---
title: road-rendering
sources:
  - src/components/Diagram.tsx
  - src/components/Inspector.tsx
  - src/editor/export.tsx
  - src/editor/geometry.ts
  - src/editor/state.ts
  - src/model/document.ts
  - src/model/types.ts
  - src/styles.css
  - src/styles/diagram.css
  - src-tauri/src/model/layout.rs
covers: >
  how a link becomes a picture of a road: the one lane-width derivation
  everything descends from, class as a token, two-way carriageways, alignment,
  lane kinds and the hatch, and the painted centreline
max_lines: 200
generated: 2026-08-09
---

# Road rendering

How a link becomes a picture of a road — the **run** of it, between its ends.
Frontend only apart from one model addition, `LinkView.align`. Rationale:
`specs/road_rendering_spec.md` and `specs/ramps_and_tapers_spec.md`.

Two boundaries. What is drawn where links **meet** — arms and radii, taper
wedges, gores — is `rules/road-joints.md`, which consumes the derivations below
rather than repeating them. The paint a *human* places is
`rules/road-markings.md`; the line there is who chose it, everything here being
derived from the model.

## The rule the whole subsystem follows

**The model already describes the road; the renderer's job is to stop ignoring
it.** Almost every quantity below comes from a field the document already carried
— `Lane.width`, `Lane.kind`, `Link.median_gap`, `LinkView.style`. When something
looks wrong, the first question is which field is not being read, not which
constant to tune. `LinkView.align` is the one thing genuinely added: nothing in
the model distinguishes "4 lanes becomes 3 by losing the nearside lane" from
"…the offside lane", since `Link` carries an ordered `lanes` array and no
statement about how two links' lanes correspond across a shared node. Which side
a lane goes is a drawing decision, so it is a **presentation** field.

## Lane geometry: one derivation, everything downstream

```
UNITS_PER_METRE = LANE_PX / DEFAULT_LANE_WIDTH        // 9 / 3.5
laneWidths      = lanes.map(l => l.width * UNITS_PER_METRE * classWidthFactor(style))
roadWidth       = sum(laneWidths) + ROAD_MARGIN
laneBands       = each lane's { offset, width }, world units, lane 0 first
```

Four things are load-bearing and each has a test that fails if "simplified":

- **Convert per lane, then sum — never sum metres first.** `9/3.5` has no exact
  binary form, so `sum(width) * UNITS_PER_METRE` lands on `30.000000000000004` at
  3 default lanes and `57.00000000000001` at 6. The pinned rate exists so a default
  document draws *exactly* as when every lane was hardcoded to `LANE_PX`; the wrong
  grouping breaks `export.test.ts`'s `toBe(15)`.
- **The one-lane floor is on the lane *count*, not the output width.** An empty
  `lanes` array is one default lane. A `Math.max(MIN_ROAD_WIDTH, …)` clamp on the
  result looks identical until a class narrows its lanes, then rounds a 1-lane
  ramp (10.2) back up to a 1-lane arterial's 12 and cancels the class distinction
  in the case it reads most clearly.
- **`classWidthFactor` enters at the per-lane widths and nowhere else.** Scaling
  the finished `roadWidth` narrows the casing while the band-derived dividers stay
  at full pitch and spill outside it. The bands, the dividers, `edgeInset`, the
  hit path, the halo, the arrowhead, `junctionArms` and `strokeAllowance` all
  inherit it from that one place.
- **`ROAD_MARGIN` is the casing lip, not a lane, so it is not scaled.**
  `roadWidth` is therefore *not* proportional to the factor — only the lane region
  is, the two differing by `ROAD_MARGIN * (1 - factor)`. Width identities across
  classes are **exact per lane band**, approximate in aggregate; assert per band.
**Lane 0 is the nearside (kerb) lane**, so it comes back with the most positive
offset — the side a positive `offsetPolyline` distance draws on under right-hand
traffic. Everything keyed on `Lane.kind` depends on it: a `shoulder` at index 0
must render as an outside hard shoulder, not one hiding in the median. The
Inspector notes `nearside` on that first row, the only place the UI says so.

## Road class paints as a class token

`RoadShape` emits `<g class="road road-{style}">` and `diagram.css` carries the
colour and line treatment — which is what makes a class-driven style reach an
exported file **with no exporter change at all** (`rules/diagram-export.md`); a
computed inline colour would have needed the export path to learn about road
classes. The width factor is the exception, and not a preference: CSS can
*replace* a computed `strokeWidth`, not *scale* one.

## Two-way roads: two links, stepped off the shared centreline

`carriageways(doc)` returns a lateral offset per link, `0` for a link with no
opposing twin — the model has no other way to spell a two-way road.

- **Pairing is on an exact reversed node pair**, never "roughly parallel", which
  would mis-pair a slip road with the mainline beside it. Three or more links on
  one node pair stay on the centreline rather than have a layout guessed, and two
  self-loops are excluded for satisfying the test trivially.
- `offset = DRIVE_SIDE * (roadWidth / 2 + SEPARATION / 2)`, with `SEPARATION =
  max(SCHEMATIC_MEDIAN, median_gap * UNITS_PER_METRE)`. **The road's own
  half-width is the point**: a step from the median alone leaves two 4-lane
  carriageways almost entirely on top of each other.
- **Every offset returned is positive, and that is not a bug.** The number is
  `offsetPolyline`'s `d`, in each link's *own* frame; a reversed twin traverses
  the same ground the other way, so its segment normal already points the other
  way and the same positive `d` draws it on the opposite visual side. Asserting
  the signs *differ* fails a correct implementation, negating one twin puts both
  carriageways on the same side, and only a drawn-`y` assertion catches an
  inverted `DRIVE_SIDE`.
- `SCHEMATIC_MEDIAN = 6` because `median_gap` defaults to 0.5 m ≈ 1.3 units,
  thinner than the 1.5-unit edge line over it. Above ~2.33 m the model's value
  takes over, so the field is honoured ordinally.

**One `drawnPolyline` helper** applies this, shared by the roads and by
`junctionArms` (`rules/road-joints.md`) so the two cannot disagree about where a
road runs. It lives in `geometry.ts` (with `lateralShift`) rather than
`Diagram.tsx`, where it started: the marking tool places paint on the polyline a
road is *actually drawn along*, and a second derivation is what the "only site"
claim forbids — so the one site moved rather than a second appearing.

## Alignment: the second lateral term, composing by addition

`drawnPolyline` shifts a link by `carriagewayOffset + alignmentShift`, and that
sum is the whole of what any consumer sees. A link is drawn **centred** unless
`LinkView.align` says otherwise; aligning to an edge lets two links of different
widths meet at a node sharing that edge, which is what a lane drop looks like.

- **It is the lane region's half-span, `(roadWidth - ROAD_MARGIN) / 2`.**
  `ROAD_MARGIN` is the casing lip, so the aligned edge is the outermost painted
  line. The full width leaves a 1.5-unit casing step at every joint — small enough
  to read as an antialiasing artefact and never be diagnosed.
- **The sign follows from lane 0 and is not a choice.** Lane 0 is nearside at the
  most *positive* offset, so an unaligned road's nearside edge is at
  `+(roadWidth - ROAD_MARGIN) / 2`, and holding an edge *on* the polyline means
  shifting by whatever brings it to zero. So `offside` shifts **positive** and an
  offside-aligned road hangs to the *nearside* of its polyline. A magnitude
  assertion passes under an inversion — pin the drawn `y`.
- **Addition, at one site.** The roads and everything at a joint inherit it
  through `drawnPolyline`, exactly as they inherit `classWidthFactor`
  (`rules/road-joints.md`). That function returns the *same array* when the sum is
  zero, so a document that set neither emits byte-identical markup.
- **On a divided road it is per-carriageway.** `carriageways` knows nothing about
  alignment and the pair's offsets are measured in opposing frames, so aligning
  one twin moves it relative to the **median** — the halves close up or spread
  apart — the honest drawing, not a defect.
- `centre` is an **absent** `align`, the rule `Lane.kind` follows for `general`.

## Lane kinds, and what a line means

| Kind | Band | Boundary to the next lane |
|---|---|---|
| `shoulder` | hatched (`.lane-band-shoulder` + the pattern) | **solid** `.road-shoulder-line` |
| `bus` / `cycle` | flat tint (`--tint-bus` / `--tint-cycle`) | dashed, as usual |
| `general` / `turn` / absent | **no element emitted** | dashed `.road-divider` |

A band is a path stroked at the lane's own width along `offsetPolyline(points,
band.offset)`, between the casing and the painted lines so it reads as surface,
not marking. Emitting nothing for a plain lane keeps a document that never set a
kind rendering exactly as before. *What* a line means is the boundary's
business, not the class's: a dashed divider says "lanes, same direction, cross
freely", which a hard-shoulder boundary does not. **This is the whole of what
makes a motorway read differently from an arterial** — the two classes paint
alike, so a motorway with no shoulder lane draws like an arterial, by design. Both
derived rows can be overridden: a `lane_line` marking replaces whatever this table
put there (below).

### The hatch is the one piece of paint that cannot be a CSS rule

Both halves of the obvious implementation are illegal in `diagram.css`, and
`export.test.ts` enforces both: a paint-server reference fails the
no-external-reference assertion, and the `<pattern>` element cannot be written in
a file that may not contain `<` or `&` **anywhere, comments included**. So the
pattern is markup in `Diagram.tsx` inside a `<defs>`, referenced by an inline
`stroke="url(#road-hatch)"` on the band — `stroke`, not the spec's `fill`, since
the band is a stroked path. Three constraints: the `<defs>` is **conditional**
(`needsHatch`), so anything new referencing the pattern must widen that predicate,
as a gore already did (`rules/road-joints.md`); the pattern's stroke comes from a
class (`.road-hatch-line`), because `var()` does not resolve in a presentation
attribute; and `url(#road-hatch)` is an **in-document fragment**, which does not
taint the `<canvas>` the PNG path draws into — do not "fix" it.

### Setting a kind, and the control that used to destroy it

`setLaneKind` is the only way `Lane.kind` is reachable from the UI, and
**`general` is stored as an absent `kind`** so a plain lane has one
representation. **`setLinkLanes` preserves the lanes that survive**, by object
identity: it used to rebuild the array from `defaultLane(i)` on every ±1 click, so
the moment a kind was settable the Lanes stepper above silently discarded it — a
control whose value an adjacent control destroys is not a working feature.

## A centreline is painted, never derived (road OQ-4, closed)

**Nothing in the model can tell the renderer a road is an undivided two-way one**:
`Link` has no direction flag and `median_gap` is default-valued identically on
every link ever created. Deriving a centreline would be a guess, and that much of
OQ-4 stands. What it got wrong was the remedy — it recorded a **modelling** gap
and said the fix was a field. The fix needed none: an undivided two-way road is a
`lane_line { style: double }` marking with no lane, which the `Marking` anchor has
always expressed. The *human* says the road is two-way by painting the line, the
posture the junction glyphs take. Ramps OQ-6 closed the same way.
Two consequences here. **`RoadShape` gained one input, `replaced`** — the boundary
offsets a lane line has taken over (`laneLineOffsets`, `boundaryTaken`) — and a
boundary in it derives no line at all, because a painted line **replaces** the
divider or shoulder line it lands on; overpainting leaves a dashed line under a
solid one, visible at every dash gap. And the lane line's own offset runs
*character-for-character* the expression the divider derivation uses: the two are
compared as numbers, so an equivalent-but-different one differs in the last bit
and the divider survives under the line. The rest is `rules/marking-kinds.md`.

## Where each piece lives

`geometry.ts` owns everything pure — `laneBands`/`laneWidths`, `roadWidth`,
`classWidthFactor`, `carriageways`, `alignmentShift`,
`drawnPolyline`/`lateralShift`, `offsetPolyline`/`segmentNormals` and the
constants (`LANE_PX`, `ROAD_MARGIN`, `UNITS_PER_METRE`, `MIN_ROAD_WIDTH`,
`DRIVE_SIDE`, `SCHEMATIC_MEDIAN`) — under `geometry.test.ts`. `Diagram.tsx` holds
`RoadShape`, `arrowTriangle` and `HatchPattern`/`needsHatch` through
`renderToStaticMarkup`; the joint shapes beside them are `rules/road-joints.md`'s.
Paint is `diagram.css`; `setLaneKind`/`setLinkLanes`/`setLinkAlign` are
`state.ts`; the controls are `Inspector.tsx`, chrome CSS in `styles.css`.
`LinkView.align` is this rule's one model exception, mirrored in `types.ts` and
`layout.rs` and read through `linkAlign`/`linkStyle`. It needed no version bump —
a field is free, a variant is not, which is why the `gore` glyph next door did.
The one cross-subsystem obligation is `strokeAllowance` (`export.tsx`), which must
keep measuring roads at their own lane widths **and their own class** or wide
roads clip in exports; `export.test.ts` pins a 3-lane road's at `15`.
