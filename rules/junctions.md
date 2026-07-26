# Junctions

What a junction *means*, as opposed to what it looks like: `Junction.control`,
`Junction.rule`, and — from Phase 2 onward — the turn movements through it.
Frontend only. `Junction`, `JunctionControl`, `UnsignalizedRule`, `Movement`,
`Phase` and `SignalPlan` have all been in both mirrors since the first commit, so
nothing here crosses IPC on new terms, reaches disk in a new shape, or moves
`SCHEMA_VERSION` (still **2**). The design rationale lives in
`specs/junction_semantics_spec.md`; hand-maintained.

**Build state: Phase 2 of 4.** `control`, `rule` and `movements` are written and
read; **nothing draws a movement yet** (Phase 3). `Junction.signal_plan` is still
what it has always been — **a field nothing reads** — and so are `Movement`'s
`from_lanes`/`to_lanes`. Do not treat their presence in `src/model/types.ts` as
evidence anything consumes them.

## The three parts of a junction, and which layer owns each

A junction is not an object. It is three records keyed by the same `NodeId`:

| Part | Where | Layer | Dropped on export? |
|---|---|---|---|
| `Node { type: "junction" }` | `doc.nodes` | semantic | no |
| `Junction { node_id, control, rule?, … }` | `doc.junctions` | semantic | no |
| `JunctionView { glyph, rotation, scale }` | `doc.layout.junctions[id]` | presentation | **yes** |

`setNodeKind` (`state.ts`) mints and destroys the second and third together, so
in practice all three arrive at once — but **all three are independently
absent-able in a hand-edited file**, and every reader has to survive that. The
two cases that actually occur:

- **no `Junction` record** on a junction-kind node → both actions return `state`
  by identity, and the Inspector renders no Control row. The panel says nothing
  rather than showing an `unsignalized` that is not in the file.
- **no `JunctionView`** → read as `glyph: "generic"`. That is `JunctionFields`'
  own `view?.glyph ?? "generic"` and the renderer's default, and
  `setJunctionView` creates the entry when it writes one.

`findJunction(doc, id)` (`model/document.ts`) is the only lookup, and is **keyed
by `node_id`** — the one finder whose predicate does not read `.id`, because a
`Junction` is a record *about* a node rather than an entity beside it.

## The glyph and the control are two different questions

This is the decision the whole subsystem descends from, and the reason the fix
for "the drawing has signal heads but the file says unsignalized" is not "make
the Glyph picker write `control`".

- **`JunctionView.glyph` is presentation** — one of six drawings, dropped on
  export, chosen because it reads well on the page. `roundabout` and `gore` carry
  no control meaning at all, and `t_junction` is a *shape*, not a rule.
- **`Junction.control` is semantics** — two values, exported to Assimilator,
  orthogonal to how the intersection is drawn. A signalised junction drawn as a
  plain pad is a legitimate schematic choice; a roundabout can be signalised.

Collapsing them would make the Glyph row unable to say things that are true, and
would put a render hint in the export path. So `control` has **its own row**, and
the traffic between them runs **one way only**.

### The nudge, and its "only from the default" clause

`setJunctionControl` also moves the glyph, and `nudgedGlyph(current, control)` is
the whole of the rule:

| From | Setting control to | Becomes |
|---|---|---|
| `generic` | `signal` | `signalized_cross` |
| `signalized_cross` | `unsignalized` | `generic` |
| anything else | either | **unchanged** |

`generic` is what `setNodeKind` mints, so it is the glyph *nobody chose*;
`roundabout`, `gore`, `priority_cross` and `t_junction` are each a human's
deliberate pick and are never overwritten. One action, two writes, one undo step.

**Nothing in `setJunctionView` has a twin of this.** Presentation may follow
semantics; semantics never follows presentation. Picking a glyph — Signals
included, and the Glyph row labels `signalized_cross` "Signals" too — writes no
`control`.

The residue this leaves is deliberate: a human can still pick Signals-the-glyph
and leave the control unsignalized. The nudge makes the common case correct with
nothing to read; it does not make the contradiction unrepresentable, because
representing it is sometimes right.

## The five actions

| Action | Shape it copies | Note |
|---|---|---|
| `setJunctionControl(id, control)` | `setMarkingKind` (guard) + `setJunctionView` (the nudge) | clears `rule` going to `signal`; moves a default glyph |
| `setJunctionRule(id, rule?)` | `setSignLink` | `rule` absent clears the key |
| `addMovement(id, from, to)` | `setLinkLanes` (minted from the panel, not a gesture) | mints `M_<from>_<to>`, classified by `movementKind` |
| `deleteMovement(id, movement)` | — | the last one takes the `movements` key with it |
| `setMovementKind(id, movement, kind)` | `setLaneKind` | the hand override |

All five are **deliberate clicks**, so none appears in `coalesceKeyFor` and each is
its own undo step (`rules/history.md`).

The three movement actions take the **junction node** as `id` and the movement as a
second field — `setLaneKind`'s shape, because a movement lives inside a `Junction`
the way a lane lives inside a `Link`.

**`rule` is an absent key, never `undefined`** — the one-representation rule
`Lane.kind`, `LinkView.align`, `Marking.lane` and `Sign.associated_link` all
follow, matching Rust's `skip_serializing_if = "Option::is_none"`. Both writers
drop it by destructuring rather than assigning `undefined`. "None" in the panel is
the only route to that state from the UI; a field nothing can clear is a field
only a hand-edited file can clear.

**Clearing `rule` is `setJunctionControl`'s job, and only in one direction.**
Going to `signal` drops it, because `graph.rs` says `rule` is `None` when
signalized. Coming *back* keeps whatever is there — at that point only a
hand-edited file has one, and inventing or destroying a value is worse than
carrying it.

**`setJunctionRule` deliberately says nothing about `control`.** A rule on a
signalized junction is meaningless, but the *panel* is what withholds the row —
the posture `setMarkingLane` takes towards a marking's `kind`, and for its reason:
encoding a sibling field's state into an action that does not own it makes the
same value legal or illegal depending on something the action never touches.
`setJunctionControl` is the one place the two fields meet, because there the
change *is* to `control`.

### Two identity returns, both reachable

Each action returns `state` **itself** when there is nothing to do, so
`recordHistory` takes no snapshot and `dirty` stays put:

- no `Junction` record for the id (the hand-edited file);
- the junction is **already in the target state** — which is what re-picking the
  active segment does, on every click. `junction.rule === rule` covers
  `undefined === undefined`, so re-picking "None" on a junction with no rule is a
  no-op too.

`state.test.ts` asserts both by reference. Neither is visible behaviourally: the
cost of getting it wrong is an undo step that undoes nothing.

## A movement is a relation, not an object on the canvas

Both prior decoration specs answered "how is one placed?" with a pointer gesture —
`addMarking` projects a click onto a road, `addSign` drops one where the pointer is.
**A movement has no such question**: it is a pair of links already in the document,
so it is created by *naming* them. Three consequences, and they are why this
subsystem is *smaller* than markings and signs rather than larger:

- **No tool, no `TOOL_KEYS` entry, no canvas gesture.** The junction panel is a
  movement's only home, the way a `Lane` is minted by the Lanes stepper and never by
  pointing at anything.
- **No fifth `Selection` arm.** A movement is selected the way a lane is: by being a
  row in the panel of the thing that owns it. So `deleteSelection` never sees one,
  the Delete key does nothing to one, and **delete is a per-row button**.
- **Every write is a nested update.** `doc.junctions` is an array searched by
  `node_id` and a movement lives inside one, so all three actions go through
  `withMovements`, which rewrites exactly one `Junction`.

### The id *is* the pair

`movementId(from, to)` is `` `M_${from}_${to}` `` — `M_L1_L3`, `graph.rs`'s own
documented example. Not a `nextId` mint: that helper parses a **numeric** suffix so
it could not produce this shape, and `M1` already means a marking.

That is load-bearing rather than cosmetic. **The uniqueness rule is one movement per
ordered pair**, so `addMovement`'s duplicate check is an id lookup rather than a
second predicate, the panel subtracts what is already permitted from what
`legalMovements` offers by keying a `Set` on it, and Phase 4's Derive will match a
hand-added movement the same way.

The cost, accepted: a hand-edited file naming the same pair under a different id
gets a second movement for it. Nothing the app can produce reaches that state.

### Direction is real, and the drawn arms deliberately do not carry it

A `Link` is **directed**, so a movement through node `N` is well defined:
`from_link` ends at `N` (traffic arriving) and `to_link` starts there (traffic
leaving). That is the whole legality rule, it is pure, and it is what
`legalMovements(doc, nodeId)` returns every ordered pair of — **u-turns included**,
because the picker offers everything the model can express and it is Phase 4's
Derive that will decline to mint one. A link with no drawable polyline is skipped
(the picker must not offer a turn the drawing cannot show); a self-loop is not
paired with itself, on `carriageways`' precedent for the same degenerate link.

`movementKind(doc, nodeId, from, to)` classifies, in this order:

1. **the topological u-turn**: `from.from_node === to.to_node` is exactly "leaves
   back down the road it arrived on". No geometry — and running it *first* is what
   spares the angular bands a `left`/`u-turn` boundary, since a ~180° pair either is
   one of these or genuinely is not a u-turn.
2. the bands, off the **drawn** polylines: `dot > cos 45°` is `through`, then
   positive `cross` is `right` and everything else is `left`.

**Positive cross is a *right* turn** because SVG's y grows downward — `DRIVE_SIDE`'s
trap in the other subsystem. Getting it backwards is self-consistent and would pass
a test written from the same wrong premise, which is why `geometry.test.ts` pins
*named* turns on *named* bearings, on two different axes.

`armDirection` is `junctionArms`' body for one link, and points **away** from the
node whichever way its traffic runs — so travel *into* the junction is the negation
of the approach's arm. The drawn arms cannot supply the direction themselves and
that is by design: `gorePair` needs a symmetric geometric frame, so an `Arm` carries
no incoming/outgoing information at all. The arm supplies position; the model
supplies direction.

`movementKind` is **total**: an unknown link, one that misses the node, and one with
no drawable polyline all fall back to `through`, which the row's dropdown repairs.

### The third cascade answer

Deleting a link has now needed a different answer three times:

| Owner | Deleting its link | Where |
|---|---|---|
| `Marking` | **drops it** — nothing draws a marking whose road is gone | `keepMarkings` |
| `Sign` | **clears `associated_link`, keeps the sign** — a sign is free-standing | `clearSignLinks` |
| `Movement` | **drops it** — a turn from nowhere to nowhere is not a turn | `dropMovements` |

So a movement takes the marking's answer, for the marking's reason. Structurally,
though, it is `clearSignLinks`: it *rewrites* junctions rather than removing them, so
a `map` always returns a fresh array and **the identity has to be recovered by a
pre-check**, not by a length comparison. Without it every link deletion in a document
with a junction hands history a fresh `doc.junctions` for something nothing changed
in.

Both delete arms need it, and the node arm's job is about **other** junctions: the
deleted node's own record goes whole, and then the `dropped` set that arm already
builds cleans its incident links out of any neighbour that permitted a turn onto
one.

### An empty list is an absent key

`withMovements` states it once: `movements: []` is never stored. Rust elides an
empty vec (`skip_serializing_if = "Vec::is_empty"`), so the two encodings save to
the same bytes while differing by document identity — the one-representation rule
`rule`, `lane` and `associated_link` all follow. Deleting the last movement, and a
cascade that strands every one, both leave no key behind.

## The panel

`JunctionFields` (`components/Inspector.tsx`) renders, in this order:

1. **Control** — a plain `.segmented` row (`CONTROLS`), only when a `Junction`
   record exists;
2. **Rule** — `segmented segmented-wrap segmented-labels segmented-rules`
   (`RULES`, "None" first), only while `control === "unsignalized"`;
3. **Movements** — `MovementRows`, or a `.readout` reading `None`;
4. **Add movement** — `MovementAdd`, only while some legal pair is unclaimed;
5. **Glyph**, 6. **Size** — as before.

Semantics above presentation, which also puts the nudge's cause above its visible
effect. `segmented-labels` is load-bearing: `.seg` sets
`text-transform: capitalize`, which would render "All-way Stop".

`RULES` is a segmented row rather than `SignLink`'s `<select>` because the
discriminator that control's own comment gives is *where the options come from* —
its option count is the document's (every link in the file), this one's is the
vocabulary's (three rules and the absence of one). `MOVEMENT_KINDS` is a `<select>`
by the same discriminator turned the other way: there is one per movement and a
junction can carry a dozen, so four buttons a row would make the panel a wall.

**What the pickers offer is the panel's question, not the model's.**
`legalMovements` answers "what does the model allow here"; `JunctionFields`
subtracts the pairs already permitted, so Add never offers one whose dispatch would
no-op, and the exit picker offers only what pairs with the chosen approach — which
is why an arriving→arriving turn cannot be asked for at all.

**`MovementAdd` holds the panel's only local state**, and it has to: a movement
needs *two* names before it is anything, so unlike every other control here it
cannot dispatch on change. Both picks are **derived against the live options**
(`arriving.includes(from)`) rather than corrected by an effect, so a pick that a
later render made illegal is simply inactive; the component is keyed on the node id
as well, so switching junctions resets it outright.

There is no test file for the Inspector; every row here is a `bun run dev` check.

## Where each piece lives

| Piece | File |
|---|---|
| `findJunction` | `src/model/document.ts` |
| `setJunctionControl`, `setJunctionRule`, `nudgedGlyph` | `src/editor/state.ts` |
| `addMovement`, `deleteMovement`, `setMovementKind`, `withMovements`, `dropMovements` | `src/editor/state.ts` |
| `movementId`, `movementKind`, `legalMovements`, `armDirection` | `src/editor/geometry.ts` |
| `CONTROLS`, `RULES`, `MOVEMENT_KINDS`, `JunctionFields`, `MovementRows`, `MovementAdd` | `src/components/Inspector.tsx` |
| `.segmented-rules`, `.movement-*` | `src/styles.css` (chrome — **not** `src/styles/diagram.css`; nothing here reaches an export) |
| The glyphs themselves | `JunctionGlyphShape`, `src/components/Diagram.tsx` — see `rules/road-rendering.md` for the arms and the pad |

## The two turn vocabularies, and the hyphen between them

There are **two** enumerations of a turn in the project, they are not the same, and
the difference is one character:

| | Values | Where |
|---|---|---|
| `MovementKind` | `through`, `left`, `right`, **`u-turn`** | semantics; Rust `#[serde(rename = "u-turn")]` |
| `TurnDirection` | `through`, `left`, `right`, `slight_left`, `slight_right`, **`u_turn`** | a *painted arrow* — decoration |

`MovementKind`'s hyphen is **Assimilator's spelling and must not be "fixed"** — it
is what the `network.yaml` carries. `TurnDirection`'s underscore is Zukai's own, has
two values the semantic model has no room for, and belongs to `MarkingKind`. They
stay separate: deriving a lane's turn arrow from the movements that use it is a
named non-goal, because a painted arrow is a human's decoration rather than a
derivation.

## Still unbuilt (spec Phases 3–4)

- **Phase 3 — the drawing.** `movementArc` in `geometry.ts` and a `MovementShape`
  rendered **inside `JunctionGlyphShape`**, never as a sibling layer: `.jn-pad` is
  opaque asphalt and would paint over the arcs while every source-order assertion
  still passed. Drawn from the two arms found **by link id** (`Arm.id`), never from
  an arm's direction.
- **Phase 4 — `deriveMovements`.** `legalMovements` **less the u-turn pairs**,
  classified through `movementKind`, added as one undoable action and **merging
  rather than replacing** — matched by ordered pair, which its id already is.
- **Signal plans are cut entirely** and deferred to a follow-up spec: a fixed-time
  plan is a table, not a picture, and the one drawable part (which movements share a
  stage) needed movements to exist first.
- **`Movement.from_lanes`/`to_lanes` stay empty.** Assimilator accepts that
  ("empty for a movement with no lane detail"), and a lane-pair matrix at a 4-arm
  junction is a large editor for something the schematic does not show. Likely
  wanted by the export spec rather than by this one.
