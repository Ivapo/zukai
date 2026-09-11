---
id: zk-016
title: bus-stops
note: >
  Draw a bus stop where buses stop — a box lettered BUS in the kerb lane, or
  pulled into a bay that widens the road beside it — as a marking kind rather
  than a new object, after the edge line learns to stop for a bay.
status: accepted
last_updated: 2026-09-11

phases:
  - name: "Phase 1 — A bus stop in the kerb lane"
    reviewed: 2026-09-11
    shipped: 2026-09-11
    cut: null
    by: null
  - name: "Phase 2 — A bus stop in a bay"
    reviewed: 2026-09-11
    shipped: 2026-09-11
    cut: null
    by: null

extends: null
supersedes: null
superseded_by: null
related: [zk-004, zk-005, zk-006, zk-007, zk-011, zk-014]
reference: "How road atlases and street-design manuals draw a kerbside bus stop: a marked box in the nearside lane lettered BUS, or a lay-by with a tapered entry and exit beside the running lane. Not a transit model — no routes, stop names, dwell times or platforms — and not to-scale stop geometry."
---

# Bus Stops Spec

## 1. Goal

**Nothing in Zukai's vocabulary says "a bus stops here".** The nearest thing is a
`text` marking reading `BUS`, which is a word on the road rather than a stop, and a
bay cannot be drawn at all: a road's width changes only at a node where exactly two
links meet (`rules/road-joints.md`, tapers), so a lay-by partway along a link would
mean splitting the link at two waypoints — which triples its length labels and
direction arrows and, on a two-way road, breaks the carriageway pairing unless the
opposite link is split at the same nodes (`geometry.ts:carriageways` pairs on an
exact reversed node pair).

The observable is the drawn network, in the app and in an exported figure.

End state — an eastbound road, kerb side below, with a stop drawn each way:

```
  in the kerb lane (Phase 1) — two end bars and the word, between the
  dashed lane divider and the kerb edge line

  ─────────────────────────────────
                  ▶
  ─ ─ ─ ─ ─ ─ ┬ ─ ─ ─ ─ ─ ┬ ─ ─ ─ ─
              │    BUS    │
  ────────────┴───────────┴────────

  in a bay (Phase 2) — the kerb edge opens into a dashed mouth, and the
  end bars span from it to the bay's outer edge line

  ─────────────────────────────────────
                    ▶
  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─

  ────────╲ ─ ┬ ─ ─ ─ ─ ─ ┬ ─ ╱────────
           ╲  │    BUS    │  ╱
            ╲─┴───────────┴─╱
```

Drawn from the document a human would build by clicking a road with the Marking
tool and repainting what lands:

```yaml
markings:
  - id: M4
    link: L2
    position: 42.0
    kind:
      type: bus_stop
      form: bay          # or in_lane
```

### 1.1 Non-goals

- **A transit model.** No routes, stop names, dwell times or platforms.
  `network.yaml` has no bus stop concept, so import reads nothing new and
  `rules/network-yaml.md`'s import sections are untouched.
- **Offside and median stops** — island platforms, BRT stations. A stop is at the
  kerb (§2.4).
- **An editable stop length** (OQ-2). A stop is drawn at one schematic length.
- **A roadside bus stop sign** (OQ-3). The painted word carries the meaning.
- **Kerb build-outs, shelters, boarders**, and a stop spanning a node or sitting on
  a junction pad.
- **Content-aware versioning.** A save declares the version of the build that wrote
  it, not the oldest version its content needs (§2.3.1).
- **`hatching`**, which stays out for the reason `rules/marking-kinds.md` gives.

## 2. Design

### 2.1 A new spec, and not a phase of the markings spec (decision, recorded)

`spec-authoring.md` §6.1, in order. No shipped work is removed (step 1). The
subject is not one spec's: a stop *is* a marking kind (§2.2), which
`road_markings_spec.md` (zk-006) owns — but Phase 2 cuts the road's edge line,
which `road_rendering_spec.md` (zk-004) owns, and draws asphalt in the wedge layer
`ramps_and_tapers_spec.md` (zk-005) built, and the markings spec's own note says
**paint only**. Work spanning three subsystems is a new spec by §6.1's closing rule,
and zk-006 reserved no framework for `extends` to name (step 3). So `extends: null`,
and `related` records what this reuses rather than redesigns.

### 2.2 A bus stop is a marking kind, not a new object (decision, recorded)

A stop is positioned **exactly** as a marking is: one link, a distance along it in
metres, and which end that distance is measured from (`decoration.rs:Marking`).
Everything a stop needs around that already exists for markings, and a new
top-level object would rebuild each piece:

- placement from a click and dragging along the road (`Canvas.tsx:projectOntoLink`);
- the Paint picker and the Anchor row (`Inspector.tsx:MARKING_PICKER`,
  `Inspector.tsx:MarkingAnchorPicker`);
- one undo step per edit (`state.ts:setMarkingKind`);
- removal when its link or node goes, or its lanes shrink (`state.ts:keepMarkings`);
- the marking layer, its hit target and halo, and export (`Diagram.tsx:MarkingShape`).

A new object would also need a sixth `Selection` arm. The `never`-checked switches
make a missing arm a compile error where they exist, but `rules/road-markings.md`
names what they leave unpoliced — the Inspector, and every call to `isSelected` —
and a marking kind adds no arm at all. `hatching` is not a counterexample: it is an
*area* between links, where `rules/marking-kinds.md`'s own test is that "the
`Marking` anchor is one link at one position" — which a stop is.

### 2.3 One variant with a `form`, and the version bump it costs (decision, recorded)

```ts
// src/model/types.ts
| { type: "bus_stop"; form: StopForm }
export type StopForm = "in_lane" | "bay";
```

```rust
// src-tauri/src/model/decoration.rs, inside MarkingKind
/// A kerbside bus stop, in the nearside lane or pulled into a bay beside it.
BusStop { form: StopForm },

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopForm { InLane, Bay }
```

**One variant with a payload, not two variants**, on `decoration.rs:LineStyle`'s
model and with its derives: `form: bay` reads as `style: dashed` does, switching
form is one payload control dispatching `setMarkingKind` (as
`Inspector.tsx:MarkingLineStyle` is), and the stop's identity does not change with
its form. An enum rather than a boolean so the YAML names what it means.

**A new variant moves `SCHEMA_VERSION` from 2 to 3.** An older build fails to
deserialize the *whole document* on an unknown variant, and `persist.rs`'s probe
rejects only files that declare a newer version, so it can say something readable
only if the version moves with the variant (`rules/document-model.md`) — and only if
a save *declares* it, which today it does not (§2.3.1). The `form` field arrives with
the variant in Phase 1, so the bump happens once even though Phase 2 is what draws a
bay. Everything that moves with it, all in Phase 1:

- the two constants, `src-tauri/src/model/mod.rs:SCHEMA_VERSION` and
  `src/model/types.ts:SCHEMA_VERSION`, and their doc comments;
- `persist.rs:encode`, which stamps the version (§2.3.1);
- `persist.rs:rejects_a_newer_schema_version`, whose fixture writes
  `schema_version: 3` and must go to **4** — its own doc comment says why: left
  behind the constant it stops testing anything, silently;
- **four tests that pin the literal 2** (OQ-6, resolved):
  `persist.rs:saves_at_the_current_schema_version`,
  `persist.rs:a_zkai_with_the_retired_glyph_loads_as_generic_and_resaves_clean`,
  `mod.rs:a_zkai_saved_with_movements_still_loads_and_writes_none` and
  `mod.rs:an_unstated_length_writes_no_key`. The first becomes the one deliberate
  pin, now on 3. The other three drop their `assert_eq!(SCHEMA_VERSION, 2)` and keep
  every behavioural assertion, and the retired-glyph test's resave asserts it
  declares the *current* version — which §2.3.1 makes true;
- the goldens `src-tauri/tests/fixtures/golden/cross-4.zkai` and
  `cross-4.document.json`, which are this build's own output and each carry
  `schema_version: 2`. Regenerated by the directory's documented opt-in
  (`cd src-tauri && ZUKAI_UPDATE_GOLDEN=1 cargo test`), and the diff read before
  committing: **one version line per file and nothing else**.
  `src/editor/wasm.test.ts` reads both;
- comments that name version 2 as current: the doc comments of
  `persist.rs:still_loads_a_version_1_file`, of the retired-glyph test, and of
  `import.rs:a_zkai_document_is_not_a_network`.

What does **not** move: `src-tauri/tests/fixtures/zkai/t-junction-glyph.zkai`,
which is a record of an older file and must still open as one, and
`examples/*.zkai`, which declare 2 and load as older files do.

#### 2.3.1 A save declares the version this build writes (decision, recorded)

**Today a file's version never moves once it is written.** `persist.rs:encode` is
`serde_yaml::to_string` of the document as it stands, and both ways in keep the
file's own `schema_version`: `persist.rs:decode` parses it through, and
`document.ts:normalizeDocument` copies `raw.schema_version` — pinned by
`persist.rs:still_loads_a_version_1_file` and `document.test.ts`. Only a document
Zukai itself creates starts at the constant — a new one (`document.ts:emptyDocument`)
or an imported one (`Document::new`). So open any
`examples/*.zkai`, add a stop, save, and the file declares 2 while carrying
`bus_stop`: an older build passes it at the probe and fails inside serde, which is
the failure the bump exists to prevent. **This is not new** — a version-1 file given
a `gore` glyph already saves declaring 1 — but it is the first bump since that
would otherwise be decorative for every file that already exists.

**`encode` writes `SCHEMA_VERSION`, whatever the document holds.** Three placements
were weighed:

- **In `encode`** — chosen. Both shells call it, `persist.rs:save_document` on the
  desktop and the wasm shell in `src-tauri/src/wasm.rs` in a browser, so one line
  covers both hosts. Of the two goldens only `cross-4.zkai` is `encode`'s output;
  `cross-4.document.json` is the importer's JSON, carrying the constant through
  `Document::new`.
- **In `decode` or `normalizeDocument`** — rejected: it breaks the two pins that a
  load keeps a file's version, and a document's in-memory version is not what an
  older build ever sees.
- **As a serde attribute on the field** — rejected: the same struct crosses Tauri's
  IPC and the wasm boundary as JSON on load, where the file's own version has to
  survive.

**The cost, accepted:** a file merely opened and re-saved by a newer build declares
the newer version, so an older build refuses a file it could have read — with a
readable message rather than a serde failure, which is the safe direction.

### 2.4 A stop is kerbside, and ignores `lane` (decision, recorded)

A bus stops at the kerb, so a stop always takes the **nearside band** — index 0 of
`geometry.ts:laneBands`, at the most positive offset (`rules/road-rendering.md`) —
whatever `Marking.lane` holds. Two alternatives were rejected:

- **Honouring `lane`.** A stop box in lane 2 of a three-lane road means nothing, and
  it is reachable: a marking placed by a click in lane 2 keeps that lane when
  repainted, because `setMarkingKind` never names `lane`.
- **Enforcing it by holding `lane` at 0 in every writer.** A drag writes `lane` from
  `geometry.ts:bandAt`, a repaint keeps it, and a hand-edited file says anything, so
  the rule would hold only while every writer agreed. The cascade and the drag below
  do clear a stop's `lane`, but as **housekeeping** — so a stale value cannot outlive
  a change of kind — never as the rule: the span line ignores `lane` whatever any
  writer left there.

The rule lives where the turn arrow's already does: **`geometry.ts:markingAnchor`'s
kind-aware span line**, widened from "a lane-less `turn_arrow` takes the nearside
band" to "…and a `bus_stop` always does" — and **the stop term is evaluated before
the out-of-range-lane skip**, so no `lane` value can make a stop undrawable. It stays
**one** site, so the hit target and halo move with the paint, which is why the turn
arrow's rule was put there. Consequences:

- **The Span control is withheld for a stop** (`Inspector.tsx:MarkingSpan`), as the
  Anchor row is withheld for a lane line.
- **A drag writes no `lane` for a stop.** The drag's lane is kind-aware in one place
  (`Canvas.tsx`, where a `lane_line` already resolves through `boundaryAt`), and a
  stop resolves to `undefined`. Otherwise a drag straight across the lanes changes a
  `lane` nothing reads, and `state.ts:moveMarking` — which compares `lane` — dirties
  the document and records an undo step that draws nothing different.
- **The lane-shrink cascade keeps a stop, and clears a `lane` it has outgrown.**
  `state.ts:setLinkLanes` drops every marking on the link whose `lane` is at or past
  the new count — right for paint, which `rules/road-markings.md` drops rather than
  clamps so it never silently moves lanes. A stop never moves lanes, so dropping one
  for a `lane` it ignores is data loss. But *keeping* the stale `lane` is worse: a
  stop clicked into lane 2, its road narrowed to two lanes, then repainted as a stop
  line, becomes a marking `markingAnchor` skips — undrawn, unclickable, with no Span
  control shown while it was a stop — breaking `markingAnchor`'s own promise that
  the cascades cover every edit the app can make. So a kept stop whose `lane` is at
  or past the new count loses the key, and `doc.markings` stays **identical by
  reference** when nothing changes, as `keepMarkings` keeps it today.
- **On a two-way road** each carriageway's nearside is the side *away* from the
  shared centreline, because `geometry.ts:carriageways` steps each twin out by a
  positive offset in its own frame — the fact `geometry.ts:lengthLabel` already
  rests on — so each direction's stop lands at its own kerb, never in the median.
- **On a road whose lane 0 is a `shoulder`**, a stop paints over the hatch (OQ-7).

### 2.5 A stop has a drawn length, not a measured one (decision, recorded)

No marking has an extent today: `geometry.ts:markingForm` draws a marking either
`across` the road at a point or `along` it for the whole link. A stop needs a
stretch. **Its length is a build constant, `BUS_STOP_LENGTH`**, in the manner of
`geometry.ts:CROSSWALK_DEPTH` and `geometry.ts:TAPER_LENGTH`, and not a model field:

- **`CLAUDE.md`'s founding rule.** A number is an annotation, not a measurement of
  the drawing. A stop box is a symbol of a stop, as a sign is a symbol and not a
  scale model (signs spec §2.7).
- **The metre/unit boundary is exactly two functions** — `projectOntoLink` and
  `markingAnchor` (`rules/road-markings.md`). A stored length would be a second
  metres quantity with a third site to convert it.
- **Deferring it costs nothing.** A new *optional* field costs no version bump
  (`rules/document-model.md`), so if a figure turns out to need a long or short
  stop, the field can arrive later for free (OQ-2).

Starting value `5 * LANE_PX` (45 units), settled in the app as every marking
constant has been.

### 2.6 A stretch of the road, measured where the anchor already measured it

A stop follows the road: **on a bent link its footprint is a stretch of the drawn
polyline between two distances**, not a straight rectangle at the anchor. That
stretch places the box's two ends and its hit spine in Phase 1, and the bay's
asphalt, lines and edge-line cut in Phase 2 — a straight footprint beside a bend
visibly leaves its lane, and a bay's, the box plus a `TAPER_LENGTH` each end and 93
units long, more so. Two additions to `geometry.ts`:

- **`MarkingAnchor` gains `distance`**: the clamped distance, in world units from the
  polyline's start, at which `pointAlongPolyline` put `at`. `markingAnchor` computes
  the raw distance and the clamp happens inside `pointAlongPolyline`, so `distance`
  is that raw value clamped to `[0, polylineLength]` — the same clamp, applied where
  it can be returned. It is what keeps the conversion in one place: a stop's builder
  works in world units from `distance` and never touches `position`. Named
  `distance` rather than `along` because `MarkingForm` already has an `along` arm and
  `MarkingShape` branches on it. **Required, not optional**: the five hand-built
  `MarkingAnchor` literals in `geometry.test.ts` — four helpers and one test body —
  gain it, and the typecheck lists them.
- **A new `polylineStretch(points, from, to)`**: the sub-polyline between two
  distances, clamped to the polyline, walking the same `SAME_EDGE`-filtered
  segments `pointAlongPolyline` and `polylineLength` walk, so the three agree about
  distance *exactly* — the reason `geometry.ts:polylineLength`'s own comment gives
  for sharing that walk. Nothing like it exists: no function in `geometry.ts` takes
  two distances.

**Cut the drawn polyline, then offset it — never the reverse.** Offsetting changes
arc length unevenly at a bend: on `link_bends_spec.md` §2.6's
`A(0,0)→B(50,0)→C(50,150)` at offset 13.5, the interior vertex sits at 0.211 of the
offset polyline's length against 0.250 of the base polyline's, so a distance
measured on one names a different point on the other. Every piece below is
`offsetPolyline(polylineStretch(points, a, b), d)`.

**The footprint slides to fit** (OQ-4, resolved). A stop's footprint reaches `h`
either side of its centre — `h = BUS_STOP_LENGTH / 2` in the lane,
`BUS_STOP_LENGTH / 2 + TAPER_LENGTH` for a bay, which in Phase 1 still draws in the
lane and so takes the in-lane reach until Phase 2 draws its bay. Its **centre** is
`distance` clamped
into `[h, total − h]`, or `total / 2` on a road shorter than `2h`, where `total` is
`polylineLength`; every stretch below is measured from that centre, never from
`distance`. So a stop dragged to a road's end stays whole with its word centred,
where a clamped stretch would draw half a box with its word at the box's edge — and,
on a road shortened past the stop, a box of no length. `position` is untouched: the
slide is how a stop is drawn, not what is stored.

### 2.7 The in-lane form: a box and a word

`markingForm` gains a third arm, `{ stop: BusStopShape }`, where

```ts
interface BusStopShape {
  ends: [Vec2, Vec2][]; // the box's two ends; its long sides are the road's own lines
  word: TextRun;        // BUS
  spine: Vec2[];        // the hit target's and the halo's path
  width: number;        // what the spine is stroked at
}
```

and the two existing arms gain `stop?: never`. **`MarkingShape`'s and `haloWidth`'s
tests on `form.along` are two-way today** (`form.along ? … : markingBar(form.across)`,
`if (!form.along) return 9`), so both become three-way and check `form.stop` first —
left two-way, a stop reaches `markingBar(undefined)` or a halo sized for a bar.
`MarkingShape` draws the arm:

- **The box's two ends**: `geometry.ts:markingBar` of an anchor at each end of the
  stretch, `centre ± L/2`, across band 0's span — a `.marking-stop-ends` path of two
  bars. **The box draws no long side** (§2.7.1): band 0's kerb edge lies on the
  road's edge line (the lane region's edge is `edgeInset`) and its other edge on the
  lane divider, so those two lines are the box's sides. Nothing is filled, so a
  `bus` lane's `.lane-band-bus` tint shows through.
- **The word `BUS`**: `geometry.ts:markingText` of an anchor at the footprint's
  centre — `pointAlongPolyline(points, centre)` with band 0's span — emitted as
  `markingPaint`'s `text` arm emits a run, the same element and class a `text`
  marking reading `BUS` paints. It reads as road paint because it is road paint.
- **`Diagram.tsx:needsText` must count a stop.** The export embeds the font only
  when the document has something it emits a `<text>` for, and today that is a
  non-empty `text` marking, a sign or a stated length. Missing the stop passes every
  canvas test and exports a figure whose `BUS` falls back to whatever face the
  viewer has — or, in the PNG path, bakes that substitution in for good
  (`rules/marking-kinds.md`, text).
- **The hit target and halo are the box**, not `geometry.ts:markingBar`'s bar across
  the middle, which would leave most of a 45-unit box unclickable. The spine is the
  box's stretch at band 0's centre offset, stroked band 0's width — a rectangle, on
  the lane line's spine model — and the halo is the same path stroked `width + 6`,
  the margin `.road-halo`'s `w + 6` uses, butt-capped as `.marking-halo` already is.

The class token `marking-bus-stop` falls out of `MarkingShape`'s existing
`kind.type.replace(/_/g, "-")`.

#### 2.7.1 The box draws its ends, and the road draws its sides (decision, recorded)

A stop's box has two long sides, and both already exist as lines on the road: in
the lane, the kerb edge line and the divider to the next lane; in a bay, the bay's
outer edge line and the dashed mouth line (§2.8, §2.9). **A long side the box drew
itself would land exactly on one of those lines**, and on the traffic side that
line is dashed — so a solid box side paints "do not cross" over the one line a bus
has to cross to reach the stop, which is the reason §2.9 cuts the edge line in the
first place. Drawing the sides just *beside* the lines instead doubles every line
the box runs along. So the box paints only its two ends and the word, and reads as
a box because the road's own lines close it. A line to borrow always exists: on a
one-lane road band 0's other edge is the offside edge line, and where a human's lane
line has replaced the divider, that lane line draws the boundary instead.

### 2.8 The bay: asphalt beside the road, with the stop moved into it

In the drawn polyline's frame, with `w` the road's drawn width (`geometry.ts:roadWidth`,
casing lip included), `e = w / 2` its casing edge, `b` band 0's width,
`L = BUS_STOP_LENGTH`, `T = TAPER_LENGTH` and `s` the footprint's centre (§2.6):

- **The bay's asphalt is one polygon**: the casing edge
  `offsetPolyline(polylineStretch(points, s − L/2 − T, s + L/2 + T), e)`, then the
  outer edge `offsetPolyline(polylineStretch(points, s − L/2, s + L/2), e + b)`
  reversed, closed. The two closing segments are the tapers, `TAPER_LENGTH` long
  along the road as every taper in the drawing is.
- **Its outer edge line** is that outer boundary inset 1.5, the inset
  `RoadShape`'s `edgeInset = w / 2 − 1.5` uses. Each taper's line is
  `geometry.ts:taperEdge` of `[outer corner at s ∓ L/2, casing edge at s ∓ L/2,
  casing edge at s ∓ (L/2 + T)]`: the hypotenuse runs from the first corner to the
  third and is inset toward the second, the corner off the hypotenuse. Where the
  inset taper line meets the outer edge line they miss by about half a unit, which
  is settled in the app.
- **The bay is as wide as the kerb lane**: `b` is band 0's width, so a bay beside a
  narrow lane is narrower, as a turn arrow in one is (OQ-7).
- **The box moves into the bay, between its lines.** Its ends span `e − 1.5` to
  `e + b − 1.5` — from the mouth line to the bay's outer edge line, which are its
  long sides (§2.7.1), as the in-lane box's are the edge line and the divider. The
  word, the spine and the halo follow it: centre offset `e − 1.5 + b / 2`, width
  `b`. The bus is drawn stopped out of the running lane, which is the whole of what
  the form says.

**The asphalt goes in the wedge layer, not the marking layer.** `geometry.ts` gains
`busBays(doc, offsets)`, computed once in `Diagram` like `tapers` is, returning per
bay its polygon, its edge and taper lines, its mouth line and the stretch it cuts
(§2.9). A new `BayShape` renders them beside `Diagram.tsx:TaperShape` — after every
road, before every marking — because asphalt must lie under all paint: drawn in the
marking layer, a bay would cover any earlier marking of a neighbouring road that it
overlaps. Like `TaperShape` it carries the road-class token on its group, and its
elements carry a second token naming them for tests, as `road-taper-edge` does: the
polygon `road-taper road-bay`, its lines `road-edge road-bay-edge`, the mouth
`road-divider road-bay-mouth`. The box, the word, the hit target and the halo stay
in `MarkingShape`.

### 2.9 The bay cuts the edge line; it does not paint over it (decision, recorded)

Where a bay opens, the road's kerb-side edge line has to stop: a solid line across
a bay's mouth says "do not cross". Covering it with the bay's asphalt fails twice:

- **The line is inside the road.** It sits 1.5 in from the casing's rim, so a
  covering polygon would have to start inside the casing — over lane 0's paint,
  including a `bus` lane's tint.
- **On the canvas it is a hairline.** `RoadShape` strokes it with `hairline(interaction)`
  (`vector-effect: non-scaling-stroke`), whose width in world units grows as the view
  zooms out, so any covering margin fixed in world units lets the line through at
  some zoom. The export has no hairlines, so the figure would look right and the
  canvas wrong — a split no automated test here sees.

So **`RoadShape` leaves the kerb-side edge undrawn over the bays' stretches**, told
which by a prop computed once in `Diagram` from `busBays` — the `replaced`
precedent, where `geometry.ts:laneLineOffsets` tells each road which dividers a
human's lane line has taken. Five details:

- **The kerb-side edge is the positive offset**, `RoadShape`'s `leftEdge` — a name
  from the y-up formula that is the kerb side on screen (`rules/road-rendering.md`:
  lane 0 at the most positive offset).
- **The kept pieces are cut in the drawn frame, then offset** (§2.6):
  `offsetPolyline(polylineStretch(points, a, b), edgeInset)`.
- **One link's stretches are merged before cutting**, so two overlapping bays open
  one gap in the edge line, not two overlapping ones (OQ-5).
- **A kept piece of no length is omitted**, not emitted as an empty path — the case a
  bay slid against a road's end produces.
- **The stretches come from the slid centre**, which comes from `markingAnchor`, the
  one conversion site, so the road and the bay cannot disagree about where the bay
  is.

Across the whole mouth, tapers included, `BayShape` draws **a dashed line at the old
edge line's offset**, painted as a divider because it is one — the boundary between
the running lane and the bay — so it takes `.road-divider`'s treatment and the
canvas hairline with no new rule (OQ-8).

### 2.10 What does not change

- **Export bounds.** `export.tsx:strokeAllowance` reads only `doc.links`, so nothing
  a marking or a bay adds can move it — which is why it needs no widening, and why no
  gate below asserts it. The bay is fill, which `measureDiagram` frames through
  `getBBox`, and its lines sit inside that fill. Two statements stop being true of a
  bay and are restated in Phase 2: the comment on `export.test.ts`'s "is unchanged by
  the markings painted on a road" (*every marking is painted inside the road it
  belongs to*), and `rules/diagram-export.md`'s count of what is fill.
- **Import**, **carriageway pairing**, **tapers at joints** and **gores**.
- **Undo.** `setMarkingKind` is already one step, and the Form control is a click,
  as `MarkingLineStyle`'s is, so `state.ts:coalesceKeyFor` gains no key.
- **The landing page.** No example carries a stop, so `scripts/render-examples.ts`'s
  figures do not move.

## 3. Open questions

- **OQ-1 — RESOLVED 2026-09-11: a white outline box lettered `BUS`** (§2.7).
  ~~What does a stop look like? Proposed: a white outline box lettered `BUS`, because
  the palette spends colour on meaning. The alternatives are a yellow box lettered
  `BUS STOP`, as in the UK, or a pictogram.~~ Resolved on the proposal in review
  round 1, where leaving it open was found to block Phase 1: a `double` lane line is
  the one marking that is not white, and its yellow says opposing traffic
  (`rules/marking-kinds.md`). Refined in review round 2: the box is drawn by its two
  ends, and the road's own lines are its sides (§2.7.1). *(was design call)*
- **OQ-2 — Should a stop's length be editable?** Proposed no (§2.5): an optional
  field later costs no bump, so waiting loses nothing. *(deferred by evidence —
  reopen when a figure needs a stop of another length; blocks nothing)*
- **OQ-3 — A roadside bus stop sign?** Proposed not in this spec: the painted word
  says it, and a new `SignKind` is `signs_and_text_spec.md`'s subject, where it would
  be a phase. *(design call; blocks nothing)*
- **OQ-4 — RESOLVED 2026-09-11: the footprint slides to fit** (§2.6). ~~Proposed:
  the stretch clamps and the stop draws shortened. The alternative slides the stop
  until its whole footprint fits.~~ Review round 1 showed the clamp draws half a box
  with its word at the box's edge, and on a road shortened past the stop a box of no
  length; the slide keeps the footprint whole and its word centred, and changes only
  the drawing, never `position`. *(was design call)*
- **OQ-5 — RESOLVED 2026-09-11: overlaps draw as they fall, except the edge-line
  cut, which merges** (§2.9). ~~Two stops on one stretch, or a bay reaching a taper
  wedge or a gore at the link's end. Proposed: draw both with no resolution.~~ Two
  overlapping stops draw both, as does a bay meeting a wedge or a gore — a human moves
  one. The one overlap that must resolve is the cut: one link's bay stretches merge
  before the kerb-side edge is split. *(was design call)*
- **OQ-6 — RESOLVED 2026-09-11: the literal pins go; one deliberate pin stays**
  (§2.3). ~~Rewrite the retired-glyph test to assert that the fixture declares 2,
  loads, and resaves at the current version.~~ Review round 1 found **four** tests
  pinning the literal 2, not one, and that the proposed rewrite could not pass while
  `encode` wrote a document's own version. With §2.3.1's stamping,
  `saves_at_the_current_schema_version` keeps the one literal pin, now on 3; the other
  three drop theirs and keep every behavioural assertion. The claims those pins made —
  that a retired variant, a dropped field and a new optional field each cost no bump —
  were true when made and stay recorded in `rules/document-model.md` and their own
  specs; a pin that an unrelated bump breaks was never the right home for them.
  *(was design call)*
- **OQ-7 — RESOLVED 2026-09-11: band 0's width and band 0's place, whatever its
  kind, in both phases** (§2.4, §2.8). ~~Proposed: band 0's width. A hard shoulder at
  index 0 would size a bay off the shoulder.~~ Review round 1 noted Phase 1 reaches
  the same case — a stop in a `shoulder` band paints over the hatch — so the answer
  covers both: a stop beside a hard shoulder is not a road this project draws, and
  special-casing the kind buys nothing a figure needs. *(was design call)*
- **OQ-8 — RESOLVED 2026-09-11: dashed along the whole opening, painted as a
  divider** (§2.9). ~~Proposed: dashed along the whole opening, tapers included,
  rather than only along the stopping stretch.~~ Whether the mouth wants a dash rhythm
  other than `.road-divider`'s is settled in the app. *(was design call)*

## 4. Implementation phases

Strictly sequential: Phase 2 draws the bay form on Phase 1's model, stretch, slide
and anchor.

### Phase 1 — A bus stop in the kerb lane
*Produces the observable: yes — a stop drawn in the kerb lane, on the canvas and in
an exported SVG and PNG.*

- **Scope:**
  - **Model and persistence.** The `bus_stop` variant and `StopForm` in both mirrors
    (§2.3), and `SCHEMA_VERSION` 2 → 3 with everything §2.3 lists: both constants,
    `encode` stamping the version (§2.3.1), the future fixture to 4, the four literal
    pins (OQ-6), both goldens regenerated through the opt-in with the diff read, and
    the comments naming version 2.
  - **Geometry** (`geometry.ts`). `MarkingAnchor.distance`, clamped and required,
    with the five test literals; `polylineStretch`; `BUS_STOP_LENGTH`; the widened
    span line, ahead of the out-of-range-lane skip (§2.4); `markingForm`'s `stop` arm
    with `BusStopShape` and the footprint slide (§2.6, §2.7). Both forms draw in the
    lane in this phase.
  - **State** (`state.ts`). `setLinkLanes`' shrink cascade keeps a stop and clears a
    `lane` it has outgrown, with `doc.markings` identical by reference when nothing
    changes (§2.4).
  - **Canvas** (`Canvas.tsx`). The drag writes no `lane` for a stop (§2.4).
  - **Render** (`Diagram.tsx`). `MarkingShape`'s three-way arm, `haloWidth`, and
    `needsText` counting a stop. `.marking-stop-ends` in `src/styles/diagram.css`.
  - **Panel** (`Inspector.tsx`). `MARKING_KINDS` gains `bus_stop: "Bus stop"`,
    `MARKING_PICKER` gains `{ type: "bus_stop", form: "in_lane" }`, and the Span
    field is withheld for a stop. **No Form control yet**: a bay the panel offered
    and the drawing ignored would be visibly wrong, so `form: bay` is reachable only
    by hand-editing until Phase 2, and draws in the lane — visible and selectable,
    the posture `markingPaint`'s default arm takes.
- **Exit gate:**
  - `bun run build`, `bun run test`, and from `src-tauri/` `cargo test`,
    `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`, all green;
    `spec-lint` 0 errors.
  - `geometry.test.ts`, `polylineStretch`: on a straight polyline; across a bend,
    where the stretch carries the vertex; clamped at both ends; and on
    `[(0,0), (50,0), (50,5e-7), (50,100)]` the stretch `[0, 100]` ends **exactly**
    (`toEqual`) where `pointAlongPolyline(points, 100)` puts its point,
    `(50, 50.0000005)` — which a walk counting the 5e-7 segment misses by that 5e-7.
  - `geometry.test.ts`, `markingAnchor`: a start-anchored marking whose metres exceed
    its road reports `distance` equal to `polylineLength`; a `bus_stop` with `lane: 2`
    takes band 0 on a three-lane road **and on a two-lane road** (where the skip would
    otherwise return `undefined`); a `turn_arrow` with `lane: 2` on a three-lane road
    still takes band 2.
  - `state.test.ts`: narrowing a three-lane road to two keeps a `bus_stop` whose
    `lane` was 2, with no `lane` key, and still drops a `stop_line` with `lane: 2`;
    repainting that kept stop as a `stop_line` leaves a marking `markingForm` draws;
    narrowing a road whose markings all remain in range leaves `doc.markings`
    identical by reference.
  - `Diagram.test.tsx`, on the three-lane `N1(0,0) → N2(120,0)` (road width 30,
    band 0 at offset 9, width 9):
    - a stop at `position = 60 / UNITS_PER_METRE` draws two end bars, at `x` 37.5 and
      82.5, each from `y` 4.5 to 13.5, **and no long side** — its paint is those two
      bars and the word — with the word's run equal to `markingText` of an anchor at
      `(60, 0)` with band 0's span;
    - a stop at `position = 120 / UNITS_PER_METRE` slides: its end bars sit at `x` 75
      and 120 and its word at `x` 97.5;
    - the stop's group is `marking marking-bus-stop`, its hit path stroked 9 wide and,
      when selected, its halo 15;
    - on a road bent within the stop's stretch, the hit spine carries three points and
      each end bar lies perpendicular to the segment its end falls on.
  - `export.test.ts`: a document with one stop exports `.marking-stop-ends`, a `<text>`
    run and the embedded `@font-face`, and no chrome.
  - Rust: a `.zkai` carrying a stop of each form round-trips byte for byte; a
    version-2 text decodes still declaring 2 and **encodes declaring 3**; the
    future-version fixture is rejected at 4; `saves_at_the_current_schema_version`
    pins 3; the three other pins name no literal; the golden diffs are one version
    line each.
  - Mutations, each failing a named clause above: `needsText` without the stop term;
    the stop term placed after the out-of-range-lane skip; the cascade without the
    stop term; the cascade keeping a stop without clearing its `lane`; `encode`
    without the stamp; `polylineStretch` walking segments shorter than `SAME_EDGE`;
    the footprint measured from `distance` rather than the slid centre; the stop
    drawing its box's long sides.
  - Dev pass (`bun run dev`): place a marking and repaint it as a bus stop; drag it
    along a bent road and across the lanes — it stays in the kerb lane; save, and the
    saved stop carries no `lane` key; narrow the road under it; undo and
    redo; open an example, add a stop, save, and confirm the file declares
    `schema_version: 3`; export SVG and PNG and open both — `BUS` in Overpass Mono in
    each.
- **Close-out:** `rules/marking-kinds.md` (the eighth kind, the third form, a box
  drawn by its ends, the box's hit target, `needsText`); `rules/road-markings.md` (its
  opening claim that no marking change has moved `SCHEMA_VERSION`, the span line ahead
  of the skip, the cascade clearing a stop's `lane`, the withheld Span field);
  `rules/canvas-interaction.md` (a drag's offset becomes a lane, a boundary, or — for a
  stop — none); `rules/document-model.md` (version 3 and the variant that took it
  there, `encode` stamping, the pins); `rules/persistence.md` (`encode` stamps);
  `rules/diagram-export.md` (`needsText`'s fourth term); `rules/junctions.md` (its
  "still **2**") and `rules/network-yaml.md` (its "still **2**" and its
  version-constant table row). **Line budget**: `junctions.md` (215/215) and
  `network-yaml.md` (343/345) change in place; `marking-kinds.md` (246/250),
  `road-markings.md` (277/280) and `canvas-interaction.md` (190/190) trade prose;
  `document-model.md` (135/135) gains a mechanism it had no concept of — a save
  stamping the version — which is the case `link_bends_spec.md` records for moving a
  cap ("the rule genuinely gains a mechanism"), so the plan argues that move for the
  human to accept, or trades; `persistence.md` (154/160) and `diagram-export.md`
  (299/305) have room. Commit the feature and the rules separately; push, which
  deploys the demo.

### Phase 2 — A bus stop in a bay
*Produces the observable: yes — the road widens into a bay beside the running lane,
with the stop drawn in it.*

- **Scope:**
  - **Geometry** (`geometry.ts`). `busBays(doc, offsets)`: per bay its polygon, its
    outer and taper edge lines, its mouth line and the stretch it cuts, all from the
    slid centre (§2.8, §2.9); one link's stretches merged; the stop's end bars, word,
    spine and halo offset into the bay, between its lines.
  - **Render** (`Diagram.tsx`). `BayShape` in the wedge layer with the `road-bay`
    tokens; `RoadShape`'s new prop splitting the kerb-side edge line and omitting
    pieces of no length; the stop's box and word in the bay.
  - **Panel** (`Inspector.tsx`). A **Form** control (In lane · Bay), one more
    dispatcher of `setMarkingKind`, on `MarkingLineStyle`'s model.
  - **Tests.** The comment on `export.test.ts`'s "is unchanged by the markings painted
    on a road" restated for a bay (§2.10).
- **Exit gate:**
  - The Phase 1 build, test, lint and format commands, all green.
  - `geometry.test.ts`, on the three-lane `N1(0,0) → N2(240,0)` with a bay centred at
    `s = 120` (`e` 15, `b` 9): the casing edge runs `x` 73.5 to 166.5 at `y` 15, the
    outer edge `x` 97.5 to 142.5 at `y` 24, and the box's end bars sit at `x` 97.5 and
    142.5, each from `y` 13.5 to 22.5.
  - `geometry.test.ts`, on `Diagram.test.tsx`'s two-lane divided pair: the eastbound
    carriageway's bay spans `y` 24 to 33, outside both carriageways; on the negative
    offset it would span −6 to 3, over the westbound carriageway at −24 to −3.
  - `Diagram.test.tsx`, on the bent three-lane `A(0,0)→B(50,0)→C(50,150)` with a bay
    at `position = 125 / UNITS_PER_METRE`: the kerb-side edge draws two pieces, the
    first ending at `(36.5, 28.5)` and the second starting at `(36.5, 121.5)`.
    Offsetting before cutting would end the first at `(36.5, 55.5)`.
  - `Diagram.test.tsx`, on the three-lane `N1(0,0) → N2(400,0)` with bays at
    `position = 150 / UNITS_PER_METRE` and `200 / UNITS_PER_METRE`, whose footprints
    overlap: the kerb-side edge draws exactly two pieces, the first ending at `x` 103.5
    and the second starting at `x` 246.5.
  - `Diagram.test.tsx`: on the 240-unit road a bay at `position = 0` slides to centre
    46.5 and the kerb-side edge draws one piece, from `x` 93, with no empty path; the
    offside edge is untouched; an `in_lane` stop leaves the road's markup
    byte-identical to a road with no stop.
  - `Diagram.test.tsx`, layer order, with a `stop_line` on a second road listed
    **before** the bay's stop in `doc.markings`: `road-casing` precedes the
    `road-bay` polygon, and the polygon precedes every `class="marking` group — on the
    model of "draws above every road and below the junction glyphs".
  - `export.test.ts`: a bay exports with no chrome.
  - Mutations, each failing a named clause above: cutting the offset polyline instead
    of the drawn one; the bay on the negative offset; `BayShape` moved into the marking
    layer; one link's stretches cut without merging.
  - Dev pass: at 50% zoom no solid line runs along a bay's mouth and the dashed mouth
    line is there; switch the Form control both ways and undo each; export a PNG.
- **Close-out:** `rules/road-rendering.md` (the edge line can be cut, by what, and
  merged), `rules/road-joints.md` (a bay's tapers are not joints),
  `rules/marking-kinds.md` (the bay form), `rules/diagram-export.md` (the bay among
  what is fill). **Line budget**: both road rules sit at their caps (272/272,
  268/268), so the plan trades prose or argues a cap move for a mechanism neither rule
  had; `marking-kinds.md` is wherever Phase 1 left it; `diagram-export.md` has room.
  Commit and push as Phase 1.

<!--
The review record is a sibling file, not a section: it lives at
specs/reviews/zk-016.md, append-only, one heading per round. See §7.
-->
