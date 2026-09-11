---
title: marking-kinds
sources:
  - src/components/Diagram.tsx
  - src/editor/export.tsx
  - src/editor/geometry.ts
  - src/model/types.ts
  - src/styles.css
  - src/styles/diagram.css
  - src-tauri/src/model/decoration.rs
covers: >
  what each of the eight marking kinds paints: the marking layer and its order,
  the per-kind shapes and their chrome, the turn arrow with its staggered forks
  and its second head, the lane line and the boundary it replaces, the bus stop's
  box and the stretch it is cut from, and text and the font it cost
max_lines: 250
generated: 2026-08-10
---

# Marking kinds

What a marking **paints**, kind by kind. The marking as an object a human owns —
anchor, placement, dragging, editing, deletion — is `rules/road-markings.md`, and
everything here starts from the anchor that rule defines. Rationale:
`specs/road_markings_spec.md`; the second head, `specs/lane_arrows_spec.md`; the
stop, `specs/bus_stops_spec.md`.

**Seven of the eight kinds are drawn.** `stop_line`, `give_way_line`, `crosswalk`,
`turn_arrow` and `text` sit at a point across the road; `lane_line` runs **along**
it for the whole link and `bus_stop` over a **stretch** of it, the two odd ones
out below. `Hatching` alone is out of scope and paints a placeholder bar, as do the
two kinds with an empty fresh payload.

## What the renderer asks for

`markingForm(doc, marking, offsets)` is the **one call the renderer makes**: a
marking is drawn `across` the road at a point, `along` it for the whole link, or as
a `stop` over a stretch. The kind branch lives there, not in `Diagram.tsx`, so the
layer stays one call, one skip, one element. `markingAnchor` is the `across` arm,
returning `{ at, dir, span, distance }`; `laneLine` is the `along` arm and takes no
anchor; `busStop` is the `stop` arm. `span` is one `laneBands` entry, or
`{ offset: 0, width }` summed **from the bands**, not `roadWidth - ROAD_MARGIN`.

**Every point kind's builder takes the anchor** and nothing else except its own
payload — `markingArrow` alone has one, its `directions` and `back`. The anchor's
**one kind-aware line** gives the **nearside** band to a lane-less `turn_arrow`, an
arrow having no carriageway-wide meaning, and to a `bus_stop` **whatever `lane`
says**, tested *before* the out-of-range skip. It lives there so the hit target and
halo move with the paint, and it does **not** flip `dir`.

**`markingForm` skips what the cascades in `state.ts` cannot reach**
(`rules/road-markings.md`) — an unknown `link`, an undrawable polyline, a
non-finite `position`, a `lane` past the link's lanes (never a stop's). Each
returns `undefined` and the renderer emits *nothing*: an out-of-range `laneBands`
index would yield `NaN` coordinates, which SVG renders as an invisible-but-corrupt
path no `d=` assertion catches. A skipped lane line **takes no divider with it** —
the same `boundaryOffset` finds the same nothing.

## The marking layer is a sibling, never a child of the road

`MarkingShape`s render **after every road and taper, before the nodes** — above
all asphalt, below the glyphs, since a pad is the intersection's own surface and
paint under one is genuinely covered. Nesting inside `RoadShape`'s `<g>` is wrong
**twice over**: that group carries `onLinkPointerDown`, routing a marking's clicks
to link selection, and a road drawn after its neighbour would paint over that
neighbour's markings. The class token comes from the model
(`kind.type.replace(/_/g, "-")`).

| Kind | Element | Shape |
|---|---|---|
| `stop_line` | `.marking-bar` | one stroked bar across the span |
| `give_way_line` | `.marking-teeth` | filled triangles, apexes **upstream** |
| `crosswalk` | `.marking-zebra` | filled stripes **along** the road |
| `turn_arrow` | `.marking-arrow-stem` + `-head` | the only **two-element** kind |
| `lane_line` | `.marking-line` + a style token | the whole link — not from the anchor |
| `bus_stop` | `.marking-stop-ends` + `.marking-text` | two end bars and `BUS`, **no long side** |
| `text` | `.marking-text` | a run, not a path, set at the road's angle |
| everything else | `.marking-bar` | the placeholder bar |

Three rules hold across the point kinds. **Every transverse kind is centred on
`position`.** **The teeth point at the driver**, who arrives from *behind* — drawn
the other way they read as arrowheads telling traffic to keep going, and no
assertion on a magnitude sees it. And **containment is a property of the tiling,
not a clamp**: `spanCells` takes the cell *count* from the span and lets the pitch
follow, so cells tile it exactly and nothing reaches the verge. `MARKING_PITCH` is
`LANE_PX / 3` — **one** rhythm for both tiled kinds, a third not a half because
two teeth to a lane read as two arrows.

**The `default` arm is load-bearing, not tidiness.** Three things reach it and
only one is hand-edited: `hatching` is out of scope, while a `turn_arrow` with no
direction and a `text` with no content are what the app mints when you pick either
kind. All three draw the bar, keeping a marking **visible and selectable**.

**The hit target and halo are the anchor's transverse bar for every point kind**,
so selection feels identical and a `stop_line`'s markup is byte-for-byte what
Phase 1 emitted. **The paint takes no `vector-effect`**, unlike `.jn-stopbar` and
the roads' hairlines: a marking scales with its road, so what it *paints* is
byte-identical between canvas and export — hit target and halo being
interaction-only either way. **`.marking-halo` is butt-capped** where `.road-halo`
is round: a halo matches the shape it highlights, and round caps here balloon past
the lane the marking spans.

### The turn arrow: one shaft, one branch per direction

A shared through/right lane is **one arrow with two branches**, so every branch
leaves **the same shaft** — each at the point its own direction picks, not at its
far end. Five directions are straight stubs (`through` 0°, slight ∓30°, hard ∓90°,
negative being left of travel); `u_turn` is a 180° hook turning back alongside the
shaft with its head pointing **at the driver**, hooking *left* — the U-turn side
under the right-hand traffic `laneBands` assumes.

- **The one kind drawn as two elements**: stems stroked, heads filled. One filled
  outline would close the hook across its chord and fill the half-disc inside; one
  stroked path would leave the heads hollow. The stem's `stroke-width` is an
  **attribute**, a fraction of the band, so a narrow ramp lane gets a narrower arrow.
- **`ARROW_REACH` (0.42 of the band) is the whole containment rule**, and why the
  **hook's radius is derived rather than picked**: the spec proposed a quarter of
  the band width, which puts the return leg at the band edge before the head is
  added. `2R + headHalf = reach` instead, so one number bounds all six directions.
  The proportions — a **short shaft and a chunky head** — were decided in the app.

**`BRANCH_STAGGER` is why three turns no longer draw a star.** One shared fork put
every head the same `reach` from one point, across a band only `2 * ARROW_REACH`
wide; each direction now forks its own share of the way upstream, separating the
heads **along** the road, the axis with room. Measured: no two heads intersect at
any direction set, minimum 0.487 units of asphalt between them on a default lane;
the suite asserts disjointness to three branches and containment at all six.

- **A table, not a formula on the bearing** — the slights are equally hard, so a
  formula gives them one fork, and two ±30° heads share no fork without meeting.
- **A fraction of the stagger budget**, `TURN_ARROW_LENGTH - 2 * reach` (twice the
  fork), not of the band: `s ≤ 1` is then **both** the footprint bound and the
  fork-stays-on-the-shaft bound at every width, by construction. A band with no
  budget floors to `0` — the old shared fork, never a downstream one.
- **Per-direction, not per-count**, so toggling one direction cannot move another
  head. The price: every arrow but a lone `through` changed shape.
- **Only the pair that needs it is split** — `left`/`right` are across-disjoint at
  a shared fork and share one, the symmetric barbs a painted arrow has.

#### The second head, and the one frame flip that keeps it honest

`back` paints branches at the **upstream** end pointing upstream, for the
**two-way left-turn lane**. Nothing imports one — `network.yaml` has no per-lane
direction — so it is schematic-only, as `Lane.kind` is: a **field on the existing
variant**, a **`Vec` with `skip_serializing_if`** rather than an `Option<Vec>`, so
empty and absent are the same document.

- **`back`'s directions are read in the oncoming driver's frame**, and that is the
  trap: a rear `left` is left *for the driver it faces*. Reflect `along` only and
  both heads swing the same way — plausible, and wrong.
- **So there is one flip, and it is a frame rather than a sign change.**
  `markingPoint` is affine, so `at(across, along) → at(-across, -along)` is a 180°
  rotation carrying `stub`, `hook` and `head` over wholesale; the builders take an
  `ArrowFrame` rather than closing over one. The centre is the **band centre at
  the marking's position**, *not* `anchor.at`, which sits on the polyline — they
  differ on every lane whose offset is not zero, and a test written about the
  wrong one fails a *correct* implementation.
- **The shaft shortens to `-fork → fork` iff a rear branch was actually built**,
  not iff the array was non-empty, keeping `TURN_ARROW_LENGTH` the footprint
  either way. A **`back`-only arrow** is unreachable from the panel and skipped:
  `markingArrow` returns `undefined` on zero *forward* branches.

### The lane line: the one kind that runs along the road

`Marking` has one `position` and no extent, so **it paints its boundary for the
whole link and `position` is ignored** — what a schematic wants nine times in ten.
A line that stops partway is a link that wants splitting at a waypoint.

**`lane` names a boundary, not a lane, and the count does not match.**
`boundaryOffset` is the whole rule: absent is the lane region's centre (offset
`0`); a `lane` outside `0..n-2` names nothing and **draws nothing**; otherwise
`bands[lane+1].offset + bands[lane+1].width / 2`. That last is
*character-for-character* `RoadShape`'s own divider derivation, because the road
drops the divider a line replaces by **comparing the two numbers** — an equivalent
expression over `bands[lane]` differs in the last bit, which is the bit that
decides.

**A lane line replaces the derived line at its offset** (OQ-3), divider and
shoulder line alike; overpainting leaves a dashed line under a solid one, showing
at every dash gap. `laneLineOffsets(doc)` collects what each link's lines took,
`Diagram` computes it once, and `boundaryTaken` compares — with a tolerance,
because **the centreline replaces too**: on a 2-lane road the lane region's centre
*is* boundary `0|1`, so a literal `0` must match an offset summed from lane
widths. `laneLineOffsets` takes **no** `offsets` argument — which boundary a line
sits on is a fact about the cross-section, not about where the road was dragged.

**Road OQ-4 and ramps OQ-6 landed here**, with neither's proposed model field: an
undivided two-way road is a `lane_line { style: double }` with `lane` absent.

- **The style is a class token**, so `diagram.css` carries the dashes and the
  colour and an export inherits both. `double` is **two strokes** `LANE_LINE_GAP`
  apart, with the `spine` kept for the hit target and halo.
- **A double line is the one marking that is not white.** Yellow says opposing
  traffic. `LANE_LINE_GAP` is **4**, not the 3 first written: a gap narrower than
  the 2-unit strokes reads as one fat line with a scratch down it. Decided in the
  app.
- **Its hit target and halo are its own** — the spine, at 8 units rather than 12,
  because a 12-unit strip down a link is a dead zone for every click under it. The
  **halo grows with the paint** (`haloWidth`): a double line's paint spans
  `LANE_LINE_GAP + stroke`, and a fixed halo was exactly as wide as it, which
  against yellow reads as no halo at all. Caught in the app, not by an assertion.

### The bus stop: a box the road's own lines close

`busStop` draws a **stretch**: `BUS_STOP_LENGTH` of the drawn polyline — a drawn
length, not a measured one — centred on the anchor's `distance` and **slid** half a
box in from either end, so a stop at a road's end stays whole with its word
centred, `position` untouched. It is cut by `polylineStretch`, which shares
`pointAlongPolyline`'s walk, and only then offset: offsetting first moves a bend's
corner along the road. **It paints two end bars and `BUS`, and no long side** —
those are the kerb edge line and the divider, and a solid side on the dashed one
says "do not cross" over the line a bus crosses. The word is `markingRun`, the
element a `text` marking emits, so `needsText` counts every stop. **Its hit target
and halo are the box** — band 0's centre along the stretch, stroked band 0's width,
the halo `+ 6` — not the anchor's bar. Both forms draw in the lane until a bay is.

### Text is the seventh kind, and it cost a font

`Text` was out of scope for the whole markings spec, and not for tidiness: an
exported SVG reaches no external font, so the first glyph falls back to whatever
the viewer has — or, in the PNG path, **bakes that substitution in permanently**.
Signs Phase 1 paid that by embedding Overpass Mono (`rules/diagram-export.md`):
the constraint is *satisfied*, not repealed, and governs every future glyph.

- **A run is drawn from the anchor and nothing else.** `markingText(anchor)`
  returns `{ at, angle, size }`, and the **content is not an argument**, because
  `text-anchor="middle"` centres the string. `textWidth(content)` is the separate
  function for the case that does care, which is a sign plate.
- **Its run is the one *marking* shape set at an angle**, and it earns it: paint
  turns with the road. There is deliberately **no upright flip** — a westbound road
  paints text upside down on screen and the right way up for its driver. A link's
  length label is the deliberate inverse on every count (it *does* flip, sits beside
  the carriageway, and is derived rather than placed): `rules/road-rendering.md`.
- **Centred across the band by arithmetic, not `dominant-baseline`**, whose
  support in a rasterized SVG fails silently in the PNG path: `BASELINE_DROP`,
  shared with sign and length labels. `ADVANCE` (0.616) and `CAP_HEIGHT` (0.7) are
  the **face's own** metrics, pinned so a face swap fails a test.
- **Empty content draws the placeholder bar**, which is why it can join the picker
  at all — and it is exactly what the marking arm of `needsText` counts, so font
  and glyph cannot disagree.

`Hatching` is still out for a different reason: it is an **area**, and the
`Marking` anchor is one link at one position. (A gore's chevrons are not
`Marking`s either, and belong on `GoreShape` — OQ-4.)

### The glyph's stop bars are not markings

`.jn-stopbar` is drawn per arm by `signalized_cross` and says "this junction has
signals"; a `stop_line` is paint a human placed. **A document can carry both, and
that is not a duplicate** — suppressing one from the other would couple the glyph
to the decoration list. Both stroke 4 wide, deliberately. The glyph's bar sits at
`rp + 4` and its **hit disc** at `rp + 2`, which is why a click much closer drags
the glyph instead of placing paint (`rules/road-joints.md`).

## Where each piece lives

`geometry.ts` owns every builder and constant — `markingForm` (the anchor it calls
is `rules/road-markings.md`'s), `markingBar`/`markingTeeth`/`markingZebra`,
`markingArrow` (with `ArrowFrame`, `BRANCH_BEARING` and the hook),
`markingText`/`textWidth`, `laneLine`/`boundaryOffset`,
`laneLineOffsets`/`boundaryTaken`, `busStop`/`polylineStretch` and `spanCells` —
under `geometry.test.ts`. `Diagram.tsx` holds `MarkingShape`, `markingPaint`,
`markingRun`, `haloWidth` and the exported `needsText`. Paint is `diagram.css`; the
chrome (`.marking-hit`, `.marking-halo`) is `styles.css`, the split that keeps an
export carrying the first and not the second. `strokeAllowance` (`export.tsx`)
needed **no** change for any kind: every marking paints inside its own road, no
marking stroke exceeds `.jn-stopbar`'s 4 that its `2` floor was sized for, and
teeth, zebra and text are *fill*, which `getBBox` measures with no allowance.
