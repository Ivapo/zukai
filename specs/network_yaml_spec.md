---
status: reviewed
last_updated: 2026-07-26
note: Phases 1–3 of 4 shipped 2026-07-26 (the format read, reaching the app, and written). Import and export Assimilator's `network.yaml` — the one coupling the two projects were ever meant to have, and the first thing Zukai has built that another program reads.
implemented: ["Phase 1", "Phase 2", "Phase 3"]
not_implemented: ["Phase 4"]
related: [specs/save_load_spec.md, specs/junction_semantics_spec.md, specs/ramps_and_tapers_spec.md, specs/diagram_export_spec.md]
reference: "Assimilator's `crates/config/src/network.rs` — `NetworkConfig` and its `NodeConfig`/`LinkConfig`/`LaneConfig`/`JunctionConfig`/`MovementConfig`/`SignalPlanConfig`/`PhaseConfig` — plus `crates/config/src/version.rs` (the `schema_version` header, §2.1, `CURRENT_SCHEMA_VERSION = 1`), `crates/network/src/validation.rs` (the seven rules an export must satisfy, §2.4) and `crates/cli/src/{main,runner}.rs` (what the CLI can actually load, Phase 4). All read at `../assimilator` on 2026-07-26. Explicitly *not* in scope from it: `detectors`, `stops`, `crossings`, `rerouters`, and the simulation-only per-junction fields (`conflict_pairs`, `gap_acceptance`, `collision_avoidance`, `conflict_model`, `b_amber`, `enforce_entry_guards`), which `graph.rs:11-15` already records as deliberately omitted."
---

# `network.yaml` Spec

## 1. Goal

`CLAUDE.md` opens by saying Zukai and Assimilator share exactly one thing: the
`network.yaml` file format. **Nothing has ever been built for it.** There is no
reader, no writer, no serde struct for Assimilator's shape, and no menu item —
`src-tauri/src/` has `persist.rs` (Zukai's own `.zkai`), `export.rs` (SVG/PNG
bytes) and `recent.rs` (the recent-files list), and nothing that reads a format
Zukai does not own.

So Zukai currently draws pictures that no other program can read, of networks
that no other program can supply. Every one of the eight shipped specs made the
drawing better; this one makes it *worth something outside the app*.

End state — both directions, on Assimilator's own `t_junction` scenario:

```
File ▸ Import network…  →  ../assimilator/demo/dist/scenarios/t_junction/network.yaml

  nodes W, J, E, S            → 4 Zukai nodes, ids preserved, kinds preserved
  links L_W_J, L_J_E, L_S_J   → 3 Zukai links, lanes preserved
    their `geometry:` polylines  → DISCARDED (§2.5)
    their `point: [500, -300]`   → kept only to SEED layout.nodes (§2.6)
  junction J                  → control unsignalized, rule priority,
                                movements M_major_thru / M_minor_left,
                                the minor one still `minor`, still yielding (§2.3.1)
    its `conflict_pairs`, `gap_acceptance`, `geometry.setback`  → dropped
  top-level `detectors:`      → dropped (§2.8, OQ-5)

  → a T-junction on the canvas, positioned, ready to redraw by hand

File ▸ Export network…  →  a `network.yaml` Assimilator's own loader accepts

  `schema_version: 1`                 stamped first (§2.1 — the header is read
                                       above serde, which is why `NetworkConfig`
                                       has no field for it)
  every node gets `point: [x, y]`     synthesized from layout, metres (§2.4)
  every link gets `geometry: [...]`   a straight line, or its bends (§2.4, OQ-1)
  every movement gets `from_lanes`/`to_lanes`  — REQUIRED, and today Zukai
                                       would omit the keys entirely (§2.3)
  every signal phase gets `green_movements`    — same trap, and `cross-4` has
                                       a signal plan today (§2.3.2)
  markings, signs, glyphs, scale      → never written; Assimilator has no such idea
```

## 2. Design

### 2.1 What `network.yaml` actually is (verified, not assumed)

Read from `../assimilator/crates/config/src/network.rs` on 2026-07-26. Both
projects use `serde_yaml 0.9`, so the encoders agree by construction.

`NetworkConfig` (`:334-356`):

| Key | Required? | Zukai's answer |
|---|---|---|
| `metadata` | **yes** | `Document.metadata` (§2.7) |
| `nodes` | **yes** | `doc.nodes` + `layout.nodes` for `point` |
| `links` | **yes** | `doc.links` + synthesized `geometry` |
| `junctions` | no (`default`) | `doc.junctions` |
| `crossings`, `detectors`, `stops`, `rerouters` | no (`default`) | **not written**; dropped on import (OQ-5) |

**`network.yaml` carries a `schema_version` header, and `NetworkConfig` has no
field for it. Both halves are true, and missing either one produces a bug.**
`crates/config/src/version.rs` reads the header *before* serde and strips it —
`version.rs:20-22` says so outright: "The header is **stripped from the returned
`Value`** … so the typed `ProjectConfig` / `NetworkConfig` / `DemandConfig`
structs need no `schema_version` field". Every network-loading path in
Assimilator goes through `parse_and_check` (`cli/runner.rs:170`,
`config/src/project.rs:590`, `server.rs:242`), and its editor's save path stamps
the header on the way out (`stamp_schema_version`, `version.rs:134`).

So `CLAUDE.md`'s "the coupling point is the documented, `schema_version`-keyed
file format" is **correct as written and needs no edit** — the key is real, it is
simply read a layer above serde. Three consequences:

- **Import probes the version first**, the analogue of `load_document`'s
  `VersionProbe` (`persist.rs:26-29`), applying `classify`'s policy
  (`version.rs:58-81`) against `CURRENT_SCHEMA_VERSION = 1` (`version.rs:34`):
  **absent or `0` → accept**, `1` → accept, **`> 1` → reject** with a message
  naming the mismatch. The "absent → accept" arm is load-bearing, not lenient:
  **Assimilator's own demo scenarios carry no header** — `t_junction/network.yaml`
  starts at `metadata:` — so a reader that demanded one would reject the very
  fixtures Phase 1 commits.
- **Export stamps `schema_version: 1`** as the first line, the shape
  `stamp_schema_version` produces. Omitting it is legal *today* (Assimilator warns
  and treats it as v0) but becomes a hard error once `CURRENT_SCHEMA_VERSION >= 2`
  (`version.rs:9-10`) — writing a file that is already deprecated on arrival is
  precisely the silent failure §2.2 says export exists to avoid.
- **That `1` is a hardcoded coupling, and the one number here that can rot
  silently.** Zukai writes it because Assimilator's constant is 1 on the date in
  this spec's `reference:`. It goes in the rule file next to that date, so the next
  reader knows it is a copy rather than a derivation.

The enum spellings all match Zukai's mirror exactly, checked value by value:
`NodeType` (`:761-770`, `lowercase`) vs `NodeKind`; `ControlType` (`:1234-1240`,
`lowercase`) vs `JunctionControl`; `UnsignalizedRule` (`:1250-1257`,
`snake_case`) vs its namesake; `MovementType` (`:1281-1293`, **`lowercase`** plus
`#[serde(rename = "u-turn")]`) vs `MovementKind`. **`graph.rs` was written
correctly and no renaming is needed anywhere.** That is worth stating because it
is the one large risk this spec turned out *not* to carry.

The one spelling difference is inert and worth recording so a later reader does
not "fix" it: Assimilator's `MovementType` is `rename_all = "lowercase"` while
Zukai's `MovementKind` is `snake_case`. Every variant is a single word and `UTurn`
is explicitly renamed on both sides, so the two produce identical wire spellings.

### 2.2 The two directions are not symmetric, and the asymmetry is the design

Import throws information away and is easy. Export must **invent** information
and is where every trap lives.

| | Import | Export |
|---|---|---|
| Geometry | discard the polylines (§2.5) | **synthesize** them (§2.4) |
| Layout | seed from the metric coordinates (§2.6) | drop entirely |
| Decorations | nothing to read | drop entirely |
| Missing data | Assimilator's defaults fill in | Zukai must supply every required key |
| Failure mode | a parse error on a real file | **a file Assimilator refuses to load** |

The second column's failure mode is the one that matters: a `.zkai` that fails to
save is loud, while a `network.yaml` that Zukai writes happily and Assimilator
rejects is silent until someone tries to use it. Phase 3's exit gate is built
around exactly that.

### 2.3 `from_lanes`/`to_lanes` are required, and today Zukai would omit them (decision, recorded)

**This is the single finding that changes existing code**, and it contradicts a
doc-comment Zukai has carried since the first commit.

`MovementConfig` (`:1339-1349`):

```rust
pub from_lanes: Vec<LaneIdx>,   // no #[serde(default)]
pub to_lanes: Vec<LaneIdx>,     // no #[serde(default)]
```

Both are **required**. An absent key is `missing field `from_lanes`` and the
whole file fails to parse. Meanwhile `graph.rs:151-157` has:

```rust
/// Approach lanes used; empty for a movement with no lane detail (e.g. a
/// bare u-turn), matching Assimilator.
#[serde(default, skip_serializing_if = "Vec::is_empty")]
pub from_lanes: Vec<LaneIdx>,
```

**The comment is right and the attribute is wrong** — a distinction worth drawing
precisely, because the draft of this spec got it backwards. Assimilator's own
editor really does emit empty lists for u-turns: `cross-4/network.yaml:170-175`
writes `from_lanes: []` / `to_lanes: []` on all four. So "empty … matching
Assimilator" is an accurate claim about the *data*. What is fatal is
`skip_serializing_if`, which does not write an empty list — it **omits the key**,
and an omitted key is the parse error above. `[]` parses; nothing does not.

That matters because junction semantics Phase 2 deliberately leaves both lists
empty (`§2.8`, OQ-4), so **every movement Zukai has ever derived would export with
neither key**, and a document with one junction would produce a `network.yaml`
Assimilator cannot open at all.

**The decision: both keys are always written, and the value depends on where the
movement came from.** Three cases, in order:

1. **Non-empty in the model** (an imported movement) — written **verbatim**. This
   is what makes Phase 3's round-trip gate exact rather than approximate.
2. **Empty, and the movement is a `u-turn`** — written `[]`, matching what
   Assimilator's editor emits for the same case. Filling these would make the
   round trip rewrite a file it should have reproduced.
3. **Empty, any other kind** — filled with **every lane index** on the respective
   link: `from_lanes: [0, 1]` for a two-lane approach. `[]` here would be a lie —
   `MovementConfig`'s own doc calls these "lane indices on `from_link` that can use
   this movement", so an empty list on a through movement says no lane may — and it
   defeats `lane_mapping`'s auto-computation (`:1365-1367`, "positional matching of
   `from_lanes[i]` → `to_lanes[i]`"), which is the thing that makes carrying no
   lane detail survivable at all.

The alternative — *make Zukai's model carry a lane-pair matrix* — is junction
OQ-4, a second editor, and still deferred (§2.8). So this is an **export-time
synthesis, not a model change**: `graph.rs` keeps the empty vecs and the writer
fills them, the same shape as the geometry decision in §2.4.

**`graph.rs:151-157`'s attribute is what Phase 1 corrects** — the doc comment
gains the "the key is always written; `[]` is legal, absent is not" rule and a
pointer to this section. Whether `skip_serializing_if` comes off the field or the
writer overrides it is Phase 3's call, since `.zkai` is Zukai's own format and has
no reason to carry empty lists.

### 2.3.1 `priority` and `yields_to` — the fields that make `rule: priority` mean something

`MovementConfig` has two more fields Zukai's `Movement` does not carry
(`:1357-1364`):

```rust
#[serde(default)] pub priority: MovementPriority,   // major (default) | minor
#[serde(default)] pub yields_to: Vec<MovementId>,
```

Both are optional, so nothing fails to parse — which is exactly why this is
dangerous. `t_junction` carries `priority: minor` and `yields_to: [M_major_thru]`
on `M_minor_left`. A mirror that drops them imports the file happily and exports a
junction where **`rule: priority` is inert and nothing yields**: `MovementPriority`
defaults to `Major` (`:230-236`) with no `skip_serializing_if`, so the round trip
silently *promotes* the minor movement. A signal-plan-free priority junction in
which every movement has right of way is a materially different network, and no
parse error would ever say so.

**The decision: Zukai's `Movement` gains `priority` and `yields_to`, carried but
not edited.** The precedent is already in the file — `Junction.signal_plan`
(`graph.rs:115-117`) is carried by the model with no UI that creates one. Import
preserves them, export writes them back, and no Inspector control appears in this
spec. What Zukai *cannot* do is invent them for a junction a human drew here:
nothing in the schematic model says which arm is the major road, and deriving it
from road class would be the same guess-dressed-as-fact §2.6 refuses for glyphs.
So an authored priority junction exports with every movement `major`, and that
limitation is stated in the export dialog (§2.7) rather than hidden. Recorded as
**OQ-8**.

### 2.3.2 Signal plans are not hypothetical — `cross-4` has one

The draft recorded the `PhaseConfig` trap as a future problem. It is a **Phase 1**
problem: `cross-4/network.yaml:167-168` is `control: signal` with a `signal_plan`,
and Zukai's model already has `Junction.signal_plan`, `SignalPlan` and `Phase`
types to hold it (`graph.rs:115-208`). Import must carry it or the fixture loses
its signal timing; export must write it or a `control: signal` junction arrives
with no plan. Note the shape of that trap: `JunctionConfig.signal_plan`
(`:992-994`) is `#[serde(default)] Option<SignalPlanConfig>` — **serde-optional but
semantically required**, as its own doc says ("required when `control` is
`Signal`"). So omitting it parses cleanly and fails at runtime, with every approach
reading red. That is §2.2's silent-failure column exactly.

`PhaseConfig` (`:1401-1421`) requires `id`, `duration`, `green_movements`,
`amber_time` and `all_red_time`; only `permitted_movements` is `#[serde(default)]`.
Zukai's `Phase` (`graph.rs:198-208`) `skip_serializing_if`s `green_movements` and
defaults the two times. So `green_movements` gets **the same treatment as
`from_lanes`** — always written, `[]` legal, absent not — and `amber_time` /
`all_red_time` serialize unconditionally already (a `serde(default)` with no
`skip_serializing_if` still writes), so they need nothing.

One constraint export inherits and must not break: Assimilator validates that
**phase durations + amber + all-red sum to `cycle_time`**
(`crates/network/src/validation.rs:14`, tolerance 0.01 s). Zukai has no signal
editor, so a plan that arrived valid leaves valid; this is recorded because the
signal-plan spec, when it comes, is the thing that can violate it. That closes the
old OQ-6, which assumed no `SignalPlan` was reachable.

### 2.3.3 Field-completeness — and the one remaining field that re-wires a junction

The three sections above each found a required-or-semantic field by accident. That
is not a method, so this one closes the set: **every field** of `MovementConfig`,
`LaneConfig`, `LinkConfig`, `NodeConfig`, `JunctionConfig`, `SignalPlanConfig`,
`PhaseConfig` and `LaneMappingEntry` is now either mirrored, carried, or named a
non-goal — 62 fields across eight structs, enumerated against the source in review
round 3. The mirror is auditable against that claim, and a field in none of the
three buckets is a bug in this section.

**The rule that decides which.** A field is **carried** if dropping it would
silently change what the network *means* for a file Zukai round-trips. It is
**dropped** if Assimilator recomputes it from data Zukai does supply, or if it is
simulation instrumentation. Neither bucket implies an editor — §2.3.1's
carried-not-edited deal covers all of them.

**`lane_mapping` is carried**, and it is the last field with §2.3.1's silent-failure
shape. It appears on **both** fixtures — twice in `t_junction`, twelve times in
`cross-4` — so it is not hypothetical. Zukai dropping it is survivable only by
luck: every mapping in both files is the positional identity that
`lane_mapping`'s auto-computation (`:1365-1367`) reconstructs from
`from_lanes`/`to_lanes` anyway. A **crossed** mapping (`0→1, 1→0`) is legal,
expressible, and would come back through Zukai **re-wired**, with no parse error to
say so. So `Movement` gains `lane_mapping: Vec<LaneMappingEntry>`, written
verbatim, and Phase 3's round-trip gate names it explicitly rather than leaving it
between the must-equal and must-be-gone lists.

**Dropped, and declared here so the mirror is complete:**

- `MovementConfig.turn_speed` (`:1355`) — an override of a speed Assimilator
  computes from the turn radius. Zukai's radii are schematic fictions, so an
  override tuned against real geometry is one Zukai has no business preserving;
  letting Assimilator recompute is the more honest answer.
- `MovementConfig.control_points` (`:1376`) — the movement's Bézier shape, the same
  bucket as §2.8's `anchors` / `curve_control_points`. Zukai draws its own arc
  (`rules/junctions.md`) and does not claim Assimilator's.
- `LaneConfig.no_change_left` / `no_change_right` / `gap_after` (`:886-898`) — all
  `#[serde(default)]`, absent from both fixtures. This drop **does** cost meaning:
  a file that prohibits a lane change comes back permitting it. It is accepted
  rather than hidden because Zukai has no lane-change concept to attach them to,
  and inventing carried fields for a case no fixture exercises is how a mirror
  rots. OQ-5 is the general answer if a real file ever needs it.
- `NodeConfigRepr.z` (`:725-726`) — the same deal, for the same reason, and the
  one §2.7 already implied without naming: Zukai writes `z_enabled: false` because
  it has no elevation, so a file with real z-coordinates comes back **flat**. An
  `Option` with `skip_serializing_if`, absent from both fixtures, and touched by no
  validator rule — but stated here rather than left to be inferred from
  `z_enabled`, because that inference is exactly the kind this section exists to
  stop being necessary.

### 2.4 Synthesizing geometry — and the two offsets that must *not* be baked in

`LinkConfig.geometry` is required and "must contain at least 2 points"
(`:786-788`); `NodeConfig.point` is required (`:719-730`). A schematic has neither,
so export invents both.

**The scale.** `layout.nodes[id].pos` is in abstract canvas units — `layout.rs:11-12`
says so outright. The renderer's own bridge is
`UNITS_PER_METRE = LANE_PX / DEFAULT_LANE_WIDTH = 9 / 3.5`
(`src/editor/geometry.ts:108`, `:120`),
so a canvas unit is 0.389 m and the T's arms (100 units) become 39 m. Proposed:
**divide by `UNITS_PER_METRE`**, so a road drawn at its true lane width comes out
at its true metric width and the drawing is at least self-consistent. OQ-2 puts the
alternative (a separate, larger export scale) to review, because 39 m arms make a
cramped simulation.

**The y axis.** SVG's y grows **down** (`src/editor/geometry.ts:600`, and junction
semantics §2.4 spends a paragraph on the handedness it causes). Assimilator's
metric frame grows **up** — its own `t_junction` puts the south node at
`[500, -300]`. So export **negates y** and import negates it back. Getting this
wrong mirrors the whole network, which is self-consistent, silently wrong, and
would pass any test written from the same premise — the identical trap
`movementKind` carries, and it gets the same treatment: a *named* compass bearing
in the gate, not "a positive and a negative".

**Two offsets are Assimilator's job, not the polyline's.** This is the part a naive
"just export `drawnPolyline`" gets wrong:

- **The carriageway offset.** `LinkConfig.median_gap`'s doc (`:797-803`) says
  "Each link is offset by `median_gap / 2` from the shared centerline" —
  Assimilator applies it. Zukai's `carriageways` (`geometry.ts`) already applies it
  to the *drawn* polyline. Exporting the drawn polyline therefore double-offsets
  every two-way road.
- **The alignment.** `LinkView.align` maps to `LinkConfig.lateral_offset`
  (`:789-796`, "Positive values shift the road to the right"), which Assimilator
  also applies itself. `layout.rs:84-91` already argues alignment is presentation
  "from which alignment is a *consequence* rather than an input" — this is that
  argument collecting.

So the exported polyline is built from the **node positions and `bends` alone**,
never from `drawnPolyline`, and `median_gap`/`lateral_offset` are written as
*values* for Assimilator to apply. OQ-1 asks whether `bends` belong in it at all.

**The seven rules the export must satisfy.** Parsing is not the bar — Assimilator
validates a `NetworkConfig` before it becomes a runtime network, and
`crates/network/src/validation.rs:8-18` lists exactly what it checks: link
endpoints reference existing nodes; movement `from_link`/`to_link` reference links
that actually touch the junction node; **lane indices in movements are valid for
the referenced link**; signal phase times sum to `cycle_time` (§2.3.2); **geometry
polylines start near `from_node` and end near `to_node`, tolerance 1 m**; speed
limits > 0; lane widths > 0. The design above satisfies all seven by construction —
building the polyline from the node positions is what makes rule 5 hold, and
deriving the lane lists from each link's own lane count is what makes rule 3
hold — but they are named here so Phase 3's gate can be checked against a list
rather than against intuition.

**A movement between links of unequal lane count** is the one place rule 3 leaves
room to get it wrong: a two-lane approach into a one-lane exit gives
`from_lanes: [0, 1]` and `to_lanes: [0]`, both individually valid, with no partner
for index 1 under `lane_mapping`'s positional matching. That is legal and is what
Assimilator's own auto-computation is for; export does not invent a `lane_mapping`
to paper over it.

**Where the synthesis runs.** In **Rust**, not TypeScript. `persist.rs:1-8` gives
the rule — "`serde_yaml` plus the model's serde attributes are the single source
of truth for the on-disk shape — a second (JS) encoder would drift" — and the
arithmetic here is a scale, a negation and a list concatenation, none of which
needs `geometry.ts`. That keeps the whole `network.yaml` shape inside one file
that `cargo test` can exercise without a browser, which the diagram-export spec's
DOM-bound layers conspicuously cannot.

### 2.5 Import: what is thrown away, and what a broken file does

Import reads a `NetworkConfig` and produces a `Document`.

- **`geometry` polylines are discarded.** This is the project's founding claim
  (`CLAUDE.md`: "a schematic intentionally distorts real geometry for clarity")
  and it is what makes import easy.
- **`point` is *not* discarded, it is demoted**: it seeds `layout.nodes` (§2.6)
  and never reaches `doc.nodes`, which stays geometry-free (`graph.rs:4-9`).
- **Unknown keys are ignored**, because nothing in Zukai's model derives
  `deny_unknown_fields` (`mod.rs:32-34` states this as the reason a new optional
  field costs no version bump). So `detectors`, `stops`, `conflict_pairs` and
  every simulation-only field pass through the reader untouched and unstored.
- **A malformed file yields the serde error, wrapped** — with one check ahead of
  it. §2.1's version probe runs first, so a file from a newer Assimilator gets a
  message that names the mismatch instead of an arbitrary field error. Past that
  there is nothing smarter to do, and inventing a friendly message for a parse
  failure would be guessing. The other obvious user error — pointing Import at a
  `.zkai`, or Open at a `network.yaml` — is handled by *file dialog filter* (§2.7)
  rather than by sniffing content.

**Import replaces the document; it does not merge.** `loadDocument`'s existing
shape (`state.ts`, `rules/persistence.md`) already means "this is now the
document", and a merge would need an id-collision policy that OQ-3 shows is not
worth inventing yet. Import therefore goes through the **same close-guard** as
Open — the unsaved-changes check `save_load_spec` Phase 4 built.

### 2.6 Seeding the layout, and why import is not a blank canvas

An imported network with no `layout` renders nothing: `drawnPolyline` returns
`undefined` for a node with no layout entry, which is exactly the case
`junctionArms` skips (`Diagram.tsx:368` — `if (!poly || poly.length < 2) continue`)
and `legalMovements` filters out (`src/editor/geometry.ts`). So import **must**
seed `layout.nodes` or the user opens a file and sees an empty page.

The seed is the metric `point`, converted by §2.4's scale and y-negation — the
inverse of export, and the whole reason import keeps the coordinates it claims to
discard. This is `CLAUDE.md`'s "semi-automatic, not auto-layout" exactly: the
positions arrive true-to-life and *wrong for a schematic*, and a human drags them
into a legible diagram. No orthogonalization, no octilinear snapping, no
auto-layout — a named non-goal in `CLAUDE.md` and still one here.

`layout.links` and `layout.junctions` are seeded with **defaults**, not derived:
every link gets `DEFAULT_LINK_STYLE` and every junction the `generic` glyph, the
same values `completeLink` and `setNodeKind` mint (`state.ts`). Deriving a road
class from a speed limit is a guess dressed as a fact, and junction semantics §2.2
is the standing argument for not letting semantics pick a glyph.

### 2.7 Where the logic lives

| Piece | Where | Tested by |
|---|---|---|
| `NetworkFile` and its structs — Zukai's serde mirror of `NetworkConfig` | `src-tauri/src/network/mod.rs` (new) | `cargo test` on committed fixtures |
| `import_network(path) -> Document` | `src-tauri/src/network/import.rs` | `cargo test` |
| `export_network(path, doc)` | `src-tauri/src/network/export.rs` | `cargo test` |
| the scale + y-negation, one place each way | `src-tauri/src/network/mod.rs` | `cargo test` |
| dialog + IPC glue, the close guard | `src/editor/files.ts` | the `bun run dev` pass |
| the two menu items | `src/editor/menu.ts`, `src/components/Toolbar.tsx` | the `bun run dev` pass |

**A new `network/` module, not more of `persist.rs`.** They are different formats
with different owners: `persist.rs` is Zukai's own shape and may change whenever
Zukai likes, while this one is another project's and may only change when that
project's does. Putting them in one file would make the second rule invisible.

**`Document.metadata` maps to `NetworkMetadata`** both ways: `name` and `author`
are common to both (`mod.rs:94-101`, `:669-674`). `coordinate_system` is written
as `"metric"` (its own default, `:687-689`) and **rejected on import if it is
present and anything else**, since every conversion in §2.4 assumes metres. The
"present and" is not pedantry — the key has a `#[serde(default)]`, so an absent
one already means metric and must not trip the rejection. `z_enabled` is written
`false` and `map_origin` is not written at all — Zukai has no elevation and no
projection.

**The export dialog states what it cannot supply.** Two things leave Zukai poorer
than they arrived and the user is told so rather than left to discover it: the
blocks §2.8 drops (OQ-5) and, for a junction drawn here rather than imported,
`priority`/`yields_to` (§2.3.1, OQ-8).

### 2.8 Non-goals

- **`detectors`, `stops`, `crossings`, `rerouters`.** Dropped on import, never
  written. They are simulation instrumentation, not road shape; a schematic has
  nowhere to draw one. This covers **both** `crossings` keys — the top-level one
  and the per-junction `JunctionConfig.crossings` (`:1019-1020`), which is a
  different field with the same name and is `#[serde(default)]` like the rest.
  OQ-5 asks whether *round-tripping* them opaquely is worth it, which is a
  different question from editing them.
- **Simulation-only junction fields** — `conflict_pairs`, `gap_acceptance`,
  `collision_avoidance`, `conflict_model`, `b_amber`, `enforce_entry_guards`,
  `stop_time`, `stop_line_offsets`, `arms`, `geometry`. `graph.rs:11-15` already
  records these as deliberately omitted and nothing here changes it. All are
  `#[serde(default)]` on Assimilator's side, so omitting them is legal.
- **`anchors` / `curve_control_points`** (`:804-817`). Assimilator's spline form.
  Export writes a plain `geometry` polyline; import ignores anchors, because a
  curve Zukai cannot draw is a curve Zukai should not claim to carry.
- **Editing signal plans.** No Inspector control, no phase editor — junction
  semantics OQ-1 cut that and nothing here revives it. But an imported plan is
  **carried and written back** (§2.3.2): `cross-4` has one, and dropping it would
  export a signalized junction that sits at red forever. Carried-not-edited is the
  same deal `priority`/`yields_to` get in §2.3.1.
- **Lane-pair movement editing.** Junction OQ-4 stays deferred; §2.3 synthesizes
  the lists at export rather than modelling them.
- **No auto-layout.** §2.6.
- **`project.yaml` and `demand.yaml`.** A scenario is three files; this spec
  touches one. Zukai has no concept of demand or of a simulation run.

## 3. Open questions

- **OQ-1** — **Does the exported polyline carry the schematic's `bends`?** A
  straight two-point line is honest placeholder geometry and matches `CLAUDE.md`'s
  "default spacing, straight links". Including `bends` makes the exported network
  look like the drawing, which is either helpful or a metric claim the schematic
  was never entitled to make. Proposed: **include them** — they are already in
  canvas units and convert by the same rule, and a road that visibly doglegs in
  Zukai arriving dead straight in Assimilator is more surprising than the reverse.
  (design-call.)
- **OQ-2** — **Is `UNITS_PER_METRE` the right export scale?** It makes the drawing
  metrically self-consistent (§2.4) but yields short roads: the T's 100-unit arms
  become 39 m, which is a cramped approach for a simulator. The alternative is a
  separate `EXPORT_METRES_PER_UNIT` chosen for plausibility rather than for
  agreement with the lane widths — at the cost of roads whose width and length are
  on different scales, which is exactly what a schematic *is*. **Decided: keep
  `UNITS_PER_METRE`** — neither review round objected, and it is the only choice
  that needs no new constant to justify. **What this spec cannot do is test it**
  (round 2): every gate here round-trips an imported fixture, and a round trip is
  scale-neutral by construction — the constant cancels. The evidence would have to
  come from simulating a network *drawn* in Zukai, which needs a hand-written
  demand file (§2.8, out of scope). So this stays open on purpose, decided by
  default rather than by proof, and it is one constant wide in the one function
  §2.7 says owns the scale. Whoever first exports an authored network and runs it
  is the one who can close this. (design-call; decided-by-default, deferred.)

  **Evidence from Phase 2, and it is about the *import* half.** The first look at
  a real imported network (`t_junction` through the app, 2026-07-26) says the
  drawing is unusable as a schematic: a 500 m arm is **1285 canvas units against a
  9-unit lane**, ~143 lane-widths of road. §2.6 predicted this — "true to life and
  *wrong for a schematic*" — and answered it with "a human drags them into a
  legible diagram", which is a lot of dragging. Two things follow. First, the fix
  is cheap where it looks expensive: **the constant cancels**, so import ÷ K and
  export × K are inverses for any K, and Phase 3's round-trip gate is indifferent
  to which one is chosen. Second, and this is the fork Phase 3 should settle
  rather than inherit:
  - **a smaller fixed constant** — one number, no round-trip cost, but a 5 km
    motorway is still unusable while a 50 m slip road becomes a dot;
  - **fit-to-extent at import** — scale so the network's bounding box lands in a
    legible frame. Not a metric claim at all, which is the honest thing about it,
    but import and export stop being inverses unless the factor is **stored per
    document**, which is a `SCHEMA_VERSION` bump and a new `layout` field;
  - **non-uniform spacing** — schematization proper, and a named non-goal
    (`CLAUDE.md`, §2.6).

  **Settled in Phase 3, and the first branch is now *disproven* rather than
  doubted.** The "50 m slip road becomes a dot" objection above was written as a
  hypothetical; the two committed fixtures make it concrete, which is the evidence
  this OQ had been missing. At today's 2.571 u/m, `t_junction`'s 500 m arm is 1285
  units against a 9-unit lane — 143 lane-widths, unusable — but `cross-4`'s 100 m
  arms are 257 units, ≈28 lane-widths, which is a perfectly legible schematic. Pick a
  constant small enough to fix `t_junction` (~0.2 u/m) and `cross-4`'s arms become 20
  units, **shorter than its own 21-unit-wide road**. One number cannot serve both,
  and no third fixture is needed to see it. So: **`UNITS_PER_METRE` kept**, the fixed
  constant closed, and **fit-to-extent is the only live branch** — for a spec that
  can afford the schema bump, not this one. Still untested by any gate here, for the
  reason above: a round trip is scale-neutral by construction.
- **OQ-3** — **Id collisions on import.** Assimilator ids are free-form
  (`L_W_J`, `M_major_thru`), and Zukai's `nextId` parses a **numeric** suffix
  (`document.ts:129-138`), so after importing a file of non-numeric ids the next
  minted link is `L1` — which cannot collide. A file that mixes `L1` and `L_W_J`
  is also safe, since `nextId` takes the max numeric suffix. So: **no collision is
  reachable**, and import preserves ids verbatim. Recorded rather than left
  implicit, because "ids are preserved" is a claim the export direction depends on.
  (answerable-from-code; **RESOLVED — confirmed in round 1**: `Number.parseInt`
  on `"_W_J"` is `NaN` and skipped, so a non-numeric suffix cannot raise the
  counter. Phase 4's gate now leans on this directly — the exported `cross-4` only
  drops into its own scenario directory because its node ids survive the trip.)
- **OQ-4** — **Import replaces; should there be a merge?** §2.5 says no. The use
  case that would want one is importing a second interchange beside the first,
  which is really a "paste a fragment" feature and wants its own spec.
  (design-call; deferred.)
- **OQ-5** — **Opaque round-trip of the blocks Zukai drops?** Import →export
  currently **destroys** a file's `detectors`, `stops` and `conflict_pairs`. Storing
  them verbatim in the `Document` (a `serde_yaml::Value` blob, never rendered,
  never edited) would make a round trip lossless. Against: it puts un-modelled
  foreign data in `.zkai`, which every other spec has refused. Proposed: **no** —
  and say so in the export dialog, rather than silently. (design-call.)
- **OQ-6** — **RESOLVED (round 1): the `PhaseConfig` trap is live, not future.**
  The draft assumed no `SignalPlan` was reachable because nothing in Zukai mints
  one. `cross-4` mints one — it is `control: signal` with a `signal_plan`, and
  Phase 1 imports it. Answer: **fix it now.** `green_movements` gets the same
  always-write rule as `from_lanes`, and the fix landed in §2.3.2 rather than
  waiting for a signal-plan spec that may never come.
- **OQ-7** — **RESOLVED (round 1): how the fixtures are kept honest, and what the
  CLI check actually is.** Commit them with a `README` naming the source path and
  the date read (unchanged from the draft). The draft's second half was not
  performable: `assimilator validate` is a **stub** (`crates/cli/src/main.rs:330`
  prints "validate: not yet implemented"), and the binary cannot load a bare
  `network.yaml` at all — `runner.rs:95-160` wants a project directory, and the
  demand file references node ids. Phase 4's gate now names the real procedure
  (import `cross-4`, export, swap the result into a copy of its own scenario
  directory, `assimilator run`), which works precisely because import preserves ids
  verbatim (OQ-3). Still needs the human to run it.
- **OQ-8** — **`priority`/`yields_to` for a junction Zukai *drew*.** §2.3.1 carries
  both fields through a round trip, but an authored priority junction exports with
  every movement `major`, i.e. a give-way rule with nothing giving way. Deriving
  major/minor from road class or arm angle is available and rejected for now as a
  guess dressed as a fact (§2.6's standing argument). The real fix is an Inspector
  control — a per-movement major/minor toggle, which is small — but it is a junction
  semantics feature rather than a file-format one, so it wants that spec, not this
  one. (design-call; deferred, and stated in the export dialog meanwhile.)

## 4. Implementation phases

Strictly sequential; each is one plan-mode pass with a concrete exit gate.

### Phase 1 — The format, read

- **Scope:** Zukai's serde mirror of `NetworkConfig`, and reading a real file into
  a `Document`. **Rust only** — no IPC, no UI, no TypeScript.
  - `src-tauri/src/network/mod.rs` — `NetworkFile`, `NetworkNode`, `NetworkLink`,
    `NetworkLane`, `NetworkJunction`, `NetworkMovement`, `NetworkSignalPlan`,
    `NetworkPhase`, mirroring §2.1's table. `point` is declared as a **two-element
    array**, `[f64; 2]`, which sidesteps rather than reproduces Assimilator's
    hazard: its own `NodeConfig` doc (`:694-700`) explains that a bare `y:` key is
    coerced to boolean `true` under YAML 1.1, and it needs the `NodeConfigRepr`
    two-struct trick only because its in-memory struct splits `x`/`y`. Zukai's
    mirror has no `y:` key to be coerced, so it needs no such trick — **carry the
    doc-comment, not the pattern.**
  - **Optionality is mirrored per field, not guessed from `graph.rs`.** A mirror
    copied field-for-field from Zukai's model would reject legal files: e.g.
    `MovementConfig.movement_type` is `#[serde(default, rename = "type")]`
    (`:1351`) while Zukai's `Movement.kind` has no default, so a movement that
    omits `type:` would fail to parse even though Assimilator accepts it. Neither
    fixture catches this (both write `type:` on every movement), so it is called
    out here instead. The rule: **every field's `default` follows Assimilator's
    source, not Zukai's mirror.**
  - The **`schema_version` probe** (§2.1): absent/`0`/`1` accept, `> 1` reject with
    a message naming the version. Read and strip it before deserializing, the way
    `parse_and_check` does.
  - `src-tauri/src/network/import.rs` — `network_to_document`, pure: discard
    `geometry`, demote `point` to `layout.nodes` (§2.6), default
    `layout.links`/`layout.junctions`, carry `priority`/`yields_to` (§2.3.1),
    `lane_mapping` (§2.3.3) and any `signal_plan` (§2.3.2), reject a
    `coordinate_system` that is present and not `metric`.
  - **The model change** (§2.3.1, §2.3.3): `Movement` gains `priority:
    MovementPriority`, `yields_to: Vec<MovementId>` and `lane_mapping:
    Vec<LaneMappingEntry>`, plus a new `MovementPriority` enum (`major`/`minor`,
    `lowercase`, default `major`) and a `LaneMappingEntry` (`from`/`to` lane
    indices) — all carried, with no Inspector control. The TypeScript mirror in
    **`src/model/types.ts`** (`Movement` at `:68-75`) moves in the same commit, per
    `rules/document-model.md §"Rust ↔ TypeScript mirror"`.
  - Fixtures: `src-tauri/tests/fixtures/network/{t_junction,cross-4}.yaml`, copied
    from `../assimilator/demo/dist/scenarios/`, with a `README.md` naming the
    source path and the date (OQ-7).
  - **The `graph.rs:151-157` correction** (§2.3): the doc-comment is factually
    right — Assimilator does emit `from_lanes: []` for u-turns — so it gains the
    part that matters, "the key is always written; `[]` is legal, absent is not",
    and a pointer to §2.3. Comment only; the attribute question is Phase 3's,
    where the writer that depends on it lands.
- **Exit gate:** `cargo test` + `cargo clippy --all-targets -- -D warnings` green.
  - Both fixtures parse, and `t_junction` yields **4 nodes, 3 links, 1 junction
    with 2 movements**, ids verbatim (`L_W_J`, `M_major_thru`).
  - `doc.nodes` carries **no coordinates** and `doc.links` **no polyline** — the
    geometry-free claim, asserted rather than assumed.
  - `layout.nodes["S"]` is the seeded position, with its **y negated**: the fixture
    has `[500, -300]` and south is `+y` on the canvas. A *named compass bearing*,
    per §2.4's handedness warning.
  - A `coordinate_system: geographic` file is **rejected** with a readable message,
    and one with **no `coordinate_system` key at all** is **accepted** (§2.7).
  - `t_junction`'s `M_minor_left` imports with `priority: minor`,
    `yields_to: ["M_major_thru"]` and its `lane_mapping` populated (§2.3.1,
    §2.3.3) — the assertion that catches a mirror silently dropping any of the
    three. All three are asserted here so Phase 1's gate is the same audit its
    §2.3.3 claim promises, rather than leaving `lane_mapping` for Phase 3 to catch.
  - `cross-4` imports its **signal plan**: `control: signal`, a `SignalPlan` with
    its phases, and every movement — all counts read from the fixture rather than
    assumed (§2.3.2).
  - A file with **no `schema_version`** parses (both fixtures are such files), and
    one with `schema_version: 99` is **rejected** with a message naming the version.
- **Docs touched:** a new `rules/network-yaml.md`, or a section of
  `rules/persistence.md` — decide in the plan, on the "who chose it" line every
  prior Phase 1 used; **`CLAUDE.md`**, whose spec list gains this spec (its
  `schema_version` sentence is **correct** — §2.1 — and must be left alone);
  `rules/document-model.md`, for the two new `Movement` fields; the project-memory
  roadmap.

**As built (2026-07-26).** Gate met: `cargo fmt --check`, `cargo clippy
--all-targets -- -D warnings`, 43 `cargo test`, plus `bun run build` and 359
vitest, all green. Six notes, the first two being decisions the spec left to the
plan and the rest things the phase found:

- **The rule file is its own** — `rules/network-yaml.md`, not a section of
  `rules/persistence.md`, whose whole structure is one toolbar→dialog→IPC→reducer
  path table a Rust-only phase would fill with empty cells.
  `rules/diagram-export.md` is the standing precedent, and Phases 2/4 already list
  `persistence.md` *separately alongside* "the Phase 1 rule file".
- **The mirror reuses Zukai's enums rather than redeclaring them** (chosen by the
  user). §2.1 verified the spellings value by value and this phase's bullet names
  eight *structs* and no enums, so `NodeKind`/`JunctionControl`/`UnsignalizedRule`/
  `MovementKind` are imported straight from `model::graph` and the importer has no
  match arms at all. The reuse is a coupling, so it is pinned by
  `the_shared_enums_spell_what_assimilator_spells`, which asserts each against a
  literal from the fixture plus the three variants no fixture carries.
- **`pub mod network;`, and the reason is the gate.** Phase 1 registers no
  command, so nothing in the binary reaches the module; a private `mod` leaves
  every item unreachable from the crate root and fails `-D warnings` on
  `dead_code`. Worth knowing before Phase 2 tries to narrow it back.
- **`priority` is elided when `major`.** `rules/document-model.md`'s "pair every
  defaulted field with a `skip_serializing_if`" applies, and a plain enum has no
  helper — so `MovementPriority::is_major` is `LinkAlign::is_centre`'s twin. That
  is what makes the field cost no `SCHEMA_VERSION` bump *and* leaves every
  existing `.zkai` saving byte-for-byte as before. On the **mirror** the same
  field is `#[serde(default)]` with no skip, because that is Assimilator's shape —
  the two disagree on purpose.
- **The mirror rule paid out twice, in opposite directions**, and both are tested
  where neither fixture would catch them: a movement omitting `type:` must
  **parse** (`default_movement_kind`), and one omitting `from_lanes:` must
  **fail** (declared bare, no default, no skip). The second is what will make
  §2.3's always-write rule hold for free in Phase 3.
- **One assertion had to be sharpened, not weakened**: "the semantic graph carries
  no coordinates" first failed on its own needle, because `endpoint` contains
  `point`. The needles are now the key forms with their trailing colons.

### Phase 2 — Import into the app  (depends on Phase 1)

- **Scope:** the `import_network` Tauri command and the glue that reaches it —
  the path `save_load_spec` Phase 3 already built for Open, followed step for step.
  - `#[tauri::command] import_network(path) -> Result<Document, String>`, registered
    in `lib.rs` beside `load_document`.
  - `src/editor/files.ts` — an `importNetwork()` beside `openDocument()`, with a
    `.yaml`/`.yml` dialog filter (§2.5) and **the same unsaved-changes close
    guard**.
  - `src/editor/menu.ts` + `Toolbar.tsx` — a File ▸ Import network… entry.
  - The imported document is **dirty and pathless**: it is not a `.zkai` and
    Save must not overwrite the `network.yaml` it came from. That is the one
    behaviour that differs from Open, and the reason this phase is not just glue.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green.
  - `state.test.ts`: importing sets `dirty`, leaves `currentPath` **null**, and
    **resets history** — `past` and `future` both empty. That last one is not a
    choice this phase makes: `loadDocument` already clears both under the comment
    "Installing a whole document resets history: there is nothing to undo across a
    file boundary" (`src/editor/state.ts:177-191`), restated in
    `rules/history.md`. An import *is* a file boundary, so it inherits the rule —
    and the close guard below is what protects the work an undo no longer can.
  - A `bun run dev` pass: import `t_junction.yaml`, see the T on the canvas
    (positioned, not blank — §2.6's whole point), drag a node, and confirm Save
    prompts for a **new** `.zkai` path rather than writing the YAML back.
- **Docs touched:** the Phase 1 rule file; `rules/persistence.md`, whose
  toolbar→dialog→IPC→reducer map gains a third entry point.

**As built (2026-07-26).** Gate met: `cargo fmt --check`, `cargo clippy
--all-targets -- -D warnings`, 46 `cargo test` (+3), `bun run build` and 360
vitest (+1), all green; the `bun run tauri dev` pass is the user's. Four notes,
the first two being decisions the spec left to the plan:

- **Menu only — no toolbar button and no accelerator** (chosen by the user).
  `FileActions` gains `onImport` and `FILE_COMMANDS` deliberately does not, so
  the toolbar keeps the five everyday commands and the interface stays the one
  shared surface. The item sits below a separator, since New→Export… all act on
  Zukai's own document and this one reads another program's; Phase 4's Export
  network… joins it in that block. No accelerator also means no case in
  `App.tsx`'s keydown handler — the one place a menu item and a chord have to be
  kept in sync.
- **The command lives beside the pure conversion**, per §2.7's table, and
  `import.rs`'s module doc draws the line rather than losing it: nine lines of
  read-then-convert, so every existing test still reaches
  `network_to_document` with a `&str`. Phase 3's writer takes the same shape.
- **`pub mod network;` narrowed back to `mod network;`.** Phase 1 predicted this
  ("worth knowing before Phase 2 tries to narrow it back") and it held —
  `import_network` is the caller from the crate root that `dead_code` wanted, and
  clippy stays green.
- **Three arms, one install.** `loadDocument`, `importDocument` and `newDocument`
  differ in exactly two fields, so the seven-field file-boundary reset became one
  `install(state, doc, currentPath, dirty)` helper rather than a third copy. The
  history reset was never this phase's choice to make — `loadDocument` already
  cleared both stacks — and the extended test now pins all three at once.
- One thing worth knowing before Phase 4: handing Import a `.zkai` fails with the
  **version probe's** message, `.zkai` being at schema 2 against Assimilator's 1.
  Odd phrasing for that case, and left alone — the extension filter is the guard,
  and a content sniffer to improve one wrong-file message is not worth it (§2.5).

### Phase 3 — The format, written  (depends on Phase 2)

- **Scope:** `document_to_network` and `export_network` — §2.4's synthesis and
  §2.3's required-field discipline. **Rust only** again; the UI is Phase 4.
  - The scale and y-negation, **one function each way**, shared with the importer
    so the two cannot drift.
  - `geometry` from node positions and `bends` (OQ-1), never from `drawnPolyline`;
    `median_gap` and `lateral_offset` written as **values**, not baked in (§2.4).
  - `from_lanes`/`to_lanes` by §2.3's three cases: verbatim when the model has
    them, `[]` for an empty u-turn, every lane index otherwise. Same always-write
    rule for `green_movements` on a signal plan (§2.3.2), and `priority` /
    `yields_to` written from the model (§2.3.1).
  - `schema_version: 1` stamped as the **first line** (§2.1).
  - A node with **no layout entry** has no position to export. Proposed: place it
    at the origin and let the gate pin the behaviour, since the alternative —
    refusing to export — punishes a document a hand-edit could produce. Settle in
    the plan.
- **Exit gate:** `cargo test` + `cargo clippy --all-targets -- -D warnings` green.
  - **The round trip**: `t_junction.yaml` → import → export → parse **again**, and
    the second `NetworkFile` equals the first on everything §2.5 keeps (ids, kinds,
    topology, lanes, control, rule, movements — **including `priority`,
    `yields_to` and `lane_mapping`**, the three that fail silently rather than
    loudly (§2.3.1, §2.3.3)). Same round trip for `cross-4`, whose **signal plan
    and four empty-lane u-turns** must both survive unchanged (§2.3.2, §2.3 case 2).
    What it must *not* claim to equal is `geometry`, `detectors`, `gap_acceptance`,
    `turn_speed`, `control_points`, node `z`, or the `LaneConfig` lane-change
    flags — the gate
    asserts those are **gone** (§2.3.3), so "lossless" is never accidentally
    claimed. Every field of the eight mirrored structs lands in one list or the
    other; that is what makes the gate an audit rather than a spot-check.
  - **A crossed `lane_mapping` survives**: a hand-built movement mapping `0→1` and
    `1→0` exports with that mapping intact, not with the positional identity
    `from_lanes`/`to_lanes` would regenerate. Neither fixture is crossed, so this
    one is written by hand — it is the only assertion that distinguishes carrying
    the field from getting lucky (§2.3.3).
  - **Every required key is present** on a document built through the reducer:
    `metadata`, every node's `point`, every link's `geometry` with ≥2 points, every
    lane's `width`/`speed_limit`, and — the assertion this whole section exists for
    — **every movement's `from_lanes` and `to_lanes`**. A test that re-parses the
    emitted string into `NetworkFile` catches all of them at once, and would have
    failed on day one against today's `skip_serializing_if`.
  - A two-way road's two carriageways export the **same, unoffset polyline** — not
    two offset ones (§2.4's double-offset trap, and the assertion that catches
    exporting `drawnPolyline`). `median_gap` is written per link, on both, the way
    `cross-4` writes it.
  - The seven validator rules (§2.4) hold on the emitted file: in particular every
    polyline's endpoints are **within 1 m** of its `from_node`/`to_node` and every
    movement's lane indices are in range for the link they name.
  - The y round-trips: a node south on the canvas exports negative and imports back
    south.
- **Docs touched:** the Phase 1 rule file.

**As built (2026-07-26).** Gate met: `cargo fmt --check`, `cargo clippy
--all-targets -- -D warnings`, 64 `cargo test` (+18), plus `bun run build` and 360
vitest, all green. Six notes, the first two being the forks the spec handed to the
plan and the rest things the phase found:

- **OQ-2 is settled by disproof, not by choice** (decided by the user). Keeping
  `UNITS_PER_METRE` was the recommendation, but the argument for it is new: checking
  the two fixtures *against each other* shows **no fixed constant serves both**. At
  2.571 u/m `t_junction`'s 500 m arm is 1285 units (143 lane-widths, unusable) while
  `cross-4`'s 100 m arms are 257 (≈28, perfectly legible); at a constant small enough
  to fix the first, `cross-4`'s arms fall to 20 units — **shorter than its own
  21-unit-wide road**. The "smaller fixed constant" branch is therefore dead rather
  than merely doubted, which leaves fit-to-extent (a factor stored per document, so
  the two directions stay inverses) as the only live answer, and that is a
  `SCHEMA_VERSION` bump for a later spec.
- **`lateral_offset` is derived from `align`, in metres** (chosen by the user). §2.4
  said the two "map" without saying how literally. The signs already agree — a
  positive `lateral_offset` and a positive canvas shift both mean *right of travel* —
  so it is a three-line match on `Σ lane widths / 2`. What it deliberately does *not*
  use is `alignmentShift`'s canvas value, which folds in `ROAD_MARGIN` and the class
  width factor; exporting those would dress a rendering artefact as a surveyed offset.
- **The command shipped in this phase, not Phase 4, and clippy is why.** An
  unregistered `#[tauri::command]` in the private `mod network` is unreachable from
  the crate root and fails `-D warnings` on `dead_code` — Phase 1 hit this exactly.
  One line in `generate_handler!`; Phase 4 is now purely frontend.
- **The gate was mutation-tested, and one test was found not to bite.**
  `an_authored_document_writes_every_required_key` is the assertion this whole
  section exists for, and against a deliberately broken mirror (a
  `skip_serializing_if` on `from_lanes`) it **passed** — because every movement in
  the hand-built document was a `through` or a `left`, which §2.3 case 3 fills, so
  the skip never had an empty list to swallow. Adding a **u-turn** is what made it a
  real check: 3 tests caught the mutation before, 7 after. Un-negating the export's
  y fails 5. Both mutations are recorded in the rule file, because "all green on the
  first run" is not evidence about a format.
- **The write-side attributes are set independently of the mirror rule**, and the
  module doc now says so. Optionality follows Assimilator (a *reader* concern);
  `skip_serializing_if` is a separate choice, and the two are opposite here: every
  `Option` in the mirror gained one, so the emitted key set matches the fixtures'
  exactly (`rule:` on `t_junction` and not on `cross-4`, no `author: null`), while
  every **bare** field must never gain one. Conflating them is precisely how
  `from_lanes` breaks.
- **A drop §2.3.3's 62-field audit missed:** `lateral_offset` is *mirrored* on read
  but never carried into the `Document`, so a file with `lateral_offset: 2.0` comes
  back at whatever `align` derives — 0, for anything imported. Same silent shape as
  node `z`, found only because this phase had to decide what to *write* there.
  Recorded in the rule file's drop list beside `z` rather than fixed: the honest fix
  is a metres→`align` inference that is lossy in the other direction.

### Phase 4 — Export from the app, and the proof it works  (depends on Phase 3)

- **Scope:** the last of the glue, and the only verification that actually matters.
  - `#[tauri::command] export_network(path, doc)`, a File ▸ Export network… entry,
    and a save dialog defaulting to `network.yaml`.
  - An **export is not a document** — `rules/diagram-export.md`'s rule, applied
    again: exporting must not set `currentPath` and must not clear `dirty`.
  - OQ-5's honesty note in the dialog or a one-line confirmation: what is being
    dropped.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green.
  - `state.test.ts`: exporting leaves `dirty` and `currentPath` untouched.
  - A `bun run dev` pass: import `cross-4`, export it, and **run the result through
    Assimilator's own simulator** — the one check no test in this repo can perform,
    and the only one that proves the format claim (OQ-7; needs the human).

    The procedure is named here because the draft's was not performable: there is
    no way to hand Assimilator a lone `network.yaml`. `assimilator validate` is a
    **stub** (`crates/cli/src/main.rs:330` prints "validate: not yet implemented"),
    and `run` takes a project directory, resolving `network` and `demand` through a
    `project.yaml` (`crates/cli/src/runner.rs:95-160`). So:

    ```bash
    cp -r ../assimilator/demo/dist/scenarios/cross-4 /tmp/zukai-export-check
    cp <the exported file> /tmp/zukai-export-check/network.yaml
    cd ../assimilator && cargo run --bin assimilator -- \
      run --config /tmp/zukai-export-check --duration 60
    ```

    **Round-tripping `cross-4` specifically is what makes this work**: its
    `demand.yaml` addresses origins and destinations by node id, and import
    preserves ids verbatim (OQ-3), so the exported network still answers to the
    demand sitting beside it. A hand-drawn cross would need a hand-written demand
    file, which §2.8 puts out of scope.

    **Pass = the run completes and reports vehicles arriving** — `runner.rs:392`
    prints `Vehicles: {} completed, {} active`, so the criterion is observable
    rather than a judgement. Not merely "no parse error": the validator (§2.4) runs
    after parsing, and a network that loads but strands every vehicle is exactly
    the silent failure §2.2 says this direction is prone to.

    **This gate proves the format claim and nothing about OQ-2.** Round-tripping
    `cross-4` is scale-*neutral*: import multiplies by `UNITS_PER_METRE` and export
    divides by it, so the simulated network has the fixture's original 100 m arms
    whichever constant is chosen. Only a network drawn in Zukai would exercise the
    scale, and that needs a hand-written demand file (§2.8). Said plainly here
    because the obvious reading — "we ran it, so the scale is fine" — is wrong.
- **Docs touched:** the rule file; `rules/persistence.md`; the project-memory
  roadmap; mark this spec `implemented`.

## 5. Review log

### Round 1 — 2026-07-26 — NOT READY → fixed

Clean-context reviewer with access to **both** repos. Five blocking findings, all
verified against source before folding in. The draft's own list of "reviewer's
highest-value targets" scored 1 for 4: §2.3's required-lanes claim held, §2.1's
headline was **backwards**, OQ-2 drew no objection, and Phase 1's fixture concern
turned out to be the least of it.

**Blockers fixed:**

1. **§2.1 reversed.** The draft claimed `network.yaml` has no `schema_version` and
   that `CLAUDE.md` was wrong to say otherwise. The header is real —
   `version.rs:20-22` strips it *before* serde, which is why `NetworkConfig` has no
   field. Import now probes it, export now stamps it, and the instruction to "fix"
   `CLAUDE.md` is gone before it could install an error. (The fixtures carry no
   header, so "absent → accept" is load-bearing.)
2. **Phase 2's gate contradicted the reducer.** It demanded an import be "one undo
   step away from the previous document"; `loadDocument` clears `past`/`future` and
   `rules/history.md` documents why. Gate now asserts the reset.
3. **`priority` / `yields_to` were unmodelled and undeclared.** Both optional, so
   nothing would have failed to parse — a round trip would silently promote
   `t_junction`'s minor movement to major and export a priority junction where
   nothing yields. `Movement` gains both fields, carried-not-edited (§2.3.1); the
   authored-document gap is OQ-8.
4. **`cross-4` is signalized.** The draft called signal plans a non-goal *and*
   committed a fixture with a `signal_plan`. Zukai's model already has the types;
   §2.3.2 now carries it, and OQ-6's "not reachable today" is closed as false.
5. **Phase 4's gate was not performable.** `assimilator validate` is a stub and the
   CLI cannot load a bare `network.yaml`. Replaced with a named command, a
   companion-file procedure that works *because* ids round-trip, and a pass
   criterion stronger than "no parse error".

**Non-blocking, accepted:** `MovementType` is `lowercase` not `snake_case` (inert,
recorded so nobody "fixes" it); three drifted line cites (`Diagram.tsx:368`,
`geometry.ts:600`, the `src/editor/` prefix); §1's "nothing else touches a file"
(`recent.rs`); per-field optionality must follow Assimilator's source, not Zukai's
mirror (`movement_type`'s default); the `NodeConfigRepr` trick is unnecessary here —
carry the doc-comment, not the pattern; unequal lane counts; the seven
`validation.rs` rules now named in §2.4; `coordinate_system` must not reject an
*absent* key; `median_gap` is per link; the per-junction second `crossings`.

**Notable adjudication — accepted, but against the reviewer's framing.** It filed
the `graph.rs` doc-comment as a draft *over*statement: Assimilator really does emit
`from_lanes: []` for u-turns, so "empty … matching Assimilator" is true of the
data. Right — and it makes §2.3 **sharper**, not softer. The defect was never the
comment, it was `skip_serializing_if`, which writes no key at all where `[]` was
wanted. That split the one blanket rule into the three cases §2.3 now lists, and
case 2 is what lets `cross-4` round-trip byte-for-byte instead of being rewritten.

### Round 2 — 2026-07-26 — NOT READY → fixed

Same agent resumed. Confirmed all five round-1 blockers resolved, re-verifying each
against source rather than taking the changelog's word (including that the new
`MovementPriority` spelling is wire-correct, that cross-4's signal plan satisfies
validation rule 4 — 2 × (25+3+2) = 60 = `cycle_time` — and that every field of
`SignalPlanConfig`/`PhaseConfig` has somewhere to land in Zukai's model). It also
confirmed the three-case lane rule is implementable and endorsed the round-1
adjudication that went against its own framing.

**One new blocker, and it is the same failure mode a third time.**
`MovementConfig.lane_mapping` had no disposition anywhere: not mirrored, not a
non-goal, and in *neither* list of Phase 3's round-trip gate — while appearing on
both fixtures (twice in `t_junction`, twelve times in `cross-4`). Dropping it was
survivable only by luck, since every mapping in both files is the positional
identity that Assimilator regenerates anyway; a **crossed** mapping is legal and
would return re-wired, silently. Fixed by carrying it (§2.3.3), and the gate gains
a hand-built crossed mapping — the only assertion that tells carrying the field
apart from getting lucky.

That this class of bug surfaced three times (`priority`/`yields_to`, the signal
plan, now `lane_mapping`) is the actual lesson, so §2.3.3 replaces the accidents
with a rule and a completeness claim: every field of the seven mirrored structs is
now mirrored, carried, or named a non-goal, and the mirror can be audited against
that. `turn_speed`, `control_points` and the three `LaneConfig` lane-change fields
are declared dropped — the last of these with its cost stated rather than hidden.

**Non-blocking, accepted:** Phase 1 named the wrong TS mirror (`src/editor/
document.ts` → **`src/model/types.ts`**); two cites one line short
(`version.rs:34`, `classify` at `:58-81`); `runner.rs:392`'s printed line now
supplies Phase 4's observable pass criterion.

**Notable correction to my own reasoning.** Round 2 caught that Phase 4's gate
cannot settle OQ-2, which I had claimed it would: round-tripping `cross-4` is
scale-neutral — import multiplies by `UNITS_PER_METRE`, export divides by it, so
the constant cancels and the simulated network keeps the fixture's original arms
whatever it is set to. OQ-2 is now marked decided-by-default and explicitly
*untested*, with a note naming who could close it, rather than implying a gate
proves it.

### Round 3 — 2026-07-26 — READY (converged)

Same agent resumed. Zero blocking findings. It confirmed `lane_mapping` is carried
and that the crossed-mapping assertion is the correct discriminator (positional
mappings are regenerated by Assimilator, so a crossed one is the only case where
carrying and dropping diverge), and it re-verified the round-2 cite corrections.

**It then audited §2.3.3's field-completeness claim by enumerating every serialized
field from source — 62 across the mirrored structs — and found one hole**:
`NodeConfigRepr.z` (`:725-726`) was in no bucket. Filed non-blocking on the
grounds that only one answer is defensible and §2.7 already implies it, which is
the right call — but it is now named explicitly in §2.3.3's drop list, since a
completeness claim with a known exception is worse than none. A `z_enabled: true`
file comes back flat, and the spec now says so.

Also folded in: `LaneMappingEntry` makes it **eight** mirrored structs, not seven;
and Phase 1's import bullet and gate now both name `lane_mapping`, so that gate is
the audit §2.3.3 promises rather than deferring one field to Phase 3.

**Converged at zero blocking. `status` → `reviewed`; phases may now be planned.**
The three rounds cost five blockers, one new blocker, and one completeness hole —
and four of those seven were the same failure mode: a `#[serde(default)]` field
that parses fine and silently changes what the network means. §2.3.3 is the part
of this spec that exists to make the fifth one findable without a reviewer.
