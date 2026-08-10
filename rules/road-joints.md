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
  between two separating arms — its triangle, its chevrons, and the one
  derivation that faces them at the driver
max_lines: 190
generated: 2026-08-10
---

# Road joints

What is drawn where links **meet**: the arms a junction glyph is sized from, the
wedge that closes a width step, and the triangle between two arms that separate.
The road either side of a joint is `rules/road-rendering.md`, whose
`drawnPolyline`, `roadWidth`/`laneBands` and `carriageways` sign reasoning
everything here consumes rather than repeats. Rationale:
`specs/ramps_and_tapers_spec.md`.

## Arms carry their position, so the glyph follows the carriageways

`Arm` is `{ id, dir, origin, outbound, width }`, and **neither `origin` nor
`outbound` is re-derived** — both were already in `junctionArms`' hand and thrown
away. `origin` is the drawn polyline's own end point, so no second call to
`carriageways`, no `DRIVE_SIDE` reasoning, and none of that derivation's
offset-sign traps; it is **world** space, and a glyph's group is translated to the
node, so an interior detail enters as `origin - center` — `(0, 0)` for an
undivided road. `outbound` is the function's own `touchesStart`: the node is the
link's `from_node`, so traffic **leaves** along this arm.

**`dir` cannot substitute for either**, which is why both exist: it points away
from the node whichever way traffic runs. `id` is `gorePair`'s tie-break and,
since the movement arcs went, all it is; `outbound` is `goreFlow`'s only input.

**`Arm`, `junctionArms` and both radii live in `geometry.ts`**, not the render
body — `drawnPolyline`'s move one step on, and for its reason: a marking anchored
to a link's far end measures its clearance from the **rim of the glyph these arms
size**, and where a glyph reaches is not a render-time question. The radii are
pure, so the drawing is byte-identical across the move — the gate on such a lift
being `Diagram.test.tsx` passing untouched.

**Three things meet at that rim: two measure to it, the third sizes it.** The two
share one expression, `rayCircleExit(origin - center, dir, r)`:

- **A signalised junction's stop bar starts from its own carriageway**, one
  `rayCircleExit(…, rp) + 4` along `dir`. That call returns *exactly* `rp` for a
  centred arm, so an undivided junction draws byte-identically to the
  centre-derived code it replaced, and a divided approach gets a bar per half.
- **An `end`-anchored marking clears the rim by the same call** — `rimClearance`,
  with no constant at all, since the marking supplies its own `position` past it
  (`rules/road-markings.md`). Its radius is `junctionRadius`, differing from `rp`
  in one case: a **roundabout** measures to `ro`, because a ring buries an
  approach arrow as a pad does.

The third is `armReach`, a **floor** on both radii and never a replacement:
`reach = max(distance(origin, center) + width / 2)`, then `rp = max((maxW * 0.62
+ 3) * scale, reach)` and `ro = max(max(20, maxW * 1.35) * scale, reach)`. Only
the floor is shared; the two base terms differ. Substituting the floor for the
base would *shrink* every undivided pad ever drawn, since `0.62 w + 3 > w / 2`.
**`scale` multiplies the base term only; the floor is unscaled**, so **Size
clamps**: below roughly half scale the floor binds even on an undivided junction,
because a pad narrower than its own approach is not a smaller junction but a
broken one.

**Still open (ramps OQ-4):** the node *dots* draw at the node position, so an
endpoint or waypoint on a divided road sits in the median. `Arm.origin` makes "one
dot per carriageway" cheap; whether it *should* show that is the question.

## Tapers: a wedge at the joint, never a link that changes width

Both links keep their **uniform** width and the transition is one added polygon
per side. A varying-width link is rejected outright: `Link.lanes` is a single
array, so it cannot answer "how many lanes is it", and the casing is a **stroked
path**, whose width cannot vary.
`tapers` (`Diagram.tsx`) finds the joints; `taperWedges` (`geometry.ts`) decides
and builds. A joint qualifies on **three** independent tests:

- **Exactly two incident links, one ending and one starting.** Three or more is a
  junction or a gore; a self-loop falls out by asking each link's *other* end to
  be elsewhere. Node *kind* is not consulted — a joint is how many roads meet.
- **Not a reversed twin.** A divided pair puts one link in and one out at *either*
  node, so unequal lane counts would stretch a wedge across the median.
- **Collinear within `TAPER_MAX_BEND` (8°)**, tested as the two ends' directions
  dotting near `-1`. `segmentNormals` rotates with the link, so at
  `N1(0,0) → N2(120,0) → N3(120,120)` two *identical* 4-lane links put their
  nearside casing edges at `(120, 19.5)` and `(100.5, 0)`.

**The twin test and the bend guard do not subsume each other**, and both are
preconditions. A hairpin has a different node pair, so only the bend guard opposes
its frames; a twin whose bends leave the node the other way passes the bend guard,
and only the twin test stops it.

Then, **per side independently**, the two ends' casing edges are compared as
**signed lateral offsets** — `offset ± width / 2`, the number `drawnPolyline`
applies, **never world points**. Equal ⇒ nothing to draw; otherwise the **inset**
link is the one nearer the road's other side (smaller on the nearside, larger on
the offside) and the wedge runs `TAPER_LENGTH` (24) along it. Lane drop, lane
addition and either alignment fall out of that alone. Four things it pins:

- **The geometry stays additive.** A wedge only paints asphalt into space the
  inset link left empty; it never erases asphalt a uniform stroke laid down,
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

The wedge is a `<polygon class="road-taper">` in `<g class="taper road-{style}">`,
taking the **inset** link's class token, so `.road-local .road-taper` and the
class-scoped `.road-edge` width apply with no rule of their own. Only a joint
drawing one is touched, so a document with no width step emits byte-identical
markup. **A divided road's lane drop does not taper** — four links on the node is
not a through joint, a named non-goal.

## Gores: the paint between two arms that separate

A `gore` glyph draws **no pad at all** — the whole glyph is a chevroned triangle
between two arms, nosed where their painted edges meet. One variant covers both a
diverge and a merge: the geometry is identical, and the pair rule ignores traffic.

- **The pair is the one with the smallest angle between their directions**
  (`gorePair`), and it is **not** read off the traffic: `junctionArms` orients
  every arm away from the node whichever way traffic runs, so `dir` carries no
  incoming/outgoing information. Directions are unit, so smallest angle is largest
  dot; an exact tie breaks on the **link ids**, never `doc.links` order, or the
  same roads would draw differently in a differently-ordered document.
- **It is bounded by the roads' *painted* edges, not their casing rims** — the
  opposite of a wedge. So `GoreArm.halfSpan` is `(roadWidth - ROAD_MARGIN) / 2`,
  exactly `RoadShape`'s `edgeInset`: the legs are literal continuations of the two
  edge lines, and `jn-gore-edge` therefore takes **no inset of its own**.
- **The nose is a ray intersection with two degenerate cases**, both falling back
  to the node: parallel arms, and arms whose edges meet only *behind* both origins.
  "Behind **both**" is the rule — "behind either" would drop a good nose whenever a
  divided carriageway steps one arm past it. The fallback prevents an
  `Infinity`/`NaN` that renders as nothing and no `points=` assertion catches.
- **Two layers, not one.** A shoulder band takes its asphalt from the casing under
  it; a gore widens onto bare paper, so `.jn-gore` paints the surface and the paint
  rides on it. The base is open and unlined: that blunt end is the physical nose.
- **`GORE_LENGTH` (36) is scaled by the glyph's Size**, unlike `TAPER_LENGTH`, or
  the control would be inert on a pad-less glyph. Lengthening cannot misalign
  anything: the legs stay on the edge lines and only the base slides.

### The chevrons, and the one place a gore reads the traffic

The paint inside is a fan of chevrons (`goreChevrons`, a `.jn-gore-chevrons`
path), not the shoulder hatch it briefly borrowed: a hatch says "not a running
lane", a gore says "go round this, on this side" — a direction, and it needs one.

- **`goreFlow(a, b)` is the only place direction is read, and only after the pair
  is chosen.** Both arms `outbound` → a diverge, chevrons at the **nose**; both
  inbound → a merge, at the **base**; **mixed** takes the diverge floor rather
  than throwing (ramps OQ-9), since an imported fragment can hold one. One fixed
  orientation draws half of all gores stating the opposite of what they mean, so
  both cases are pinned off one fixture.
- **The layout has no frame of its own.** The triangle is isoceles, so its axis is
  `nose → midpoint` and every point is a `lerp` — of a leg for the wings, of the
  axis for the tip. No perpendiculars, no normals, no offset signs.
- **Count from the axis, pitch follows** (`GORE_CHEVRON_PITCH`, one lane,
  unscaled), as `spanCells` does for the tiled markings: containment is
  constructional, and a longer gore takes *more* chevrons, not longer ones.
- **`GORE_CHEVRON_LEAN` (0.65) is a fraction, not an angle** — how far a wing
  leans off the edge it lands on, toward square across. Any *fixed* angle is
  eventually shallower than the edge of a wide gore, which puts the tip past its
  own wings and **turns the chevron round**: the silent mirror by the back door.
- **A cell with no room for a tip draws nothing**, and neither does either
  degenerate gore. Pinning a tip to the corner folds both wings onto the edge
  lines, drawing the outline twice; anti-parallel arms leave no axis (`NaN`); and
  *parallel* arms leave an axis with no width, collapsing each chevron to a point
  — which a round cap paints as a **dot**. The last was found in the dev pass.

**The `<defs>` gate narrowed back with the borrowing**: `hasShoulder(doc)` fires
for a hard shoulder and nothing else. It was widened, and renamed `needsHatch`,
only while a gore reached the same pattern.

**The gore is the one glyph that needed a `SCHEMA_VERSION` bump** — a new enum
*variant*, not a new field (`rules/document-model.md`).

## Where each piece lives

`geometry.ts` owns the pure half — `Arm`/`junctionArms`, `padRadius`/`ringRadius`/
`junctionRadius`, `rayCircleExit`, `JointEnd`, `taperWedge`/`taperWedges`/
`taperEdge`, `GoreArm`/`gorePair`/`gore`/`rayIntersection`,
`GoreFlow`/`goreFlow`/`goreChevrons`, and the three lengths plus the two chevron
constants — under `geometry.test.ts`. `Diagram.tsx` turns those into markup:
`jointEnd`, `tapers`, `TaperShape`, `GoreShape` and the stop-bar loop in
`JunctionGlyphShape`, tested through `renderToStaticMarkup`. Nothing here reaches
`rules/road-rendering.md`'s `HatchPattern` any more — that borrowing is over.
Paint is `diagram.css`; `gore` is mirrored in `types.ts` and `layout.rs`.
Nothing here reaches `state.ts` — a joint is derived from the links meeting at a
node, so there is no action and nothing to undo. `strokeAllowance` (`export.tsx`)
needs nothing from either shape: `measureDiagram` frames the *drawn* tree, and
both are fill whose corners sit on the casing rim it already derives from.
