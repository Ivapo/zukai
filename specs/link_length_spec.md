---
id: zk-012
title: link-length
status: accepted
last_updated: 2026-08-09
note: >
  A link states its real length as a label on the drawing — an annotation the
  human owns, decoupled from the drawn length, and filled on import from the
  one thing import throws away.

phases:
  - name: "Phase 1 — A link states its length"
    reviewed: 2026-08-09
    shipped: 2026-08-09
    cut: null
    by: null
  - name: "Phase 2 — Import fills it from the geometry it discards"
    reviewed: null
    shipped: null
    cut: null
    by: null

extends: null
supersedes: null
superseded_by: null
related: [zk-009, zk-007]
reference: null
---

# Link length

## 1. Goal

**The observable: a link on the drawing carries the text `1800m`, and the
drawing does not move when a human changes it to `1500m`.**

This is `CLAUDE.md`'s founding example, and nothing in the code implements it.
The project holds a network *shrunk down to represent it*: the picture is a
diagram, and the numbers on it are annotations. Today the diagram states no
dimensions at all, so a reader cannot tell a 200 m slip road from a 2 km
motorway link — the drawing deliberately does not say, and neither does
anything else.

It also discharges a question that has been stuck. `network_yaml_spec.md` OQ-2
has been hunting an import scale factor, and the note recorded at that spec's
export cut (its §0; also `rules/network-yaml.md`) settled by disproof that
**no fixed constant serves both fixtures**: 2.571 u/m leaves `t_junction`'s
500 m arm at 143 lane-widths, and a constant small enough to fix that drops
`cross-4`'s 100 m arms below their own road width. The honest answer is that
scale is not what the drawing carries. A length is a **label**, and this spec
is that answer built.

### 1.1 Non-goals

- **No scale bar, and no fit-to-extent.** Where import *places* nodes on the
  canvas is `network_yaml_spec.md`'s subject, and a phase appended there is the
  right home for it. This spec makes the length survive whatever that layout
  does; it does not choose the layout.
- **Not a general link label.** `1800m` states a length. A road *name* (`M4
  westbound`) is a different feature with a different source and no importable
  value; it is not smuggled in as a free-text field here.
- **No arithmetic over lengths** — no route totals, no summed corridors, no
  consistency check against the drawn polyline. A number that is checked against
  the canvas is a number the canvas can contradict.
- **No second unit.** Metres, as everywhere else in the model.

## 2. Design

### 2.1 The field is `Link.length`, and it lives in the semantic graph

`Link` (`src-tauri/src/model/graph.rs:Link`) gains
`length: Option<f64>`, metres, `#[serde(default, skip_serializing_if =
"Option::is_none")]`, mirrored on `src/model/types.ts:Link` as `length?: number`.

Three arguments for that placement:

- **A length is a fact about the road, not paint on it.** It belongs beside
  `Link::median_gap` and `Lane::width`, which are also metres and also facts.
  `decoration.rs` is for things a human puts *on* the drawing.
- **A schematic-only field in `graph.rs` has precedent.** `Lane::kind` is
  documented there as "Not part of Assimilator's schema", and the layer's claim
  is that it is *shaped* like the `network.yaml` subset rather than identical to
  it — `rules/document-model.md` already states this, since nothing writes that
  format.
- **It costs no `SCHEMA_VERSION` bump.** A new optional *field* is free where a
  new enum *variant* is not (`src-tauri/src/model/mod.rs:SCHEMA_VERSION`), and
  elision keeps every existing `.zkai` byte-identical. Version stays **2**.

**Absent means the road does not state its length**, which is what every
document written so far means. It is not zero and not "unknown pending
measurement".

### 2.2 The invariant, and it is the whole point (decision, recorded)

**Two directions are forbidden, and a phase gate has to test both:**

- Nothing computes `Link.length` **from** the canvas. `polylineLength` and
  `drawnPolyline` (`src/editor/geometry.ts`) must not reach it. A length derived
  from the drawing is a measurement of a diagram, which is exactly the thing
  `CLAUDE.md` says the drawing is not.
- Nothing sizes the canvas **from** `Link.length`. It must not reach
  `drawnPolyline`, `roadWidth`, `laneBands` or any node position. Dragging a node
  changes the picture and leaves the label alone; editing the label changes the
  label and leaves the picture alone.

They are two independent records of one road. The test that catches a regression
is not a value assertion on either number. It is two reference checks: a
`moveNode` leaves `link.length` (and the `doc.links` entry carrying it, when
untouched) identical, and a `setLinkLength` leaves **`doc.layout` identical by
reference** — the layout is where every drawn position lives, so an untouched
layout *is* an untouched drawing. (`drawnPolyline`'s own return value cannot be
the compared reference: `linkPolyline` mints a fresh array per call.)

### 2.3 The label is drawn from the field, and it is not a `Marking`

A `text` marking can already carry the characters `1800m`. It is the wrong
object for three reasons, each of which the label inverts:

| | `MarkingKind::Text` | The length label |
|---|---|---|
| Where | in a lane band, on the asphalt | **beside** the carriageway, clear of it |
| Orientation | turns with the road, **no upright flip** — a westbound road reads upside down, which is what real paint does | **flips upright**, because a reader reads a label and a driver does not |
| Origin | placed by hand at a position | **derived** from the field, so no id, no hit target, no `Selection` arm |

`src/editor/geometry.ts:markingText` is the contrast, and its deliberate absence
of an upright flip is recorded in `rules/marking-kinds.md`. The label reuses that
module's type metrics — `TEXT_SIZE`, `ADVANCE`, `CAP_HEIGHT`, `BASELINE_DROP`,
`textWidth` — so a length reads as the same hand as a sign's label and a painted
word.

The geometry is one new pure function returning a `TextRun`-shaped value: the
drawn polyline's midpoint, stepped clear by `roadWidth / 2` plus a gap, with the
angle normalized into the upright half-turn. Because it is derived, a link with
`length: None` emits **no element at all** — a document that states nothing draws
byte-identically to one written before this spec.

### 2.4 The formatter, and why the drawing owns it

`1800m`, matching `CLAUDE.md`'s own example: the stored number **rounded to the
nearest metre**, an `m` suffix and no space. One function, so two links cannot
disagree about how a length reads.

The number is stored bare and formatted at the point of drawing — settled by
OQ-1's resolution.

### 2.5 `needsText` must widen, and it is the one silent trap here

`src/components/Diagram.tsx:needsText` gates the embedded `@font-face`. Its two
arms today count text markings with non-empty content and every sign. A length
label is a third `<text>` the drawing can emit, and a document carrying one with
no sign and no text marking would produce an exported SVG that **names Overpass
Mono without carrying its bytes** — the viewer substitutes whatever it has, and
the PNG path bakes that substitution in permanently. `rules/diagram-export.md`
records this as the failure the whole gate exists to prevent.

Widening it fixes a second thing for free: `src/editor/export.tsx:measureDiagram`
awaits `document.fonts?.ready` **gated on the same predicate**, so a label
measured before the face resolves would frame the export to a fallback-font box
with nothing to say it happened.

`src/editor/export.tsx:strokeAllowance` needs **no** change, on the sign plate's
argument: a label is fill, `getBBox` measures fill, and it sits inside the
measured `<g class="diagram">`. The frame grows to include it by construction.

### 2.6 Editing: a text input, parsed

The link panel is the tail of the `if` chain in `src/components/Inspector.tsx`,
below Lanes, Road class and Alignment. It gains a **Length** field: a text input,
because a stepper for 1800 metres is absurd and because the empty string is the
route back to "states nothing".

One new action, `setLinkLength(id, length?)`, taking `setMarkingLane`'s shape —
an absent value clears the key, on the one-representation rule `Lane.kind`,
`LinkView.align`, `Marking.lane` and `Sign.associated_link` all follow. Text
that parses to no finite positive number dispatches nothing — implementer
discretion beyond that, the UI being provisional.

`src/editor/state.ts:coalesceKeyFor` gains a key so typing `1800` is one undo
step rather than four, on `markingText`'s precedent — **including the empty-string
carve-out**, or clearing the field merges with the run that typed it.

## 3. Open questions

- **OQ-1 — a number, or the text itself? RESOLVED 2026-08-09, user's call: a
  number.** `f64` metres, formatted at the point of drawing (§2.4). `CLAUDE.md`'s
  "text reading `1800m`" describes what the *drawing* shows, not the storage;
  import produces a number, every other model quantity is metres, and one
  formatter keeps every link reading in one hand. `1.8 km` spellings are
  foregone, knowingly.
- **OQ-2 — where the label sits.** Midpoint and one side is the proposal. A
  divided road draws two labels whose offsets are measured in opposing frames, so
  they may land on opposite visual sides and read fine, or may collide. Decide in
  the app, as every marking constant has been. A side toggle is a later phase if
  the app asks for one. *(deferred by evidence)*
- **OQ-3 — does an imported label go stale?** A human who drags a node has not
  changed the road, so the length stands. A human who *splits* a link at a
  waypoint has, and neither half's length is the original. Nothing detects that,
  and the proposal is to accept it — the label is the human's claim, not a
  derived quantity. *(design call)*
- **OQ-4 — does the label belong on the export at all, or only on the canvas?**
  Proposal: on both, since it is the figure's dimension annotation and a figure
  is the deliverable. Recorded because it is the one question whose answer could
  make Phase 1 produce no observable. *(design call)*

## 4. Implementation phases

### Phase 1 — A link states its length
*Produces the observable: **yes** — the label is the picture, and after this
phase a human can type one and see it on the canvas and in an exported file.*

- **Scope:** `Link::length` in `graph.rs` and `types.ts` (§2.1); the pure label
  geometry and formatter in `geometry.ts` (§2.3, §2.4); the drawn element in
  `Diagram.tsx`, rendered from the link and skipped entirely when `length` is
  absent; the widened `needsText` (§2.5); `setLinkLength` and its coalescing key
  in `state.ts` (§2.6); the Length field in the Inspector's link panel.
- **Exit gate:**
  1. `cargo test`, `cargo fmt --check`, `cargo clippy --all-targets -- -D
     warnings` and `bun run test` all green, with `SCHEMA_VERSION` still **2**.
  2. A document that sets no length renders **byte-identically** to before, and a
     `.zkai` saved from one is byte-identical — the elision working.
  3. **Both halves of §2.2, asserted by reference**: a `moveNode` leaves
     `link.length` untouched, and a `setLinkLength` leaves `doc.layout`
     identical **by reference** — the assertable form, since `drawnPolyline`
     mints fresh arrays per call (§2.2).
  4. `export.test.ts`: a document whose *only* text is a length label embeds the
     face, and one with no length and no sign still embeds none.
  5. Dev pass in the app: type `1800`, read `1800m` on the canvas, drag a node
     and watch the label hold; export and open the SVG.
- **Close-out:** a new `rules/link-length.md`, or a section in
  `rules/road-rendering.md` if the subsystem proves too small to earn a file —
  decide at close-out, not now. `rules/document-model.md` gains the field;
  `rules/diagram-export.md`'s `needsText` arms go from two to three.

#### As built (shipped 2026-08-09)

Everything above landed as designed. Five things worth carrying to Phase 2:

- **The close-out decision went to `rules/road-rendering.md`**, not a file of its
  own: one field, one pure function and one element is thin for a rule, and that
  file already owns `drawnPolyline` — the exact thing §2.2 constrains. Its
  `max_lines` moved 210 → 235 and `graph.rs` joined its `sources`.
- **OQ-2 was answered by derivation rather than by taste**, which the spec did not
  expect. `carriageways` steps each carriageway out by a *positive* offset in its
  own frame, so each one's right of travel points away from the shared centreline:
  putting the label on the right of travel lands a divided road's two labels
  **outside** the pair by construction. Confirmed in the app and pinned in both
  `geometry.test.ts` and `Diagram.test.tsx`. `LABEL_GAP = 8`, settled in the app.
- **The upright flip has a second half the design did not name**: the baseline
  drop's *sign* must follow the turn, or a westbound label sits a whole cap height
  nearer its road than an eastbound one. A plausible half-offset rather than a
  visible mistake, so it is pinned as the two runs' centres being mirror images
  while their baselines are not.
- **`lengthLabel` takes no length, and that is the enforcement of §2.2's second
  half** — a function with no such parameter cannot size anything from one,
  whatever a later edit intends. Asserted as `lengthLabel.length === 2`.
- **The dev pass turned up one pre-existing defect**, fixed in the same push: the
  canvas had no `user-select`, so any drag sweeping across a text run selected its
  glyphs. Reachable since signs Phase 1 for a sign's label; found here because the
  gesture that shows this feature off is exactly the gesture that triggers it.
  Fixed in `styles.css`, which does not travel into exports.

### Phase 2 — Import fills it from the geometry it discards
*Produces the observable: **yes** — an imported network stops being roads at the
wrong size and becomes a diagram that states its own dimensions.*

- **Scope:** `src-tauri/src/network/import.rs:network_to_document` computes each
  link's length by summing the segments of `src-tauri/src/network/mod.rs:NetworkLink`'s
  `geometry` — a `Vec<[f64; 2]>` in metres with at least two points, today
  discarded whole — and writes it to `Link::length`. Nothing else about import
  changes: the polyline is still thrown away, and the canvas layout is untouched
  (§1.1).
- **Exit gate:**
  1. `cargo test` green; both committed fixtures import with a length on every
     link, and the values match a hand-summed polyline to within a float slack.
  2. The **founding claim still holds**: `the_semantic_graph_carries_no_coordinates`
     passes unchanged — a length is a scalar, not geometry, and no coordinate
     reaches `doc.nodes`.
  3. A `network.yaml` whose `geometry` has exactly two points still imports, and
     one with a degenerate zero-length polyline yields `None` rather than `0`.
  4. Dev pass: import `t_junction`, read a ~500 m label on the long arm while the
     arm is still 1285 canvas units long — the decoupling, visible in one screen.
- **Close-out:** `rules/network-yaml.md` gains the geometry-to-length line and
  loses "discarded whole"; `network_yaml_spec.md` OQ-2 is annotated with the
  answer this spec gives it, and the layout half is recorded there as the
  remaining question.

<!--
The review record is a sibling file, not a section: it lives at
specs/reviews/zk-012.md, append-only, one heading per round. See §7.
-->
