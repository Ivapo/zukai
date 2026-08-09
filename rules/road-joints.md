---
title: road-joints
sources:
  - src/components/Diagram.tsx
  - src/editor/export.tsx
  - src/editor/geometry.ts
  - src/model/types.ts
  - src/styles/diagram.css
  - src-tauri/src/model/layout.rs
covers: >
  what is drawn where links meet a node: the arms and the two radii, the rim
  three things measure to, taper wedges at a through joint, and the gore
  between two separating arms
max_lines: 160
generated: 2026-08-08
---

# Road joints

### Arms carry their position, so the glyph follows the carriageways

`Arm` is `{ id, dir, origin, width }`, and `origin` is **not re-derived** — it is
the drawn polyline's own end point, which `junctionArms` already had. No second
call to `carriageways`, no `DRIVE_SIDE` reasoning, so none of the offset-sign
traps above. `origin` is **world** space; a glyph's group is translated to the
node, so an interior detail enters as `origin - center`, which is `(0, 0)` for an
undivided road. `id` is **`gorePair`'s tie-break** and, since the movement arcs
went, that is again all it is — `dir` cannot substitute, since it points away from
the node whichever way traffic runs.

**`Arm`, `junctionArms` and both radii live in `geometry.ts`**, not the render
body — `drawnPolyline`'s move, one step on and for the same reason: a marking
anchored to a link's far end measures its clearance from the **rim of the glyph
these arms size**, and where a glyph reaches is not a render-time question. The
radii are pure functions, so the drawing is byte-identical across the move —
asserted by `Diagram.test.tsx` passing untouched, which is the whole gate on a
lift like this.

Three things measure to that rim, and it matters that they share one expression:

- **A stop bar starts from its own carriageway**, at `(origin - center) + dir *
  (rayCircleExit(origin - center, dir, rp) + 4)`. `rayCircleExit` returns
  *exactly* `rp` from the centre, so an undivided junction draws byte-identically
  to the centre-derived code it replaced.
- **An `end`-anchored marking clears the rim by the same expression** —
  `rimClearance`, with no constant at all, since the marking supplies its own
  `position` past it. It is the reason the arms had to leave the render body. Its
  radius is `junctionRadius`, which differs from the stop bar's `rp` in one case:
  a **roundabout** measures to `ro`, because a ring buries an approach arrow
  exactly as a pad does.
- **The arms' reach is a floor on both radii, never a replacement**: `reach =
  max(distance(origin, center) + width/2)`, then `rp = max((maxW * 0.62 + 3) *
  scale, reach)` and the same for `ro`. Substituting would *shrink* every
  undivided pad ever drawn, since `0.62 w + 3 > w / 2` for every road.

**`scale` multiplies the base term only; the floor is unscaled.** The corollary is
intended: **Size clamps.** Below roughly half scale the floor binds even on an
undivided junction, because a pad narrower than its own approach is not a smaller
junction but a broken one.

**Still open (ramps OQ-4):** the node *dots* draw at the node position, so an
endpoint or waypoint on a divided road sits in the median. `Arm.origin` makes "one
dot per carriageway" cheap; whether that is what it should show is the question.

## Tapers: a wedge at the joint, never a link that changes width

Both links keep their **uniform** width and the transition is one added polygon
per side. A link whose width varies is rejected outright: `Link.lanes` is a single
array, so a tapering link has no answer to "how many lanes is it", and the casing
is a **stroked path**, whose width cannot vary.

`tapers(doc, offsets)` finds the joints; `taperWedges` decides and builds. A joint
qualifies on **three** independent tests:

- **Exactly two incident links, one ending and one starting.** Three or more is a
  junction or a gore. Node *kind* is not consulted — what makes a joint is how
  many roads meet at it.
- **Not a reversed twin.** A divided pair puts one link in and one out at *either*
  node, so unequal lane counts would stretch a wedge across the median.
- **Collinear within `TAPER_MAX_BEND` (8°).** `segmentNormals` rotates with the
  link, so at `N1(0,0) → N2(120,0) → N3(120,120)` two *identical* 4-lane links put
  their nearside casing edges at `(120, 19.5)` and `(100.5, 0)`.

**The twin test and the bend guard do not subsume each other.** A hairpin has a
different node pair, so only the bend guard opposes its frames; a twin whose bends
leave the node the other way passes the bend guard and only the twin test stops
it. Both are preconditions.

Then, **per side independently**, the two ends' casing edges are compared as
**signed lateral offsets** — `d ± roadWidth/2`, where `d` is the very number
`drawnPolyline` applies, **never world points**. Equal ⇒ nothing to draw.
Otherwise the **inset** link is the one nearer the road's other side (smaller on
the nearside, larger on the offside) and the wedge runs `TAPER_LENGTH` (24) along
it. Four cases fall out with no further judgement — a lane drop wedges forward
past the node, an addition backward before it, a centre-aligned pair gets one
wedge per side, and a pair aligned to different sides gets one each way. Four
things this pins:

- **The rule keeps the geometry additive.** A wedge only paints asphalt into space
  the inset link left empty; it never erases asphalt a uniform stroke laid down,
  which is what makes it a polygon and not a redraw.
- **It is bounded by the *casing* edges**, because a wedge is asphalt. Its own edge
  line is inset 1.5 from the hypotenuse (`taperEdge`), mirroring `RoadShape`'s
  `edgeInset`; the lane-region edge is a silent 1.5-unit error at every joint.
- **A wedge forces butt caps** on **both** links, or the outset link's round cap
  paints a half-disc of asphalt past the node that no added polygon can remove.
  `stroke-linecap` is a property of the whole path, so a link tapered at one end is
  butt-capped at its **other** end too — covered by the pad at a junction, and a
  flat rather than domed free end elsewhere, the better schematic reading anyway.
- **8° is derived, not picked.** Butt caps notch the outside of a bend by
  `(roadWidth/2)·tan(θ/2)` — 1.36 units at 8° on a 4-lane road, no deeper than the
  1.33-unit overhang they remove. 15° would invert the trade at ≈2.6.

The wedge is a `<polygon class="road-taper">` inside `<g class="taper
road-{style}">`, taking the **inset** link's class token, so `.road-local
.road-taper` and the class-scoped `.road-edge` width apply with no rule of their
own. Only a joint that draws a wedge is touched, so a document with no width step
emits byte-identical markup. **A divided road's lane drop does not taper** — four
links on the node is not a through joint, a named non-goal rather than an
oversight.

## Gores: the paint between two arms that separate

A `gore` glyph draws **no pad at all** — the whole glyph is the hatched triangle
between two arms, nosed where their painted edges meet. One variant covers a
diverge and a merge, because the geometry is identical and the rule picking the
arms never asks which way traffic goes.

- **The pair is the one with the smallest angle between their directions**
  (`gorePair`). It **cannot** be read off the traffic: `junctionArms` orients every
  arm away from the node whichever way traffic runs, so an `Arm` carries no
  incoming/outgoing information. Unit directions, so smallest angle is largest
  dot; an exact tie breaks on the **link ids**, never `doc.links` order, or the
  same three roads would draw differently in a differently-ordered document.
- **It is bounded by the roads' *painted* edges, not their casing rims** — the
  opposite of a wedge. So `GoreArm.halfSpan` is `(roadWidth - ROAD_MARGIN) / 2`,
  exactly `RoadShape`'s `edgeInset`: the legs are literal continuations of the two
  edge lines, and `jn-gore-edge` therefore takes **no inset of its own**.
- **The nose is a ray intersection with two degenerate cases**, both falling back
  to the node: parallel arms, and arms whose edges meet only *behind* both origins.
  "Behind **both**" is the rule — "behind either" would drop a good nose whenever a
  divided carriageway steps one arm past it. The failure the fallback prevents is
  an `Infinity`/`NaN` in the markup, which renders as nothing and which no
  `points=` assertion catches.
- **Two polygons, not one.** The hatch is transparent by design — a shoulder band
  takes its asphalt from the casing under it — but a gore widens out onto bare
  paper, so `.jn-gore` paints the surface and `.jn-gore-hatch` overlays it. The
  base is left open and unlined: that blunt end is the physical nose.
- **`GORE_LENGTH` (36) is scaled by the glyph's Size**, unlike `TAPER_LENGTH`, or
  the control would be inert on a pad-less glyph. Lengthening cannot misalign
  anything: the legs stay on the edge lines and only the base slides.

**The `<defs>` condition widened with it.** `needsHatch(doc)` fires for a shoulder
lane **or** a gore glyph. It cannot become unconditional (an empty document is
pinned to exactly `<g class="diagram"></g>`) and it cannot stay shoulder-only, or
a gore in a shoulder-less document references a `<pattern>` never emitted and
draws an *unpainted* triangle with markup otherwise identical.

**The gore is the one glyph that needed a `SCHEMA_VERSION` bump** — a new enum
*variant*, not a new field (`rules/document-model.md`).
