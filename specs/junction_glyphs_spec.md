---
id: zk-013
title: junction-glyphs
note: >
  The junction pad follows the roads that meet at it, instead of being a disc —
  which is what makes a three-arm node read as a T, and what retires the glyph
  that promised to.
status: accepted
last_updated: 2026-08-10

phases:
  - name: "Phase 1 — The pad follows its arms"
    reviewed: 2026-08-10
    shipped: 2026-08-10
    cut: null
    by: null
  - name: "Phase 2 — Retire the glyph the arms made redundant"
    reviewed: 2026-08-10
    shipped: 2026-08-10
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

**Why this is a new spec, on §6.1's test, step by step** — stated in full because
step 2 has a live competing answer and the short version skipped it:

- *Step 0, is a decision changing?* Yes: what a junction's asphalt **is** is
  unbuilt design, not a defect in existing code.
- *Step 1, does it remove or contradict shipped work?* Phase 2 removes an enum
  variant — but **no spec's phase ever shipped it.** `t_junction` is in the
  initial commit, predating this corpus, so there is nothing to `supersede` and
  step 1 does not fire.
- *Step 2, does an existing spec own the subject?* The competing answer is
  `zk-005`, which owns junction **interiors** — `padRadius`, `armReach`,
  `Arm.origin`, and `rules/road-joints.md` — and whose rollup is `done` rather
  than `abandoned`, so a phase could be appended to it. It is rejected on what
  the two subjects are: `zk-005` sizes the pad and makes its interior follow the
  carriageways, taking the disc as given in both; this spec changes what the pad
  **is**, and then removes a glyph. And `zk-005` itself pushed `t_junction` away
  (OQ-7) while `zk-008` explicitly disclaimed the glyph vocabulary (OQ-5) —
  neither of which a subject's owner does.
- *Step 3, a named kind under a reserved framework?* No spec reserved the glyph
  vocabulary; `zk-008` §2.2 established the glyph-versus-control split and
  declined the drawing. A declination is not a reservation, and no spec in this
  corpus sets `extends`.
- *Step 4* → new spec, `extends: null`, `supersedes: null`.

### 2.2 The pad follows its arms, and `t_junction` is only where that shows worst (decision, recorded)

The defect is not that a T draws like a crossroads. It is that **every** junction
draws like a disc, and a T is where a reader notices. A four-arm cross puts the
same bulge in all four corners; a T puts it in one, next to a road that visibly
has nothing there.

So the fix is one rule and it serves the whole vocabulary:

> The pad is the **union of the approach roads**, each carried from the node out
> along its own carriageway, and the whole of it **clipped to the disc of radius
> `r`** that sizes the glyph today.

Everything it needs is already derived. `Arm`
(`src/editor/geometry.ts:Arm`) is `{ id, dir, origin, outbound, width }`, and
`origin` is the carriageway's **drawn** end — `zk-005` Phase 1's whole subject,
which is what lets a divided approach contribute its own half rather than a
centreline.

```ts
/** The pad's outline: one closed ring per arm, all wound the same way, to be
 *  filled as a single nonzero path. In the glyph's frame, so an arm enters as
 *  `origin - center` and the disc is centred on the origin of that frame. */
export function padShape(arms: Arm[], center: Vec2, r: number): Vec2[][]
```

**One arm's ring, stated exactly**, because two readings of "a band out to the
rim" differ by several units on a divided approach and an implementer must not
have to pick:

> Take the frame's origin as the glyph centre. An arm's band is every point `p`
> with `(p) · dir >= 0` — at or ahead of the line through the **centre**
> perpendicular to `dir` — whose lateral distance from the arm's own axis (the
> line through `origin - center` along `dir`) is at most `width / 2`. The ring is
> that band **intersected with the disc of radius `r`**: two straight sides, a
> straight inner cut, and an outer **arc**.
>
> The arc is emitted as chords, so the ring is inscribed in the disc rather than
> crossing it, under two rules. **At most 10° per chord**, which bounds how far a
> chord falls short of the arc at `r · (1 − cos 5°)` — 0.10 units on §1's T, and
> under half a unit for any pad this project draws, against a 1.5-unit edge line.
> And **the point where the arm's own ray leaves the disc is always one of the
> vertices**, which is what makes the next bullet an exact equality rather than an
> approximation.

Four things this pins, each a way to get it wrong:

- **The pad is contained in the disc, and that invariant is load-bearing.**
  `pad ⊆ disc(r)` is what keeps every consumer in §2.3 correct, and it is why the
  outer end is an arc and not a straight cut: a flat-ended band of half-width
  `w/2` puts its corners at `sqrt(r² + (w/2)²)`, which for §1's 4-lane T is 33.45
  against a hit disc of 29.18 — asphalt painted **outside** the glyph's own hit
  target and halo, and outside the rim an `end`-anchored marking was cleared from.
- **Along its own arm the pad ends exactly where `rayCircleExit` says**, since
  the ray from `origin` in direction `dir` leaves the band only by leaving the
  disc, and the arc rule above puts a vertex there. That is character for
  character the expression the stop bar already uses (§2.3), which is what makes
  the two agree by construction rather than by coincidence — on a divided
  approach as much as an undivided one. **This is a statement about the ray, not
  about the ring's furthest vertex**, and the two are different numbers: on a
  divided 4-lane approach (`origin` 22.5 off the node, `r` floored to `armReach`
  = 42) the ray exits at 35.46 while the ring's furthest vertex along `dir` is at
  41.89. An assertion written on the vertex rejects a correct implementation.
- **The union is rendered, never computed.** The rings are emitted as subpaths of
  one `<path class="jn-pad">` and filled with the default nonzero rule, so
  overlapping bands read as one area with no boolean-union machinery — which this
  repo has none of, and which this spec does not add. The cost is a discipline:
  **every ring is wound the same way**, or two overlapping rings of opposite
  winding cancel into a hole. `src/editor/geometry.ts:polygonsPath` already turns
  a `Vec2[][]` into exactly this `d`.
- **It is derived, never picked.** A three-arm node draws as a T because it *has*
  three arms — the same posture `gorePair` takes to choosing its pair, and the
  reason §2.4 can retire a variant rather than implement it.

**A node with no arms keeps today's `<circle>`.** `padShape` returns `[]` for it,
and `JunctionGlyphShape` falls back to the circle element — rather than an
inscribed polygon, which would be a different drawing for no reason. A junction
the human placed and has not yet joined must stay visible and clickable, and
`armWidth`'s existing `MIN_ROAD_WIDTH` fallback already sizes it.

### 2.3 Four things assumed a disc. Three survive because the pad is clipped to one; the fourth does not (decision, recorded)

**This is the constraint that makes the change a spec rather than a one-line
branch.** The three that survive do so cheaply, and the reason is worth recording
so an implementer does not build the expensive fix; the fourth is real work and
belongs to Phase 1, not to a later surprise.

Three things **measure to the glyph's rim**, and all three assume a circle of
radius `rp`:

1. **A signalised junction's stop bar** starts one `rayCircleExit(…, rp) + 4`
   along its own arm (`src/components/Diagram.tsx:JunctionGlyphShape`).
2. **An `end`-anchored marking** clears the rim by the same call
   (`src/editor/geometry.ts:rimClearance`, through
   `src/editor/geometry.ts:junctionRadius`), which is how a turn arrow avoids
   being buried under the pad.
3. **The hit disc and the selection halo** are `outerR + 2` and `outerR + 5`.

The tempting move is to generalise all three to an arbitrary outline — a rim
abstraction, a ray-versus-polygon exit, three call sites rewritten. **Do not.**
Each measures **along an arm**, and §2.2's ring ends exactly where that arm's ray
leaves the disc — the same `rayCircleExit` expression — so all three stay correct
**because the pad is clipped to the disc they already assume**. That containment,
not the union, is what does the work here; a band merely "run out to the rim"
with a flat end would break items 2 and 3 by putting its corners outside `r`.

So the rim **stays a circle** and `padRadius`, `rayCircleExit`, `junctionRadius`
and `rimClearance` are all untouched. Two consequences:

- **The hit disc stays generous.** It covers corners the pad no longer paints, so
  a click just off the asphalt still selects the junction. That is the right
  trade for a 2-unit target and is not a bug to fix later.
- **Their being unchanged is *not* evidence the pad is right, and Phase 1's gate
  must not pretend otherwise.** All three read `padRadius` and none reads the
  outline, so the stop bars are byte-identical *whatever* `padShape` returns —
  including a wrong one. They are a regression check, not a proof. What actually
  tests §2.2 is a pair of assertions on the drawn outline itself: that it
  **reaches** `rayCircleExit(origin − center, dir, r)` along every arm, and that
  **no vertex exceeds `r`**. Phase 1's gate carries both.

**The fourth thing is not a measurement, it is paint that sits on the asphalt,
and it breaks.** `priority_cross` draws `diamondPoints(rp * 0.85)`
(`src/components/Diagram.tsx:diamondPoints`), whose vertices lie on the frame's
axes at `0.85 r` — always inside a disc, and **not** always inside a union of
bands. On §1's 4-lane T the north vertex sits at 23.1 while the through road's
band edge is at 19.5, so 3.6 units of filled yellow float on bare paper; on the
default arterial it is 8.87 against 6. **Some rotations put a tip in empty space
and some do not** — a T rotated 20° puts its north tip 21.7 from the through
axis against a half-width of 19.5, while at 45° all four tips are 16.33 out and
land on asphalt. Which is precisely why the bound is **measured** rather than
derived from the arms' widths:

```ts
/** How far the pad reaches from `p` along unit `d` before **first** leaving it:
 *  the ray-versus-pad exit, `0` when `p` is outside every ring. The union is not
 *  convex, so a ray can leave and re-enter; only the contiguous run from `p`
 *  counts. The ray analogue of `rayCircleExit`, for the shape that replaced the
 *  circle — with one difference that is a trap rather than a detail: a point
 *  **on** a ring's boundary counts as inside. The glyph centre lies exactly on
 *  every band's inner cut by construction (§2.2), so an implementation that
 *  copies `rayCircleExit`'s strict outside-test returns `0` for every ring and
 *  collapses every diamond to nothing. */
export function rayPadExit(rings: Vec2[][], p: Vec2, d: Vec2): number
```

The diamond's half-diagonal is then `min(rp * 0.85, s)`, where `s` is the
smallest `rayPadExit(rings, {x: 0, y: 0}, d)` over the four tip directions
`±x, ±y` — which is to say, **each tip is measured against the pad it will sit
on**, in the direction it actually points.

**The bound applies only where there are rings to measure.** With no arms
`padShape` returns `[]`, so every `rayPadExit` is `0` and the rule above would
size the diamond to nothing — on a junction that is still painting a full disc of
asphalt under it, since that branch keeps the `<circle>`. That state is ordinary:
make a node a junction, pick Priority, then draw the roads; or delete the links
from a priority junction that had them. **So the disc fallback keeps today's
`rp * 0.85` unchanged**, and the measured bound governs only the derived pad.

**A width-derived inradius was tried and is wrong**, recorded so it is not
re-derived: `max` over arms of `width / 2 − |lateral offset|` reads as "the
largest disc the pad certainly contains", but §2.2 cuts every band at the
half-plane through the centre, so **one arm contributes only a half-disc**, and a
`max` is safe only when the widest arm has an opposite of comparable width. Three
reachable counterexamples, each found in review: a **single-arm** junction reports
19.5 while the pad covers only `p · dir ≥ 0`, putting the opposite tip that far
onto bare paper; a three-arm **Y whose arms all leave northward** fails the same
way at its south tip; and — the one that needs no unusual layout at all — a **T
with a 1-lane through road and a 4-lane stem** reports 19.5 while the through
band is only 6 wide, so the bounded diamond still floats 13.5 units of yellow.
A T and a four-arm cross of uniform width pass only by luck. The measured form
has no such blind spot: it reports 6 for that T, because it asks the pad rather
than the widths, and it reuses the helper `Diagram.tsx` needs anyway.

**The signal head needs nothing, and the reason is not geometric.** Its *anchor*
is `rp + 7 * scale`, but the body is a `6.5 × 17` rect drawn around that point,
and its inner corner does dip inside the rim (15.18 against `rp` = 16.02 on the
crossroads `Diagram.test.tsx` already uses). It is unaffected because a signal
head is **roadside furniture, which needs no asphalt beneath it** — unlike the
diamond, which is paint on the road surface. Naming which badge breaks and which
does not is the point; "the badges are untouched" was wrong and is corrected in
§2.6.

`s` is `0` in two *kinds* of situation, and only the second is a question. **With
no arms** it is vacuous and the paragraph above carves it out. Otherwise it is
real — any single tip direction the pad does not paint drives the `min` to zero,
and the glyph centre sitting in a median is only the most obvious way to get
there, not the only one. **OQ-5 carries the enumeration**, which is longer than
it first looks.

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

And the version probe cannot help in this direction either.
`src-tauri/src/persist.rs:load_document` rejects a file declaring a *newer*
`schema_version`; a document carrying `glyph: t_junction` declares an *older or
equal* one and is accepted, then fails in serde with no useful message. So a bump
alone is not the fix — **this needs a real migration arm**, the first in the
project. That file's own doc comment records why there has never been one: "there
is still no migration arm because none is needed — the one bump so far … only
*added* an enum variant". Removing one is the case it was waiting for.

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
| `padShape(arms, center, r)`, `rayPadExit(rings, p, d)` | `src/editor/geometry.ts` | ✅ vitest |
| The pad element, the `.jn-pad` path, the bounded diamond | `src/components/Diagram.tsx` | ✅ via `renderToStaticMarkup` |
| Pad paint | `src/styles/diagram.css` | — reaches exports free |
| Dropping the variant from the union and the picker | `src/model/types.ts`, `src/components/Inspector.tsx` | — |
| The load-only variant and its normalisation | `src-tauri/src/model/layout.rs`, `src-tauri/src/persist.rs` | ✅ Rust round-trip test |

**Phase 1 touches no Rust**, so `cargo test` must come out unchanged. That is
true but not for the obvious reason, and the difference matters to Phase 2:
`src-tauri/src/network/import.rs` reads two frontend files with `include_str!`
to hold its mirror tests honest, so a Rust test *can* fail on a TypeScript edit.
The two it reads are keyed to `TURN_ARROW_LENGTH` and `TURN_DIRECTIONS`, which
neither phase touches — but **Phase 2 edits one of those two files**
(`Inspector.tsx`), so its gate asserts the count deliberately rather than by
assumption.

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
- **Two badges out of three are untouched, and the third is Phase 1's work.**
  Stop bars measure along an arm, so the gate pins them; the signal head is
  unmoved **by construction**, because it needs no asphalt under it — not
  because it clears the pad, which §2.3 shows it does not quite do. **The
  priority diamond is neither** — it is paint on asphalt that is going away under
  it, and §2.3 bounds it. Two earlier summaries of this bullet were wrong ("the
  badges are untouched", "the signal head sits outside the pad entirely"); the
  action has never changed.

## 3. Open questions

- **OQ-1 — RESOLVED in Phase 2: removed, folded in as proposed.** ~~Remove
  `JunctionView.rotation`?~~ Taken by the user on the Phase 2 plan. It went in the
  same pass, and the inventory below was exact — the four `tsc`-caught
  constructions and the one `cargo`-caught read were the whole of it, each found
  by its own compiler rather than by grep. The fixture that tests the migration
  carries a `rotation:` key too, so **one file pins both directions of §2.4's
  table**: a removed *variant* needs the arm, a removed *field* needs nothing.
  *(was: design call. The original text follows.)* It is declared in **both**
  mirrors
  (`src/model/types.ts:JunctionView`, `src-tauri/src/model/layout.rs`) and is
  **read by nothing that draws** — there is no Inspector control for it. Five
  test sites touch it, all Phase 2 work if this is taken: **four** construct it
  and are caught by `bun run build` as excess-property errors under `strict` —
  two `rotation: 0` literals in `src/editor/state.test.ts` and two inside
  `junctions: { N2: { … } }` fixtures in `src/editor/geometry.test.ts` — while
  the fifth **reads** it and is caught by `cargo`, not `tsc`: an `assert_eq!` in
  `src-tauri/src/network/import.rs`. Three non-test sites write it, all as zero:
  `src/editor/state.ts:setNodeKind`, `src/editor/state.ts:setJunctionView`, and
  `layout.rs`'s `Default for JunctionView` (which `import.rs` consumes). A pad
  derived from its arms needs no rotation by construction, so the field's last
  possible justification goes with this spec. Removing a *field* is the cheap
  direction — a new field costs no version bump (`zk-005` §2.3) and its removal
  is the mirror of that, where a *variant* is the expensive case in both
  directions (`zk-005` §2.6) — but it is still a change in both mirrors.
  *(design call; proposed: leave Phase 1 alone and fold it into Phase 2, which is
  already in both mirrors — or open a Phase 3 if review would rather it stood on
  its own.)*
- **OQ-2 — RESOLVED in Phase 2: no bump, as proposed.** ~~Does dropping a variant
  bump `SCHEMA_VERSION` to 3?~~ Taken by the user on the Phase 2 plan. The constant
  stays **2**: the migration arm is what saves the old file and a v2 document is a
  valid v2 document, so the bump would buy only a label while moving six sites.
  The counter-argument — the format's *vocabulary* genuinely narrowed, and a
  version is how a reader is told — is outweighed rather than refuted. The
  reasoning is recorded where the last bump is (`rules/document-model.md`), and the
  part worth having is that it is **pinned rather than merely written down**: an
  `assert_eq!(SCHEMA_VERSION, 2)` sits inside the migration test, on
  `a_zkai_saved_with_movements_still_loads_and_writes_none`'s model.
  *(was: design call.)*
- **OQ-3 — RESOLVED during review: leave the median open, and Phase 1 draws it.**
  The draft asked what happens between two arms that nearly coincide, and the
  premise was geometrically wrong: two arms 5° apart have axes only `r · sin 5°`
  ≈ 2.4 units apart at the rim, against bands at least 12 wide, so they overlap
  throughout and no sliver exists. **The gap that really appears is a divided
  road's median** — its two carriageways are `SCHEMATIC_MEDIAN` apart, each band
  is about its own `origin`, and the strip between them is genuinely unpainted.
  That is the correct picture and wanted: `zk-005` drew the two carriageways
  apart on purpose, and closing them at the node would undo it for no reason a
  reader would thank us for. So **no gap-closing rule, no threshold, and no
  boolean union** — the plain union of §2.2 is what ships, and the Phase 1 dev
  pass looks at a divided approach to confirm the median reads as a median rather
  than as a crack. **It does**: the median runs through the junction unbroken, the
  four quadrant rings sitting either side of it. *(was: design call. Answered from
  the geometry, which is what §4 of the conventions asks of a code-answerable
  question.)*
- **OQ-4** — **Should the badge glyphs be a separate field from the shape?**
  §2.1's table shows the enum is carrying two independent questions — what shape
  the asphalt is, and what mark sits on it — and a human cannot currently ask for
  a roundabout *with* signals. Splitting them is a model change with a mirror, a
  migration and an Inspector row. *(design call; proposed: not here. It is a
  bigger subject than this spec's, and it should be its own if it is ever
  wanted — but it is worth a round-0 challenge, because if the split is coming
  anyway then Phase 2's migration is the cheapest moment to do it.)*
- **OQ-5 — RESOLVED in Phase 1: floor the bound, and only where it is vacuous.**
  ~~Draw it at a floor anyway, move it onto one carriageway, or leave the junction
  badge-less?~~ The half-diagonal is `min(rp * 0.85, s)` while `s > 0`, and
  `rp * 0.35` when `s` is `0` — a badge that vanishes is harder to diagnose than
  one that overhangs, which was the proposal. **The floor is conditional, and that
  is the part worth reading**: an unconditional `max(min(rp * 0.85, s), rp * 0.35)`
  reads the same until §2.3's own T with a 1-lane through road and a 4-lane stem,
  where it raises a **measured** 6 to 9.51 and puts 3.5 units of yellow back on
  bare paper — the defect the measured bound exists to remove, and the reason a
  width-derived form was rejected. `Diagram.test.tsx` pins both branches, and an
  unconditional floor was run as a mutation and fails the mixed-T assertion.
  The list this question carries — every approach divided, a **single-arm**
  junction, a **Y whose arms all leave the same way** — is unchanged and is what
  the floor answers. *(was: design call. Taken by the user on the Phase 1 plan.)*
- **OQ-6 — RESOLVED by the Phase 1 dev pass: it reads as a bend, and needs
  nothing.** ~~A node with two arms may read as a lump in the road.~~ Two arms at
  an angle draw as a **mitred elbow** — the outer corner squared off where the two
  bands cross, the inner corner filled to where their edges meet. It reads as a
  bend a road makes, not as a lump, and it is strictly better than the disc it
  replaces. No action.
  *(was: deferred by evidence. The evidence was drawn.)*

## 4. Implementation phases

Strictly sequential; each is one plan-mode pass with a concrete exit gate.

### Phase 1 — The pad follows its arms

*Produces the observable: **yes**, and it is the whole reason the spec exists —
every pad junction in every figure stops painting asphalt where no road goes, and
a three-arm node reads as a T without anyone picking anything.*

- **Scope:** `padShape(arms, center, r)` and `rayPadExit(rings, p, d)` in
  `src/editor/geometry.ts` per §2.2 and §2.3 — one closed ring per arm, each the
  arm's band intersected with the disc of radius `r`, every ring wound the same
  way, `[]` when there are no arms. `JunctionGlyphShape` paints them as one
  `<path className="jn-pad" d={polygonsPath(...)}>`, keeping the `<circle>` for
  the no-arms case. **Where there are arms**, the priority diamond's half-diagonal
  becomes `min(rp * 0.85, s)`, `s` being the smallest `rayPadExit` from the centre
  over the four tip directions; **on the no-arms disc it stays `rp * 0.85`**, or a
  vacuous `s = 0` would erase the badge from a junction still painting a full disc
  under it (§2.3). **The rim does not move** (§2.3):
  `padRadius`, `ringRadius`, `rayCircleExit`, `junctionRadius`, `rimClearance`,
  the hit disc, the halo and `SignalHead` are all untouched. `.jn-pad` in
  `src/styles/diagram.css` must not set `fill-rule`, since the default nonzero is
  what renders the union. Frontend only — no model change, no Rust, no action, no
  control.

  **Six shipped assertions in `src/components/Diagram.test.tsx` read the pad's
  radius off `class="jn-pad" r="…"`, and one pins the literal serialization
  `jn-pad" r="16.02"></circle><line class="`.** They exist to pin `zk-005`'s
  `armReach` floor, its Size clamp and the class-width narrowing — invariants
  about `padRadius`, not about the element. Rewrite each to call `padRadius`
  directly, which is exported and pure; that keeps every invariant and decouples
  it from the markup permanently. Naming them here is what stops them being
  deleted as collateral.

  **This phase sits at the ceiling of one plan-mode pass and is deliberately not
  split**, which review asked about directly. The seam that looks available is
  the diamond bound, badge paint being a different subject from the pad outline.
  It is rejected because the diamond breaks only *because* the pad changed:
  splitting it out would ship a phase that paints yellow on bare paper, which is
  the "visibly wrong in between" state a phase boundary must never create. The
  assertion rewrites cannot be split off either — they land with the element
  change or the suite is red between the two.
- **Exit gate:** `bun run build` + `bun run test` green, and **`cargo test`
  unchanged** (§2.5). Every geometric assertion below is written against one
  test-file predicate, **`inside(rings, p)`** — a point-in-any-ring test the repo
  does not have and this phase writes. It stays in the test file: `rayPadExit`
  goes in `geometry.ts` because `Diagram.tsx` calls it, but the gate deliberately
  does **not** assert through `rayPadExit`, or a bug in the helper could mask a
  bug in the rings it is measuring.

  The two assertions that actually test §2.2, in `geometry.test.ts`, because §2.3
  explains why nothing else can:
  - **the outline reaches the rim along every arm, and stops there** — with
    `t = rayCircleExit(origin − center, dir, r)`, the point at `t − ε` along the
    arm's own ray from `origin − center` is `inside` and the point at `t + ε` is
    not. **Phrased on the ray, never on the ring's furthest vertex**: those are
    different numbers whenever `origin ≠ center`, and on the divided approach
    this is tested against they differ by about 4 units (`rayCircleExit` 19.84
    against a furthest vertex at 23.81), so a vertex-worded assertion fails a
    correct implementation. Tested at three arm counts **and** on that divided
    approach, which is the fixture where the two readings come apart at all;
  - **no vertex of any ring exceeds `r`** from the centre — as `≤ r + ε`, since
    chord endpoints land *on* the circle. This is the containment §2.3 shows is
    load-bearing and the assertion a flat-ended band fails. It passes *trivially*
    for an inscribed arc at any chord density, which is why it does not
    substitute for the reach assertion and why §2.2 bounds the chord step.

  Then: **a point at `0.9 r` in the direction of the *missing* arm is outside the
  pad** — the direction no road takes, which on a T with arms running east, west
  and south is due **north**. (Not "opposite the missing arm", which names due
  south and is where the stem is; and not "in the empty quadrant", because at 45°
  the point is 17.3 from the through road's axis and so **inside** its band. Both
  wordings were tried and both are false.) The fixture must satisfy
  `0.9 r > max(width) / 2` — 24.46 against 19.5 on §1's T.

  And **the no-arms path is byte-identical, badge included**: a lone junction
  node still renders `class="jn-pad" r=`, **and a lone `priority_cross` still
  draws its diamond at `rp * 0.85`** — the branch a vacuous `s = 0` would
  silently erase, and the one branch this phase must not move.

  `Diagram.test.tsx`: every stop bar's `x1/y1/x2/y2`, the hit disc radius and the
  halo radius are **unchanged** — a regression check, not a proof (§2.3), and its
  baseline is captured from the current build in the same commit, since only the
  stop bars are pinned today; the priority diamond's points are **expected to
  change** and are re-pinned, with the case that motivates the measured bound
  among them: a T whose through road is 1 lane and whose stem is 4 puts every
  tip's bound at 6, not at the widest arm's 19.5. `export.test.ts`: `strokeAllowance`
  is unchanged (§2.5 — confirm, do not pre-emptively widen), and the pad's
  vertices lie inside a `diagramSvg` viewBox built from synthetic bounds — the
  taper and gore precedent, because `getBBox` has no DOM in this environment.

  Plus a `bun run dev` pass on a T, a four-arm cross, a **divided approach**
  (OQ-3's median — does it read as a median or as a crack?), a `priority_cross`
  (the diamond), and a two-arm junction (OQ-6), at the default Size and a reduced
  one.
- **Close-out:** `rules/road-joints.md` (the pad is no longer a disc; *why* the
  three rim consumers did not move, and that the reason is containment rather
  than the union — that reasoning is the reusable part); `rules/junctions.md`
  (the glyph table's "one of six drawings"); the project-memory roadmap.

#### As built (2026-08-10)

Shipped as designed. Frontend only, no Rust; 423 vitest (up 17), `cargo test`
unchanged at 68. `padShape`/`rayPadExit` in `geometry.ts`, `diamondHalf` and the
`<path className="jn-pad">` branch in `Diagram.tsx`, a comment on `.jn-pad`. The
rim, the badges' two other members and `strokeAllowance` all needed nothing, as
§2.3 and §2.5 predicted. Four things worth carrying forward:

- **The gate's two assertions were the only ones that could fail**, and the
  mutation run proves it rather than asserting it. Six mutations, each failing a
  **distinct** test: no forced vertex at the ray exit; one chord per half-arc; a
  flat-ended band; a strict outside-test in `rayPadExit`; alternating ring
  winding; and OQ-5's unconditional floor. The stop bars, hit disc and halo
  stayed byte-identical through **all six** — which is exactly §2.3's point that
  they are a regression check and not a proof.
- **The winding invariant needed an assertion of its own, and nothing else would
  have caught it.** A reversed ring cancels into a hole *where the roads meet*,
  and the gate's `inside(rings, p)` still calls that point covered, because it
  asks one ring at a time. `padShape` is safe by construction — the arm's frame
  is a rotation — but the invariant is one edit away from being lost, so it is
  now pinned on the signed area.
- **At the Size floor the pad is round again**, found in the dev pass and not a
  defect: `armReach` floors `r` at `width / 2` for an undivided arm, and a band
  of half-width `width / 2` cut by a disc of *that* radius **is** a half-disc. The
  clamp working, not the shape failing.
- **The dev pass rendered through the real export path** rather than driving the
  window — junction semantics Phase 3's precedent, and here it is what made the
  divided junction's median legible enough to answer OQ-3 by measurement. The
  three findings above all came out of the pictures, not the suite.

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
  normalise it to `Generic` in `src-tauri/src/persist.rs:load_document` — the
  project's first migration arm (§2.4). `SCHEMA_VERSION` per OQ-2. OQ-1's
  `rotation` removal folds in here if review takes it, since this is already the
  phase that touches both mirrors.

  **Two frontend sites beyond the union and the picker**, both found by grep and
  named so the build is not the thing that discovers them:
  `src/editor/geometry.test.ts` iterates
  `["signalized_cross", "priority_cross", "t_junction"] as const` typed against
  `JunctionGlyph`, and `src/editor/state.ts:nudgedGlyph`'s doc comment names the
  variant as one a human deliberately picks. `tsconfig.json` includes all of
  `src`, so the first fails the build; the second is stale prose and fails
  nothing.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green — and the
  `cargo test` count is asserted deliberately here rather than assumed, because
  this phase edits `Inspector.tsx`, which `src-tauri/src/network/import.rs` reads
  with `include_str!` (§2.5).

  A **Rust** test that a `.zkai` carrying `glyph: t_junction` **loads**, comes
  back as `generic`, and **re-saves with no `t_junction` anywhere** — written
  against a committed fixture file rather than a hand-built struct, because the
  failure being guarded is a *parse* failure and a struct cannot reproduce it.
  That test is the phase's real proof, and a `Diagram.test.tsx` equivalent is
  **not** written: with the variant gone from the union it would need a cast, and
  the Rust normalisation means the frontend can never receive one.

  For the union, `bun run build` green proves no *existing* reference survives;
  the durable check is one `@ts-expect-error` line in a test asserting that
  `"t_junction"` is no longer assignable to `JunctionGlyph`, which `tsc` fails if
  the error ever stops occurring. "A compile error is the assertion" is not a
  gate — it disappears the moment the code compiles.

  Plus a `bun run dev` pass opening a pre-Phase-2 document saved with the
  variant, confirming it draws as it did and re-saves clean.
- **Close-out:** `rules/junctions.md` (five glyphs, and the migration);
  `rules/persistence.md`, whose "no migration arm is needed" this phase falsifies
  — it is the first one; `zk-005` OQ-7 and `zk-008` OQ-5 both record that this
  landed and how; the project-memory roadmap.

#### As built (2026-08-10)

Shipped as designed, with **both open questions taken as proposed** (OQ-1 fold the
`rotation` removal in, OQ-2 no bump). 424 vitest (up 1), `cargo test` 69 (up 1) —
one new test each, exactly the predicted moves, and the `cargo` count asserted
rather than assumed because this phase edits a file `import.rs` reads with
`include_str!`. Four things worth carrying forward:

- **The commit order was decided by a failing test, not by the plan.** The plan
  put the glyph retirement first and the `rotation` removal second; the migration
  test asserts the re-saved file contains **neither** spelling, so it was red until
  the field was gone. Reordering was the fix — a phase's commits each have to be
  green on their own, and the narrative order is the thing that gives way. Worth
  knowing before the next phase that folds an OQ into a headline change.
- **A hand-authored fixture is a different kind of object from a copied one**, and
  the README beside it exists to say so. `tests/fixtures/network/` holds bytes
  another project produced; this one holds bytes *this* project can no longer
  produce, so the standing instruction is inverted: never regenerate it by saving
  from the app. Doing that yields a valid document that tests nothing, and it
  passes quietly, because what it would then assert about the output is already
  what the test expects.
- **Three mutations, each failing a distinct test**, since a green first run is not
  evidence: dropping the `migrate` call (the glyph assertion), restoring `rotation`
  to the Rust struct with its one construction site patched so it compiles (the
  `rotation` assertion — the unpatched version fails at compile time instead, which
  is the weaker guard and not the one being checked), and putting `t_junction` back
  in the TypeScript union (`error TS2578: Unused '@ts-expect-error' directive`,
  which is the whole reason that line is written as a directive rather than left to
  a compile error).
- **Two rules were at their line cap and the caps moved**, which is a decision
  rather than a slip. `rules/junctions.md` absorbed the change by trading prose it
  had just falsified and landed at exactly 215. `rules/persistence.md` (110) and
  `rules/document-model.md` (130) had **no falsified prose of equal length to
  trade** — they gained a mechanism neither had, the first migration arm — so they
  went to 122 and 135. Compressing to fit would have starved the one genuinely new
  fact in the phase.

The dev pass was split, because this shell has no accessibility permission and
System Events reports the Tauri window as having none: the drawing was checked by
rendering the fixture's document through the real export path **twice**, once with
the retired glyph (via a cast) and once with `generic`, and asserting the two SVGs
are byte-identical — which is the "unchanged by construction" claim measured
rather than eyeballed. The picker was checked against the built bundle, which
carries the five remaining labels and no `T-junction`. What no test covers, and did
not need to, is the file dialog itself; `load_document` → `save_document` on a real
file is what the Rust test walks.
