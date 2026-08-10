---
title: junctions
sources:
  - src/components/Diagram.tsx
  - src/components/Inspector.tsx
  - src/editor/state.ts
  - src/model/document.ts
  - src/model/types.ts
  - src/styles.css
  - src-tauri/src/model/graph.rs
  - src-tauri/src/network/mod.rs
covers: >
  what a junction means rather than what it looks like — control and rule, which
  layer owns each part, the glyph-versus-control split and its nudge, the two
  actions, and the one turn vocabulary left in the model
max_lines: 215
generated: 2026-08-08
---

# Junctions

What a junction *means*, as opposed to what it looks like: `Junction.control` and
`Junction.rule`. Frontend only — all three types have been in both mirrors since
the first commit, so nothing moves `SCHEMA_VERSION` (still **2**). Rationale:
`specs/junction_semantics_spec.md`.

**Build state: Phase 1 only.** Phases 2–4 — the turn movements, their arcs and
their Derive button — were **cut on 2026-07-28** (`specs/lane_arrows_spec.md`
Phase 4), and **signal plans are cut entirely** (`specs/signal_plans_spec.md` §0).
A `Junction` carries `node_id`, `control` and `rule` and nothing else.

## Which turns a junction permits is not recorded here

The largest thing to know about this subsystem, because it is the shape of what is
*missing*. Zukai used to answer "which lane goes where" twice — a dashed arc per
permitted turn across the pad, and a Movements table in the panel. It now answers
**once, with paint on the approach**: a `turn_arrow` `Marking` per lane, which is
what a real road uses and the only one of the three that prints
(`rules/marking-kinds.md`, `specs/lane_arrows_spec.md` §2.1). Three consequences:

- **There is no relation in the model and nothing derives one.** The arrow *is*
  the representation. A junction with no paint says nothing about its turns, and
  that is a legitimate schematic — a drawing may say less than the road does.
- **The vocabulary went with it.** `MovementKind` is no longer a model type; it
  lives in `src-tauri/src/network/mod.rs` as the mirror's word for a foreign
  format's `type:`, because the only thing left that names a turn that way is a
  `network.yaml` being read (`rules/network-yaml.md`).
- **What it costs, recorded rather than rediscovered.** An arrow says *you may
  turn left from this lane*; it does not say **which road** that left leads to,
  where an arc named an exit link. No loss at an orthogonal cross; ambiguous at a
  five-arm junction with two possible lefts. Real signage has the same limit and
  answers it with a destination plate, which `SignKind::Direction` is. Accepted.

Import is where this is visible: `network_to_document` reads a junction's
`movements`, paints one arrow per approach lane from its `from_lanes`, and
**stores none of it** — `rules/network-yaml.md`'s read-without-carrying case.

## The three parts of a junction, and which layer owns each

A junction is not an object. It is three records keyed by the same `NodeId`:

| Part | Where | Layer | Leaves for Assimilator? |
|---|---|---|---|
| `Node { type: "junction" }` | `doc.nodes` | semantic | shaped for it |
| `Junction { node_id, control, rule? }` | `doc.junctions` | semantic | shaped for it |
| `JunctionView { glyph, rotation, scale }` | `doc.layout.junctions[id]` | presentation | **no** |

`setNodeKind` mints and destroys the second and third together, so all three
normally arrive at once — but **each is independently absent-able in a hand-edited
file**, and every reader must survive that. The two cases that occur:

- **no `Junction` record** on a junction-kind node → both actions return `state`
  by identity, and the Inspector renders no Control row. The panel says nothing
  rather than showing an `unsignalized` that is not in the file.
- **no `JunctionView`** → read as `glyph: "generic"`, which is `JunctionFields`'
  own fallback and the renderer's default; `setJunctionView` creates the entry.

`findJunction(doc, id)` (`model/document.ts`) is the only lookup, and is **keyed
by `node_id`** — the one finder whose predicate does not read `.id`, because a
`Junction` is a record *about* a node rather than an entity beside it.

## The glyph and the control are two different questions

The decision the whole subsystem descends from, and the reason the fix for "the
drawing has signal heads but the file says unsignalized" is not "make the Glyph
picker write `control`".

- **`JunctionView.glyph` is presentation** — one of six drawings, dropped on
  export, chosen because it reads well on the page. `roundabout` and `gore` carry
  no control meaning at all, and `t_junction` names a *shape*, not a rule — a
  shape the arms now draw on their own, which is why it is on its way out
  (`specs/junction_glyphs_spec.md` Phase 2).
- **`Junction.control` is semantics** — two values, orthogonal to how the
  intersection is drawn. A signalised junction drawn as a plain pad is a
  legitimate schematic choice; a roundabout can be signalised.

Collapsing them would stop the Glyph row saying things that are true. So `control`
has **its own row**, and the traffic between them runs **one way only**.

### The nudge, and its "only from the default" clause

`setJunctionControl` also moves the glyph, and `nudgedGlyph(current, control)` is
the whole rule: `generic` + `signal` → `signalized_cross`; `signalized_cross` +
`unsignalized` → `generic`; **anything else is unchanged**. `generic` is what
`setNodeKind` mints, so it is the glyph *nobody chose*, while `roundabout`,
`gore`, `priority_cross` and `t_junction` are each a human's deliberate pick. One
action, two writes, one undo step.

**Nothing in `setJunctionView` has a twin of this.** Presentation may follow
semantics; semantics never follows presentation. Picking a glyph — Signals
included — writes no `control`. The residue is deliberate: a human can still pick
Signals-the-glyph and leave the control unsignalized. The nudge makes the common
case correct with nothing to read; it does not make the contradiction
unrepresentable, because representing it is sometimes right.

## The two actions

`setJunctionControl(id, control)` takes `setMarkingKind`'s guard plus
`setJunctionView`'s nudge; `setJunctionRule(id, rule?)` takes `setSignLink`'s
shape, where an absent `rule` clears the key. Both are **deliberate clicks**, so
neither appears in `coalesceKeyFor` and each is its own undo step.

**`rule` is an absent key, never `undefined`** — the one-representation rule
`Lane.kind`, `LinkView.align`, `Marking.lane`, `Marking.anchor` and
`Sign.associated_link` all follow. The writer drops it by destructuring rather
than assigning `undefined`, and "None" in the panel is the only route there.

**Clearing `rule` is `setJunctionControl`'s job, and only in one direction.**
Going to `signal` drops it, because `graph.rs` says `rule` is `None` when
signalized. Coming *back* keeps whatever is there — at that point only a
hand-edited file has one, and inventing or destroying a value is worse than
carrying it.

**`setJunctionRule` deliberately says nothing about `control`.** A rule on a
signalized junction is meaningless, but the *panel* withholds the row — the
posture `setMarkingLane` takes towards a marking's `kind`, and for its reason:
encoding a sibling field's state into an action that does not own it makes the
same value legal or illegal depending on something the action never touches.
`setJunctionControl` is the one place the two fields meet, because there the
change *is* to `control`.

**Two identity returns, both reachable.** Each action returns `state` *itself*
when there is nothing to do, so `recordHistory` takes no snapshot and `dirty`
stays put: no `Junction` record for the id, or the junction already in the target
state — which is what re-picking the active segment does on every click.
`junction.rule === rule` covers `undefined === undefined`, so re-picking "None" is
a no-op too. `state.test.ts` asserts both by reference; neither is visible
behaviourally, the cost of getting it wrong being an undo step that undoes nothing.

## A deleted link needs no answer here

Two of the three decorations need a cascade answer and a `Junction` is
deliberately not one: a `Marking` is **dropped** (`keepMarkings`), a `Sign`
**keeps its place with `associated_link` cleared** (`clearSignLinks`), and a
`Junction` is **untouched** — it names a node, never a link.

That third row was a `dropMovements` helper until Phase 4, and its removal is
worth a line because of *how* it was written: it rewrote junctions with a `map`,
so array identity had to be recovered with a pre-check or every link deletion in a
document with a junction handed history a fresh `doc.junctions`. The link arm now
omits `junctions:` entirely, so the identity holds by construction; the node arm
still filters out the deleted node's own record.

## The panel

`JunctionFields` (`components/Inspector.tsx`) renders **Control** (a plain
`.segmented` row from `CONTROLS`, only when a `Junction` record exists), **Rule**
(`segmented segmented-wrap segmented-labels segmented-rules`, from `RULES` with
"None" first, only while `control === "unsignalized"`), then **Glyph** and
**Size**. Semantics above presentation, which also puts the nudge's cause above
its visible effect. `segmented-labels` is load-bearing: `.seg` sets
`text-transform: capitalize`, which would render "All-way Stop".

`RULES` is a segmented row rather than `SignLink`'s `<select>` because the
discriminator is *where the options come from* — that control's option count is
the document's, this one's is the vocabulary's. There is no test file for the
Inspector; every row here is a `bun run dev` check.

## The drawn glyph

`JunctionGlyphShape` (`components/Diagram.tsx`) paints the pad or the ring, and —
for `signalized_cross` — a stop bar per arm and a signal head. Nothing sits
between the pad and the stop bars, and `Diagram.test.tsx` pins that adjacency as a
**literal slice** rather than an index comparison: the arcs used to be drawn there,
and an ordering assertion passes for anything painted invisibly under `.jn-pad`.

**The pad is the roads that meet there, not a disc** — one band per arm, clipped
to the rim, as one nonzero `<path class="jn-pad">` (`padShape`). So a three-arm
node reads as a T because it *has* three arms, and the drawing is `rules/
road-joints.md`'s subject. The `<circle>` survives for a junction with **no** arms,
which has no roads to follow and still has to be clickable.

Where the glyph *reaches* — `Arm`, `junctionArms`, `padRadius`, `ringRadius` and
the exported `junctionRadius` — lives in `geometry.ts` rather than the render
body, because an `end`-anchored marking measures its clearance from that rim.
`junctionRadius` carries its own exclusion list and **does not exclude a
roundabout**: a ring buries an approach arrow exactly as a pad does. **The rim is
still a circle** and none of it moved when the pad stopped being one.

## Where each piece lives

| Piece | File |
|---|---|
| `findJunction` | `src/model/document.ts` |
| `setJunctionControl`, `setJunctionRule`, `nudgedGlyph` | `src/editor/state.ts` |
| `CONTROLS`, `RULES`, `JunctionFields` | `src/components/Inspector.tsx` |
| `.segmented-rules` | `src/styles.css` — chrome, **not** `styles/diagram.css`, since nothing here reaches an export |
| The glyphs; a junction's turns as paint | `JunctionGlyphShape` in `Diagram.tsx`; `MarkingKind.turn_arrow` (`rules/marking-kinds.md`) |

## One turn vocabulary in the model

`TurnDirection` is the **only** turn enum under `src-tauri/src/model/` and
`src/model/types.ts` — `through`, `left`, `right`, `slight_left`, `slight_right`,
`u_turn` — and it belongs to a painted arrow. There used to be two, separated by
one character: `MovementKind` spelled its u-turn `u-turn`, Assimilator's wire
spelling, and the pair was a standing reading hazard. It still exists in
`network/mod.rs`, where it is the *file format's* vocabulary and the hyphen is
simply correct. A grep, not a runtime assertion.

## Cut, and one known gap

Nothing below is scheduled work. **The turn movements are cut** — model relation,
drawn arcs, panel list and Derive, all four. **Signal plans are cut entirely**,
Phase 1 included: a plan is a table, its only drawable form is a stage diagram,
and this project prints network figures.

**The gap that was here is closed, and by the pass it named.** `t_junction` drew a
plain pad, like `generic` (ramps OQ-7, declined as junction semantics OQ-5), on the
reasoning that the glyph vocabulary is presentation and wants a rendering pass.
That pass is `specs/junction_glyphs_spec.md`: its Phase 1 made **every** pad follow
its arms, so a three-arm node draws as a T with nobody picking anything, and Phase 2
retires the variant that promised to.
