# Road rendering

How a link becomes a picture of a road: lane geometry, road class, two-way
carriageways, lane kinds, and the junction arms derived from them. Frontend only
— nothing here crosses IPC, reaches disk, or changes the schema. The design
rationale lives in `specs/road_rendering_spec.md`, and from `Arm.origin` onward in
`specs/ramps_and_tapers_spec.md`; hand-maintained.

## The rule the whole subsystem follows

**The model already describes the road; the renderer's job is to stop ignoring
it.** Every quantity below comes from a field the document already carried —
`Lane.width`, `Lane.kind`, `Link.median_gap`, `LinkView.style` — and this spec
added none. When something looks wrong, the question is which field is not being
read, not which constant to tune.

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
runs.

### Arms carry their position, so the glyph follows the carriageways

`Arm` is `{ dir, origin, width }`, and `origin` is **not re-derived** — it is the
drawn polyline's own end point, which `junctionArms` already had in hand. No
second call to `carriageways`, no `DRIVE_SIDE` reasoning, and so none of the
offset-sign traps the section above is about. `origin` is **world** space; the
glyph's group is translated to the node, so an interior detail enters as
`origin - center`, which is `(0, 0)` for an undivided road.

- **A stop bar starts from its own carriageway**, at `(origin - center) + dir *
  (rayCircleExit(origin - center, dir, rp) + 4)`. `rayCircleExit` returns
  *exactly* `rp` from the centre, so an undivided junction draws byte-identically
  to the centre-derived code this replaced — pinned in `Diagram.test.tsx`.
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
  carries a shoulder lane, because `Diagram.test.tsx` pins an empty document to
  exactly `<g class="diagram"></g>`.
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

## No centreline (spec OQ-4)

An undivided two-way road would carry one in a road atlas. Zukai does not draw
one, because nothing in the model distinguishes "one link the user thinks of as
two-way" from "one carriageway of a pair": `Link` carries no direction flag and
`median_gap` is default-valued identically on every link ever created, so it
holds no signal. This is a **modelling** gap recorded for the ramps/junction
spec, not a rendering one — the fix is a field, which this spec ruled out.

## Where each piece lives

| Piece | Where | Tested by |
|---|---|---|
| `laneBands`, `roadWidth`, `classWidthFactor`, `carriageways`, `rayCircleExit`, `UNITS_PER_METRE`, `MIN_ROAD_WIDTH`, `DRIVE_SIDE`, `SCHEMATIC_MEDIAN` | `src/editor/geometry.ts` | `geometry.test.ts` (pure) |
| `RoadShape`, `HatchPattern`, `drawnPolyline`, `junctionArms`, `JunctionGlyphShape` | `src/components/Diagram.tsx` | `Diagram.test.tsx` via `renderToStaticMarkup` |
| Colour, tints, line treatments | `src/styles/diagram.css` | `export.test.ts` — reaches exports free |
| `setLaneKind`, `setLinkLanes` | `src/editor/state.ts` | `state.test.ts` |
| The lane-kind control | `src/components/Inspector.tsx`, chrome CSS in `src/styles.css` | — |

Nothing here touches Rust, `src-tauri/`, or the schema version. The one
cross-subsystem obligation is `strokeAllowance` (`src/editor/export.tsx`), which
must keep measuring roads at their own lane widths **and their own class** or
wide roads clip in exports.
