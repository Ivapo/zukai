# `network.yaml`

Assimilator's file format — the one thing the two projects share, and the only
format Zukai reads that Zukai does not own. Nothing here moves `SCHEMA_VERSION`
(still **2**). Not to be confused with `rules/persistence.md`, which is `.zkai` —
Zukai's *own* YAML, a different format with a different owner. The design
rationale lives in `specs/network_yaml_spec.md`; hand-maintained.

**Build state: Phase 2 of 4.** The format is **read**, and a real file now
reaches the editor: a serde mirror, a version probe, `network_to_document`, the
`import_network` command and a File ▸ Import network… menu item. **No writer** —
nothing in Zukai can produce a `network.yaml` yet. `Movement` gained `priority`,
`yields_to` and `lane_mapping` in Phase 1; they are **carried, never edited**,
joining `Junction.signal_plan` and `Movement.from_lanes`/`to_lanes` on the list
of fields whose presence in `src/model/types.ts` is not evidence that anything
consumes them.

## Two formats, two owners, and that is why this is not `persist.rs`

| | `.zkai` (`persist.rs`) | `network.yaml` (`network/`) |
|---|---|---|
| Owner | Zukai | Assimilator |
| May change when | Zukai likes | Assimilator's does |
| Version constant | `model::SCHEMA_VERSION` (2) | `ASSIMILATOR_SCHEMA_VERSION` (1), **a copy** |
| Version lives | a `Document` field | a header read *above* serde |

The second row is the whole reason the module is separate. Merging them into one
file would make it invisible.

## The header is real, and it is not a struct field

`network.yaml` carries `schema_version`, **and** `NetworkConfig` has no field for
it. Both are true: Assimilator's `crates/config/src/version.rs` reads the key off
the parsed `Value` and **strips it** before typed deserialization, so every one of
its loaders sees a document without one. `CLAUDE.md`'s "the coupling point is the
documented, `schema_version`-keyed file format" is correct as written.

Three consequences, all in `network/mod.rs`:

- `parse_network` probes the version first, `persist.rs`'s `VersionProbe` shape
  with one difference that is load-bearing: **the field is an `Option`**.
  Assimilator's own demo scenarios carry no header — both committed fixtures start
  at `metadata:` — so a probe demanding one would reject the very files this
  module exists to read. **Absent / `0` / `1` accept; higher rejects by number.**
- No stripping is needed. Nothing derives `deny_unknown_fields`, so the full parse
  simply ignores the key — the same property that lets `detectors`, `stops`,
  `conflict_pairs` and every simulation-only field pass through untouched.
- `ASSIMILATOR_SCHEMA_VERSION = 1` is **a hand copy, not a derivation** — read
  from `crates/config/src/version.rs` at commit `d79c32d` on **2026-07-26**. It is
  the one number here that can rot silently, so the date travels with it.

## Optionality follows Assimilator's source, not Zukai's model

The mirror rule, and the failure it prevents: a mirror copied field-for-field from
`graph.rs` would **reject legal files**. `MovementConfig.movement_type` is
`#[serde(default, rename = "type")]` in Assimilator while Zukai's `Movement.kind`
has no default, so a movement omitting `type:` parses there and would have failed
here. Neither fixture catches it — both write `type:` on every movement — so
`a_movement_without_a_type_reads_as_through` exists instead.

The rule cuts the other way too, and that is the sharper half.
`MovementConfig.from_lanes` carries **no** `serde(default)`: an absent key is
`missing field `from_lanes`` and the *whole file* fails. So `NetworkMovement`
declares it bare — no default, no `skip_serializing_if` — and
`a_movement_without_from_lanes_fails_to_parse` is what catches someone helpfully
adding one. Writing the mirror faithfully is what will make the writer's
always-write rule hold for free.

**`[]` parses; nothing does not.** That distinction is the single most expensive
thing in this spec. Assimilator's own editor really does write `from_lanes: []`
for a u-turn — `cross-4` has four — so an empty list is correct *data*; what is
fatal is `skip_serializing_if`, which omits the key rather than writing `[]`.
`graph.rs`'s doc-comment now says so. Its attribute stays, because `.zkai` has no
reason to carry empty lists; the writer overrides it.

## The enums are shared, and one test is what keeps that honest

`NodeKind`, `JunctionControl`, `UnsignalizedRule` and `MovementKind` are **Zukai's
own, reused rather than redeclared** — every variant already produces
Assimilator's exact wire spelling, checked value by value. So the importer has no
match arms at all, and `MovementPriority`/`LaneMappingEntry` are shared the same
way.

That reuse is a coupling, so it is pinned:
`the_shared_enums_spell_what_assimilator_spells` asserts each spelling against a
literal lifted from the fixture, plus the three variants no fixture exercises
(`priority_right`, `all_way_stop`, `waypoint`). Drift on either side fails a test
instead of silently writing a foreign file.

One inert difference, recorded so nobody "fixes" it: Assimilator's `MovementType`
is `rename_all = "lowercase"` and Zukai's `MovementKind` is `snake_case`. Every
variant is one word and `UTurn` is explicitly renamed on both sides, so the wire
spellings are identical. **`u-turn`'s hyphen is Assimilator's and must never
become `u_turn`** — that spelling belongs to `TurnDirection`, which is paint.

## The scale, and the y that is a compass bearing

`metres_to_canvas` is the one conversion, and it does two things:

- **Scale by `UNITS_PER_METRE`** = `9 / 3.5`, a hand-mirror of
  `src/editor/geometry.ts`'s constant. Rust has neither half — `LANE_PX` never
  crosses IPC and the lane width is a `fn` behind `#[serde(default = "…")]` — so
  the arithmetic is written out literally rather than derived from something that
  does not exist here.
- **Negate y.** SVG's y grows *down*; Assimilator's metric frame grows *up*. A
  node 300 m **south** of the origin therefore lands at a **positive** canvas y.

Getting the sign wrong mirrors the whole network, which is self-consistent,
silently wrong, and passes any test written from the same premise. So every test
here names a **compass bearing** rather than a sign —
`a_node_300_metres_south_lands_at_a_positive_canvas_y`,
`the_southern_node_seeds_a_positive_canvas_y` — the same treatment `movementKind`
gets in `rules/junctions.md` for the same trap.

Note what the scale means in practice: a 500 m arm arrives 1285 canvas units long
against a 9-unit lane. That is **true to life and wrong for a schematic**, and it
is the intended outcome.

## What import throws away, and the one thing it demotes

- **`geometry` polylines are discarded.** The founding claim: a schematic
  intentionally distorts real geometry for clarity.
- **`point` is demoted, not discarded.** It seeds `layout.nodes` and never reaches
  `doc.nodes`, which stays geometry-free — asserted by
  `the_semantic_graph_carries_no_coordinates` rather than assumed. That seeding is
  not a nicety: a node with no layout entry has no drawable polyline, so an
  unseeded import would render a **blank page**.
- **`layout.links` and `layout.junctions` are seeded with defaults, never
  derived** — `LinkStyle::Arterial` and the `generic` glyph, the values
  `completeLink` and `setNodeKind` mint. A road class inferred from a speed limit,
  or a glyph from a control type, is a guess dressed as a fact; the human is about
  to redraw all of it anyway. `layout.junctions` is keyed off **node kind**, the
  pairing `setNodeKind` maintains, not off the presence of a junction record.
- **Dropped with a stated cost**, rather than silently: node `z` (a
  `z_enabled: true` file comes back **flat**), `LaneConfig`'s three lane-change
  flags (a file prohibiting a lane change comes back permitting it),
  `turn_speed` and `control_points` (tuned against real geometry Zukai does not
  have), and the four instrumentation blocks.
- **The only error is a non-`metric` `coordinate_system`** — and the check must
  not fire on an **absent** key, which `#[serde(default = "default_coordinate_system")]`
  already reads as metric. Both halves are tested. Past that a malformed file
  yields the wrapped serde error; inventing a friendly message for a parse failure
  would be guessing.

## The four fields that fail quietly

This format's characteristic bug is a `#[serde(default)]` field that parses
cleanly and changes what the network *means*. Review found four, three of them
after the draft was written:

| Field | What dropping it does | No parse error because |
|---|---|---|
| `from_lanes`/`to_lanes` | file becomes unparseable *on write* | the key is omitted, not emptied |
| `priority`/`yields_to` | a minor movement is **promoted to major** — a give-way junction where nothing gives way | both default, `priority` to `Major` |
| `signal_plan` | a `control: signal` junction arrives with no timing and sits at red | serde-optional, semantically required |
| `lane_mapping` | a **crossed** mapping (`0→1, 1→0`) comes back re-wired | Assimilator regenerates the positional identity, so only a crossed one diverges |

A field is **carried** if dropping it would silently change meaning for a file
Zukai round-trips; **dropped** if Assimilator recomputes it from data Zukai does
supply, or if it is simulation instrumentation. Neither bucket implies an editor.
A field in *neither* bucket is a bug, not an omission — spec §2.3.3 enumerates all
62 against source.

## How a network reaches the editor

The Open path of `rules/persistence.md`, one format over, with **two deliberate
differences** — both following from the file belonging to another program:

| Step | Where |
|------|-------|
| Trigger | File ▸ Import network… (`src/editor/menu.ts`) — **menu only**: no toolbar button, no accelerator |
| Dialog + IPC | `importNetwork` (`src/editor/files.ts`), `.yaml`/`.yml` filter, same unsaved-changes guard as Open |
| Command | `import_network` (`src-tauri/src/network/import.rs`), registered in `lib.rs` |
| Apply | the `importDocument` reducer case (`src/editor/state.ts`) |

- **The document arrives dirty and pathless.** `importDocument` sets
  `dirty: true` and `currentPath: null`, so Save falls through to the Save As
  picker rather than writing a schematic back over Assimilator's network. This is
  the only thing in the phase that is not plumbing, and
  `importDocument installs the network dirty and pathless` (`state.test.ts`) is
  what holds it.
- **The path is not remembered.** "Open Recent" opens through `load_document`,
  which reads `.zkai`, so a `network.yaml` in that list could only ever fail —
  the same reasoning that keeps an exported `.svg` out of it.
- Everything else it *inherits*, history reset included: an import is a file
  boundary, so `past`/`future` clear, and the work being replaced is protected by
  the unsaved-changes prompt rather than by an undo (`rules/history.md`).
- The **extension filter is the only guard** against pointing Import at a `.zkai`
  (or Open at a `network.yaml`) — neither reader sniffs content. The fallback is
  an error, not a half-formed document: `a_zkai_document_is_not_a_network` pins
  it, and the message it happens to get is the version probe's, `.zkai` being at
  schema 2 against Assimilator's 1.
- No new Tauri permission: `dialog:default` already grants `open`.

## Where each piece lives

| Piece | File |
|---|---|
| `NetworkFile` + the eight mirror structs | `src-tauri/src/network/mod.rs` |
| `ASSIMILATOR_SCHEMA_VERSION`, `UNITS_PER_METRE` | `src-tauri/src/network/mod.rs` |
| `VersionProbe`, `parse_network`, `metres_to_canvas` | `src-tauri/src/network/mod.rs` |
| `network_to_document` and its three helpers | `src-tauri/src/network/import.rs` |
| `import_network`, the command around it | `src-tauri/src/network/import.rs` |
| `importNetwork` (dialog + IPC), the `.yaml` filter | `src/editor/files.ts` |
| the `importDocument` case and the `install` helper | `src/editor/state.ts` |
| `MovementPriority`, `LaneMappingEntry`, the three carried fields | `src-tauri/src/model/graph.rs` |
| the TypeScript mirror of those | `src/model/types.ts` |
| the two fixtures + their provenance | `src-tauri/tests/fixtures/network/` |

`import.rs` holds both the pure conversion and the I/O shell, and the module doc
draws the line: `network_to_document` takes a parsed `NetworkFile` and touches no
filesystem, so every test above reaches it with a `&str`. Phase 3's writer takes
the same shape.

`mod network;` in `lib.rs` is **private again** as of this phase. Phase 1 needed
`pub` only because nothing in the binary called into it, which left every item
unreachable from the crate root and failed
`cargo clippy --all-targets -- -D warnings` on `dead_code`; `import_network` is
now that caller.

The fixtures are the **first checked-in test data in the repo**. They are loaded
with `include_str!` from the inline `#[cfg(test)]` modules, so no
`src-tauri/tests/*.rs` integration target exists — a `fixtures/` subdirectory with
no top-level `.rs` is invisible to cargo, and the bytes stay out of the release
binary.

## Still unbuilt

Everything after "read". By plan, not by omission:

- **The writer.** `document_to_network` and `export_network` are Phase 3 — where
  geometry must be *synthesized* from node positions and `bends` (never from
  `drawnPolyline`, which has the carriageway offset and the alignment already
  baked in, and Assimilator applies both itself), `schema_version: 1` gets stamped
  as the first line, and the always-write rule for `from_lanes`/`to_lanes`/
  `green_movements` finally has code depending on it.
- **Export from the app.** The second menu item, the save dialog and the honesty
  note about what is being dropped are Phase 4 — as is the only check that proves
  the format claim: running an exported `cross-4` through Assimilator's own
  simulator.
- **Editing any of the carried fields.** No Inspector control for `priority`,
  `yields_to`, `lane_mapping` or signal plans. An authored priority junction
  therefore exports with every movement `major`, which the export dialog will say
  out loud rather than hide.
- **Opaque round-trip of the dropped blocks.** A file's `detectors` and
  `conflict_pairs` are destroyed by an import→export cycle. Storing them as an
  un-modelled blob in `.zkai` was considered and refused.
- **Merge on import, and auto-layout.** Import replaces the document; positions
  arrive true-to-life and a human makes them legible.
