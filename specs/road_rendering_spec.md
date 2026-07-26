---
status: implemented (all 4 phases; reviewed in 4 rounds, 2026-07-25)
last_updated: 2026-07-25
note: Make the drawn road honour the road model — class, lane widths, lane kinds, and two-way carriageways that don't sit on top of each other.
implemented: ["Phase 1", "Phase 2", "Phase 3", "Phase 4"]
not_implemented: []
related: [specs/diagram_export_spec.md, specs/save_load_spec.md]
reference: "Schematic road-diagram convention as road atlases and motorway signage use it — solid edge lines, dashed lane dividers, hatched shoulders, separated carriageways. Not to-scale surveyed geometry (that is Assimilator's job), not a map style like OSM Carto."
---

# Road Rendering Spec

## 1. Goal

Make a Zukai drawing look like a road, not like a graph with fat edges.

The document model already describes roads properly — road class, per-lane
widths, lane kinds, a median gap between opposing carriageways. The renderer
ignores all of it. `Diagram.tsx` draws every link as one asphalt stroke of
`laneCount * 9 + 3` units with evenly-spaced identical dashes, whatever the model
says. The gap is not a missing feature; it is **a promise the model makes and the
picture breaks** (§2.1).

The sharpest symptom: the Inspector's **Road class** control
(`Inspector.tsx:117`) offers motorway / arterial / local / ramp, stores the
choice, and round-trips it to `.zkai` — and the drawing is byte-identical for all
four. A user picks "motorway" and nothing happens.

End state — the same four-link document, drawn as a road diagram:

```
File ▸ a motorway with a parallel local street

  L1  motorway, 4 lanes, lane 0 = shoulder      → wide, dark, hatched shoulder,
                                                   solid edge + dashed dividers
  L2  motorway, 4 lanes, opposite direction      → drawn as the second
      (same node pair as L1)                       carriageway, offset, not on
                                                   top of L1
  L3  local, 2 lanes, one lane a bus lane        → narrow, lighter, tinted lane
  L4  ramp, 1 lane                               → narrowest, distinct ramp
                                                   class (no taper — §2.7)
```

Today L1 and L2 are **exactly coincident** — a two-way road is invisible as
such — and L3 is indistinguishable from L1 but for lane count.

## 2. Design

### 2.1 The model already specifies this (decision, recorded)

This spec implements rendering the Rust model documents but never got. Each is a
doc comment describing a visual, cited so a reviewer can check it:

| Model field | What Rust says it is for | Rendered? |
|---|---|---|
| `LinkView.style` (`layout.rs:66`) | "Road class, driving stroke width/colour" | ❌ 0 refs in `Diagram.tsx` |
| `Lane.kind` (`graph.rs:80`) | "Schematic-only hint used for rendering (bus lane tint, shoulder hatch)" | ❌ not rendered, not editable |
| `Lane.width` (`graph.rs:73`) | Lane width, metres, default 3.5 | ❌ every lane hardcoded to `LANE_PX = 9` |
| `Link.median_gap` (`graph.rs:61-63`) | "Gap to the opposing carriageway centreline" | ❌ never read by the renderer; written as a constant `0.5` at every creation site (`state.ts:443`, `persist.rs:86`, `model/mod.rs:136`, `:143`) |

So the scope is deliberately **not** new model concepts. Nothing in
`model/types.ts` or `src-tauri/src/model/graph.rs` changes shape; the schema
version stays `1`; existing `.zkai` files keep loading and start looking better.
That is what makes this a rendering spec and keeps it independent of the
Assimilator import/export work.

**Two-way roads need no new model either.** `graph.rs:48-50` already settles it:
"roads are directional: a two-way street is two links with opposite
`from_node`/`to_node`." The bug is purely that the renderer draws both down the
same centreline. No `oneway` flag, no bidirectional link type — §2.4 is a
rendering change.

### 2.2 Lane geometry comes from the lanes (decision, recorded)

`roadWidth(laneCount)` (`geometry.ts:62`) and `RoadShape`'s divider loop
(`Diagram.tsx:166-169`) both assume every lane is exactly `LANE_PX = 9` units
wide. Replace both with a single derivation from the actual `Lane[]`:

```ts
/** World units per model metre, pinned so a default document renders unchanged. */
export const UNITS_PER_METRE = LANE_PX / DEFAULT_LANE_WIDTH;   // 9 / 3.5

/** Both fields are **world units**, not metres — the conversion happens inside
 *  `laneBands`, so every consumer downstream is already in drawing space. */
export interface LaneBand { offset: number; width: number; }  // offset = band centre

export function laneBands(lanes: Lane[]): LaneBand[]
export function roadWidth(lanes: Lane[]): number
```

**`UNITS_PER_METRE` is chosen so today's picture is the baseline**, not a
redesign: `DEFAULT_LANE_WIDTH` is 3.5 m (`document.ts:18`, `graph.rs`
`default_lane_width`), so a document of default lanes gives
`n * 3.5 * (9/3.5) + 3 = n * 9 + 3` — the same number `roadWidth(n)` returns
today. A lane the model gives a larger width then draws wider, ordinally faithful
without the schematic becoming to-scale (`CLAUDE.md`: "not necessarily to
scale"). Note that `Lane.width` has **no Inspector control** and this spec adds
none, so until one exists a non-default width is only reachable from a
hand-edited or imported `.zkai` — the mechanism is what Phase 1 builds, not a
user-facing feature yet.

**Convert per lane, then sum — not sum-then-convert.** `UNITS_PER_METRE` is
`9/3.5 = 2.5714285714285716`, which does not divide evenly in binary, so the two
groupings are not the same number:

```ts
// WRONG: drifts. n=3 gives 30.000000000000004, n=6 gives 57.00000000000001.
lanes.reduce((s, l) => s + l.width, 0) * UNITS_PER_METRE + ROAD_MARGIN

// RIGHT: exact against `n * 9 + 3` for every n = 1..8.
lanes.reduce((s, l) => s + l.width * UNITS_PER_METRE, 0) + ROAD_MARGIN
```

This is not a rounding nicety — `export.test.ts:44` asserts
`expect(strokeAllowance(road(3))).toBe(15)`, so the sum-first form fails an
existing test, and Phase 1's own "equals the old `n * 9 + 3`" gate fails at
n=3 and n=6. `laneBands` must convert per lane for the same reason, so that band
widths sum back to `roadWidth` exactly.

**The `Math.max(1, …)` floor survives — as a floor on the *lane count*, not on
the output width.** `roadWidth` today clamps to at least one lane
(`geometry.ts:63`), making `roadWidth(0) === 12`; without it, a link with an empty
`lanes` array yields width 3, `edgeInset = 0`, and both edge lines land on the
centreline. The lane-derived form keeps the same semantics: **an empty `lanes`
array is treated as one default lane**, and `MIN_ROAD_WIDTH = 12` is the name for
the width that falls out of it.

It is deliberately **not** a `Math.max(MIN_ROAD_WIDTH, …)` clamp on the result.
That distinction is invisible in Phase 1 and load-bearing in Phase 2: a 1-lane
ramp is `3.5 × 0.8 × UNITS_PER_METRE + 3 = 10.2` units, so an output clamp would
round it back up to 12 — identical to a 1-lane arterial — defeating
`classWidthFactor` (§2.3) in precisely the case §1's L4 ("ramp, 1 lane →
narrowest") exists to show. The UI clamps lane count to 1..8 (`state.ts:462`), so
the empty-lanes case is only reachable from a hand-edited or imported document,
which is why it needs the floor rather than an assertion.

**Lane 0 is the nearside lane (decision, recorded).** `graph.rs:59` says only
"Lanes, ordered" and today's `RoadShape` is symmetric, so no existing code pins
which end of the array is which side of the road — but §1's example ("lane 0 =
shoulder") and every `Lane.kind` band depend on it. **Lane 0 is the nearside
(kerb) lane: the one furthest to the `DRIVE_SIDE` of the travel direction**,
i.e. rightmost under right-hand traffic (OQ-2), with subsequent lanes running
inward toward the centreline. That is what makes a `shoulder` at index 0 render
as an outside hard shoulder rather than in the median. `laneBands` returns bands
in array order, so `laneBands(lanes)[0].offset` is the most positive offset when
`DRIVE_SIDE` is `+1`.

**The signature change is the ripple to plan for.** `roadWidth` currently takes a
lane *count*; every call site must pass lanes instead. There are six, and the two
in tests are the ones easily missed:

- `Diagram.tsx:158` — `RoadShape`, the casing width
- `Diagram.tsx:138` — `junctionArms`, the arm width feeding every junction glyph
- `Diagram.tsx:269` — the `roadWidth(1)` fallback for an arm-less junction, which
  becomes a named `MIN_ROAD_WIDTH` constant rather than a synthetic lane array
- `export.tsx:strokeAllowance` — bounds the exported `viewBox`
  (`specs/diagram_export_spec.md` §2.6). **If this is missed, wide roads clip in
  exports** — the exact bug that spec's review round 1 caught.
- `export.test.ts:56` and `:59` — the regression assertions that the export margin
  covers `roadWidth(8)/2`. They must keep asserting the *same property* against
  the new signature, not be weakened to make the build pass.

Four pieces of **prose** also describe the old signature and go stale in the same
pass: the `strokeAllowance` doc comment (`export.tsx:53-57`, which names "the 1–8
lane clamp"), the arithmetic comments at `export.test.ts:70` and `:139`, and
`rules/diagram-export.md:95-101`. Phase 1 updates all four — a rule that
contradicts the code is the failure mode `CLAUDE.md` calls out.

### 2.3 Road class paints, it does not resize (decision, recorded)

`LinkStyle` drives **colour and line treatment, plus a modest width factor** — it
must not become the dominant width term, because road width is how a reader
counts lanes. A 2-lane motorway must still look narrower than a 4-lane local
road, or the drawing lies about lane count.

The mechanism for **colour and line treatment** is a class on the road group, not
inline attributes: `<g className="road road-motorway">`, with the rules in
`src/styles/diagram.css`. That choice is load-bearing for export — `diagram.css`
is embedded verbatim in every exported SVG (`rules/diagram-export.md`, "The paint
travels inside the file"), so a class-driven style reaches an exported file with
**no exporter change at all**, whereas a computed inline colour would need the
export path to know about road classes.

**The width factor is the exception: it is applied in TypeScript, not CSS.** A
CSS rule cannot *scale* a per-element `strokeWidth={w}` presentation attribute —
it can only replace it with a constant — and `w` (`Diagram.tsx:158`) is not just
the casing stroke: after Phase 1 it also drives `edgeInset` (`:160`), the hit
path (`:189`), the halo (`:191`), the arrowhead (`:174`), `junctionArms`' arm
width (`:138`) and `strokeAllowance` (`export.tsx:64`), all computed in TS — and
the lane dividers and bands come from `laneBands`. A CSS-only factor would shrink
the casing while the edge lines stayed put, i.e. paint the lines outside the
road. So:

```ts
/** Modest per-class width multiplier; never large enough to confuse lane count. */
export function classWidthFactor(style: LinkStyle): number
```

lives in `geometry.ts`. **It must be applied at one place upstream of everything
else: the per-lane widths feeding `laneBands`.** Scaling only `w` at
`Diagram.tsx:158` is not enough — Phase 1 deletes the fixed-pitch divider loop
that used to derive dividers from `w`, so after Phase 1 the dividers and bands
come from `laneBands(lanes)`, which knows nothing about the style. Scale `w`
alone and a `ramp` (0.8) gets a narrowed casing with full-width dividers spilling
outside it — the same "lines outside the road" defect, just relocated. Feeding
the factor into the lane widths makes `roadWidth`, `laneBands`, `edgeInset`, the
dividers, the bands, the arms and the export allowance all inherit it from a
single derivation.

**The factor scales the lane region, not the whole road width.** `ROAD_MARGIN` is
the casing lip, not a lane, so it is deliberately *not* scaled — which means
`roadWidth` does **not** scale by the factor:

```
roadWidth(ramp, n)  −  factor × roadWidth(arterial, n)  =  ROAD_MARGIN × (1 − factor)
                                                        =  0.6, at every n
```

What *is* proportional is the lane region, `roadWidth − ROAD_MARGIN`.
This matters because the obvious gate — "a ramp's casing is `factor` times an
arterial's" — is **false at every lane count**, and an implementer forcing it true
has to scale the whole of `w` including the margin, which is exactly the `w`-only
implementation forbidden above and brings the divider spill back. Phase 2's gate
is therefore written against the lane region.

**Proportional to within a float ulp, though — the *exact* claim is per lane.**
(Corrected during Phase 2, measured; round 4's "verified at n = 1, 2, 4, 8" was
wrong.) `Σ(wᵢ × f)` is not `f × Σ(wᵢ)`, and `(region + ROAD_MARGIN) − ROAD_MARGIN`
is not `region`, so the aggregate identity lands up to 1 ulp off at ramp n = 1, 2,
8 and local n = 3, 7. No regrouping fixes it — scaling in metres before converting
drifts three times as often, and this is §2.2's own drift one level up. What *is*
exact for every class and every lane width is the per-lane statement this section
already makes:

```ts
laneBands(lanes, style)[i].width === factor * laneBands(lanes)[i].width
```

which is also the stronger gate, since the dividers are what a `w`-only
implementation gets wrong. So Phase 2 asserts that exactly and the aggregate
lane-region relation approximately.

`diagram.css` then carries only colour and line treatment. This does not weaken
the export claim — the *paint* still travels as classes; width was already a
computed geometric quantity that the exporter inherits by rendering the same
`Diagram` tree.

Proposed treatment (the palette already has the variables it needs):

| Class | Casing | Width factor | Edge line |
|---|---|---|---|
| `motorway` | `--asphalt` | 1.0 | solid `--paint-white` (the hard-shoulder line is §2.5, and lands in **Phase 4**, not Phase 2) |
| `arterial` (default) | `--asphalt` | 1.0 | solid `--paint-white` |
| `local` | `--asphalt-2` (already defined, currently unused) | 0.9 | solid, thinner |
| `ramp` | `--asphalt-2` | 0.8 | solid, thinner |

`--asphalt-2` exists in `diagram.css:25` and is referenced by nothing today —
this is what it was declared for.

### 2.4 Two-way roads: two links, drawn side by side (decision, recorded)

Two links between the same node pair in opposite directions are one two-way road.
Today they render on the same centreline and are literally invisible as two.

`carriageways(doc)` returns, per link, the lateral offset to apply to its
polyline before drawing — `0` for a link with no opposing twin, and a signed
offset for a link that has one. `offsetPolyline` (`geometry.ts:97`) already does
the offsetting, including through `bends`.

Pairing rule: **exact reversed node pair** (`a.from === b.to && a.to === b.from`).
Not "roughly parallel links" — that is a heuristic that will mis-pair a slip road
running alongside a mainline, and a schematic's whole point is that the human
placed things deliberately.

**The offset must clear the road's own width, not just the median.** This is the
easiest thing to get wrong: a "separation" derived only from `median_gap` leaves
two 4-lane carriageways (39 units wide each) sitting almost entirely on top of
each other — the very defect this section exists to fix. Each link steps out by
half its *own* width plus half the median:

```ts
const SEPARATION = Math.max(SCHEMATIC_MEDIAN, link.median_gap * UNITS_PER_METRE);
offset(link) = DRIVE_SIDE * (roadWidth(link.lanes) / 2 + SEPARATION / 2);
```

so the drawn gap between the two facing inner edges is `SEPARATION`, whatever the
lane counts are.

**Both offsets are positive — the opposition comes from the frame, not the
sign.** This is the subtlest thing in the spec and the easiest to "fix" into a
bug. `carriageways` returns the `d` handed to `offsetPolyline`, and that `d` is
measured in **each link's own polyline frame**. A reversed twin traverses the
same ground in the opposite direction, so its segment normal already points the
other way: for `N1(0,0) → N2(100,0)` the normal is `(0,+1)` and `+d` draws at
`+y`; for the twin `N2 → N1` the normal is `(0,−1)` and *the same positive* `d`
draws at `−y`. Opposite visual sides, identical signs. Since `DRIVE_SIDE`,
`roadWidth` and `SEPARATION` are all positive, **every offset this function
returns is positive.** An implementer who instead negates one twin to make the
two signs differ puts both carriageways on the *same* visual side — precisely the
defect this section exists to remove. The magnitudes differ when the lane counts
differ (a 4-lane carriageway steps out further than its 2-lane twin), which is
correct and is why the phase gate tests the unequal case explicitly.

When the pair disagrees on `median_gap`, each link uses its own, so the drawn gap
is `S_A/2 + S_B/2` — the mean of the two separations. That is a harmless
consequence of a document the UI cannot produce (nothing sets `median_gap`, see
below), not a case worth special-casing.

Two traps, both now settled:

- **Which side each carriageway takes depends on which side of the road the
  country drives on** — and the *sign convention is not obvious from the code*.
  `segmentNormals` (`geometry.ts:80`) is documented as returning "left-hand
  normals", but that is the y-up maths convention; on an SVG canvas y points
  down, so for travel due east the normal is `(0, +1)`, which is **visually
  down-and-to-the-right**. Therefore **a positive `d` in `offsetPolyline` moves
  the polyline to the right of its travel direction as drawn**, and
  `DRIVE_SIDE = +1` means right-hand traffic. A sign inversion here is invisible
  to a "two distinct carriageways appear" check, so Phase 3 asserts the sign
  against a known-direction link, not just the magnitudes. Settled in OQ-2.
- **`median_gap` is metres and tiny.** Its default is 0.5 m (`graph.rs`
  `default_median_gap`), which at `UNITS_PER_METRE` is ~1.3 units — thinner than
  the 1.5-unit edge line, i.e. invisible. It cannot be used literally as the
  drawn separation. Settled in OQ-3.

More than two links on the same node pair (a divided road plus a parallel
service road) is left alone — offset `0` for all of them, so the existing
behaviour is preserved rather than a guess being made.

**Known limitation, accepted:** the junction glyph's interior details are drawn
from the junction *centre* — the stop bars (`Diagram.tsx:309-327`) and the pad
radius (`:270`) — while `Arm` carries only `{dir, width}`
(`Diagram.tsx:118-121`), no lateral offset. So where a divided road meets a
junction, the carriageways move off the centreline but the stop bars do not
follow them. Fixing that means giving `Arm` an offset and re-deriving the
junction interior, which is junction-glyph work this spec lists as a non-goal
(§2.7). Recorded as OQ-6 and left to the ramps/junction spec rather than
smuggled into Phase 3.

### 2.5 Lane kinds and line semantics (decision, recorded)

Today every divider is the same dashed white line (`.road-divider`,
`diagram.css:58`) and there is no distinction between the outermost line and an
interior one — but in a real schematic the line *is* the meaning:

| Line | Meaning | Style |
|---|---|---|
| Edge line | Carriageway edge | solid, already `.road-edge` |
| Lane divider | Lanes, same direction | dashed, already `.road-divider` |
| Shoulder line | Hard shoulder boundary | solid, wider gap |
| Centreline | Undivided two-way (no opposing link) | **not derived** — painted, as a `lane_line` marking (OQ-4) |

And `Lane.kind` gets a fill band behind the lane: `shoulder` hatched,
`bus`/`cycle` tinted, `turn` left plain. Rendering a band per lane is what
`laneBands` (§2.2) exists to make cheap — the band is `{offset, width}` already.

**The hatch pattern is the one thing that cannot follow the class-in-CSS rule
(§2.3), and two existing assertions enforce that.** The obvious way to hatch is
an SVG `<pattern>` referenced as `fill: url(#hatch)`, and `diagram.css` can hold
neither half:

- `export.test.ts:93` asserts the embedded stylesheet does **not** contain
  `url(` — a `fill: url(#hatch)` rule in `diagram.css` fails an existing test on
  sight. (The rule exists because a `url()` in an exported standalone SVG is the
  classic way to end up with an external reference that does not resolve.)
- `diagram.css`'s own header (lines 15-17), asserted by `export.test.ts:99`,
  forbids `<` and `&` **anywhere in the file, including comments** — so the
  `<pattern>` element itself cannot be defined there either.

So: the `<pattern>` is emitted as **markup in `Diagram.tsx`**, inside a `<defs>`,
and referenced by an **inline `fill` attribute** on the band. `diagram.css` keeps
only the flat colour/tint rules for the non-hatched kinds. Two constraints on the
emission:

- **`<defs>` must be conditional** — emitted only when the document actually has
  a shoulder lane. `Diagram.test.tsx:60-64` asserts an empty document renders
  *exactly* `'<g class="diagram"></g>'`, so an unconditional `<defs>` breaks it.
- The pattern must be **self-contained** (geometry and stroke colour inline or
  from a CSS custom property), since it travels into the exported file with no
  external stylesheet.

This is the honest version of §2.3's "no exporter change" claim: it holds for
paint, and the one exception is scoped, tested, and stays inside the `Diagram`
tree the exporter already renders.

Setting a lane's kind needs an Inspector control; without one the field is
unreachable from the UI and the rendering is dead code. That is Phase 4 scope,
and it is the only new reducer action in this spec (`setLaneKind`).

**`setLinkLanes` has to stop wiping lane data in the same phase.** It currently
rebuilds the whole array from `defaultLane(i)` on every count change
(`state.ts:467-470`), so the moment a lane kind is settable, pressing the Lanes
`+` stepper silently discards it — a user marks lane 0 a shoulder, adds a lane,
and the shoulder is gone. Phase 4 changes it to **preserve the existing lanes'
`kind` and `width` for indices that survive**, appending `defaultLane(i)` only
for genuinely new indices. This is in scope because Phase 4 is what makes the
field reachable; shipping a control whose value an adjacent control destroys is
not a working feature.

### 2.6 Where the logic lives

Mirrors the split the export spec established (`rules/diagram-export.md`, "Pure,
DOM, Tauri"):

| Piece | Where | Pure? |
|---|---|---|
| `laneBands`, `roadWidth`, `UNITS_PER_METRE`, `MIN_ROAD_WIDTH` | `src/editor/geometry.ts` | ✅ vitest |
| `classWidthFactor`, `DRIVE_SIDE`, `SCHEMATIC_MEDIAN` | `src/editor/geometry.ts` | ✅ vitest |
| `carriageways(doc)` | `src/editor/geometry.ts` | ✅ vitest |
| `RoadShape`, the road classes, the hatch `<pattern>` | `src/components/Diagram.tsx` | ✅ via `renderToStaticMarkup` |
| Colour + line-treatment rules | `src/styles/diagram.css` | — reaches exports free (§2.3) |
| `setLaneKind`, `setLinkLanes` lane preservation | `src/editor/state.ts` | ✅ vitest |

Two things deliberately do **not** live in `diagram.css`, each for a reason the
code enforces: the class **width factor** (CSS cannot scale a computed
`strokeWidth`, §2.3) and the hatch **`<pattern>`** (`export.test.ts` forbids both
`url(` and `<` in the embedded stylesheet, §2.5).

Nothing in this spec touches Rust, `src-tauri/`, or the schema version. The one
cross-spec obligation is `strokeAllowance` (§2.2).

### 2.7 Non-goals

- **Not ramps and tapers.** An onramp merging into a mainline needs geometry this
  spec doesn't build; it is the natural next spec and depends on this one.
- **Not markings or signs.** `Marking[]`/`Sign[]` stay unrendered; separate spec,
  and it inherits export OQ-4 (fonts must be embedded for PNG).
- **Not movements or signal plans.** Junction interiors stay as they are.
- **Not auto-layout** (`CLAUDE.md`: "Layout is semi-automatic").
- **Not to-scale.** `UNITS_PER_METRE` gives ordinal fidelity, not survey accuracy.
- **No schema change.** Version stays `1`; no new model fields.

## 3. Open questions

- **OQ-1** — Should road class change width at all (§2.3's 0.8–1.0 factor), or
  only colour and line treatment? (design-call; proposed: keep the modest factor,
  since a ramp reading as narrow is most of what makes it legible as a ramp — but
  never enough to confuse lane count.)
- **OQ-2** — **Drive-on side.** Which side of its travel direction does a
  carriageway sit on (§2.4), and does it become a document-level setting or a
  build-wide constant? (design-call; was flagged as blocking Phase 3.)
  **RESOLVED (review round 1):** a single module-level constant
  `export const DRIVE_SIDE = 1` in `geometry.ts`, `+1` meaning right-hand
  traffic. Because SVG's y axis points down, a **positive** `d` in
  `offsetPolyline` moves a polyline to the **right of its travel direction as
  drawn** (verified: travel east → normal `(0, +1)` → visually right), despite
  `segmentNormals`' "left-hand normals" doc comment, which uses the y-up
  convention. No document field: a `.zkai` written today has no place to record
  it, adding one would be the schema change §2.7 rules out, and a constant is a
  one-line change when someone draws a left-hand-traffic network.
- **OQ-3** — How does `median_gap` (metres, default 0.5) map to drawn separation
  when a literal conversion is ~1.3 units and invisible (§2.4)? (design-call.)
  **RESOLVED (review round 1):** `SCHEMATIC_MEDIAN = 6` world units, and the
  drawn separation is `max(SCHEMATIC_MEDIAN, median_gap * UNITS_PER_METRE)`,
  applied per §2.4's offset formula (which also clears each carriageway's own
  half-width). 6 units is four times the 1.5-unit edge line, so the median reads
  clearly as a gap; the crossover is at `median_gap ≈ 2.33 m`, so a real motorway
  median (3 m+) widens the drawn gap and the field is honoured ordinally, while
  the 0.5 m default — which is what every link created by the UI carries
  (`state.ts:443`, `persist.rs:86`) — still renders legibly.
- **OQ-4** — Does an undivided two-way road (a single link the user thinks of as
  two-way, with no opposing twin) get a centreline? (answerable-from-code.)
  **RESOLVED (review round 1) — no centreline.** Confirmed against the source:
  nothing in the model can distinguish "this one link is a two-way road" from
  "this link is one carriageway of a pair". `Link` (`types.ts:50-56`,
  `graph.rs:52-64`) carries only `id`, `from_node`, `to_node`, `lanes`,
  `median_gap`; `Lane` carries `id`, `width`, `speed_limit`, `allowed_classes`,
  `kind`; `LinkView` (`layout.rs:65-74`) carries only `style` and `bends`. There
  is no `oneway`, no direction flag, no pair id. The one near-miss is
  `median_gap` — its doc comment ("Gap to the opposing carriageway centreline")
  sounds like it implies a twin, but it is serde-defaulted and hardcoded to `0.5`
  at every creation site (`state.ts:443`, `persist.rs:86`, `model/mod.rs:136`,
  `:143`), so it is identical on every link ever created and carries no signal.
  So an undivided two-way road gets no centreline, because the renderer cannot
  know it is one. **Recorded as a modelling gap for the ramps/junction spec:**
  the fix is a model field, which is out of scope here (§2.7, "No schema
  change").
  **AMENDED 2026-07-25 — the resolution stands, the last clause was wrong.** No
  centreline is *derived*, for exactly the reasons above, and that is still true.
  But the fix needed **no model field at all**: an undivided two-way road is a
  `lane_line { style: double }` marking with `lane: None`, which the `Marking`
  anchor has expressed since the first commit. The *human* says the road is
  two-way by painting the line, which is why nothing has to infer it.
  `specs/road_markings_spec.md` Phase 4 shipped it (2026-07-25) and closes ramps
  OQ-6 with it; `rules/road-rendering.md`'s section is rewritten accordingly.
- **OQ-5** — Should `LaneKind::Shoulder` count toward the lane count shown to the
  user in the Inspector (`Lanes` +/-)? A 4-lane motorway with a hard shoulder is
  "4 lanes" to a road engineer, but `lanes.length` would be 5. (design-call;
  proposed: leave the counter as `lanes.length` and revisit if it reads wrong.
  Does not block any phase — the counter behaves as it does today either way.)
- **OQ-6** — Should a junction's interior details (stop bars, pad radius) follow
  the offset carriageways of a divided road (§2.4's known limitation)? Doing so
  means giving `Arm` a lateral offset and re-deriving the junction glyph.
  (design-call, deferred to the ramps/junction spec; junction interiors are a
  non-goal here, §2.7. Does not block Phase 3 — the carriageways separate
  correctly, only the stop bars stay on the old centreline.)

## 4. Implementation phases

Strictly sequential; each is one plan-mode pass with a concrete exit gate.

### Phase 1 — Lane geometry from the model

- **Scope:** `UNITS_PER_METRE`, `MIN_ROAD_WIDTH`, `LaneBand`, `laneBands(lanes)`,
  and `roadWidth(lanes: Lane[])` in `src/editor/geometry.ts`, replacing
  `roadWidth(laneCount)` — **converting per lane then summing**, per §2.2, and
  keeping the one-lane floor as `MIN_ROAD_WIDTH = 12`. Update all **six** call
  sites of §2.2 — `RoadShape` (`Diagram.tsx:158`), `junctionArms`
  (`Diagram.tsx:138`), the `roadWidth(1)` fallback (`Diagram.tsx:269`, becoming
  `MIN_ROAD_WIDTH`), **`strokeAllowance` (`export.tsx:64`)**, and the two
  `export.test.ts` assertions (`:56`, `:59`) — kept asserting the same property,
  not weakened to compile. `RoadShape`'s divider loop derives offsets from
  `laneBands` instead of the fixed pitch. Lane 0 is the nearside lane (§2.2). No
  visual change for default documents, no new model fields, no CSS.
- **Exit gate:** `bun run build` + `bun run test` green, with vitest cases
  asserting via `toBe` that `roadWidth` of `n` default lanes **exactly** equals
  the old `n * 9 + 3` for `n = 1..8` (the no-visual-change proof — note n=3 and
  n=6 are the two that catch a sum-then-convert implementation), that
  `laneBands` widths sum back to `roadWidth` minus `ROAD_MARGIN` exactly, that
  `roadWidth([])` is `MIN_ROAD_WIDTH` **and equals `roadWidth([defaultLane(0)])`**
  (pinning the empty-array-is-one-lane semantics rather than an output clamp,
  §2.2), and that a lane with a larger `width`
  widens the road proportionally; the existing `export.test.ts` `strokeAllowance`
  assertions still pass **unchanged**, including `toBe(15)` at `:44`. Plus a
  `bun run dev` check that a drawn 4-lane road shows **no visible change**.
- **Docs touched:** the stale prose of §2.2 — the `strokeAllowance` doc comment
  (`export.tsx:53-57`), the arithmetic comments at `export.test.ts:70` and
  `:139`, and `rules/diagram-export.md:95-101`, all of which describe the old
  `roadWidth(lanes.length)` signature.

### Phase 2 — Road class paints  (depends on Phase 1)

- **Scope:** `RoadShape` emits `road road-${style}` from
  `doc.layout.links[id].style`; the four **colour and line-treatment** rules in
  `src/styles/diagram.css` per §2.3, using the already-declared `--asphalt-2`;
  and `classWidthFactor(style)` in `geometry.ts`, applied **to the per-lane
  widths feeding `laneBands`** (§2.3) so `roadWidth`, the bands, the dividers,
  `edgeInset`, the hit path, the halo, the arrowhead, `junctionArms` and
  `strokeAllowance` all inherit it from one derivation — *not* as a CSS rule,
  which cannot scale a computed `strokeWidth`, and *not* by scaling `w` alone,
  which leaves the band-derived dividers at full width. The
  motorway hard-shoulder line is Phase 4, not here. No new Inspector control —
  the Road class buttons already exist (`Inspector.tsx:117`) and finally do
  something.
- **Exit gate:** `bun run build` + `bun run test` green, with a `Diagram.test.tsx`
  case asserting the class token reaches the markup for each of the four styles
  and that the default (`arterial`) is emitted when a link has no layout entry;
  a `geometry.test.ts` case asserting **every lane band scales exactly** —
  `laneBands(lanes, style)[i].width === classWidthFactor(style) × laneBands(lanes)[i].width`,
  the one form of the width claim that is exact (§2.3) — and one asserting the
  aggregate **lane region** scales to within a float ulp,
  `roadWidth(ramp) − ROAD_MARGIN ≈ factor × (roadWidth(arterial) − ROAD_MARGIN)`,
  *not* `roadWidth(ramp) === factor × roadWidth(arterial)`, which is false at
  every lane count because `ROAD_MARGIN` is unscaled (§2.3); a `Diagram.test.tsx`
  case that both the `edgeInset`-derived edge lines
  **and the `laneBands`-derived dividers** moved with the casing — the dividers
  are the half that a `w`-only implementation gets wrong, so a gate that checks
  the edge lines alone passes on a broken drawing (§2.3) — with no divider
  outside its own edge lines; a case asserting a **1-lane
  ramp is strictly narrower than a 1-lane arterial** (the `MIN_ROAD_WIDTH`
  interaction of §2.2 — an output clamp instead of a lane-count floor makes these
  equal and silently defeats the factor); an `export.test.ts` case asserting the
  class and its CSS rule both reach an exported SVG (proving §2.3's
  no-exporter-change claim for paint), and one that `strokeAllowance` measures a
  road at its own class. Plus a `bun run dev` pass: clicking each Road class
  button changes the drawing — visibly for `local`/`ramp`; `motorway` and
  `arterial` are identical until Phase 4 adds the hard-shoulder line (§2.3's
  table).
- **Docs touched:** `rules/` gains a road-rendering note in Phase 4; none here.

### Phase 3 — Two-way carriageways  (depends on Phase 2)

- **Scope:** `carriageways(doc)` in `geometry.ts` per §2.4 — exact reversed-pair
  detection and the offset formula
  `DRIVE_SIDE * (roadWidth(lanes)/2 + SEPARATION/2)` with
  `SEPARATION = max(SCHEMATIC_MEDIAN, median_gap * UNITS_PER_METRE)`, using
  `DRIVE_SIDE = 1` and `SCHEMATIC_MEDIAN = 6` as resolved in OQ-2/OQ-3. Applied
  via `offsetPolyline`. `Diagram.tsx` offsets each link's polyline before
  drawing. `junctionArms` must use the **offset** polyline too, or the arms of a
  divided road will point at the wrong place. (Junction *interiors* stay on the
  centreline — the accepted limitation in §2.4, OQ-6.)
- **Exit gate:** `bun run build` + `bun run test` green, with vitest cases: a lone
  link gets offset `0`; **each** link of a reversed pair gets a **positive**
  offset of magnitude `roadWidth(own lanes)/2 + SEPARATION/2` (§2.4 — the
  opposition lives in the polyline frame, so an assertion that the two signs
  *differ* is wrong and would drive both carriageways onto the same side); a
  reversed pair with **unequal lane counts** gets unequal magnitudes whose facing
  inner edges are exactly `SEPARATION` apart (the check that the offset clears
  the road's own width, not just the median); a **sign** assertion carrying the
  drive-side check — a link travelling due east is displaced to `+y` under
  `DRIVE_SIDE = 1`, and its westbound twin to `−y` (§2.4's y-down trap, which no
  magnitude test catches); three links on one node pair all
  get `0` (§2.4's explicit non-guess); the offset survives a link with `bends`.
  Plus a `bun run dev` pass drawing two opposing links between one node pair and
  confirming two distinct carriageways with a visible median, with the
  right-hand-traffic side visually correct — and an export of the same,
  confirming the extent grew to cover both (the `strokeAllowance` interaction
  from Phase 1).
- **Docs touched:** none yet.

### Phase 4 — Lane kinds and line semantics  (depends on Phase 3)

- **Scope:** per-lane fill bands from `laneBands` keyed on `Lane.kind` (shoulder
  hatch, bus/cycle tint) and the line treatment table of §2.5, including the
  motorway hard-shoulder line deferred from Phase 2. Flat colour/tint rules go in
  `diagram.css`; the shoulder **hatch `<pattern>` is emitted as conditional
  `<defs>` markup in `Diagram.tsx` and referenced by an inline `fill`**, per
  §2.5 — it cannot live in `diagram.css`. `setLaneKind` in `state.ts` and a
  lane-kind control in `Inspector.tsx` so the field is reachable; `setLinkLanes`
  changed to preserve surviving lanes' `kind`/`width` (§2.5). OQ-4's resolution
  applied: no centreline for undivided two-way roads.
- **Exit gate:** `bun run build` + `bun run test` green, with a `state.test.ts`
  case for `setLaneKind` (including its undo step, per `rules/history.md`) and
  one asserting `setLinkLanes` preserves a shoulder `kind` on lane 0 when the
  count grows and when it shrinks past that index; a `Diagram.test.tsx` case
  asserting a shoulder lane emits its band and a general lane does not, that the
  band sits on the **nearside** (§2.2's lane-0 convention), and that the existing
  empty-document assertion (`Diagram.test.tsx:60-64`, exact
  `'<g class="diagram"></g>'`) still passes — i.e. the `<defs>` is conditional;
  an `export.test.ts` case that a hatched document still satisfies the existing
  `not.toContain("url(")` and no-`[<&]` assertions on the **embedded stylesheet**
  (`:93`, `:99`) while the pattern itself round-trips into the exported markup
  and references nothing external. Plus a `bun run dev` pass setting a lane to
  shoulder and to bus and seeing each render.
- **Docs touched:** new `rules/road-rendering.md` (the lane-band derivation, the
  class-not-inline-style rule and why export depends on it, the carriageway
  pairing rule); a cross-reference from `rules/diagram-export.md` noting that
  `strokeAllowance` now derives from lane widths; add the spec to `CLAUDE.md`'s
  spec list and update the project-memory roadmap.

## 5. Review log

### Round 1 — 2026-07-25 — `VERDICT: NOT READY` (6 blocking)

Clean-room reviewer with repo access. All of the draft's `file:line` citations
verified correct on re-check, and the six `roadWidth` call sites were confirmed
complete with none invented — the author's self-corrections had already landed.
The blockers were design errors, not citation errors.

Blockers fixed:

1. **§2.2's formula was not bit-identical.** `sum(width) * UNITS_PER_METRE` drifts
   in double precision — 30.000000000000004 at n=3, 57.00000000000001 at n=6 —
   failing the existing `export.test.ts:44` `toBe(15)` and Phase 1's own gate.
   Verified independently. Now specified as convert-per-lane-then-sum, exact for
   n=1..8, with the wrong form shown so it is not re-derived.
2. **§2.4's carriageway offset had no road-width term**, so two 4-lane
   carriageways (39 units wide) would still overlap almost completely — the exact
   defect the section exists to fix. Now
   `DRIVE_SIDE * (roadWidth(lanes)/2 + SEPARATION/2)`, with the unequal-lane-count
   case stated and gated.
3. **Phase 3 deferred to OQ-2/OQ-3, which were still open**
   (`spec-authoring.md` §4 forbids a phase
   resting on an unresolved question). Both promoted to `RESOLVED` with concrete
   constants: `DRIVE_SIDE = 1`, `SCHEMATIC_MEDIAN = 6`.
4. **The shoulder hatch cannot live in `diagram.css`**, where §2.6/Phase 4 put it:
   `export.test.ts:93` forbids `url(` in the embedded stylesheet and `:97` forbids
   `<`/`&` anywhere in the file, so neither the `fill: url(#hatch)` nor the
   `<pattern>` was legal. Moved to conditional `<defs>` markup in `Diagram.tsx`;
   the conditionality is required by `Diagram.test.tsx`'s exact empty-document
   assertion.
5. **The lane-index-to-side convention was never stated**, leaving an implementer
   to guess whether a `shoulder` at index 0 renders on the outside or in the
   median. Now pinned: lane 0 is the nearside lane.
6. **The road-class width factor was assigned to CSS, which cannot scale a
   computed `strokeWidth`** — and `w` also drives `edgeInset`, dividers, hit path,
   halo, arrowhead, `junctionArms` and `strokeAllowance`, so a CSS-only factor
   would paint the edge lines outside the casing. Moved to `classWidthFactor` in
   `geometry.ts`.

Open questions closed by reading the source (per `spec-authoring.md` §4):

- **OQ-4 — answered, `no centreline`.** Confirmed no model field distinguishes an
  undivided two-way link from one carriageway of a pair; `median_gap` is the
  near-miss but is default-valued identically on every link ever created, so it
  carries no signal. Recorded as a modelling gap for the ramps spec. (Amended
  2026-07-25: still nothing *derived*, but the modelling gap was not one — see §3
  OQ-4. The markings spec paints it, with no field.)
- **OQ-2 / OQ-3 — resolved** as above. OQ-2's *content* was already adequate; what
  blocked was its form (an open "proposed:") plus an unflagged sign trap:
  `segmentNormals`' "left-hand normals" is y-up maths convention, but SVG's y
  points down, so positive `d` is the visual *right*. Now stated, with a sign
  assertion in Phase 3's gate — magnitude-only tests pass under an inversion.

Non-blocking, accepted: the four-vs-six call-site count; the dropped
`Math.max(1, …)` floor and `MIN_ROAD_WIDTH`'s missing value (12); `setLinkLanes`
wiping `Lane.kind` (folded into Phase 4 — a control whose value an adjacent
control destroys is not a working feature); four stale doc comments scheduled
into Phase 1; "pixel-identical" softened to "no visible change" since nothing in
the loop captures a before image; the §2.3 motorway row's forward reference to
Phase 4; `LaneBand`'s units (world units, and it matters — metres would
reintroduce blocker 1's drift).

Notable rejection: **the junction-interior desync was not folded into Phase 3.**
The finding is real — stop bars and pad radius derive from the junction centre
while offset carriageways move off it — but fixing it means giving `Arm` a
lateral offset and re-deriving the junction glyph, which §2.7 lists as a
non-goal. Recorded as OQ-6 for the ramps/junction spec instead. Also noted
rather than fixed: `Lane.width` stays UI-unreachable after this spec, so §2.2's
proportional-width mechanism is exercised only by hand-edited or imported
documents — §2.2 now says so instead of implying a user-facing feature.

### Round 2 — 2026-07-25 — `VERDICT: NOT READY` (2 blocking)

Same reviewer, resumed. All six round-1 blockers confirmed resolved, and the
lane-0 convention was checked for consistency against §2.4 and §1's example (they
agree: both carriageways of the §1 pair put their index-0 shoulder on the
outside, not in the median). Both new blockers were **introduced by the round-1
fixes** — the failure mode this loop exists to catch.

1. **"Opposite in sign" contradicted the offset formula three lines above it.**
   `carriageways` returns the `d` passed to `offsetPolyline`, which is measured in
   each link's *own* polyline frame — and a reversed twin's segment normal already
   points the other way, so both links take a **positive** offset and still land
   on opposite visual sides. Verified by tracing `offsetPolyline` directly: with
   `d = +25.5`, the eastbound link draws at `y = +25.5` and its westbound twin at
   `y = −25.5`. The danger was concrete, not editorial: Phase 3's gate would have
   required `Math.sign(a) !== Math.sign(b)`, which fails on a correct
   implementation and whose "fix" — negating one twin — puts both carriageways on
   the same side, the exact defect §2.4 exists to remove. §2.4 now explains the
   frame/sign distinction and the gate asserts positive offsets plus the
   `+y`/`−y` drive-side check. Also corrected: with differing `median_gap`s the
   drawn gap is the mean of the two *separations*, not of the two half-medians.
2. **The width factor never reached the lane bands.** §2.3 justified TS
   application by citing the divider offsets at `Diagram.tsx:167` — but Phase 1
   *deletes* that fixed-pitch loop, after which dividers come from `laneBands`,
   which knows nothing about the style. Scaling `w` alone would narrow a `ramp`'s
   casing while its dividers stayed at full width and spilled outside it: the same
   defect §2.3 exists to prevent, relocated by the round-1 fix to blocker 1 of
   round 1. The factor now applies to the per-lane widths feeding `laneBands`, one
   place upstream of every derived quantity, and Phase 2's gate asserts the
   dividers moved with the casing — not just the edge lines, which is the half a
   `w`-only implementation gets right.

Non-blocking, accepted: two citation corrections in round-1 text —
`export.test.ts:99` is the `not.toMatch(/[<&]/)` assertion (`:97` is a comment
line), and `Link` ends at `graph.rs:64`, not `:67`.

### Round 3 — 2026-07-25 — `VERDICT: NOT READY` (1 blocking, partly stale)

Both round-2 blockers confirmed resolved. The reviewer also traced the lane-0 /
`DRIVE_SIDE` / §1 consistency question end to end and found the three agree: both
carriageways of §1's L1/L2 pair put their index-0 shoulder on the outside of the
divided road, not in the median.

One new blocker, `NEW-3`, which bundled three claims. **One was valid and is
fixed; two were already resolved or moot** — recorded here so a later pass does
not reopen them.

**Valid and fixed — the class factor does not scale `roadWidth`.** `ROAD_MARGIN`
is the casing lip, not a lane, so scaling the lane widths leaves it untouched and
`roadWidth(ramp) − factor × roadWidth(arterial) = ROAD_MARGIN × (1 − factor) =
0.6` at every lane count. Verified for n = 1, 2, 4, 8. Phase 2's gate asserted
"casing is `factor` times an arterial's", which is false for every n — and the
only way to force it true is to scale the whole of `w` including the margin, i.e.
the `w`-only implementation round 2 had just forbidden. §2.3 now states that the
factor scales the **lane region** and that `roadWidth` is deliberately not
proportional; Phase 2's gate is restated as
`roadWidth(ramp) − ROAD_MARGIN === factor × (roadWidth(arterial) − ROAD_MARGIN)`,
verified exact at n = 1, 2, 4, 8.

**Rejected as stale — "a 1-lane ramp is floored to 12."** This describes the
output-clamp reading of `MIN_ROAD_WIDTH` that §2.2 had already been rewritten to
forbid (during round 3, before the verdict landed). §2.2 now specifies the floor
on the **lane count** — an empty `lanes` array is one default lane — and gives
this very 1-lane-ramp-at-10.2 case as the reason. Gates in Phase 1
(`roadWidth([]) === roadWidth([defaultLane(0)])`) and Phase 2 (a 1-lane ramp is
strictly narrower than a 1-lane arterial) fail an output clamp.

**Rejected as moot — "`edgeInset` can diverge from the band span."** The finding
was conditional on the floor binding on ordinary documents, which it no longer
does. With the lane-count floor, `w = Σ bands + ROAD_MARGIN` always, so
`edgeInset = w/2 − 1.5 = (w − 3)/2` *is* the band half-span identically, by
construction — as the reviewer itself noted. Deriving `edgeInset` from the band
span instead of from `w` would be a no-op; left as-is rather than churned.

Confirmed clean: Phase 1's no-visual-change proof is unaffected by the factor
(none exists until Phase 2, and `arterial`/`motorway` are 1.0), and
`strokeAllowance` is safe because every existing fixture is built through
`completeLink`, which writes `style: "arterial"` (`state.ts:448`), so
`export.test.ts`'s `toBe(37.5)` and `toBe(15)` survive.

**Round cap reached and escalated.** `specs/spec-authoring.md` §7.6 caps the loop
at three rounds; the third returned NOT READY, so the spec was **escalated to the
human** rather than looped automatically. The outstanding item was not a design
disagreement — the one valid blocker was fixed above, and what was missing was a
confirming round over that fix. The human authorised a bounded round 4 scoped to
that confirmation only.

### Round 4 — 2026-07-25 — `VERDICT: READY` (converged)

Bounded confirming round, human-authorised after the §7.6 cap, scoped to the
round-3 fix rather than a general re-review.

- **NEW-3 confirmed resolved.** The reviewer re-derived the margin identity
  independently — `ROAD_MARGIN × (1 − factor) = 3 × 0.2 = 0.6`, n-independent
  because the margin is a single unscaled additive term — and confirmed it
  against the spec's own figures at n=1 (`10.2 − 9.6`) and n=4 (`31.8 − 31.2`).
- **The restated gate is exact.** `roadWidth(ramp) − ROAD_MARGIN === factor ×
  (roadWidth(arterial) − ROAD_MARGIN)` verified at n = 1, 2, 4, 8, and noted as
  safe from §2.2's float-drift trap because the factor multiplies each lane's
  already-converted width rather than regrouping the sum. The three Phase 2 width
  clauses (lane region, dividers-with-casing, 1-lane-ramp-narrower) are mutually
  consistent.
- **Both round-3 rejections upheld**, including by the reviewer's own account:
  the `MIN_ROAD_WIDTH` claim was stale on its side, and the `edgeInset` change
  would be a literal no-op.
- **No new blocking issue**, and the reviewer looked specifically for the
  fix-breaks-prior-round pattern that had recurred three times. It did not repeat
  here: this edit brought prose and a gate assertion into line with an
  implementation rule already settled in round 3, rather than moving an
  implementation point and leaving dependent text behind — which is what had gone
  wrong each previous time.

**Converged at zero blocking findings.** `status` moves `draft` → `reviewed`; the
spec is cleared for phase planning. Across four rounds: **9 blocking findings, all
resolved**, of which **3 were introduced by fixes to earlier rounds** — the
argument for same-agent re-review rather than a single pass. Two findings were
rejected with reasons recorded above so a later pass does not reopen them.

Open questions left deliberately unresolved, none blocking: **OQ-1** (whether the
class width factor should exist at all — the mechanism is built either way),
**OQ-5** (whether a shoulder counts toward the Inspector's lane count), **OQ-6**
(whether junction interiors follow offset carriageways — deferred to the
ramps/junction spec).

### Phase 2 implementation note — 2026-07-25 — one gate corrected

Not a review round: a correction found while implementing Phase 2, recorded here
so a later pass does not reopen it as a regression.

**Round 4's exactness claim was wrong.** It recorded
`roadWidth(ramp) − ROAD_MARGIN === factor × (roadWidth(arterial) − ROAD_MARGIN)`
as "verified at n = 1, 2, 4, 8". Measured against the implementation, it **fails
at ramp n = 1, 2, 8 and local n = 3, 7**, from two independent float effects:
regrouping (`Σ(wᵢ × f)` ≠ `f × Σ(wᵢ)`) and the margin round trip
(`(region + 3) − 3` ≠ `region`). Neither is avoidable — the alternative grouping,
scaling in metres before converting, drifts at 9 of the 32 (class, n) pairs
instead of 3, and would reintroduce round 1's blocker 1.

The property itself is sound; only its exactness was overstated. §2.3 and Phase
2's gate now assert the **per-lane** identity exactly — `laneBands(lanes,
style)[i].width === factor × laneBands(lanes)[i].width`, exact for every class
and lane width tested — and the aggregate lane-region identity approximately.
The per-lane form is the stronger claim anyway: it is the literal statement of
"applied to the per-lane widths feeding `laneBands`", and the dividers are what a
`w`-only implementation gets wrong.

Same cause, same treatment: `laneBands`' band-contiguity assertion is exact for
default lanes and 1 ulp off under a factor, since a shared boundary is
reconstructed as `offset ± width/2` from either side. A rounding artefact of the
midpoint form, not a gap in the road.

**OQ-1 is now answerable from the shipped code, and the answer is keep it.** The
factor exists and reads correctly: a 4-lane ramp draws at 31.8 against an
arterial's 39, narrow enough to register as a ramp and far too small to be
mistaken for a lane-count difference (a 3-lane ramp is still wider than a 2-lane
motorway, asserted). Left open only in the sense that removing it would now be a
deletion rather than a decision.

### Phase 3 implementation note — 2026-07-25 — two readings recorded

Not a review round: two things settled while implementing Phase 3, recorded so a
later pass does not read either as a deviation.

**The offset's width term is the link's own road class.** §2.4 writes
`roadWidth(link.lanes)`, which predates the `style` parameter Phase 2 added.
`carriagewayOffset` passes `linkStyle(doc, link.id)`, because the step has to
clear the road's *drawn* width and that width carries `classWidthFactor`; the
unclassed width would leave a ramp pair a wider gap than the `SEPARATION` the
formula claims to draw. Confirmed in the running app on an unequal pair (4-lane
eastbound, 3-lane westbound): casings at y = 322.5 and 282, spanning 303–342 and
267–297, so the drawn median is exactly 6 either way.

**A second accepted consequence of the junction limitation.** §2.4 records that
a junction's stop bars stay on the centreline while its carriageways move off
it. The same is true of the **node dots**, which now sit in the median of a
divided road rather than on either carriageway. Same cause — the glyphs are
drawn from the node position, and `Arm` carries no lateral offset — and the same
disposition: OQ-6, the ramps/junction spec.

### Phase 4 implementation note — 2026-07-25 — two readings recorded

Not a review round: two things settled while implementing Phase 4, recorded so a
later pass does not read either as a deviation. The spec converged cleanly here —
neither is a design change, and no gate moved.

**The band is a stroked path, so the hatch is referenced by `stroke`, not
`fill`.** §2.5 says "referenced by an **inline `fill`** attribute on the band".
A lane band can be drawn two ways: a path stroked at the lane's width along the
band centreline, or a filled quad between its two boundary offsets. The stroked
form is the one implemented — it is the same mechanism the casing and the
dividers already use, it reuses `offsetPolyline` rather than building a polygon
that self-intersects at bends, and SVG accepts a paint server on `stroke` as
readily as on `fill`. §2.5's intent is untouched and is what the constraint was
actually about: **the `url()` lives in markup, never in `diagram.css`**, because
`export.test.ts` forbids both `url(` and `<` there. Only the attribute differs.

A related trap found in the same pass, worth recording because it is invisible
until a test runs: **the pattern's stroke cannot be an inline `var()` either.**
CSS custom properties do not resolve inside a *presentation attribute*, so the
pattern's own line takes a class (`.road-hatch-line`) whose rule lives in
`diagram.css` and travels inside an exported file like every other. The pattern
is still self-contained; it just reaches the palette the same way the rest of the
drawing does. And a second one: an explanatory comment mentioning the forbidden
construct *by name* fails `export.test.ts`'s `not.toContain("url(")` on sight —
the assertion reads the file, not its CSS. `diagram.css` cannot discuss the rule
it is subject to using the literal token.

**Motorway and arterial still draw identically without a shoulder lane.** Phase
2's gate said they were "identical until Phase 4 adds the hard-shoulder line",
which reads as a promise that Phase 4 separates the two classes outright. It does
not, and §2.3/§2.5 together are why: §2.3's table gives motorway the *same*
solid white edge as arterial and defers its one distinguishing mark to §2.5,
where the hard-shoulder line is a property of the **lane**, not the class. So a
motorway carrying a `shoulder` lane draws its solid shoulder line and an arterial
without one does not — and a motorway without one is an arterial to look at.
Confirmed as the intended reading with the human before implementing rather than
resolved by inventing a class-driven motorway treatment the spec never took
through review. Recorded here because "the Road class buttons still do nothing
for motorway" is the kind of thing a later pass would otherwise file as a bug.

**Verified in the running app, not only under vitest.** The two DOM-bound export
functions have no unit test by construction (no jsdom), and a paint-server
reference is exactly the sort of thing that passes a string assertion and fails
in a browser. A 5-lane road with lane 0 = shoulder and lane 2 = bus was drawn,
exported, and **rasterized to real PNG bytes** — the hatch renders, the file's
only `url()` is the in-document fragment, and `toBlob` does not return `null`, so
an internal fragment reference does not taint the canvas the way an external one
would. `rules/diagram-export.md` now records that under its standing constraints
so the reference is not "fixed" away later.
