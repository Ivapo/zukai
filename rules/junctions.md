# Junctions

What a junction *means*, as opposed to what it looks like: `Junction.control` and
`Junction.rule`. Frontend only. `Junction`, `JunctionControl` and
`UnsignalizedRule` have all been in both mirrors since the first commit, so
nothing here crosses IPC on new terms, reaches disk in a new shape, or moves
`SCHEMA_VERSION` (still **2**). The design rationale lives in
`specs/junction_semantics_spec.md`; hand-maintained.

**Build state: junction semantics is Phase 1 only.** Phases 2–4 — the turn
movements, their drawn arcs and their Derive button — were **cut on 2026-07-28**
(`specs/lane_arrows_spec.md` Phase 4), and **signal plans is cut entirely**
(2026-07-27, `specs/signal_plans_spec.md` §0). A `Junction` therefore carries
`node_id`, `control` and `rule`, and nothing else; `Movement`, `SignalPlan` and
`Phase` are gone from both mirrors.

## Which turns a junction permits is not recorded here

This is the largest thing to know about this subsystem, because it is the shape
of what is *missing*. Zukai used to answer "which lane goes where" twice — a
dashed arc per permitted turn across the junction pad, and a Movements table in
the panel. It now answers it **once, with paint on the approach**: a
`turn_arrow` `Marking` per lane, which is what a real road uses, what a reader of
a figure sees, and the only one of the three that prints
(`rules/road-markings.md`, `specs/lane_arrows_spec.md` §2.1).

Three consequences worth carrying:

- **There is no relation in the model and nothing derives one.** The arrow *is*
  the representation. A junction with no paint says nothing about its turns, and
  that is a legitimate schematic — the drawing may deliberately say less than the
  road does.
- **The vocabulary went with it.** `MovementKind` is no longer a model type; it
  lives in `src-tauri/src/network/mod.rs` as the mirror's own word for a foreign
  format's `type:` field, because the only thing left that names a turn that way
  is a `network.yaml` being read (`rules/network-yaml.md`).
- **What it costs, recorded rather than rediscovered.** An arrow says *you may
  turn left from this lane*; it does not say **which road** that left leads to,
  where an arc named an exit link. At an orthogonal cross that is no loss; at a
  five-arm junction with two possible lefts the drawing is ambiguous where it was
  not. Real signage has the same limitation and answers it with a destination
  plate, which `SignKind::Direction` is (`rules/signs.md`). Accepted.

Import is where this is visible: `network_to_document` reads a junction's
`movements` block, paints one arrow per approach lane from its `from_lanes`, and
**stores none of it**. That is `rules/network-yaml.md`'s read-without-carrying
case in its cleanest form.

## The three parts of a junction, and which layer owns each

A junction is not an object. It is three records keyed by the same `NodeId`:

| Part | Where | Layer | Dropped on export? |
|---|---|---|---|
| `Node { type: "junction" }` | `doc.nodes` | semantic | no |
| `Junction { node_id, control, rule? }` | `doc.junctions` | semantic | no |
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
- **`Junction.control` is semantics** — two values, orthogonal to how the
  intersection is drawn. A signalised junction drawn as a plain pad is a
  legitimate schematic choice; a roundabout can be signalised.

Collapsing them would make the Glyph row unable to say things that are true. So
`control` has **its own row**, and the traffic between them runs **one way only**.

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

## The two actions

| Action | Shape it copies | Note |
|---|---|---|
| `setJunctionControl(id, control)` | `setMarkingKind` (guard) + `setJunctionView` (the nudge) | clears `rule` going to `signal`; moves a default glyph |
| `setJunctionRule(id, rule?)` | `setSignLink` | `rule` absent clears the key |

Both are **deliberate clicks**, so neither appears in `coalesceKeyFor` and each is
its own undo step (`rules/history.md`).

**`rule` is an absent key, never `undefined`** — the one-representation rule
`Lane.kind`, `LinkView.align`, `Marking.lane`, `Marking.anchor` and
`Sign.associated_link` all follow, matching Rust's
`skip_serializing_if = "Option::is_none"`. The writer drops it by destructuring
rather than assigning `undefined`. "None" in the panel is the only route to that
state from the UI; a field nothing can clear is a field only a hand-edited file
can clear.

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

## A deleted link needs no answer here

Deleting a link has needed a cascade answer for two of the three decorations, and
a `Junction` is deliberately not one of them:

| Owner | Deleting its link | Where |
|---|---|---|
| `Marking` | **drops it** — nothing draws a marking whose road is gone | `keepMarkings` |
| `Sign` | **clears `associated_link`, keeps the sign** — a sign is free-standing | `clearSignLinks` |
| `Junction` | **untouched** — it names a node, never a link | — |

That third row was a `dropMovements` helper until Phase 4, and its removal is
worth a line because of *how* it was written: it rewrote junctions with a `map`,
so array identity had to be recovered with a pre-check or every link deletion in
a document with a junction handed history a fresh `doc.junctions` for something
nothing changed in. The link arm now simply does not list `junctions:` at all, so
the identity holds by construction. The node arm still filters out the deleted
node's own record, and that is the whole of it.

## The panel

`JunctionFields` (`components/Inspector.tsx`) renders, in this order:

1. **Control** — a plain `.segmented` row (`CONTROLS`), only when a `Junction`
   record exists;
2. **Rule** — `segmented segmented-wrap segmented-labels segmented-rules`
   (`RULES`, "None" first), only while `control === "unsignalized"`;
3. **Glyph**, 4. **Size** — presentation.

Semantics above presentation, which also puts the nudge's cause above its visible
effect. `segmented-labels` is load-bearing: `.seg` sets
`text-transform: capitalize`, which would render "All-way Stop".

`RULES` is a segmented row rather than `SignLink`'s `<select>` because the
discriminator that control's own comment gives is *where the options come from* —
its option count is the document's (every link in the file), this one's is the
vocabulary's (three rules and the absence of one).

There is no test file for the Inspector; every row here is a `bun run dev` check.

## The drawn glyph

`JunctionGlyphShape` (`components/Diagram.tsx`) paints the pad or the ring, and —
for `signalized_cross` — a stop bar per arm and a signal head. Nothing sits
between the pad and the stop bars, and `Diagram.test.tsx` pins that adjacency
literally rather than as an ordering: the arcs used to be drawn exactly there, and
an index comparison alone would pass for something painted invisibly underneath
the opaque `.jn-pad`.

Where the glyph *reaches* — `Arm`, `junctionArms`, `padRadius`, `ringRadius` and
the exported `junctionRadius` — lives in `geometry.ts` rather than in the render
body, because an `end`-anchored marking measures its clearance from that rim
(`rules/road-rendering.md`, `rules/road-markings.md`). `junctionRadius` carries
its own exclusion list and **does not exclude a roundabout**: a ring buries an
approach arrow exactly as a pad does.

## Where each piece lives

| Piece | File |
|---|---|
| `findJunction` | `src/model/document.ts` |
| `setJunctionControl`, `setJunctionRule`, `nudgedGlyph` | `src/editor/state.ts` |
| `CONTROLS`, `RULES`, `JunctionFields` | `src/components/Inspector.tsx` |
| `.segmented-rules` | `src/styles.css` (chrome — **not** `src/styles/diagram.css`; nothing here reaches an export) |
| The glyphs themselves | `JunctionGlyphShape`, `src/components/Diagram.tsx` — see `rules/road-rendering.md` for the arms and the radii, which live in `geometry.ts` |
| A junction's turns, as paint | `MarkingKind.turn_arrow` — `rules/road-markings.md` |

## One turn vocabulary in the model

`TurnDirection` is the **only** turn enum under `src-tauri/src/model/` and
`src/model/types.ts` — `through`, `left`, `right`, `slight_left`, `slight_right`,
`u_turn`, and it belongs to a painted arrow.

There used to be two, separated by one character: `MovementKind` spelled its
u-turn `u-turn`, because that is Assimilator's wire spelling, and the pair was a
standing reading hazard. `MovementKind` still exists — in
`src-tauri/src/network/mod.rs`, where it is the *file format's* vocabulary rather
than the document's, and where its hyphen is simply correct. This is a grep rather
than a runtime assertion; there is nothing to write a test against.

## Cut, and one known defect

Nothing below is scheduled work.

- **The turn movements are cut** — the model relation, the drawn arcs, the panel
  list and Derive, all four. See the top of this file for what replaced them.
- **Signal plans are cut entirely** — all four phases, Phase 1 included. A
  fixed-time plan is a table; its only drawable form is a stage diagram, and this
  project prints network figures rather than signal phasing
  (`specs/signal_plans_spec.md` §0).
- **`t_junction` still draws a plain pad**, like `generic` (ramps OQ-7, declined
  as junction semantics OQ-5): the glyph vocabulary is presentation and wants a
  rendering pass, not a semantic one.
