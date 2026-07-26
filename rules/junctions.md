# Junctions

What a junction *means*, as opposed to what it looks like: `Junction.control`,
`Junction.rule`, and — from Phase 2 onward — the turn movements through it.
Frontend only. `Junction`, `JunctionControl`, `UnsignalizedRule`, `Movement`,
`Phase` and `SignalPlan` have all been in both mirrors since the first commit, so
nothing here crosses IPC on new terms, reaches disk in a new shape, or moves
`SCHEMA_VERSION` (still **2**). The design rationale lives in
`specs/junction_semantics_spec.md`; hand-maintained.

**Build state: Phase 1 of 4.** `control` and `rule` are written and read.
`Junction.movements` and `Junction.signal_plan` are still what they have always
been — **fields nothing reads**. Do not treat their presence in
`src/model/types.ts` as evidence anything consumes them.

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

## The two actions

| Action | Shape it copies | Note |
|---|---|---|
| `setJunctionControl(id, control)` | `setMarkingKind` (guard) + `setJunctionView` (the nudge) | clears `rule` going to `signal`; moves a default glyph |
| `setJunctionRule(id, rule?)` | `setSignLink` | `rule` absent clears the key |

Both are **deliberate clicks**, so neither appears in `coalesceKeyFor` and each is
its own undo step (`rules/history.md`).

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

## The panel

`JunctionFields` (`components/Inspector.tsx`) renders, in this order:

1. **Control** — a plain `.segmented` row (`CONTROLS`), only when a `Junction`
   record exists;
2. **Rule** — `segmented segmented-wrap segmented-labels segmented-rules`
   (`RULES`, "None" first), only while `control === "unsignalized"`;
3. **Glyph**, 4. **Size** — as before.

Semantics above presentation, which also puts the nudge's cause above its visible
effect. `segmented-labels` is load-bearing: `.seg` sets
`text-transform: capitalize`, which would render "All-way Stop".

`RULES` is a segmented row rather than `SignLink`'s `<select>` because the
discriminator that control's own comment gives is *where the options come from* —
its option count is the document's (every link in the file), this one's is the
vocabulary's (three rules and the absence of one).

There is no test file for the Inspector; both rows are a `bun run dev` check.

## Where each piece lives

| Piece | File |
|---|---|
| `findJunction` | `src/model/document.ts` |
| `setJunctionControl`, `setJunctionRule`, `nudgedGlyph` | `src/editor/state.ts` |
| `CONTROLS`, `RULES`, `JunctionFields` | `src/components/Inspector.tsx` |
| `.segmented-rules` | `src/styles.css` (chrome — **not** `src/styles/diagram.css`; nothing here reaches an export) |
| The glyphs themselves | `JunctionGlyphShape`, `src/components/Diagram.tsx` — see `rules/road-rendering.md` for the arms and the pad |

## Still unbuilt (spec Phases 2–4)

Movements — `addMovement`/`deleteMovement`/`setMovementKind`/`deriveMovements`,
`legalMovements`/`movementKind`/`movementArc`, the Movements list in the panel,
and arcs drawn **inside** `JunctionGlyphShape` (never as a sibling layer:
`.jn-pad` is opaque asphalt and would paint over them). Signal plans are cut
entirely and deferred to a follow-up spec — a fixed-time plan is a table, not a
picture.

Two things the spec settles ahead of that work, worth knowing before touching
`Movement`:

- **`MovementKind` spells its u-turn `"u-turn"` with a hyphen**, because that is
  Assimilator's spelling on the wire. `TurnDirection` — a *painted arrow*, pure
  decoration — spells its own `"u_turn"`, and has two values (`slight_left`,
  `slight_right`) the semantic model has no room for. The two vocabularies stay
  separate, and deriving one from the other is a named non-goal.
- **A movement id is `M_<from>_<to>`** (`M_L1_L3`), not a `nextId` mint — that
  helper parses a numeric suffix, and `M1` already means a marking.
