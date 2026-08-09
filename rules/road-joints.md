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
generated: 2026-08-09
---

# Road joints

What is drawn where links **meet**: the arms a junction glyph is sized from, the
wedge that closes a width step, and the triangle between two arms that separate.
The road either side of a joint is `rules/road-rendering.md`, whose
`drawnPolyline`, `roadWidth`/`laneBands` and `carriageways` sign reasoning
everything here consumes rather than repeats. Rationale:
`specs/ramps_and_tapers_spec.md`.

## Arms carry their position, so the glyph follows the carriageways

`Arm` is `{ id, dir, origin, width }`, and `origin` is **not re-derived** — it is
the drawn polyline's own end point, which `junctionArms` already had. No second
call to `carriageways` and no `DRIVE_SIDE` reasoning, so none of that derivation's
offset-sign traps reach here. `origin` is **world** space; a glyph's group is
translated to the node, so an interior detail enters as `origin - center` — `(0,
0)` for an undivided road. `id` is **`gorePair`'s tie-break** and, since the
movement arcs went, all it is: `dir` cannot substitute, pointing away from the
node whichever way traffic runs.

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

A `gore` glyph draws **no pad at all** — the whole glyph is the hatched triangle
between two arms, nosed where their painted edges meet. One variant covers both a
diverge and a merge: the geometry is identical, and the pair rule ignores traffic.

- **The pair is the one with the smallest angle between their directions**
  (`gorePair`), and it **cannot** be read off the traffic: `junctionArms` orients
  every arm away from the node whichever way traffic runs, so an `Arm` carries no
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
- **Two polygons, not one.** The hatch is transparent by design — a shoulder band
  takes its asphalt from the casing under it — but a gore widens onto bare paper,
  so `.jn-gore` paints the surface and `.jn-gore-hatch` overlays it with an inline
  `fill="url(#road-hatch)"`. The base is open and unlined: that blunt end is the
  physical nose.
- **`GORE_LENGTH` (36) is scaled by the glyph's Size**, unlike `TAPER_LENGTH`, or
  the control would be inert on a pad-less glyph. Lengthening cannot misalign
  anything: the legs stay on the edge lines and only the base slides.

**The `<defs>` condition widened with it.** `needsHatch(doc)` fires for a shoulder
lane **or** a gore glyph: unconditional breaks the empty document pinned to exactly
`<g class="diagram"></g>`, and shoulder-only leaves a gore referencing a
`<pattern>` never emitted, drawing an *unpainted* triangle with identical markup.

**The gore is the one glyph that needed a `SCHEMA_VERSION` bump** — a new enum
*variant*, not a new field (`rules/document-model.md`).

## Where each piece lives

`geometry.ts` owns the pure half — `Arm`/`junctionArms`, `padRadius`/`ringRadius`/
`junctionRadius`, `rayCircleExit`, `JointEnd`, `taperWedge`/`taperWedges`/
`taperEdge`, `GoreArm`/`gorePair`/`gore`/`rayIntersection` and the three lengths —
under `geometry.test.ts`. `Diagram.tsx` turns those into markup: `jointEnd`,
`tapers`, `TaperShape`, `GoreShape` and the stop-bar loop in `JunctionGlyphShape`,
tested through `renderToStaticMarkup`. The hatch a gore fills with is
`rules/road-rendering.md`'s `HatchPattern` — this rule only widened `needsHatch`.
Paint is `diagram.css`; `gore` is mirrored in `types.ts` and `layout.rs`.
Nothing here reaches `state.ts` — a joint is derived from the links meeting at a
node, so there is no action and nothing to undo. `strokeAllowance` (`export.tsx`)
needs nothing from either shape: `measureDiagram` frames the *drawn* tree, and
both are fill whose corners sit on the casing rim it already derives from.
