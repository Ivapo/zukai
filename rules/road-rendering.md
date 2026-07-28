# Road rendering

How a link becomes a picture of a road: lane geometry, road class, two-way
carriageways, alignment, lane kinds, tapers, gores, and the junction arms derived
from them. Frontend only apart from two model additions — the `LinkView.align`
field and the `gore` junction glyph — and nothing else here crosses IPC, reaches
disk, or changes the schema. The design rationale lives in
`specs/road_rendering_spec.md`, and from `Arm.origin` onward in
`specs/ramps_and_tapers_spec.md`; hand-maintained.

The paint a *human* places on a road — stop lines, crossings, lane arrows — is a
separate subsystem: see `rules/road-markings.md`. The line between them is who
chose it. Everything here is derived from the model (lane count, class, kinds);
a marking is a decoration someone placed by hand.

## The rule the whole subsystem follows

**The model already describes the road; the renderer's job is to stop ignoring
it.** Almost every quantity below comes from a field the document already carried
— `Lane.width`, `Lane.kind`, `Link.median_gap`, `LinkView.style`. When something
looks wrong, the first question is which field is not being read, not which
constant to tune.

`LinkView.align` is the one thing genuinely added, and it is worth knowing why:
nothing in the model distinguishes "4 lanes becomes 3 by losing the nearside
lane" from "…by losing the offside lane" — `Link` carries an ordered `lanes`
array and no statement about how two links' lanes correspond across a shared
node. Which side a lane goes is a drawing decision, so it is a **presentation**
field, not a graph one, and nothing a future Assimilator export would carry.

## Lane geometry: one derivation, everything downstream

`src/editor/geometry.ts` owns it, and every drawn width traces back to
`laneWidths(lanes, style)`:

```
UNITS_PER_METRE = LANE_PX / DEFAULT_LANE_WIDTH        // 9 / 3.5
laneWidths      = lanes.map(l => l.width * UNITS_PER_METRE * classWidthFactor(style))
roadWidth       = sum(laneWidths) + ROAD_MARGIN
laneBands       = each lane's { offset, width }, in world units, lane 0 first
```

Four things about this are load-bearing and each has a test that fails if
"simplified":

- **Convert per lane, then sum — never sum metres first.** `9/3.5` has no exact
  binary form, so `sum(width) * UNITS_PER_METRE` lands on `30.000000000000004`
  at 3 default lanes and `57.00000000000001` at 6. The pinned rate exists so a
  default document draws *exactly* as it did when every lane was hardcoded to
  `LANE_PX`; the wrong grouping breaks that and `export.test.ts`'s `toBe(15)`.
- **The one-lane floor is on the lane *count*, not the output width.** An empty
  `lanes` array is treated as one default lane. A `Math.max(MIN_ROAD_WIDTH, …)`
  clamp on the result would look identical until a class narrows its lanes, then
  round a 1-lane ramp (10.2) back up to a 1-lane arterial's 12 and silently
  cancel the class distinction in the case it reads most clearly.
- **`classWidthFactor` enters at the per-lane widths and nowhere else.** Scaling
  the finished `roadWidth` instead narrows the casing while the band-derived
  dividers stay at full pitch and spill outside it. Feeding it in upstream makes
  `roadWidth`, the bands, the dividers, `edgeInset`, the hit path, the halo, the
  arrowhead, `junctionArms` and `strokeAllowance` all inherit it from one place.
- **`ROAD_MARGIN` is the casing lip, not a lane, so it is not scaled.** Which
  means `roadWidth` is deliberately *not* proportional to the factor — only the
  lane region is, and the two differ by `ROAD_MARGIN * (1 - factor)` at every
  lane count. Width identities across classes are **exact per lane band** and
  only approximate in aggregate (float regrouping plus the margin round trip;
  measured, unavoidable). Assert the per-band form.

**Lane 0 is the nearside (kerb) lane**, so it comes back with the most positive
offset — the side a positive `offsetPolyline` distance draws on under right-hand
traffic. Everything keyed on `Lane.kind` depends on it: a `shoulder` at index 0
must render as an outside hard shoulder, not one hiding in the median. The
Inspector labels that first row `nearside`, which is the only place the
convention is stated in the UI.

## Road class paints as a class token, not an inline attribute

`RoadShape` emits `<g class="road road-{style}">` and `src/styles/diagram.css`
carries the colour and line treatment. That choice is what makes
`rules/diagram-export.md`'s claim true: `diagram.css` is embedded verbatim in
every exported SVG, so **a class-driven style reaches a file with no exporter
change at all**. A computed inline colour would have needed the export path to
learn about road classes.

The width factor is the exception, and it is not a preference: CSS can *replace*
a computed `strokeWidth`, not *scale* one. So it lives in TypeScript
(`classWidthFactor`), applied where the previous section says.

## Two-way roads: two links, stepped off the shared centreline

`carriageways(doc)` returns a lateral offset per link — `0` for a link with no
opposing twin. The model has no other way to spell a two-way road: "roads are
directional: a two-way street is two links with opposite `from_node`/`to_node`."

- **Pairing is on an exact reversed node pair**, never on "roughly parallel",
  which would mis-pair a slip road with the mainline beside it. Three or more
  links on one node pair stay on the centreline rather than have a layout guessed
  for them.
- `offset = DRIVE_SIDE * (roadWidth(lanes, style) / 2 + SEPARATION / 2)`, with
  `SEPARATION = max(SCHEMATIC_MEDIAN, median_gap * UNITS_PER_METRE)`. **The
  road's own half-width is the point**: a step derived from the median alone
  leaves two 4-lane carriageways sitting almost entirely on top of each other.
  The width term carries the road class, so the gap left for the median is the
  median and nothing else.
- **Every offset returned is positive, and that is not a bug.** The number is the
  `d` of `offsetPolyline`, measured in each link's *own* polyline frame; a
  reversed twin traverses the same ground the other way, so its segment normal
  already points the other way and the same positive `d` draws it on the opposite
  visual side. Asserting the two signs *differ* fails on a correct
  implementation, and the obvious "fix" — negating one twin — puts both
  carriageways on the same side. Only a drawn-`y` assertion catches an inverted
  `DRIVE_SIDE`.
- `SCHEMATIC_MEDIAN = 6` because `median_gap` defaults to 0.5 m, which converts
  to ~1.3 units — thinner than the 1.5-unit edge line painted over it. Above
  ~2.33 m the model's own value takes over, so the field is honoured ordinally.

`Diagram.tsx` applies this through **one** `drawnPolyline` helper that the roads
and `junctionArms` share, so the two cannot come to disagree about where a road
runs. It lives in `geometry.ts` (with `lateralShift`) rather than in
`Diagram.tsx`, where it started: the marking tool has to place paint on the
polyline a road is *actually drawn along*, and a second derivation of it is
precisely what the "only site" claim forbids — so the fix was to move the one
site, not add another (`rules/road-markings.md`).

### Arms carry their position, so the glyph follows the carriageways

`Arm` is `{ id, dir, origin, width }`, and `origin` is **not re-derived** — it is
the drawn polyline's own end point, which `junctionArms` already had in hand. No
second call to `carriageways`, no `DRIVE_SIDE` reasoning, and so none of the
offset-sign traps the section above is about. `origin` is **world** space; the
glyph's group is translated to the node, so an interior detail enters as
`origin - center`, which is `(0, 0)` for an undivided road.

**`Arm`, `junctionArms` and both radii live in `geometry.ts`**, not in
`Diagram.tsx` where they started — `drawnPolyline`'s move, one step on and for the
same reason. A marking anchored to a link's far end measures its clearance from
the **rim of the glyph these arms size**, and where a glyph reaches is not a
render-time question. The radii are two pure functions, `padRadius(arms, center,
scale)` and `ringRadius(arms, center, scale)`, so `JunctionGlyphShape` reads
exactly what it used to compute in its own body and the drawing is byte-identical
across the move — asserted by `Diagram.test.tsx` passing untouched, which is the
whole gate on a lift like this.

`id` was `gorePair`'s tie-break alone until movements shipped; it is now also
**how a movement finds its two arms**, since `dir` points away from the node
whichever way traffic runs and so cannot say which arm a turn arrives on
(`rules/junctions.md`).

- **A stop bar starts from its own carriageway**, at `(origin - center) + dir *
  (rayCircleExit(origin - center, dir, rp) + 4)`. `rayCircleExit` returns
  *exactly* `rp` from the centre, so an undivided junction draws byte-identically
  to the centre-derived code this replaced — pinned in `Diagram.test.tsx`.
- **A movement arc runs rim to rim**, from the same `rayCircleExit` with no `+ 4`,
  so an arc and a stop bar on one arm cannot disagree about where the road meets
  the glyph. Drawn *after* the pad, because the pad is opaque
  (`rules/junctions.md`), and only on the four glyphs that paint one.
- **An `end`-anchored marking clears the rim by the same expression** —
  `rimClearance` in `geometry.ts`, `rayCircleExit(origin - center, dir, radius)`
  with no constant at all, since the marking supplies its own `position` past it.
  It is the third consumer, and the reason the arms had to leave the render body
  (`rules/road-markings.md`). Its radius is `junctionRadius`, which differs from
  the stop bar's `rp` in one case: a **roundabout** measures to `ro`, because a
  ring buries an approach arrow exactly as a pad does.
- **The arms' reach is a floor on the pad radius and the roundabout ring**, never
  a replacement: `reach = max(distance(origin, center) + width/2)`, then
  `rp = max((maxW * 0.62 + 3) * scale, reach)` and the same for `ro`. Substituting
  would *shrink* every undivided pad ever drawn, since `0.62 w + 3 > w / 2` for
  every road. `ringT`/`ri` derive from `ro` and inherit it.
- **`scale` multiplies the base term only; the floor is unscaled world units.**
  The corollary is intended, not a bug: **Size clamps.** Below roughly half scale
  the floor binds even on an undivided junction, so the Inspector's Size control
  stops shrinking a pad past the road it serves. A pad narrower than its own
  approach is not a smaller junction, it is a broken one.

**Still open (ramps spec OQ-4):** the node *dots* draw at the node position, so an
endpoint or waypoint on a divided road sits in the median rather than on either
carriageway. `Arm.origin` makes "one dot per carriageway" cheap; whether that is
what a divided endpoint should show is the open question.

## Alignment: the second lateral term, and it composes by addition

`drawnPolyline` shifts a link by `carriagewayOffset + alignmentShift`, and that
sum is the whole of what any consumer sees. A link is drawn **centred** on its
polyline unless `LinkView.align` says otherwise; aligning to an edge is what lets
two links of different widths meet at a node sharing that edge, which is what a
lane drop looks like on a real road (a centred pair steps symmetrically, losing
half the lane from each side at a point).

- **It is the lane region's half-span, `(roadWidth - ROAD_MARGIN) / 2`, not
  `roadWidth / 2`.** `ROAD_MARGIN` is the casing lip, not a lane, so the edge
  being aligned is the outermost painted line. The full width instead leaves a
  1.5-unit casing step at every joint — small enough to read as an antialiasing
  artefact and never be diagnosed.
- **The sign follows from lane 0, and is not a choice.** Lane 0 is nearside at
  the most *positive* offset, so an unaligned road's nearside edge is at
  `+(roadWidth - ROAD_MARGIN) / 2`; holding an edge *on* the polyline means
  shifting by whatever brings it to zero. So `offside` shifts **positive** and an
  offside-aligned road hangs to the *nearside* of its own polyline. A magnitude
  assertion passes under an inversion — pin the drawn `y`.
- **Addition, at one site.** Nothing else learns about alignment: the roads, the
  junction arms and (through `Arm.origin`) the junction interiors all inherit it,
  exactly as they inherited `classWidthFactor`. `drawnPolyline` still returns the
  *same array* when the sum is zero, so a document that has set neither emits
  byte-identical markup.
- **On a divided road it is per-carriageway, not per-road.** `carriageways` knows
  nothing about alignment, and the pair's two offsets are measured in opposing
  frames, so aligning one twin moves it relative to the **median** rather than
  relative to the road — the halves close up or spread apart. That is the honest
  drawing (an aligned carriageway *has* moved), not a defect to fix.

`centre` is stored as an **absent** `align`, the same rule `Lane.kind` follows
for `general`: one representation of the default, matching what Rust writes back
(`skip_serializing_if = "LinkAlign::is_centre"`). Adding the field needed no
`SCHEMA_VERSION` bump — see `rules/document-model.md`.

## Tapers: a wedge at the joint, never a link that changes width

Where a road changes width, both links keep their **uniform** width and the
transition is one added polygon per side. The obvious alternative — a link whose
width varies along its length — is rejected outright: `Link.lanes` is a single
array, so a tapering link has no answer to "how many lanes is it", and the casing
is a **stroked path**, whose width cannot vary. Making it vary means drawing every
road as a filled polygon, a rewrite that invalidates every pinned width in the
test suite to serve a case entirely local to one node.

`tapers(doc, offsets)` in `Diagram.tsx` finds the joints; `taperWedges` in
`geometry.ts` decides and builds. A joint qualifies on **three** independent
tests, and dropping any one of them draws a wedge where no road changes width:

- **Exactly two incident links, one ending and one starting.** Three or more is a
  junction or a gore. Node *kind* is not consulted — what makes a joint is how
  many roads meet at it.
- **Not a reversed twin.** A divided pair puts one link in and one out at *either*
  of its nodes, so unequal lane counts would otherwise stretch a wedge across the
  median between two anti-parallel carriageways.
- **Collinear within `TAPER_MAX_BEND` (8°).** `segmentNormals` rotates with the
  link, so at `N1(0,0) → N2(120,0) → N3(120,120)` two *identical* 4-lane links put
  their nearside casing edges at `(120, 19.5)` and `(100.5, 0)`.

**The twin test and the bend guard do not subsume each other.** A hairpin
(`N1→N2`, `N2→N3` with N3 placed back beside N1) has a different node pair, so the
twin test misses it and only the bend guard opposes its frames; a twin whose bends
leave the node the other way passes the bend guard and only the twin test stops
it. Both are preconditions.

Then, **per side independently**, the two ends' casing edges are compared as
**signed lateral offsets** — `d ± roadWidth/2`, where `d` is the very number
`drawnPolyline` applies (`lateralShift`), **never world points**. Equal ⇒ nothing
to draw. Otherwise the **inset** link is the one nearer the road's other side —
smaller on the nearside, larger on the offside — and the wedge runs from the joint
`TAPER_LENGTH` (24) along it. Four cases fall out with no further judgement:

| Joint (per side) | Inset link | Wedge runs |
|---|---|---|
| Lane drop, both `offside`-aligned | the downstream narrow one | **forward**, past the node |
| Lane addition, both `offside`-aligned | the upstream narrow one | **backward**, before it |
| Either, both `centre`-aligned | the narrow one, on **both** sides | one wedge per side, each closing half |
| The two aligned to *different* sides | possibly a different link each side | one each way; the road jinks and says so |

Four more things this pins:

- **The rule keeps the geometry additive.** A wedge only ever paints asphalt into
  space the inset link left empty; it never erases asphalt a uniform stroke
  already laid down, which is what makes it a polygon and not a redraw.
- **It is bounded by the *casing* edges** (`roadWidth/2`), because a wedge is
  asphalt. Its own edge line is inset 1.5 from the hypotenuse (`taperEdge`),
  mirroring `RoadShape`'s `edgeInset`. Using the lane-region edge is a silent
  1.5-unit error at every joint.
- **A wedge forces butt caps** (`.road-casing--butt` on **both** links). Otherwise
  the outset link's round cap paints a half-disc of asphalt past the node —
  ~1.3 units outside the freshly painted taper line on a 4→3 joint — which no
  added polygon can remove. `stroke-linecap` is a property of the whole path, so a
  link tapered at one end is butt-capped at its **other** end too: covered by the
  pad at a junction, and a flat rather than domed free end elsewhere, which is the
  better schematic reading anyway.
- **8° is derived, not picked.** Butt caps notch the outside of a bend by
  `(roadWidth/2)·tan(θ/2)` — 1.36 units at 8° on a 4-lane road, no deeper than the
  1.33-unit overhang they remove, so the trade is never a loss. 15° would invert
  it at ≈2.6.

The wedge is a `<polygon class="road-taper">` inside `<g class="taper
road-{style}">`, taking the **inset** link's class token — so `.road-local
.road-taper` and the class-scoped `.road-edge` width both apply with no rule of
their own, the same class-as-token mechanism the roads use. Only a joint that
actually draws a wedge is touched at all, so a document with no width step emits
byte-identical markup.

**A divided road's lane drop does not taper** — four links on the node is not a
through joint. That is a non-goal (ramps spec §2.8), not an oversight; the fix
belongs with a wider pass over carriageway pairing.

## Gores: the paint between two arms that separate

A `gore` junction glyph draws **no pad at all** — the whole glyph is the hatched
triangle between two arms, nosed where their painted edges meet. One variant
covers both a diverge and a merge, because the geometry is identical and the
rule that picks the two arms never asks which way traffic goes.

- **The pair is the one with the smallest angle between their directions**
  (`gorePair`), which is the diverging pair at a diverge and the converging pair
  at a merge. It **cannot** be read off the traffic: `junctionArms` orients every
  incident link away from the node whichever way its traffic runs, so an `Arm`
  carries no incoming/outgoing information at all. Unit directions, so smallest
  angle is largest dot; an exact tie breaks on the pair's **link ids**, never on
  `doc.links` order, or the same three roads would draw differently in a
  differently-ordered document. Fewer than two arms draws nothing; more than
  three is not rejected — the closest pair still wins.
- **It is bounded by the roads' *painted* edges, not their casing rims** — the
  opposite of a taper wedge, which is asphalt and takes `width / 2`. So a
  `GoreArm`'s `halfSpan` is `(roadWidth - ROAD_MARGIN) / 2`, which is *exactly*
  `RoadShape`'s `edgeInset`: the gore's legs are literal continuations of the two
  edge lines either side of it, and `jn-gore-edge` therefore takes **no inset of
  its own** (`taperEdge`'s 1.5 would visibly jog it at the nose).
- **The nose is a ray intersection with two degenerate cases**, both falling back
  to the node: parallel arms, and arms whose edges meet only *behind* both
  origins. "Behind **both**" is the rule — rejecting on "behind either" would
  drop a good nose whenever a divided carriageway steps one arm past it. The
  failure the fallback prevents is not a wrong point but an `Infinity`/`NaN` in
  the markup, which renders as nothing and no `points=` assertion catches.
- **Two polygons, not one.** The hatch `<pattern>` is transparent by design — a
  shoulder band gets its asphalt from the casing underneath it — but a gore
  widens out past both roads onto bare paper, so `.jn-gore` paints the surface
  and `.jn-gore-hatch` overlays it. The base is left open and unlined: that blunt
  end is the physical nose, and it is where the drawing should stop.
- **`GORE_LENGTH` (36) is scaled by the glyph's Size**, unlike `TAPER_LENGTH`.
  A pad-less glyph would otherwise leave the control inert, and lengthening
  cannot misalign anything — the legs stay on the roads' edge lines and only the
  base slides, so the nose does not move.

**The `<defs>` condition widened with it.** `needsHatch(doc)` fires for a
shoulder lane **or** a gore glyph. It cannot become unconditional — an empty
document is pinned to exactly `<g class="diagram"></g>` — and it cannot stay
shoulder-only, or a gore in a document with no shoulder references a `<pattern>`
that was never emitted and draws an *unpainted* triangle, with markup otherwise
identical. `Diagram.test.tsx` tests that case directly for exactly that reason.

**The gore is the one glyph that needed a `SCHEMA_VERSION` bump** — a new enum
*variant*, not a new field. See `rules/document-model.md`.

## Lane kinds, and what a line means

`Lane.kind` drives two things, both from `laneBands`:

| Kind | Band | Boundary to the next lane |
|---|---|---|
| `shoulder` | hatched (`.lane-band-shoulder` + the pattern) | **solid** `.road-shoulder-line` |
| `bus` / `cycle` | flat tint (`--tint-bus` / `--tint-cycle`) | dashed, as usual |
| `general` / `turn` / absent | **no element emitted** | dashed `.road-divider` |

A band is a path stroked at the lane's own width along `offsetPolyline(points,
band.offset)`, drawn between the casing and the painted lines so it reads as
surface rather than marking. Emitting nothing for a plain lane is what keeps a
document that never set a kind rendering exactly as it did before.

*What* a line means is the boundary's business, not the class's: a dashed divider
says "lanes, same direction, cross freely", which a hard-shoulder boundary does
not. **This is also the whole of what makes a motorway read differently from an
arterial** — the two classes paint alike, so a motorway with no shoulder lane
draws like an arterial, by design.

Both rows of the third column are **derived**, and a human can override either:
a `lane_line` marking painted on a boundary replaces whatever this table put
there (see "A centreline is painted, never derived" above).

### The hatch is the one piece of paint that cannot be a CSS rule

Both halves of the obvious implementation are illegal in `diagram.css`, and
`export.test.ts` enforces both:

- a paint-server reference in the stylesheet fails the no-external-reference
  assertion (`not.toContain("url(")`), and
- the `<pattern>` element cannot be written in a file that may not contain `<` or
  `&` **anywhere, comments included** — it is embedded raw inside XML.

So the pattern is markup in `Diagram.tsx`, inside a `<defs>`, referenced by an
inline `stroke="url(#road-hatch)"` on the band. Three constraints on it:

- **The `<defs>` is conditional** — emitted only when the document actually
  references the pattern (`needsHatch`: a shoulder lane **or** a gore glyph),
  because `Diagram.test.tsx` pins an empty document to exactly
  `<g class="diagram"></g>`. Anything new that references the pattern has to
  widen that predicate too; see "Gores" above for what the miss looks like.
- **The pattern's own stroke comes from a class** (`.road-hatch-line`), not an
  inline colour: `var()` does not resolve inside a *presentation attribute*, and
  the rule travels inside an exported file like every other, so the pattern stays
  self-contained.
- **`url(#road-hatch)` is an in-document fragment reference, not an external
  one.** It does not taint the `<canvas>` the PNG path draws into — verified by
  rasterizing a hatched document. Do not "fix" it away; see
  `rules/diagram-export.md`, "Standing constraints".

The spec writes this as an inline `fill`; the band is a *stroked* path, so the
paint server is referenced by `stroke`. Same intent, different attribute.

### Setting a kind, and the control that used to destroy it

`setLaneKind` (`src/editor/state.ts`) is the only way `Lane.kind` is reachable
from the UI. Two things about it:

- **`general` is stored as an absent `kind`**, not the string, so a plain lane has
  exactly one representation — `defaultLane`'s, and the one Rust writes back
  (`skip_serializing_if = "Option::is_none"`).
- **`setLinkLanes` preserves the lanes that survive**, by object identity. It
  used to rebuild the array from `defaultLane(i)` on every ±1 click, so the
  moment a kind was settable, the Lanes stepper two controls above silently
  discarded it. A control whose value an adjacent control destroys is not a
  working feature; the two belong to the same change.

## A centreline is painted, never derived (spec OQ-4, closed)

An undivided two-way road carries one in a road atlas, and **nothing in the model
can tell the renderer that a road is one**: `Link` has no direction flag and
`median_gap` is default-valued identically on every link ever created, so it holds
no signal. Deriving a centreline would be a guess, and that much of OQ-4's
resolution stands.

What it got wrong was the remedy — it recorded a **modelling** gap and said the
fix was a field. The fix needed none. An undivided two-way road is a
`lane_line { style: double }` marking with no lane, which the `Marking` anchor has
always expressed: the *human* says the road is two-way by painting the line, which
is the same "the human chose this glyph" posture the junction glyphs take. Ramps
OQ-6 proposed a presentation field (`LinkView.centreline`) instead and is closed
the same way.

Two consequences for this file's subject:

- **`RoadShape` gained one input, `replaced`** — the boundary offsets a lane line
  has taken over on this link (`laneLineOffsets`, `boundaryTaken`). A boundary in
  it derives no line at all, because a painted line **replaces** the divider or
  shoulder line it lands on rather than being drawn over it. Overpainting leaves
  a dashed line under a solid one, visible at every dash gap.
- The lane line's own offset comes from `boundaryOffset`, which runs
  *character-for-character* the expression the divider derivation below uses. The
  two are compared as numbers, so an equivalent-but-different one would differ in
  the last bit — and the divider would survive under the line.

The rest of it — the boundary rule, the styles, the paint — is
`rules/road-markings.md`, "The lane line".

## Where each piece lives

| Piece | Where | Tested by |
|---|---|---|
| `laneBands`, `roadWidth`, `classWidthFactor`, `carriageways`, `alignmentShift`, `drawnPolyline`/`lateralShift`, `Arm`/`junctionArms`, `padRadius`/`ringRadius`/`junctionRadius`, `rayCircleExit`, `taperWedge`/`taperWedges`/`taperEdge`, `rayIntersection`/`gorePair`/`gore`, `UNITS_PER_METRE`, `MIN_ROAD_WIDTH`, `DRIVE_SIDE`, `SCHEMATIC_MEDIAN`, `TAPER_LENGTH`, `TAPER_MAX_BEND`, `GORE_LENGTH` | `src/editor/geometry.ts` | `geometry.test.ts` (pure) |
| `RoadShape`, `HatchPattern`/`needsHatch`, `jointEnd`/`tapers`/`TaperShape`, `JunctionGlyphShape`/`GoreShape` | `src/components/Diagram.tsx` | `Diagram.test.tsx` via `renderToStaticMarkup` |
| Colour, tints, line treatments | `src/styles/diagram.css` | `export.test.ts` — reaches exports free |
| `setLaneKind`, `setLinkLanes`, `setLinkAlign` | `src/editor/state.ts` | `state.test.ts` |
| `LinkAlign`/`LinkView.align` and `JunctionGlyph::Gore` — the two mirrored model additions | `src/model/types.ts` **and** `src-tauri/src/model/layout.rs`; read through `linkAlign`/`linkStyle` in `src/model/document.ts` | `layout.rs` serde tests |
| The lane-kind, alignment and glyph controls | `src/components/Inspector.tsx`, chrome CSS in `src/styles.css` | — |

Almost all of this is frontend-only. The **two** exceptions are `LinkView.align`
and the `gore` glyph, both real model changes, so both obey
`rules/document-model.md`'s Rust↔TS mirror discipline and both needed
`cargo fmt`/`clippy`. Only the glyph needed a `SCHEMA_VERSION` bump — a field is
free, a variant is not. The one cross-subsystem obligation is `strokeAllowance`
(`src/editor/export.tsx`), which must keep measuring roads at their own lane
widths **and their own class** or wide roads clip in exports; alignment and tapers
need nothing from it, since `measureDiagram` frames the *drawn* tree — a shifted
road is already inside the box, and a wedge is fill geometry whose corners sit on
the casing rim the allowance is derived from.
