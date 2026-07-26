---
status: implemented — all 4 phases shipped 2026-07-26 (reviewed, converged in 2 rounds)
last_updated: 2026-07-26
note: Make a junction *mean* something — control, right-of-way rule, and the turn movements through it. The semantic half of the thing the glyph has been drawing since the first commit.
implemented: ["Phase 1", "Phase 2", "Phase 3", "Phase 4"]
not_implemented: []
related: [specs/ramps_and_tapers_spec.md, specs/road_markings_spec.md, specs/signs_and_text_spec.md]
reference: "Assimilator's `network.yaml` `junctions` block — `control`, `rule`, `movements`, `signal_plan` — which `graph.rs` already mirrors field for field. Explicitly *not* Assimilator's simulation-only per-junction detail (`conflict_pairs`, `collision_avoidance`, `gap_acceptance`), which `graph.rs:11-15` records as deliberately omitted."
---

# Junction Semantics Spec

## 1. Goal

Zukai's junctions are **drawings of junctions that do not know they are
junctions**. `JunctionGlyphShape` (`Diagram.tsx:889`) paints a signalised cross
with stop bars and a three-aspect signal head; the `Junction` record behind it
says `control: "unsignalized"` and always has, because the single line that ever
writes one (`state.ts:496-499`) mints
`{ node_id: id, control: "unsignalized" }` and nothing else ever touches it.

That is not a missing feature; it is a **document that contradicts its own
picture**. Pick the Signals glyph and the drawing grows signal heads while the
file says the junction is uncontrolled. Pick Priority and the diamond appears
while `Junction.rule` stays absent. Save it, hand it to anything that reads the
semantic layer, and the picture and the payload disagree.

Meanwhile `Movement`, `Phase` and `SignalPlan` have been in both mirrors since
the first commit (`types.ts:67-92`, `graph.rs:142-209`) and — for the third time
in this project, after `Marking` and `Sign` — **nothing has ever read them**:
`emptyDocument` seeds `junctions: []` (`document.ts:39`), `normalizeDocument`
restores it (`:68`), and a repo-wide search finds no action, no reducer case, no
Inspector control and no element that touches `movements`, `signal_plan`, `rule`
or reads `control`.

End state — a signalised T-junction that says so. The `[Pn]` tag on each line is
the phase that enables it.

**Every arm is an opposing *pair* of links**, because that is Assimilator's model
(`graph.rs:48-49`: "a two-way street is two links with opposite
`from_node`/`to_node`") — and it is the reason the counts below are not three:

```
File ▸ a signalised T, with its turns declared

      N1 ⇄ N2 ⇄ N3     west arm   L1 (N1→N2) in,  L2 (N2→N1) out
           ⇅           east arm   L3 (N2→N3) out, L4 (N3→N2) in
           N4          south arm  L5 (N2→N4) out, L6 (N4→N2) in

  Select N2, Inspector ▸ Kind ▸ Junction   → J{N2}, control unsignalized
    Inspector ▸ Rule ▸ Priority            → rule = "priority"           [P1]
    Inspector ▸ Control ▸ Signals          → control = "signal", and     [P1]
                                             the rule clears, its row
                                             goes, and the default glyph
                                             follows to signalized_cross

    Inspector ▸ Movements ▸ + L1 → L3      → M_L1_L3 through             [P2]
    Inspector ▸ Movements ▸ + L1 → L5      → M_L1_L5 right               [P2]
      … each row: from, to, kind, delete                                 [P2]

  → the two movements drawn as arcs inside the pad                       [P3]
  → Inspector ▸ Movements ▸ Derive         → the other four              [P4]
      3 arriving × 3 leaving = 9 ordered pairs, less the 3 that turn
      back down the road they arrived on — u-turns are offerable by
      hand and never derived (§2.4)
```

## 2. Design

### 2.1 What the model already carries, and how much of it fits

`Junction` is `{ node_id, control, rule?, movements?, signal_plan? }`
(`types.ts:94-101`, `graph.rs:102-118`).

| Field | Type | In scope |
|---|---|---|
| `control` | `"signal" \| "unsignalized"` (`types.ts:59`) | ✅ Phase 1 |
| `rule` | `"priority" \| "priority_right" \| "all_way_stop"` (`:62`) | ✅ Phase 1 |
| `movements` | `Movement[]` (`:68-75`) | ✅ Phases 2–4 |
| `signal_plan` | `SignalPlan` (`:87-92`) | ❌ **deferred — OQ-1** |

`Movement` is `{ id, from_link, to_link, from_lanes?, to_lanes?, type }`, where
`type` is `MovementKind = "through" | "left" | "right" | "u-turn"`
(`types.ts:64-75`).

**No Rust, and no `SCHEMA_VERSION` bump** — the same claim the markings and signs
specs made, and for the same reason: every type here already exists in both
mirrors, and nothing below adds a field or an enum variant.
`rules/document-model.md:50` has the rule ("a new optional field costs no
`SCHEMA_VERSION` bump; a new enum *variant* does"), and the version stays at **2**
(`types.ts:239`, `mod.rs:42`).

**Why signal plans are cut, and it is not squeamishness.** A `SignalPlan` is
`{ cycle_time, offset, phases }` and a `Phase` is `{ id, duration,
green_movements?, permitted_movements?, amber_time, all_red_time }`
(`types.ts:77-92`) — six numbers and two id lists per stage. Zukai is a tool for
*drawing*, and **a fixed-time plan is a table, not a picture**: cycle time and
all-red clearance have no schematic representation at all, so an editor for one
is a spreadsheet bolted to a diagram rather than a diagram. The one part that
*is* drawable — which movements run together in a stage — depends on movements
existing first, which is what this spec builds. See OQ-1, where the cut is put to
review rather than assumed.

### 2.2 The glyph and the control are two different questions (decision, recorded)

The obvious fix for §1 is to make the Glyph picker write `control`. **It should
not**, and the reason is the split `rules/document-model.md` is built on:

- `JunctionView.glyph` is **presentation** — one of six drawings
  (`Inspector.tsx:172-179`), dropped on export, and chosen because it reads well
  on the page. `roundabout` and `gore` are glyphs with no control meaning at all,
  and `t_junction` is a *shape*, not a rule.
- `Junction.control` is **semantics** — two values, exported to Assimilator, and
  orthogonal to how the intersection is drawn. A signalised junction drawn as a
  plain pad is a legitimate schematic choice; a roundabout can be signalised.

Collapsing them would make the glyph row unable to say things that are true, and
would put a render hint in the export path. So `control` gets **its own control**
in the panel, and the two stay independent — which leaves the §1 contradiction
half-solved, because a human can still pick Signals-the-glyph and
unsignalized-the-control.

**The answer is a nudge, not a constraint.** Setting `control` to `signal` on a
junction still wearing the default `generic` glyph **also sets the glyph to
`signalized_cross`**, and setting it back to `unsignalized` from a
`signalized_cross` glyph returns it to `generic` — but only from the *default*,
and never on a junction whose glyph the human has deliberately chosen
(`roundabout`, `gore`, `priority_cross`, `t_junction`). One action, two writes,
and the human's own choice is never overwritten. The Glyph row never writes
`control` in either direction: presentation may follow semantics, never the
reverse. (OQ-2 records the alternative — a passive warning — and why it lost.)

### 2.3 A movement is a relation, not an object on the canvas (decision, recorded)

Both prior decoration specs had to answer "how is one placed?" and both answered
with a pointer gesture — `addMarking` projects a click onto a road
(`rules/road-markings.md`), `addSign` drops one where the pointer is
(`rules/signs.md`). **A movement has no such question**: it is a pair of links
already in the document, so it is created by *naming* them, not by pointing at a
place.

That has three consequences worth stating before anything is built:

- **No tool, no `TOOL_KEYS` entry, no canvas gesture.** The junction panel is a
  movement's only home — the way a `Lane` is already minted by the Lanes stepper
  (`setLinkLanes`, `state.ts:589-621`) and never by pointing at anything. What is
  new is only that a movement is minted *and named* there.
- **No fifth `Selection` arm** — and this is the one place this spec is *smaller*
  than its two predecessors rather than larger. A movement is selected the way a
  lane is: by being a row in the panel of the thing that owns it. Adding a
  `Selection` arm would mean a canvas hit target for something whose drawn form
  (Phase 3) is a thin arc inside a pad already crowded with hit discs, and would
  drag in the four narrowing sites `signs §2.6` catalogued for no gain. Delete is
  a per-row button, not the Delete key. (OQ-3 revisits this if Phase 3's arcs turn
  out to want selecting.)
- **The `Junction` record is the container, so every write is a nested update.**
  `doc.junctions` is an array searched by `node_id`, and a movement lives inside
  one — so `addMovement` rewrites one `Junction` inside `doc.junctions`, the way
  `setLinkLanes` rewrites one `Link`. `document.ts` has `findNode`, `findLink`,
  `findMarking` and `findSign` (`:175-199`) but **no `findJunction`**; this spec
  adds it, as the panel and every action need it.

**A movement's id is `M_<from>_<to>`** — `M_L1_L3`, which is `graph.rs:145`'s own
documented example (OQ-6, resolved). It is not minted by `nextId`, and that is
the point twice over: `nextId` parses a **numeric** suffix (`document.ts:129-138`)
so it could not produce this shape, and the `M` prefix is already markings'
(`state.ts:696`), so an `M1` that meant a movement in one place and a marking in
another would be a genuine reading hazard even though the two ids live in separate
namespaces. The ordered pair also **is** the uniqueness rule — one movement per
(arriving, leaving) pair — so `addMovement`'s duplicate check is an id lookup
rather than a second predicate.

### 2.4 Direction is real, and the arms deliberately do not carry it

A `Link` is **directed** — `from_node`/`to_node`, and `graph.rs:48-49` says a
two-way street is two links with opposite ends. So a movement through node `N` is
well-defined: `from_link` must be a link whose **`to_node === N`** (traffic
arriving) and `to_link` one whose **`from_node === N`** (traffic leaving). That is
the whole legality rule, it is pure, and it is what the panel's two pickers are
populated from.

**The u-turn pair is legal, and `Derive` still will not mint one.** The rule above
admits the pair where the leaving link is the arriving one's opposing carriageway,
and `MovementKind` has a value naming exactly that — so `legalMovements` returns
it and the add-picker offers it. `deriveMovements` (Phase 4) **excludes** it. The
two are different jobs: the picker offers everything the model can express, while
Derive is a convenience, and silently granting a u-turn at every junction in the
document is the kind of thing §2.8 already refuses for movements as a whole. A
u-turn is a permission a human grants deliberately.

Which pair that is needs **no geometry at all**: `from.from_node === to.to_node`
is exactly "leaves back down the road it arrived on". On §1's T that identifies
`L1→L2`, `L4→L3` and `L6→L5` — the three of the nine that Derive drops.

**Classifying the other three kinds, stated because the sign is a trap.**
`junctionArms` hands back directions *away* from the node, so travel **into** the
junction on the arriving link is the negation of its arm and travel **out** on the
leaving link is its arm as given:

```
din  = -arm(from_link).dir        dout = +arm(to_link).dir
cross = din.x * dout.y - din.y * dout.x
dot   = din.x * dout.x + din.y * dout.y

|angle| < 45°  → through          (dot > cos 45°)
cross > 0      → right            otherwise → left
```

The `otherwise` is deliberate rather than lazy: it swallows `cross === 0` with
`dot < cos 45°`, which is two distinct roads leaving the node on the *same*
bearing as the approach arrives — degenerate, float-unreachable in practice, and
not a u-turn (the topological test above has already claimed those). `gorePair`
disposes of its own exact tie the same way, and `setMovementKind` is the repair if
one ever appears.

**Positive cross is a *right* turn**, because SVG's y grows downward and that
makes a positive cross product clockwise on screen — the identical handedness trap
`DRIVE_SIDE` spends four lines of doc-comment on (`geometry.ts:596-599`). Getting
it backwards is self-consistent and would pass a test written from the same wrong
premise, which is why Phase 2's gate pins a **named** turn on a **named** bearing
rather than "a left and a right".

A link with no drawable polyline (`drawnPolyline` returns `undefined` for a node
with no layout entry — the case `junctionArms` skips with `continue`,
`Diagram.tsx:362-363`) is **skipped by `legalMovements`**, so the picker never
offers one; `movementKind` falls back to `through` for the hand-edited document
that carries one anyway, with `setMovementKind` as the repair.

**The drawn arms cannot supply it, and that is by design.** `junctionArms`
(`Diagram.tsx:352-378`) orients every arm *outward* from the node regardless of
which way traffic runs — `geometry.ts:503-505` states it outright, because
`gorePair` needs a symmetric geometric frame rather than a directional one. So
Phase 3 draws a movement by pairing the **link ids** (`Arm.id`, `Diagram.tsx:329`,
which exists for exactly this class of lookup) rather than by asking an arm which
way it points. The arm supplies position and width; the model supplies direction.

A consequence worth naming: on a one-way fragment some ordered pairs are simply
not offerable, and on an undivided two-way road drawn as a single link the
opposing movement cannot be expressed at all. That is Assimilator's model, not a
gap this spec introduces — and the "no opposing carriageway" case is what
markings Phase 4's double centreline already papers over visually.

### 2.5 The third cascade answer, and the delete arm that does not know yet

Deleting a link has needed a different answer each time:

| Owner | Deleting its link | Where |
|---|---|---|
| `Marking` | **drops it** — nothing draws a marking whose road is gone | `keepMarkings`, `state.ts:1030` |
| `Sign` | **clears `associated_link`, keeps the sign** — a sign is free-standing | `clearSignLinks`, `:1031` |
| `Movement` | **drops it** — a turn from nowhere to nowhere is not a turn | this spec |

So a movement takes the *marking's* answer, and the reason is the same one: a
`Movement` naming a deleted link is not a degraded object, it is a meaningless
one.

**Both delete arms need it, and neither has anything today.** `deleteSelection`'s
link arm (`state.ts:1021-1035`) rewrites `markings` and `signs` and **never
touches `doc.junctions`**; the node arm (`:1067-1103`) drops the junction record
of the node being deleted (`:1091`) but does nothing about movements in *other*
junctions that name the links it just dropped — and it already builds the
`dropped` set both cascades use (`:1076-1084`). Neither is a live bug today,
because `movements` is always empty; **both become live in Phase 2**, which is
why the cascade ships in the same phase as the field rather than after it.

`clearSignLinks`'s hard-won lesson applies verbatim (`rules/signs.md`): a cascade
that rebuilds `doc.junctions` unconditionally hands history a fresh array for a
document nothing changed in. The pre-check comes first.

### 2.6 The two turn vocabularies, and the hyphen between them

The project now has **two** enumerations of a turn, they are not the same, and
the difference is one character:

| | Values | Where |
|---|---|---|
| `MovementKind` | `through`, `left`, `right`, **`u-turn`** | `types.ts:65`; Rust `#[serde(rename = "u-turn")]`, `graph.rs:174` |
| `TurnDirection` | `through`, `left`, `right`, `slight_left`, `slight_right`, **`u_turn`** | `types.ts:106-112` |

`MovementKind`'s hyphen is **Assimilator's spelling and must not be "fixed"** —
it is what the `network.yaml` carries. `TurnDirection`'s underscore is Zukai's
own, has two extra values (`slight_left`/`slight_right`) that the semantic model
has no room for, and belongs to a *painted arrow* (`MarkingKind::TurnArrow`),
which is decoration.

They stay separate. Any bridge between them — deriving a lane's turn arrow from
the movements that use it — is a **non-goal** (§2.8), and this table exists so
that a later pass reaching for one starts from "these are two vocabularies with a
deliberate spelling difference" rather than discovering it in a failing
round-trip.

### 2.7 Where the logic lives

| Piece | Where | Pure? |
|---|---|---|
| `findJunction` | `src/model/document.ts` | ✅ `document.test.ts` |
| `movementId(from, to)`, `movementKind(...)`, `legalMovements(doc, nodeId)` | `src/editor/geometry.ts` | ✅ `geometry.test.ts` |
| `movementArc(from, to, …)` — the drawn path | `src/editor/geometry.ts` | ✅ `geometry.test.ts` |
| `setJunctionControl`, `setJunctionRule`, `addMovement`, `deleteMovement`, `setMovementKind`, `deriveMovements`, the two cascade sites | `src/editor/state.ts` | ✅ `state.test.ts` |
| `MovementShape`, drawn **inside `JunctionGlyphShape`** — *not* a top-level sibling layer | `src/components/Diagram.tsx` | ✅ `Diagram.test.tsx` |
| The Control/Rule rows and the Movements list | `src/components/Inspector.tsx` | — the `bun run dev` pass |
| `.jn-movement` and its arrowhead | `src/styles/diagram.css` | ✅ `export.test.ts` |

**"Inside `JunctionGlyphShape`" is load-bearing, not a stylistic preference.**
`.jn-pad` is `fill: var(--asphalt)` — **opaque** — so an arc drawn as a top-level
sibling layer in `Diagram` before the node map would be painted over completely
and render invisible, while still passing any assertion about source order.
Markings and signs are both sibling layers and the word "layer" is theirs, which
is exactly why it is not used here: these arcs are an *interior detail of the
glyph*, so `JunctionGlyphShape` (`Diagram.tsx:889`) gains a `movements` prop it
does not have today and draws them after the pad and before the stop bars.

`strokeAllowance` (`export.tsx:70`) is expected to need **no** change: a movement
arc is drawn *inside* the junction pad, which is already inside the frame. Phase 3
asserts it rather than assuming, on the precedent of every prior phase that said
the same.

### 2.8 Non-goals

- **Signal plans** (`SignalPlan`, `Phase`) — §2.1, OQ-1. Deferred to a follow-up
  spec, not abandoned.
- **No movement→turn-arrow bridge.** §2.6 says why: two vocabularies, and a
  painted arrow is a human's decoration rather than a derivation.
- **No conflict matrix, no gap acceptance, no detectors.** `graph.rs:11-15`
  already records these as deliberately omitted from the mirror; nothing here
  changes that.
- **No lane-level movement editing in this spec.** `Movement.from_lanes` /
  `to_lanes` are optional (`types.ts:72-73`, `graph.rs:151-157`, empty meaning
  "no lane detail") and this spec leaves them empty — a lane-pair matrix is a
  second editor, and the schematic reads the same without it. OQ-4.
- **No auto-created movements on junction creation.** `setNodeKind` keeps minting
  a bare junction; Phase 4's Derive is a button a human presses, for markings
  Phase 1's reason — a document should not silently acquire a dozen records.
- **`t_junction` still draws a plain pad.** Ramps OQ-7 was deferred "for the
  junction-semantics spec by decision" — and this spec **declines it**, because
  §2.2 is the discovery that the glyph vocabulary is presentation and belongs to
  a rendering pass, not to the semantic one. Recorded as OQ-5 rather than quietly
  dropped.

## 3. Open questions

- **OQ-1** — **Is cutting signal plans right?** §2.1 argues a fixed-time plan is
  a table rather than a picture, and that the drawable part (which movements share
  a stage) needs movements first. The counter-argument is that `signalized_cross`
  already exists and a signalised junction with no plan is as half-said as today's
  `control`. Proposed: **cut**, with a follow-up spec once movements have shipped
  and there is something real to group. **This is the question review should push
  hardest on**, because it sets the size of everything below. (design-call.)
- **OQ-2** — **Nudge the glyph, or warn?** §2.2 takes the nudge (set `control` to
  `signal` and a *default* glyph follows). The alternative is to leave both alone
  and show a passive note in the panel when they disagree. The nudge was chosen
  because it makes the common case correct with no reading required, and the
  "only from the default" clause is what keeps it from overwriting a human's
  choice; a warning nobody acts on leaves §1's contradiction in the file.
  (design-call, taken — but the exact set of glyphs the nudge fires from is worth
  a second opinion.)
- **OQ-3** — **Should a drawn movement be selectable?** §2.3 says no and gives the
  cost of yes. Revisit only if Phase 3's arcs read as objects a human wants to
  click. (design-call; not in scope for any phase here.)
- **OQ-4** — **`from_lanes`/`to_lanes`, ever?** Left empty (§2.8). Assimilator
  accepts that ("empty for a movement with no lane detail", `graph.rs:151-152`),
  and a lane-pair matrix at a 4-arm junction is a large editor for something the
  schematic does not show. Likely wanted by the export spec rather than by this
  one. (design-call; deferred.)
- **OQ-5** — **`t_junction`'s plain pad** (ramps OQ-7, inherited). §2.8 declines
  it here and says why. It wants a rendering pass, not this one. (design-call;
  re-deferred, explicitly.)
- **OQ-6 RESOLVED — `M_<from>_<to>`** (round 1). `nextId` (`document.ts:129-138`)
  parses a **numeric** suffix, so it could not produce `graph.rs:145`'s documented
  example `M_L1_L3` anyway; and the `M` prefix is already what markings use
  (`state.ts:696`), so an `M1` meaning a movement in one file and a marking in
  another is a reading hazard even across separate namespaces. The rejected
  alternative was a distinct prefix (`MV`) through `nextId`, which mints an
  opaque number where the pair is the identity. Landed in §2.3, including the
  consequence that the id **is** the duplicate check.
- **OQ-7** — **Does a movement survive its link being *replaced*?** A lane-count
  change is modelled as two links meeting at a waypoint (`graph.rs:49-50`), so a
  human "editing" a road may in fact delete and recreate a link, silently dropping
  its movements via §2.5's cascade. Probably acceptable and certainly out of scope,
  but worth naming before someone reports it as data loss. (design-call; recorded.)

## 4. Implementation phases

Strictly sequential; each is one plan-mode pass with a concrete exit gate.

### Phase 1 — Control and rule: the glyph stops lying

- **Scope:** the smallest change that makes the document agree with its picture,
  and it needs no new type, no geometry and no rendering.
  - *Model:* `findJunction(doc, nodeId)` in `document.ts`, beside the four finders
    at `:175-199`.
  - *State:* `setJunctionControl(id, control)` and `setJunctionRule(id, rule?)` —
    both rewriting one `Junction` inside `doc.junctions`. `setJunctionControl`
    carries §2.2's nudge (a `generic` glyph follows to `signalized_cross`, a
    `signalized_cross` back to `generic`, every other glyph untouched) and
    **clears `rule` when going to `signal`**, since `graph.rs:109` says `rule` is
    `None` when signalized. `rule` is an **absent key, never `undefined`** — the
    one-representation rule `Marking.lane` and `Sign.associated_link` already
    follow.
  - *The two hand-edited cases, both reachable and neither an error.* A node of
    kind `junction` with **no `Junction` record**: every action returns `state` by
    identity (`if (!findJunction(...)) return state`, the guard `moveSign` and
    `setMarkingKind` already use), and the panel renders no Control row. A
    junction with **no `layout.junctions` entry**: the nudge treats it as
    `generic` and writes `signalized_cross`, which is `JunctionFields`' own
    `view?.glyph ?? "generic"` (`Inspector.tsx:1005`) rather than a second rule —
    and `setJunctionView` (`state.ts:517-538`) already creates a missing view.
  - *Inspector:* a Control segmented row and a Rule row in `JunctionFields`
    (`Inspector.tsx:995-1048`), the Rule row rendered **only while unsignalized**
    and carrying **"None" first**, which is how the absent key is reached from the
    UI — `SignLink`'s exact idiom (`Inspector.tsx:862`), for its reason: a field
    nothing can clear is a field only a hand-edited file can clear.
- **Exit gate:** `bun run build` + `bun run test` green.
  - `state.test.ts`: setting Control writes `control` and is undoable; the nudge
    moves a `generic` glyph and **leaves a `roundabout` alone** (the assertion that
    can actually fail); going to `signal` drops a `rule` that was set; picking
    "None" leaves **no `rule` key** rather than `undefined`; a junction already in
    the target state returns `doc` **by identity**, or history takes a snapshot for
    nothing (`rules/history.md`); a junction-kind node with no `Junction` record
    returns `state` by identity from both actions.
  - `document.test.ts`: `findJunction` finds one and returns `undefined` for a node
    with no record.
  - A `bun run dev` pass: on the **Control** row (not the Glyph row, which labels
    `signalized_cross` "Signals" too — `Inspector.tsx:175`) pick Signals, and
    confirm the glyph follows and the Rule row disappears; then set the glyph to
    Roundabout, toggle Control off and on, and confirm the roundabout is *kept*.
- **Docs touched:** a new `rules/junctions.md` or a section of an existing rule —
  decide in the plan, on the "who chose it" line markings and signs Phase 1 used;
  **`CLAUDE.md`**, whose spec list carries this spec's `status` and whose
  `rules/` list gains whatever Phase 1 writes; the project-memory roadmap.
- **As built (2026-07-26)** — the phase landed as scoped; no departure from the
  design, four decisions the scope line left to the plan, and one assertion added
  beyond the gate:
  - **The docs question resolved to a new `rules/junctions.md`**, on markings' and
    signs' precedent: three more phases are coming (movements, their geometry,
    their drawing), and the alternative host — `rules/road-rendering.md` — is about
    how a *road* is drawn, which is precisely the layer §2.2 spends itself
    separating this from. It opens by saying `movements` and `signal_plan` are
    still fields nothing reads, so the file cannot be mistaken for a map of a
    subsystem that exists.
  - **The Rule row is a segmented row, not `SignLink`'s `<select>`.** The gate cites
    that control for its **"None" first** idiom, which is what got copied; the
    dropdown *form* did not, because `SignLink`'s own doc-comment gives the
    discriminator — its option count is the document's (every link in the file),
    while this one's is the vocabulary's. It takes
    `segmented-labels`, since `.seg`'s `text-transform: capitalize` renders
    "All-way Stop", and a fourth `segmented-rules` two-to-a-row rule beside
    `segmented-kinds`/`segmented-dirs`.
  - **Control and Rule sit *above* Glyph and Size** — semantics above
    presentation, which also puts the nudge's cause above its visible effect.
  - **`nudgedGlyph` is its own named function** rather than two lines inside
    `setJunctionControl`, because the "only from the default" clause is the whole
    of §2.2 and deserved somewhere to be stated. The nudge is applied by composing
    the existing `setJunctionView`, so the missing-view case needed no code.
  - **One assertion beyond the gate, and it is the one that would have caught a
    plausible wrong implementation**: toggling Control on a `roundabout` leaves
    `doc.layout.junctions` identical **by reference**. A nudge written as an
    unconditional `setJunctionView` with the current glyph passes every
    behavioural assertion — the glyph *is* still `roundabout` — while handing
    history a fresh layout map on every control click. `clearSignLinks`'s lesson
    (§2.5), arriving a phase earlier than expected.
  - **Also asserted, and not in the gate:** coming back from `signal` to
    `unsignalized` **keeps** a `rule`. The clear is one-directional by design
    (`graph.rs` says `rule` is `None` when signalized, and says nothing about
    inventing one on the way out), and only a hand-edited file can reach that
    state — which is exactly why it wanted pinning.

### Phase 2 — A movement exists: the whole pipeline, from the panel  (depends on Phase 1)

- **Scope:** the whole lifecycle for a movement, with **no drawing at all** —
  Phase 3's job — because a movement's home is the panel (§2.3) and it is
  reachable, listable and deletable there without a pixel.
  - *Geometry:* `movementKind(doc, nodeId, fromLink, toLink)` — §2.4's rule
    exactly: the topological u-turn test first, then the cross/dot bands off the
    drawn polylines the way `junctionArms` reads them; and
    `legalMovements(doc, nodeId)` — every ordered (arriving, leaving) pair,
    **u-turn pairs included**, undrawable links skipped (§2.4). Both pure.
  - *State:* `addMovement(nodeId, from, to)` (minting `M_<from>_<to>` per §2.3,
    classifying via `movementKind`, rejecting a duplicate pair by identity),
    `deleteMovement(nodeId, movementId)`, `setMovementKind(nodeId, movementId,
    kind)` for the hand-override; and **§2.5's cascade in both delete arms**
    (`state.ts:1021-1035` and `:1067-1103`, the latter reusing its `dropped` set).
  - *Inspector:* a Movements section — one row per movement (from, to, a kind
    picker, a delete button) and an "add" control with two `<select>`s populated
    from `legalMovements`.
- **Exit gate:** `bun run build` + `bun run test` green.
  - `geometry.test.ts`: on §1's T, an approach arriving **from the west** turning
    into the **south** arm is a `right` and into the **east** arm a `through` — a
    *named* turn on a *named* bearing, because §2.4's handedness is
    self-consistently invertible and "a left and a right" would pass backwards.
    Repeated on **L6**, which arrives from the *south* on the same fixture, so the
    rule is not axis-specific — travelling north, its turn into the west arm
    (`L6 → L2`) is a `left` and into the east arm (`L6 → L3`) a `right`.
    `legalMovements` on §1's T returns **9** pairs including the
    three u-turns; it offers only arriving→leaving; it returns **nothing** at a
    node with one link; and it skips a link whose node has no layout entry.
  - `state.test.ts`: adding, re-kinding and deleting a movement are each one undo
    step; a duplicate pair returns `doc` by identity; deleting a **link** drops
    every movement naming it — as `from_link` **and** as `to_link` — and **leaves
    an unrelated junction's array identical by reference** (the `clearSignLinks`
    identity lesson, §2.5); deleting a **node** does the same for its incident
    links' movements in *other* junctions.
  - A `bun run dev` pass on §1's T-junction: add `L1 → L3` and `L1 → L5`, confirm
    the picker offers the u-turn `L1 → L2` and no arriving→arriving pair, delete
    one, undo it back.
- **Docs touched:** the Phase 1 rule file; `rules/history.md` only if any control
  here coalesces (none is expected — every one is a deliberate click).
- **As built (2026-07-26)** — the phase landed as scoped: three actions, two pure
  functions, two panel rows, and the cascade in both delete arms. Nothing coalesces,
  so `rules/history.md` needed nothing, as predicted. Five decisions the scope line
  left open, and one assertion the gate did not ask for:
  - **`legalMovements` also excludes a link paired with *itself*.** §2.4's rule
    ("`to_node === N`" and "`from_node === N`") admits the self-loop pair `(L, L)`,
    which is not a turn. `completeLink` refuses to draw a self-loop, so only a
    hand-edited file can hold one — the same degenerate link `carriageways` already
    excludes from a carriageway pair, and the guard is copied from there.
    `addMovement` rejects `from === to` for the same reason.
  - **An empty `movements` is stored as an absent key**, in one place
    (`withMovements`), because Rust elides an empty vec — the one-representation
    rule `rule` already follows a phase earlier. Deleting the last movement and a
    cascade that strands every one both leave no key behind. The spec did not say,
    and `[]` would have been a second encoding of the same document.
  - **Both pure functions compute `carriageways(doc)` themselves**, which keeps
    §2.7's 4-argument signature and spares `state.ts` a second derivation. Every
    other geometry entry point takes `offsets` from its caller; these two are called
    from the reducer and the panel rather than from a render pass that already has
    them.
  - **The panel subtracts what is already permitted from what `legalMovements`
    offers.** The function answers what the *model* allows; what is left to add is
    the panel's question. It also keys that `Set` on `movementId`, which is the one
    place both halves of "the id is the pair" meet.
  - **`MovementAdd` is the panel's first `useState`** — unavoidable, and worth
    naming: a movement needs two names before it is anything, so it is the only
    control here that cannot dispatch on change. Both picks are *derived* against
    the live options rather than reset by an effect, so a pick a later render made
    illegal is inert.
  - **One assertion beyond the gate**: deleting a link that **no** movement names
    leaves `doc.junctions` identical **by reference**. The gate asks for the
    unrelated-junction case, which a `map` with a per-junction early return already
    passes; only this one fails a cascade written without `clearSignLinks`'
    pre-check, and that is the bug the pre-check exists for.
  - The dev pass ran on §1's T built through the UI. Recorded because two of its
    results are the phase's real proof: after picking `L1` the exit picker offered
    exactly `L2`, `L3`, `L5` — the u-turn among them and no arriving link — and the
    two rows read `L1 → L3 Through` and `L1 → L5 Right`, the named turns on named
    bearings, live.

### Phase 3 — Movements drawn through the junction  (depends on Phase 2)

- **Scope:** `movementArc` in `geometry.ts`, and `MovementShape` rendered
  **inside `JunctionGlyphShape`** (`Diagram.tsx:889`), which gains a `movements`
  prop — *not* a top-level sibling layer, because `.jn-pad` is opaque asphalt and
  would paint over one (§2.7). Drawn after the pad and before the stop bars, from
  the two arms found **by link id** (`Arm.id`) — never from an arm's direction
  (§2.4). One `.jn-movement` rule plus an arrowhead in `diagram.css`.
- **Exit gate:** `bun run build` + `bun run test` green.
  - `geometry.test.ts`: an arc starts on its approach arm and ends on its exit
    arm, and a `through` movement's arc is **straighter** than the `left` on the
    same junction — a shape test, since a magnitude one passes for any curve.
  - `Diagram.test.tsx`: a junction with no movements is **byte-identical** to
    today (the regression that matters); a movement draws one element; and the arc
    sits **after `jn-pad` and before `jn-stopbar`** in source order — the
    assertion that catches the invisible-arc bug a "before the stop bars" test on
    its own would pass while the arcs were painted over.
  - `export.test.ts`: the arcs travel, their rule is in the stylesheet, and
    `strokeAllowance` is unchanged from the same document without them (§2.7).
  - A `bun run dev` pass on §1's T — the arcs must be **visible**, which is the
    half no assertion above can see.
- **Docs touched:** the rule file; `rules/road-rendering.md` if the layer order
  described there changes.
- **As built (2026-07-26)** — the phase landed as scoped: two pure functions, one
  component nested in the glyph, three CSS rules. No model change, no action, no
  `SCHEMA_VERSION` move, and `cargo check` run once to confirm the frontend-only
  claim. Two decisions taken with the human before planning, three the scope line
  left open, and three assertions beyond the gate:
  - **Two of the six glyphs draw no arc** (asked, not assumed). `roundabout` and
    `gore` paint no pad, and a movement is white paint on asphalt — a roundabout's
    arcs would be chords across its own island and a gore's would hang over bare
    paper. Implemented as `const pad = glyph !== "roundabout" && glyph !== "gore"`,
    the render chain's own last branch named. The movements stay in the document,
    so the glyph is what withholds them and switching back returns them.
  - **Dashed white at 0.7, with a solid arrowhead** (asked). Solid is taken — the
    stop bar at 4 and the edge lines at 1.5 — so a turn guide has to read as the
    lightest of the three; the pitch is `3 3` rather than `.road-divider`'s `7 7`,
    since an arc runs ten to thirty units and `7 7` puts one dash on a tight right
    turn. The opacity is on the **group**, because the head overlaps the line's
    last few units and two translucent fills composite into a dark spot exactly
    where the eye lands.
  - **A cubic, not a quadratic, and it removed a branch rather than adding one.**
    The spec said "arc" and left the primitive open. A quadratic's single control
    point cannot hold two independent tangents, and the two pairs it fails on are
    the ordinary ones: a `through`'s rays are anti-parallel and a `u-turn`'s are
    parallel, so `rayIntersection` returns `undefined` for both — while they want
    *opposite* repairs, a straight line and a loop. `C1 = start + k·din`,
    `C2 = end − k·dout` needs no repair at all.
  - **`k` is the standard cubic-arc constant**, `(4/3)·tan(θ/4)·r` over
    `2r·sin(θ/2)` — `1/3` of the chord as θ→0, `0.3905` at a right angle, `2/3` at
    a u-turn. Chosen over a flat `chord/3` because that draws a u-turn at half
    depth **while still passing every "straighter than" assertion**, which is the
    gate's own test and would not have caught it.
  - **`MovementEnd` rather than `GoreArm`**, whose `halfSpan` is the roads' painted
    edges and whose `id` is `gorePair`'s tie-break — neither means anything to a
    curve down the middle of two carriageways. Same frame convention, and its
    doc-comment says so. `arrowTriangle` *was* reused: it already exists in
    `Diagram.tsx` for a road's own direction arrow, and `back === size` is exactly
    "apex on the end, base a head-length behind".
  - **Beyond the gate, and the one that pins the constant rather than the
    ordering**: a u-turn's apex sits exactly 13.5 — the median's half-width —
    beyond its own arm, which is a true semicircle. Also asserted: a glyph with no
    pad draws no arc *while the movement is still in the document* (the decision
    above, and nothing else would notice it coming back), and a movement naming a
    link with no arm here draws nothing.
  - The dev pass rendered §1's T through the real export path at 5× and read it:
    the through straight, the right a tight corner, the u-turn hooked around the
    median, the left sweeping north-east before turning west — and a two-way 4-arm
    cross with all **12** derived by hand, which reads as a web rather than a
    tangle. Phase 4's own dev-pass count, confirmed a phase early.

### Phase 4 — Derive: every legal turn at once  (depends on Phase 3)

- **Scope:** `deriveMovements(nodeId)` — `legalMovements` **less the u-turn
  pairs** (§2.4), classified through `movementKind`, added as **one** undoable
  action, **merging rather than replacing** (a movement the human already added or
  re-kinded by hand survives untouched, matched by ordered pair — which its id
  already is, §2.3). One button in the Movements section.
- **Exit gate:** `bun run build` + `bun run test` green.
  - `state.test.ts`: Derive on §1's T mints exactly **6** — the 9 ordered pairs
    less the 3 u-turns — and no duplicate; a **hand-added u-turn survives** a later
    Derive while Derive still never mints one (the two halves of §2.4's split, and
    the pair of assertions that pin it); running Derive **twice** is one undo step
    and a no-op the second time, returning `doc` by identity; a hand-set `kind`
    **survives** a later Derive (the merge assertion, the one a
    replace-implementation fails); one undo removes the whole batch.
  - A `bun run dev` pass: Derive on a two-way 4-arm cross (12 movements), confirm
    the count and that the arcs read rather than tangling.
- **Docs touched:** the rule file; the project-memory roadmap; mark this spec
  `implemented`, and open the signal-plan follow-up if OQ-1 held.
- **As built (2026-07-26)** — the phase landed as scoped, and is the smallest in
  the spec: one action, one pure function, one button, no model change and no
  Rust (`cargo check` run once to confirm). Every gate assertion passed as
  written, including the literal **6**. Three decisions the scope line left open,
  and two assertions beyond the gate:
  - **`derivableMovements` is its own exported pure function**, not a filter
    inlined into the reducer, because **the panel has to ask the same question**:
    the button must be `disabled` exactly when the action would return the
    document by identity, and a private u-turn predicate in `Inspector.tsx` would
    be a second statement of §2.4's split in the one file with no test. It is
    also *not* `addable.length` — a junction with every crossing turn permitted
    still has u-turns left to **add** and nothing left to derive, which is the
    same split seen from the panel.
  - **The u-turn subtraction goes through `movementKind`**, not through a second
    copy of `from.from_node === to.to_node`. That comparison is already that
    function's *first* line, before any geometry, so filtering on the kind it
    returns **is** the topological test — said once, in the vocabulary the
    movement is stored in. Nothing in the spec required this; it fell out of
    Phase 2's decision to run the topological test first.
  - **The button is shown when spent rather than hidden** (asked, not assumed),
    which makes it the one row in this panel that does not follow `MovementAdd`'s
    hide-when-empty idiom. The reason is that the two are wanted at opposite
    moments: Add is a control a human is mid-way through using, while Derive is
    wanted precisely at the junction whose Movements field reads `None` — the
    worst possible place to hide the button that fixes it. Greying it is also how
    "everything legal is already permitted" gets said at all.
  - **Beyond the gate, and the one a `withMovements` call for nothing would
    fail**: Derive at a junction where the *only* pair is a u-turn returns `doc`
    by identity and leaves no `movements: []` key behind. Also asserted: Derive
    leaves the document's **other** junction untouched, the identity habit this
    file has kept since Phase 1.
  - The dev pass drove the real app rather than the export path: a two-way 4-arm
    cross built through the UI, one click on **Derive all turns** → **12** rows
    and 12 arcs, the button enabled → disabled, one undo clearing the lot and one
    redo returning it. Both halves of §2.4's split were then read live in a single
    document — a hand-added `L2 → L1` u-turn sitting first in the list and
    surviving a Derive that minted none of its own (13 rows). All twelve kinds
    were correct on all four approaches, which is the handedness pinned once more
    on two axes it was never tested on.

## 5. Review log

**Round 1 — 2026-07-26 — `NOT READY` → fixed.** Clean-room reviewer with repo
access; every `file:line` in §§1–2.8 opened and checked against the source, and
the "nothing reads them" claim re-verified by grep. All citations held **except
two of my own making**, caught in the same pass: signs Phase 4 had added a line to
`SIGN_PICKER` earlier the same day, shifting `GLYPHS` down one, so
`Inspector.tsx:172-178`/`:174` were stale by a line before this spec was a day
old. Corrected to `:172-179`/`:175`. A standing hazard worth naming: **a spec
drafted against a file the same session edited carries line numbers that were true
when read and false when committed.**

*Three blocking findings, all accepted — and all one root cause:*

1. **§1's usage example added a movement its own §2.4 rule forbids.** The sketch
   drew `N2 ◀──L2── N3`, making `L2` an *arriving* link at N2, so `+ L1 → L2` was
   arriving→arriving and not offerable — while Phase 2's gate said "add both
   movements, confirm the pickers offer only legal pairs", a check no implementer
   could perform. **Resolved**: §1 is now an explicit **two-way** T with all six
   links named and their directions given, which is Assimilator's actual model
   (`graph.rs:48-49`) and the thing the one-way sketch was papering over.
2. **"All 6 legal turns" was arithmetically impossible for the T that §1 drew.**
   Three links give `|arriving| × |leaving|` = 2 pairs, never 6; six is the count
   for a two-way T. Phase 4's gate ("mints exactly the legal set") therefore had
   no determinate expected value, and Phases 3 and 4 described different documents.
   **Resolved** by the same rewrite, with the arithmetic now shown in §1 (9 ordered
   pairs less 3 u-turns) and pinned as a literal **6** in Phase 4's gate.
3. **Whether `legalMovements`/Derive include the u-turn pair was undefined and
   self-contradictory** — §2.4's "every ordered pair … that is the whole legality
   rule" admits it, §1's "6" required excluding it, and the choice changes Phase 2's
   function, Phase 4's count and how many arcs Phase 3 paints. **Resolved** in §2.4
   as a deliberate *split*: `legalMovements` returns u-turns and the picker offers
   them, `deriveMovements` never mints one. Identified with **no geometry** —
   `from.from_node === to.to_node` — and both halves pinned in Phase 4's gate.

*Nine non-blocking findings, all accepted and folded in:* `movementKind`'s
classification rule was never stated, including the y-down handedness — now spelled
out in §2.4 with the explicit warning that getting the sign backwards is
self-consistent and would pass a test written from the same wrong premise
(`DRIVE_SIDE`'s own trap, `geometry.ts:596-599`), and Phase 2's gate now pins a
*named* turn on a *named* bearing rather than "a left and a right". Phase 3 left
sibling-layer vs. child-of-glyph ambiguous, and the reviewer showed `.jn-pad` is
opaque asphalt — so a top-level layer would render **invisible arcs while still
passing the stated source-order gate**; §2.7 and Phase 3 now require nesting inside
`JunctionGlyphShape` and the gate asserts *after* `jn-pad`. OQ-6 was
answerable-from-code and is **RESOLVED** (`M_<from>_<to>`, inlined into §2.3, with
the id doubling as the duplicate check). Phase 1 gained the two hand-edited cases
(no `Junction` record → identity return; no `layout.junctions` entry → treated as
`generic`), a **"None"** option so `rule` can be cleared from the UI at all
(`SignLink`'s idiom), and a dev-pass step disambiguated from the Glyph row's own
"Signals" label. `CLAUDE.md` was missing from Phase 1's reconciliation list. And
§2.3's claim to be "the first thing created purely from the Inspector" was simply
wrong — `setLinkLanes` mints `Lane`s that way already.

*Rejected:* nothing. Every finding was accepted.

**Round 2 — 2026-07-26 — `READY`.** Same reviewer resumed. All three blockers
confirmed resolved, **zero new blocking findings**, and every newly-introduced
citation verified (`Inspector.tsx:862`, `:1005`, `state.ts:517-538`, `:589-621`,
`geometry.ts:596-599`, `Diagram.tsx:362-363`, `document.ts:129-138`).

It checked the three things the round-1 fixes actually turned on, and all three
hold: the six-link table is internally consistent (arriving `{L1, L4, L6}`,
leaving `{L2, L3, L5}`); the u-turn arithmetic is exact, and the topological test
picks out precisely `L1→L2`, `L4→L3`, `L6→L5`, so 9 − 3 = 6 with 2 hand-added
leaves §1's "the other four" — and a two-way 4-arm cross is 4 × 4 − 4 = **12**, as
Phase 4's dev pass says; and the handedness is right *for the stated reason*
rather than coincidentally, since rotating `(1,0)` to `(0,1)` in a y-down frame is
clockwise on screen.

One thing it noticed that the design did not set out to buy: **running the
topological u-turn test first means the geometric bands never need a
`left`/`u-turn` boundary at all**, because a ~180° pair is either topologically a
u-turn or genuinely is not one. The round-1 non-blocking finding about the missing
band boundary is therefore closed by the round-1 blocker fix rather than by the
prose added for it.

*Three non-blocking residues, all folded in this round:*

- **Phase 2's gate asked for an approach "from the north" on a fixture that has no
  north arm.** §1's T is west/east/south. Rewritten to use **L6**, which arrives
  from the south on the same fixture — and writing that out caught **an error of
  mine the reviewer had not**: I first recorded `L6 → L2` as a `right`. Travelling
  *north*, the turn into the west arm is a **left**. Both directions are now
  computed from §2.4's own formula rather than asserted, and §1's own two
  (`through`, `right`) were re-derived the same way and hold.
- **`document.ts:175-200`** survived in Phase 1 after its twin was corrected in
  §2.3; the file is 199 lines.
- **The `cross === 0`, `dot < cos 45°` corner** — two roads leaving on the
  approach's own bearing — was unassigned. `otherwise → left` now swallows it
  explicitly, on `gorePair`'s precedent for an exact tie.

**Converged in 2 rounds.** `status: draft` → `reviewed`; cleared for
implementation, starting with Phase 1.
