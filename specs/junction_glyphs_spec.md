---
id: zk-013
title: junction-glyphs
note: >
  The junction pad follows the roads that meet at it, instead of being a disc —
  which is what makes a three-arm node read as a T, and what retires the glyph
  that promised to.
status: draft
last_updated: 2026-08-10

phases:
  - name: "Phase 1 — The pad follows its arms"
    reviewed: null
    shipped: null
    cut: null
    by: null
  - name: "Phase 2 — Retire the glyph the arms made redundant"
    reviewed: null
    shipped: null
    cut: null
    by: null

extends: null
supersedes: null
superseded_by: null
related: [zk-004, zk-005, zk-008]
reference: "How a road atlas draws a junction: the asphalt is the roads, widened where they meet, and its outline is the roads' own edges. Not an intersection's real kerb geometry, corner radii or splitter islands — those are surveyed, and this project draws diagrams."
---

# Junction Glyphs Spec

## 1. Goal

**Every junction in this app is drawn as a disc.** `JunctionGlyphShape`
(`src/components/Diagram.tsx:JunctionGlyphShape`) paints
`<circle className="jn-pad" r={rp} />` for four of the six glyphs, and a disc is
the same picture whichever roads meet at it. This spec makes the pad **follow the
roads**, which is what a junction looks like in a figure — and, as a consequence,
retires `t_junction`, the glyph that names a shape it has never drawn.

The observable is the drawn junction, in the app and in an exported figure.

End state — a T, drawn as a diagram rather than as a blob:

```
File ▸ a 4-lane road running east–west, a 4-lane road arriving from the south

  today                                    wanted

   ______________                           ______________________
  /              \                                             
 (   ██████████   )   the disc reaches      ██████████████████████
  \_    ██▓▓██  _/    27.2 units up from     ─ ─ ─ ─┐      ┌─ ─ ─
     \  ██▓▓██ /      a road whose own      ████████┘      └██████
      \ ██▓▓██/       edge is at 19.5               │      │
        ██▓▓██                                      │  ▓▓  │
        ██▓▓██                                      │  ▓▓  │

  asphalt above a road with                 the outer edge runs straight
  nothing above it: a crossroads            through, and the pad steps
  with one arm rubbed out                   only where a road actually goes
```

The numbers are `padRadius`'s (`src/editor/geometry.ts:padRadius`):
`max((maxW * 0.62 + 3) * scale, armReach)`. A 4-lane road is 39 units wide, so
its pad is 27.2 while the road's own edge is at 19.5 — the disc bulges **7.7
units into the empty quadrant**. On the default 1-lane arterial (12 wide) it is
10.44 against 6, a bulge of 4.4. Neither is a rounding error; both are most of a
lane of asphalt painted where there is no road.

`t_junction` exists to say "this one is a T" and draws nothing:
`JunctionGlyphShape` branches on `roundabout`, `gore`, `signalized_cross` and
`priority_cross`, and everything else — `generic` and `t_junction` alike — falls
through to the same disc. The Inspector offers it anyway
(`src/components/Inspector.tsx:GLYPHS`). Picking it changes no pixel.

### 1.1 Non-goals

- **Not real intersection geometry.** No kerb radii, no corner fillets sized to a
  design vehicle, no splitter islands, no channelisation. Those are surveyed
  quantities and belong to Assimilator (`CLAUDE.md`).
- **Not auto-layout.** The human still places the nodes and picks the glyph.
- **Not the roundabout.** Its ring is correct at any arm count and is left alone
  (§2.6).
- **Not a new control, and not a new model field.** The shape is derived from
  arms this project already computes. The spec *removes* one enum variant and
  proposes removing one dead field (OQ-1); it adds neither.
- **Not the badge glyphs' vocabulary.** Whether `signalized_cross` and
  `priority_cross` should be a *badge* field separate from the shape is named in
  OQ-4 and deliberately not taken here.
- **Not `Marking` or sign rendering**, which have their own specs.

## 2. Design

### 2.1 The vocabulary is two kinds of thing, and one entry is neither (decision, recorded)

`JunctionGlyph` (`src/model/types.ts:JunctionGlyph`, mirrored at
`src-tauri/src/model/layout.rs:JunctionGlyph`) reads as one flat list of six.
`JunctionGlyphShape` reads it as two, and has since the gore landed:

| Glyph | What it draws | Kind |
|---|---|---|
| `generic` | the pad | **shape** |
| `roundabout` | ring + island, *instead of* the pad | **shape** |
| `gore` | a chevroned triangle, and **no** pad | **shape** |
| `signalized_cross` | the pad **plus** stop bars and a signal head | **badge** |
| `priority_cross` | the pad **plus** a `.jn-priority` diamond | **badge** |
| `t_junction` | the pad, and nothing else | *neither* |

A badge glyph is additive: its branch runs *after* the shape branch and adds a
mark to whatever pad was drawn. A shape glyph decides what the asphalt is.
`t_junction` is filed among the shapes and contributes no shape — and there is no
badge it could grow instead, because **a T-junction wears no marking that says
"T"**. A driver knows it is a T by looking at it.

**That it has never been drawn is not neglect, and the record says so twice.**
`zk-005` OQ-7 deferred it — "this spec's glyph work was the gore, and scope
discipline says name the thing precisely". `zk-008` then **declined** it in its
own OQ-5, on the reasoning that "the glyph vocabulary is presentation and belongs
to a rendering pass, not to the semantic one", which `rules/junctions.md` carries
as a known gap. Two specs passed it along and both named the same destination.
This is that pass.

**No spec's phase ever shipped the variant.** It predates this corpus, in the
first model. So retiring it supersedes nothing and this spec carries no
`supersedes` — which is the whole reason §6.1's test lands on a new spec with
`extends: null` rather than on a phase appended somewhere.

### 2.2 The pad follows its arms, and `t_junction` is only where that shows worst (decision, recorded)

The defect is not that a T draws like a crossroads. It is that **every** junction
draws like a disc, and a T is where a reader notices. A four-arm cross puts the
same bulge in all four corners; a T puts it in one, next to a road that visibly
has nothing there.

So the fix is one rule and it serves the whole vocabulary:

> The pad is the **union of the approach roads**, each carried from its own
> carriageway into the node, out to the rim.

Everything it needs is already derived. `Arm`
(`src/editor/geometry.ts:Arm`) is `{ id, dir, origin, outbound, width }`, and
`origin` is the carriageway's **drawn** end — `zk-005` Phase 1's whole subject,
which is what lets a divided approach contribute its own half rather than a
centreline. So each arm contributes a band of its own `width` from `origin` along
`dir`, and the pad is what they cover together:

```ts
/** The pad's outline: the arms' own widths carried into the node, out to `r`.
 *  In the glyph's frame, so an arm enters as `origin - center`. */
export function padShape(arms: Arm[], center: Vec2, r: number): Vec2[][]
```

Three things this pins, each a way to get it wrong:

- **It is derived, never picked.** A three-arm node draws as a T because it *has*
  three arms — the same posture `gorePair` takes to choosing its pair, and the
  reason §2.4 can retire a variant rather than implement it.
- **It is additive.** A band only paints asphalt where a road already runs; it
  never has to erase what the disc laid down, because the disc is gone. This is
  `zk-005` §2.4's rule for the taper wedge, and it holds here for the same reason.
- **A node with no arms still draws something.** `armWidth` already falls back to
  `MIN_ROAD_WIDTH` for that case; the pad falls back to today's disc, because a
  junction the human placed and has not yet joined has to remain visible and
  clickable.

### 2.3 The rim is a circle, three things measure to it, and none of them looks into an empty quadrant (decision, recorded)

**This is the constraint that makes the change a spec rather than a one-line
branch**, and the reason the answer is cheap is worth recording so an implementer
does not build the expensive one.

Three separate things measure to the glyph's rim, and all three assume it is a
circle of radius `rp`:

1. **A signalised junction's stop bar** starts one `rayCircleExit(…, rp) + 4`
   along its own arm (`src/components/Diagram.tsx:JunctionGlyphShape`).
2. **An `end`-anchored marking** clears the rim by the same call
   (`src/editor/geometry.ts:rimClearance`, through
   `src/editor/geometry.ts:junctionRadius`), which is how a turn arrow avoids
   being buried under the pad.
3. **The hit disc and the selection halo** are `outerR + 2` and `outerR + 5`.

The tempting move is to generalise all three to an arbitrary outline — a rim
abstraction, a ray-versus-polygon exit, three call sites rewritten. **Do not.**
Every one of those three measures **along an arm**, and the pad still reaches
exactly `rp` along every arm, because an arm's own band runs the full radius.
What the new shape removes is asphalt in the directions **between** arms, and
nothing measures between arms.

So the rim **stays a circle** and `padRadius`, `rayCircleExit`, `junctionRadius`
and `rimClearance` are all untouched. Only the painted outline changes. Two
consequences, stated rather than discovered:

- **Phase 1's gate can prove it.** A signalised junction's stop bars must come
  out **byte-identical** to today, and so must the hit disc and halo. A moved bar
  means the rim moved, which means the change was not the one specified.
- **The hit disc stays generous.** It covers a corner the pad no longer paints,
  so a click just off the asphalt still selects the junction. That is the right
  trade for a 2-unit target and is not a bug to fix later.

### 2.4 Then `t_junction` earns nothing, and removing it is not free (decision, recorded)

Once the pad is derived, a three-arm node **is** a T. The variant then names a
fact the arms already carry, and a control that cannot change the drawing is a
control that lies — which this repo has twice decided it will not ship: `zk-008`
Phase 1 is literally titled "the glyph stops lying", and `zk-007` OQ-6 took the
same line about a readout of an unsettable field.

**Removing an enum variant runs the opposite way to adding one**, and `zk-005`
§2.6's table does not cover this direction:

| Change | Old build reads new file | New build reads old file |
|---|---|---|
| **Adding** a variant (`gore`, `zk-005`) | serde error on the whole document | fine |
| **Removing** one (`t_junction`, here) | fine | **serde error on the whole document** |

And the version probe cannot help in this direction either. `persist.rs` rejects
a file declaring a *newer* `schema_version`; a document carrying
`glyph: t_junction` declares an *older or equal* one and is accepted, then fails
in serde with no useful message. So a bump alone is not the fix — **this needs a
real migration arm**, the first in the project (`persist.rs` records "no older
versions exist yet, so there is no migration path").

The cheapest honest shape, and the one Phase 2 takes: **keep the Rust variant as
load-only and normalise it away.** `TJunction` stays in
`src-tauri/src/model/layout.rs:JunctionGlyph` so any `.zkai` ever written still
parses, and `load_document` maps it to `Generic` on the way in. The TypeScript
union and `Inspector.tsx:GLYPHS` lose it outright, so nothing can mint another.
A document that had one loads, draws identically, and re-saves without it.

Whether that also wants `SCHEMA_VERSION` moved to 3 is **OQ-2**: the file format
did not gain anything, and a v2 document is still a valid v3 document, so the
bump would buy only a label.

### 2.5 Where the logic lives

The split `rules/road-joints.md` and `rules/junctions.md` established:

| Piece | Where | Pure? |
|---|---|---|
| `padShape(arms, center, r)` | `src/editor/geometry.ts` | ✅ vitest |
| The pad element, the `.jn-pad` path | `src/components/Diagram.tsx` | ✅ via `renderToStaticMarkup` |
| Pad paint | `src/styles/diagram.css` | — reaches exports free |
| Dropping the variant from the union and the picker | `src/model/types.ts`, `src/components/Inspector.tsx` | — |
| The load-only variant and its normalisation | `src-tauri/src/model/layout.rs`, `src-tauri/src/model/persist.rs` | ✅ Rust round-trip test |

**Phase 1 touches no Rust**, so `cargo test` must come out unchanged; Phase 2
touches nothing else, so its vitest count should barely move. Each phase's gate
says so, because a moved count is the cheapest signal that something escaped the
scope.

`strokeAllowance` (`src/editor/export.tsx:strokeAllowance`) is expected to need
**no** change, and this is recorded so Phase 1 does not go hunting a bug that is
not there: `measureDiagram` frames from `getBBox`, which excludes stroke width
but includes fill geometry, and the pad is fill — as it already was as a circle,
and as the wedge and the gore both were (`zk-005` §2.7).

### 2.6 Non-goals inside the vocabulary

- **The roundabout keeps its ring.** A ring is a correct drawing of a roundabout
  at any arm count, and its geometry is the island rather than the approaches.
  `ringRadius` and its `armReach` floor stay exactly as `zk-005` Phase 1 left
  them.
- **The gore keeps drawing no pad at all.** It is paint *between* two arms and
  the rule above does not apply to it. `junctionRadius` already excludes it.
- **The badges are untouched.** Stop bars, the signal head and the priority
  diamond all sit on whatever shape the pad is, and Phase 1's gate is that they
  do not move.

## 3. Open questions

- **OQ-1** — **`JunctionView.rotation` is dead, and this makes it permanently
  dead. Remove it?** It is declared in **both** mirrors
  (`src/model/types.ts:JunctionView`, `src-tauri/src/model/layout.rs`), written
  as `0` at three creation sites and asserted once in an import test — and **read
  by nothing that draws**. There is no Inspector control for it. A pad derived
  from its arms needs no rotation by construction, so the field's last possible
  justification goes with this spec. Removing a *field* is the cheap direction
  (`zk-005` §2.3: a field is free where a variant is not) — but it is still a
  mirror change in a phase that otherwise touches no Rust.
  *(design call; proposed: leave Phase 1 alone and fold it into Phase 2, which is
  already in both mirrors — or open a Phase 3 if review would rather it stood on
  its own.)*
- **OQ-2** — **Does dropping a variant bump `SCHEMA_VERSION` to 3?** §2.4 argues
  the bump buys only a label, since the migration is what actually saves the old
  file and a v2 document is a valid v3 one. The counter-argument is that the
  format's *vocabulary* genuinely narrowed, and a version is how a reader is told.
  *(design call; proposed: no bump, and record the reasoning where the last bump
  is recorded.)*
- **OQ-3** — **What does the pad's outline do between two arms that nearly
  coincide?** Two arms 5° apart leave a sliver of paper between their bands that
  is narrower than the edge line it would carry. Round the joins, fill the sliver,
  or leave it? *(design call; proposed: fill — the union closes over any gap
  narrower than a fixed threshold, on `zk-005`'s `SAME_EDGE` precedent, since a
  visible hairline crack in asphalt reads as a drawing error.)*
- **OQ-4** — **Should the badge glyphs be a separate field from the shape?**
  §2.1's table shows the enum is carrying two independent questions — what shape
  the asphalt is, and what mark sits on it — and a human cannot currently ask for
  a roundabout *with* signals. Splitting them is a model change with a mirror, a
  migration and an Inspector row. *(design call; proposed: not here. It is a
  bigger subject than this spec's, and it should be its own if it is ever
  wanted — but it is worth a round-0 challenge, because if the split is coming
  anyway then Phase 2's migration is the cheapest moment to do it.)*
- **OQ-5** — **Does a two-arm junction read oddly once the pad is derived?** A
  node with two arms and a `junction` kind is really a waypoint the human labelled
  a junction; today it gets a disc, and after Phase 1 it gets a short fat band
  that may read as a lump in the road. *(deferred by evidence — the Phase 1 dev
  pass draws one and looks.)*

## 4. Implementation phases

Strictly sequential; each is one plan-mode pass with a concrete exit gate.

### Phase 1 — The pad follows its arms

*Produces the observable: **yes**, and it is the whole reason the spec exists —
every pad junction in every figure stops painting asphalt where no road goes, and
a three-arm node reads as a T without anyone picking anything.*

- **Scope:** `padShape(arms, center, r)` in `src/editor/geometry.ts` per §2.2,
  returning the outline in the glyph's own frame (an arm enters as
  `origin - center`), with today's disc as the no-arms fallback.
  `JunctionGlyphShape` paints it in place of `<circle className="jn-pad">`; the
  `.jn-pad` rule in `src/styles/diagram.css` follows if the element changes.
  **The rim does not move** (§2.3): `padRadius`, `ringRadius`, `rayCircleExit`,
  `junctionRadius` and `rimClearance` are all untouched, as are the hit disc and
  the halo. Frontend only — no model change, no Rust, no action, no control.
- **Exit gate:** `bun run build` + `bun run test` green, and **`cargo test`
  unchanged**, since no Rust is touched. `geometry.test.ts`: the pad reaches
  exactly `r` along every arm's own direction, at three arm counts and on a
  divided approach (where two arms have distinct `origin`s); a point in the
  **empty quadrant** of a three-arm node at radius `r * 0.9` is **outside** the
  pad, which is the assertion the disc fails and the whole phase turns on; a node
  with no arms returns today's disc. `Diagram.test.tsx`: on a signalised
  junction, every stop bar's `x1/y1/x2/y2` and the hit disc and halo radii are
  **byte-identical to today** — the proof that §2.3's cheap answer is the correct
  one; the priority diamond likewise; an empty document still renders exactly
  `<g class="diagram"></g>`. `export.test.ts`: a padded document's frame still
  covers the pad with `strokeAllowance` **unchanged** (§2.5 — confirm, do not
  pre-emptively widen). Plus a `bun run dev` pass on a T, a four-arm cross, a
  divided approach and a two-arm junction (OQ-5), at the default Size and a
  reduced one.
- **Close-out:** `rules/road-joints.md` (the pad is no longer a disc, and *why*
  the three rim consumers did not move — that reasoning is the reusable part);
  `rules/junctions.md` (the glyph table's "one of six drawings"); the
  project-memory roadmap.

### Phase 2 — Retire the glyph the arms made redundant  (depends on Phase 1)

*Produces the observable: **no** — and the argument is that it removes a control
that lies. Phase 1 already drew the T; this phase makes the panel stop offering a
pick that cannot change the drawing, which is `zk-008` Phase 1's own subject
("the glyph stops lying") applied to the row next to it. The picture is unchanged
by construction, and the gate asserts exactly that. It is the phase to challenge
in round 0 if any is.*

- **Scope:** drop `t_junction` from `src/model/types.ts:JunctionGlyph` and from
  `src/components/Inspector.tsx:GLYPHS`, so nothing can mint another. **Keep**
  `TJunction` in `src-tauri/src/model/layout.rs:JunctionGlyph` as load-only and
  normalise it to `Generic` in `src-tauri/src/model/persist.rs` — the project's
  first migration arm (§2.4). `SCHEMA_VERSION` per OQ-2. OQ-1's `rotation`
  removal folds in here if review takes it, since this is already the phase that
  touches both mirrors.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green. A Rust
  test that a `.zkai` carrying `glyph: t_junction` **loads**, comes back as
  `generic`, and **re-saves with no `t_junction` anywhere** — written against a
  committed fixture file, not a hand-built struct, because the failure being
  guarded is a *parse* failure. A `Diagram.test.tsx` case that a document which
  had the variant draws identically to the same document with `generic`, which is
  this phase's "no observable" claim made checkable. A TypeScript-side check that
  the union no longer admits it (a compile error is the assertion). Plus a
  `bun run dev` pass opening a pre-Phase-2 document saved with the variant.
- **Close-out:** `rules/junctions.md` (five glyphs, and the migration);
  `rules/persistence.md` (the first migration arm — the file that says there is
  no migration path); `zk-005` OQ-7 and `zk-008` OQ-5 both record that this
  landed and how; the project-memory roadmap.
