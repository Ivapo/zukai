---
title: road-joints
sources:
  - src/components/Diagram.tsx
  - src/editor/export.tsx
  - src/editor/geometry.ts
  - src/model/types.ts
  - src/styles.css
  - src/styles/diagram.css
  - src-tauri/src/model/layout.rs
covers: >
  what is drawn where links meet a node: the arms and the two radii, the rim
  three things measure to, the pad that follows the arms inside it, taper
  wedges at a through joint, the gore between two separating arms — its
  triangle, its chevrons, and the one derivation that faces them at the driver —
  the butt cap its two owners share, and the dots that mark a node once per
  drawn road end, on the canvas only
max_lines: 268
generated: 2026-08-14
---

# Road joints

What is drawn where links **meet**: the arms a junction glyph is sized from, the
wedge that closes a width step, and the triangle between two arms that separate. The
road either side of a joint is `rules/road-rendering.md`, whose `drawnPolyline`,
`roadWidth`/`laneBands` and `carriageways` sign reasoning everything here consumes
rather than repeats. Rationale: `specs/ramps_and_tapers_spec.md`.

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

**`dir` is read off the segment *adjacent* to the node**, not off the node pair, so
a link's bends re-aim its arm and the pad follows — likewise `taperWedges`, whose
collinearity test then sees the bent joint and draws no wedge. Both are the feature
working (`specs/link_bends_spec.md` §2.5), not a regression to chase.

**`Arm`, `junctionArms` and both radii live in `geometry.ts`**, not the render body
— `drawnPolyline`'s move one step on, and for its reason: a marking anchored to a
link's far end measures its clearance from the **rim of the glyph these arms size**,
and where a glyph reaches is not a render-time question. The radii are pure, so the
drawing is byte-identical across the move — the gate on such a lift being
`Diagram.test.tsx` passing untouched.

**Three things meet at that rim: two measure to it, the third sizes it.** The two
share one expression, `rayCircleExit(origin - center, dir, r)`:

- **A signalised junction's stop bar starts from its own carriageway**, one
  `rayCircleExit(…, rp) + 4` along `dir`. That call returns *exactly* `rp` for a
  centred arm, so an undivided junction draws byte-identically to the
  centre-derived code it replaced, and a divided approach gets a bar per half.
- **An `end`-anchored marking clears the rim by the same call** — `rimClearance`,
  with no constant at all, since the marking supplies its own `position` past it
  (`rules/road-markings.md`). Its radius is `junctionRadius`, differing from `rp` in
  one case: a **roundabout** measures to `ro`, a ring burying an arrow as a pad does.

The third is `armReach`, a **floor** on both radii and never a replacement:
`reach = max(distance(origin, center) + width / 2)`, then `rp = max((maxW * 0.62 +
3) * scale, reach)` and `ro = max(max(20, maxW * 1.35) * scale, reach)`. Only the
floor is shared; the two base terms differ. Substituting the floor for the base
would *shrink* every undivided pad ever drawn, since `0.62 w + 3 > w / 2`. **`scale`
multiplies the base term only; the floor is unscaled**, so **Size clamps**: below
roughly half scale the floor binds even on an undivided junction, because a pad
narrower than its own approach is not a smaller junction but a broken one.

## A node is marked once per drawn road end — on the canvas (ramps OQ-4, OQ-10)

`nodeDots(doc, nodeId, offsets)` returns the arms' **distinct origins** — distinct
as *positions*, within a `1e-6` guard of its own named `SAME_POINT`, in
`junctionArms`' order. So a divided road's end is marked on both carriageways
rather than in the median, and an aligned link's dot steps off with the road.
`nodePos` does **not** move: only the mark does, and a drag still dispatches
`moveNode` with the node's own position. `junctionArms`' name understates it — it
filters on nothing but the links touching a node, so it answers here too.

- **No angle, no mean, no grouping**, so the answer cannot depend on the order of
  `doc.links`. A divided waypoint at a lane drop draws **four** dots, two
  overlapping `4.5` apart per side: two road ends at two places. Merging them needs
  clustering, which is not transitive and changes the *count* under a permutation.
- **The epsilon is float slack, not a tolerance** — worst measured parting
  `2.84e-14`, against a smallest distinct design step of `0.45`. Its own constant,
  not `SAME_EDGE`'s: same magnitude, different question. A link-less node keeps its
  dot at the node — the path every node takes before it is joined; no layout entry
  returns nothing.
- **One `<g>` holds every dot and halo**, so `onNodePointerDown` stays on one
  element and either dot grabs the node. A zero displacement emits no `cx`/`cy`, so
  a centred undivided document's markup is unchanged character for character.
- **A figure carries none of them** (ramps §2.11.1) — a bead on a road that runs
  off the frame says the road stops there, which is false of every fragment. The
  circles are gated on `interaction` and `.node-dot` lives in `styles.css`, so
  every rule above is a *canvas* fact and a node no road touches exports as an
  empty `<g>`.

## The pad is the roads, not a disc — and it stays inside the rim

`padShape(arms, center, r)` returns **one closed ring per arm**, in the glyph's
frame. A ring is that arm's **band** — at or ahead of the line through the centre
perpendicular to `dir`, within `width / 2` of the arm's own axis — intersected
with the disc of radius `r`: two straight sides, a straight inner cut, and an
outer arc. `JunctionGlyphShape` emits them as subpaths of one
`<path class="jn-pad">`. Rationale: `specs/junction_glyphs_spec.md`.

- **The rim did not move, and containment is *why* nothing else had to.** The
  three consumers above measure **along an arm** to a circle, and a ring ends
  exactly where `rayCircleExit` says because a vertex is **forced** at that point.
  That is the reusable part: it was tempting to generalise all three to an
  arbitrary outline — a rim abstraction, a ray-versus-polygon exit, three call
  sites rewritten — and none of it is needed, because `pad ⊆ disc(r)`. A band
  merely run out to the rim with a **flat end** breaks it: its corners land at
  `sqrt(r² + (w/2)²)`, outside the hit target and the halo both.
- **The union is rendered, never computed.** The default nonzero rule reads
  overlapping bands as one area, so there is no boolean union in this repo and
  `.jn-pad` must never set `fill-rule`. The cost is one discipline: **every ring
  winds the same way**, or two overlapping rings cancel into a hole exactly where
  the roads meet. The frame `(dir, perp dir)` is a rotation, so one vertex order
  in the arm's own coordinates gives one winding in the drawing's.
- **The arc is chorded at 10°**, and the bound is stated because containment passes
  for an inscribed arc at *any* density — 0.10 units of sagitta on a 4-lane T, 0.47
  on the largest pad the app can make, against a 1.5-unit edge line.
- **Two numbers that look like one.** Along a **displaced** carriageway the ray
  exit and the ring's furthest vertex differ — 19.84 against 23.81 on a divided
  2-lane approach — so anything phrased on the vertex is a different claim.
- **`[]` for a junction with no arms**, and that branch keeps the `<circle>`: a
  node the human placed and has not joined must stay visible and clickable.
- **At the Size floor the pad is round again**, and this is the clamp working
  rather than a defect: `armReach` floors `r` at `width / 2` for an undivided arm,
  and a band of half-width `width / 2` intersected with a disc of *that* radius
  **is** a half-disc.

**One badge is paint on that asphalt and moves with it.** `rayPadExit(rings, p,
d)` is the ray analogue of `rayCircleExit` for the union — the contiguous run from
`p`, `0` when `p` is outside every ring, and **boundary-inclusive**, which is
load-bearing rather than a detail: the glyph centre lies exactly *on* every band's
inner cut, so a strict outside-test returns `0` everywhere and erases every
diamond. The priority diamond's half-diagonal is `min(rp * 0.85, s)`, `s` being
the smallest exit over its four tip directions. A width-derived inradius was
tried and is wrong — a band is cut at the centre, so one arm contributes a
half-disc. Where `s` is `0` (a median, one arm, a same-way Y) the bound floors at
`rp * 0.35`; where there are **no rings at all** it is `rp * 0.85` unchanged,
since that branch still paints a full disc under the badge.

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
- **A wedge forces butt caps** on **both** links; the gore below is the other owner.
  `stroke-linecap` is a whole-path property, so a capped link is flat at its
  **other** end too — under the pad at a junction, better schematic reading at a free one.
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
  (`gorePair`), and it is **not** read off the traffic: `junctionArms` orients every
  arm away from the node whichever way traffic runs, so `dir` carries no in/out
  information. Directions are unit, so smallest angle is largest dot; an exact tie
  breaks on the **link ids**, never `doc.links` order, or the same roads would draw
  differently in a differently-ordered document.
- **It is bounded by the roads' *painted* edges, not their casing rims** — the
  opposite of a wedge. So `GoreArm.halfSpan` is `(roadWidth - ROAD_MARGIN) / 2`,
  exactly `RoadShape`'s `edgeInset`: the legs are literal continuations of the two
  edge lines, and `jn-gore-edge` therefore takes **no inset of its own**.
- **The nose is a ray intersection with two degenerate cases**, both falling back to
  the node: parallel arms, and edges meeting only *behind* **both** origins — "behind
  either" would drop a good nose whenever a divided carriageway steps one arm past it.
  The fallback prevents an `Infinity`/`NaN` that renders as nothing and no `points=`
  assertion catches.
- **Two layers, not one.** A shoulder band takes asphalt from the casing under it; a
  gore widens onto bare paper, so `.jn-gore` paints a surface for the paint to ride on.
  Its base is open and unlined: that blunt end is the physical nose.
- **`GORE_LENGTH` (36) is scaled by the glyph's Size**, unlike `TAPER_LENGTH`, or
  the control would be inert on a pad-less glyph. Lengthening only slides the base.
- **Every arm of the glyph takes `.road-casing--butt`**, the wedge's own modifier
  out of the one set `tapers` builds — uncapped, a round cap paints a half-disc
  straight across those edge lines. Keyed to the **glyph** (with `node.type`, a
  stale view being hand-reachable): not to `gorePair`, which runs downstream in
  `GoreShape`, and not to an arm count, which would cap a plain three-link
  waypoint. The largest cap is often on the arm the pair does *not* pick — §1's
  4-lane approach. Placed **before** the through-joint return, a gore having three.

### The chevrons, and the one place a gore reads the traffic

The paint inside is a fan of chevrons (`goreChevrons`, a `.jn-gore-chevrons` path),
not the shoulder hatch it briefly borrowed: a hatch says "not a running lane", a
gore says "go round this, on this side" — a direction, and it needs one. The `<defs>`
gate narrowed back with it: `hasShoulder(doc)` fires for a hard shoulder alone, having
been widened and renamed `needsHatch` only while a gore reached the same pattern.

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

**The gore is the one glyph that needed a `SCHEMA_VERSION` bump** — a new enum
*variant*, not a new field (`rules/document-model.md`).

## Where each piece lives

`geometry.ts` owns the pure half — `Arm`/`junctionArms`, `padRadius`/`ringRadius`/
`junctionRadius`, `rayCircleExit`, `padShape`/`rayPadExit`, `JointEnd`,
`taperWedge`/`taperWedges`/
`taperEdge`, `GoreArm`/`gorePair`/`gore`/`rayIntersection`,
`GoreFlow`/`goreFlow`/`goreChevrons`, and the three lengths plus the two chevron
constants — under `geometry.test.ts`. `Diagram.tsx` turns those into markup:
`jointEnd`, `tapers`, `TaperShape`, `GoreShape`, `diamondHalf` and the stop-bar
loop in `JunctionGlyphShape`, tested through `renderToStaticMarkup`. The gate on
the outline is `geometry.test.ts`'s own `inside(rings, p)` and **not**
`rayPadExit`, or a bug in the helper could mask a bug in the rings it measures.
Paint is `diagram.css`; `gore` is mirrored in `types.ts` and `layout.rs`.
Nothing here reaches `state.ts` — a joint is derived from the links meeting at a
node, so there is no action and nothing to undo. `strokeAllowance` (`export.tsx`)
needs nothing from either shape: `measureDiagram` frames the *drawn* tree, and
both are fill whose corners sit on the casing rim it already derives from.
