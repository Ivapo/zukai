---
status: draft
last_updated: 2026-07-25
note: Make the drawn road honour the road model — class, lane widths, lane kinds, and two-way carriageways that don't sit on top of each other.
implemented: []
not_implemented: ["Phase 1", "Phase 2", "Phase 3", "Phase 4"]
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
  L4  ramp, 1 lane                               → narrowest, tapered class
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
| `Link.median_gap` (`graph.rs:61-63`) | "Gap to the opposing carriageway centreline" | ❌ 0 refs outside `state.ts` |

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

export interface LaneBand { offset: number; width: number; }  // offset = band centre

export function laneBands(lanes: Lane[]): LaneBand[]
export function roadWidth(lanes: Lane[]): number   // sum(width) * UNITS_PER_METRE + ROAD_MARGIN
```

**`UNITS_PER_METRE` is chosen so today's picture is the baseline**, not a
redesign: `DEFAULT_LANE_WIDTH` is 3.5 m (`document.ts:18`, `graph.rs` 
`default_lane_width`), so a document of default lanes gives
`n * 3.5 * (9/3.5) + 3 = n * 9 + 3` — bit-identical to `roadWidth(n)` today. A
lane the user widens then draws wider, ordinally faithful without the schematic
becoming to-scale (`CLAUDE.md`: "not necessarily to scale").

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

### 2.3 Road class paints, it does not resize (decision, recorded)

`LinkStyle` drives **colour and line treatment, plus a modest width factor** — it
must not become the dominant width term, because road width is how a reader
counts lanes. A 2-lane motorway must still look narrower than a 4-lane local
road, or the drawing lies about lane count.

The mechanism is a class on the road group, not inline attributes:
`<g className="road road-motorway">`, with the rules in
`src/styles/diagram.css`. That choice is load-bearing for export — `diagram.css`
is embedded verbatim in every exported SVG (`rules/diagram-export.md`, "The paint
travels inside the file"), so a class-driven style reaches an exported file with
**no exporter change at all**, whereas a computed inline colour would need the
export path to know about road classes.

Proposed treatment (the palette already has the variables it needs):

| Class | Casing | Width factor | Edge line |
|---|---|---|---|
| `motorway` | `--asphalt` | 1.0 | solid `--paint-white`, plus a hard-shoulder line when lane 0 is a shoulder (§2.5) |
| `arterial` (default) | `--asphalt` | 1.0 | solid `--paint-white` |
| `local` | `--asphalt-2` (already defined, currently unused) | 0.9 | solid, thinner |
| `ramp` | `--asphalt-2` | 0.8 | solid, thinner |

`--asphalt-2` exists in `diagram.css:25` and is referenced by nothing today —
this is what it was declared for.

### 2.4 Two-way roads: two links, drawn side by side (decision, recorded)

Two links between the same node pair in opposite directions are one two-way road.
Today they render on the same centreline and are literally invisible as two.

`carriageways(doc)` returns, per link, the lateral offset to apply to its
polyline before drawing — `0` for a link with no opposing twin, and `±half the
carriageway separation` for a link that has one. `offsetPolyline`
(`geometry.ts:97`) already does the offsetting, including through `bends`.

Pairing rule: **exact reversed node pair** (`a.from === b.to && a.to === b.from`).
Not "roughly parallel links" — that is a heuristic that will mis-pair a slip road
running alongside a mainline, and a schematic's whole point is that the human
placed things deliberately.

Two traps:

- **Which side each carriageway takes depends on which side of the road the
  country drives on.** Offsetting each link to the right of its own travel
  direction is correct for right-hand traffic and wrong for left-hand. This is
  OQ-2, and it is the one question here that a reader of the drawing would
  actually notice.
- **`median_gap` is metres and tiny.** Its default is 0.5 m (`graph.rs`
  `default_median_gap`), which at `UNITS_PER_METRE` is ~1.3 units — thinner than
  the 1.5-unit edge line, i.e. invisible. It cannot be used literally as the
  drawn separation; §OQ-3 settles how it maps.

More than two links on the same node pair (a divided road plus a parallel
service road) is left alone — offset `0` for all of them, so the existing
behaviour is preserved rather than a guess being made.

### 2.5 Lane kinds and line semantics (decision, recorded)

Today every divider is the same dashed white line (`.road-divider`,
`diagram.css:58`) and there is no distinction between the outermost line and an
interior one — but in a real schematic the line *is* the meaning:

| Line | Meaning | Style |
|---|---|---|
| Edge line | Carriageway edge | solid, already `.road-edge` |
| Lane divider | Lanes, same direction | dashed, already `.road-divider` |
| Shoulder line | Hard shoulder boundary | solid, wider gap |
| Centreline | Undivided two-way (no opposing link) | to be decided — OQ-4 |

And `Lane.kind` gets a fill band behind the lane: `shoulder` hatched,
`bus`/`cycle` tinted, `turn` left plain. Rendering a band per lane is what
`laneBands` (§2.2) exists to make cheap — the band is `{offset, width}` already.

Setting a lane's kind needs an Inspector control; without one the field is
unreachable from the UI and the rendering is dead code. That is Phase 4 scope,
and it is the only new reducer action in this spec (`setLaneKind`).

### 2.6 Where the logic lives

Mirrors the split the export spec established (`rules/diagram-export.md`, "Pure,
DOM, Tauri"):

| Piece | Where | Pure? |
|---|---|---|
| `laneBands`, `roadWidth`, `UNITS_PER_METRE` | `src/editor/geometry.ts` | ✅ vitest |
| `carriageways(doc)` | `src/editor/geometry.ts` | ✅ vitest |
| `RoadShape` and the road classes | `src/components/Diagram.tsx` | ✅ via `renderToStaticMarkup` |
| Every paint rule | `src/styles/diagram.css` | — reaches exports free (§2.3) |
| `setLaneKind` | `src/editor/state.ts` | ✅ vitest |

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
  build-wide constant? (design-call, **blocks Phase 3's correctness claim**;
  proposed: a single `DRIVE_SIDE` constant defaulting to right-hand traffic, with
  a document field deferred until someone draws a left-hand-traffic network.)
- **OQ-3** — How does `median_gap` (metres, default 0.5) map to drawn separation
  when a literal conversion is ~1.3 units and invisible (§2.4)? (design-call;
  proposed: drawn separation is `max(SCHEMATIC_MEDIAN, median_gap *
  UNITS_PER_METRE)` so the field is honoured ordinally when a user sets a real
  motorway median, and still readable at the default.)
- **OQ-4** — Does an undivided two-way road (a single link the user thinks of as
  two-way, with no opposing twin) get a centreline? The model has no way to say
  "this one link is two-way" (§2.1), so there may be nothing to key it off.
  (answerable-from-code — resolve during review by checking whether any existing
  field distinguishes it; if none does, the answer is "no centreline, and note it
  as a modelling gap for the ramps spec".)
- **OQ-5** — Should `LaneKind::Shoulder` count toward the lane count shown to the
  user in the Inspector (`Lanes` +/-)? A 4-lane motorway with a hard shoulder is
  "4 lanes" to a road engineer, but `lanes.length` would be 5. (design-call;
  proposed: leave the counter as `lanes.length` and revisit if it reads wrong.)

## 4. Implementation phases

Strictly sequential; each is one plan-mode pass with a concrete exit gate.

### Phase 1 — Lane geometry from the model

- **Scope:** `UNITS_PER_METRE`, `LaneBand`, `laneBands(lanes)`, and
  `roadWidth(lanes: Lane[])` in `src/editor/geometry.ts`, replacing
  `roadWidth(laneCount)`. Update all four call sites of §2.2 — `RoadShape`
  (`Diagram.tsx:158`), `junctionArms` (`Diagram.tsx:138`), the `roadWidth(1)`
  fallback (`Diagram.tsx:269`, becoming `MIN_ROAD_WIDTH`), **`strokeAllowance`
  (`export.tsx`)**, and the two `export.test.ts` assertions (`:56`, `:59`) — kept
  asserting the same property, not weakened to compile. `RoadShape`'s divider loop
  derives offsets from `laneBands` instead of the fixed pitch. No visual change
  for default documents, no new model fields, no CSS.
- **Exit gate:** `bun run build` + `bun run test` green, with vitest cases
  asserting `roadWidth` of `n` default lanes equals the old `n * 9 + 3` for
  `n = 1..8` (the no-visual-change proof), that `laneBands` centres sum back to
  the road width, and that a widened lane widens the road proportionally; the
  existing `export.test.ts` `strokeAllowance` assertions still pass unchanged.
  Plus a `bun run dev` check that a drawn 4-lane road is pixel-identical to
  before.
- **Docs touched:** none — no behaviour change yet.

### Phase 2 — Road class paints  (depends on Phase 1)

- **Scope:** `RoadShape` emits `road road-${style}` from
  `doc.layout.links[id].style`; the four class rules plus the width factor in
  `src/styles/diagram.css` per §2.3, using the already-declared `--asphalt-2`.
  No new Inspector control — the Road class buttons already exist
  (`Inspector.tsx:117`) and finally do something.
- **Exit gate:** `bun run build` + `bun run test` green, with a `Diagram.test.tsx`
  case asserting the class token reaches the markup for each of the four styles
  and that the default (`arterial`) is emitted when a link has no layout entry;
  an `export.test.ts` case asserting the class and its CSS rule both reach an
  exported SVG (proving §2.3's no-exporter-change claim). Plus a `bun run dev`
  pass: clicking each Road class button visibly changes the drawing.
- **Docs touched:** `rules/` gains a road-rendering note in Phase 4; none here.

### Phase 3 — Two-way carriageways  (depends on Phase 2)

- **Scope:** `carriageways(doc)` in `geometry.ts` per §2.4 — exact reversed-pair
  detection, lateral offset per link via `offsetPolyline`, `DRIVE_SIDE` and the
  `median_gap` mapping settled by OQ-2/OQ-3. `Diagram.tsx` offsets each link's
  polyline before drawing. `junctionArms` must use the **offset** polyline too,
  or the arms of a divided road will point at the wrong place.
- **Exit gate:** `bun run build` + `bun run test` green, with vitest cases: a lone
  link gets offset `0`; a reversed pair gets equal and opposite offsets; three
  links on one node pair all get `0` (§2.4's explicit non-guess); the offset
  survives a link with `bends`. Plus a `bun run dev` pass drawing two opposing
  links between one node pair and confirming two distinct carriageways with a
  visible median — and an export of the same, confirming the extent grew to
  cover both (the `strokeAllowance` interaction from Phase 1).
- **Docs touched:** none yet.

### Phase 4 — Lane kinds and line semantics  (depends on Phase 3)

- **Scope:** per-lane fill bands from `laneBands` keyed on `Lane.kind` (shoulder
  hatch, bus/cycle tint) and the line treatment table of §2.5, all as
  `diagram.css` rules; `setLaneKind` in `state.ts` and a lane-kind control in
  `Inspector.tsx` so the field is reachable; OQ-4's centreline decision applied.
- **Exit gate:** `bun run build` + `bun run test` green, with a `state.test.ts`
  case for `setLaneKind` (including its undo step, per `rules/history.md`) and a
  `Diagram.test.tsx` case asserting a shoulder lane emits its band and a
  general lane does not; an `export.test.ts` case that the hatch pattern is
  self-contained (no external reference — `rules/diagram-export.md`'s standing
  constraint, since a `<pattern>` is the obvious way to hatch and must be defined
  inline). Plus a `bun run dev` pass setting a lane to shoulder and to bus and
  seeing each render.
- **Docs touched:** new `rules/road-rendering.md` (the lane-band derivation, the
  class-not-inline-style rule and why export depends on it, the carriageway
  pairing rule); a cross-reference from `rules/diagram-export.md` noting that
  `strokeAllowance` now derives from lane widths; add the spec to `CLAUDE.md`'s
  spec list and update the project-memory roadmap.

## 5. Review log

_(none yet — `status: draft`; must pass `specs/spec-authoring.md` §7 before any
phase is planned.)_
