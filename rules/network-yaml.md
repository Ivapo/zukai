# `network.yaml`

Assimilator's file format — the one thing the two projects share, and the only
format Zukai reads that Zukai does not own. Nothing here moves `SCHEMA_VERSION`
(still **2**). Not to be confused with `rules/persistence.md`, which is `.zkai` —
Zukai's *own* YAML, a different format with a different owner. The design
rationale lives in `specs/network_yaml_spec.md`; hand-maintained.

**Build state: read-only, and permanently so.** The format is **read**, and a
real file reaches the editor: a serde mirror, a version probe,
`network_to_document`, the `import_network` command and a File ▸ Import network…
menu item.

**There is no writer, and there will not be one.** A `document_to_network` and an
Export network… item shipped as the spec's Phases 3–4 and were **reverted**
(`979a60d`). They synthesized placeholder geometry, which is not a substitute for
surveyed geometry, so the only thing they bought was simulating one junction in
isolation — and Zukai exists to print figures, not to feed a simulator. A network
worth simulating is authored in Assimilator, where the geometry is real. Do not
rebuild it.

**What that decision changed here, and it is the main thing to know:** the mirror
no longer has to be *faithful*, only *permissive*. A field is mirrored if the
schematic draws something from it, and dropped otherwise — where before, every
field an imported file carried had to survive so a round trip could reproduce it.
`Movement` lost all five of its round-trip fields (`from_lanes`, `to_lanes`,
`priority`, `yields_to`, `lane_mapping`) with the export, on both sides of the
mirror. `Junction.signal_plan` is the one carried field left, and only because
the Inspector shows it.

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

## A mirror field has to earn its place by being drawn

Read-only makes the rule short: **mirror a field if the schematic draws something
from it; drop it otherwise.** A dropped field costs nothing on the read side —
nothing derives `deny_unknown_fields`, so serde ignores the key — and a field
carried but never drawn is a claim the model cannot back.

`NetworkMovement` is where that bites. It reads `id`, `from_link`, `to_link` and
`type`, and drops `from_lanes`, `to_lanes`, `lane_mapping`, `priority` and
`yields_to`. All five *were* mirrored, and the reason is worth keeping because it
is the trap the whole read-only turn removes: while Zukai wrote the format,
`MovementConfig.from_lanes` carrying no `serde(default)` meant an absent key
failed the *whole file*, so the mirror had to declare it bare and the writer had
to always emit it — `[]` parses, nothing does not. A rule with a test each side.
None of it applies now, and the test that pinned it
(`a_movement_without_from_lanes_fails_to_parse`) has been replaced by its
inverse, `the_lane_and_priority_keys_are_ignored_either_way`.

**One direction of the old mirror rule survives**, because it is about accepting
files rather than reproducing them: a mirror copied field-for-field from
`graph.rs` would **reject legal files**. `MovementConfig.movement_type` is
`#[serde(default, rename = "type")]` in Assimilator while Zukai's `Movement.kind`
has no default, so a movement omitting `type:` parses there and would have failed
here. Neither fixture catches it — both write `type:` on every movement — so
`a_movement_without_a_type_reads_as_through` exists instead. **Optionality on a
field we keep still follows Assimilator's source, not Zukai's model.**

## The enums are shared, and one test is what keeps that honest

`NodeKind`, `JunctionControl`, `UnsignalizedRule` and `MovementKind` are **Zukai's
own, reused rather than redeclared** — every variant already produces
Assimilator's exact wire spelling, checked value by value. So the importer has no
match arms at all. (`MovementPriority` and `LaneMappingEntry` were shared the same
way and are gone with the fields that used them.)

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

## The four fields that failed quietly, and why they no longer can

This format's characteristic bug **was** a `#[serde(default)]` field that parses
cleanly and changes what the network *means* on the way back out. Review found
four:

| Field | What dropping it did | No parse error because |
|---|---|---|
| `from_lanes`/`to_lanes` | file becomes unparseable *on write* | the key is omitted, not emptied |
| `priority`/`yields_to` | a minor movement **promoted to major** — a give-way junction where nothing gives way | both default, `priority` to `Major` |
| `signal_plan` | a `control: signal` junction arrives with no timing and sits at red | serde-optional, semantically required |
| `lane_mapping` | a **crossed** mapping (`0→1, 1→0`) comes back re-wired | Assimilator regenerates the positional identity, so only a crossed one diverges |

**Every entry in that table describes a *write*.** With no writer, none of them
can happen: a field Zukai drops is simply a field the schematic does not draw, and
the file it came from is untouched on disk. Three of the four are now dropped on
purpose, and `signal_plan` is kept only because the Inspector shows it.

Keep the table anyway. It is the reason the export is not coming back — it
documents how much fidelity a round trip demands, and how little of it a picture
needs.

The bucket rule that replaces it is one line: **mirror what is drawn.** A field
carried but never drawn is the shape the old rule had, and it is what put five
dead fields on `Movement` for two specs.

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
| `Movement` (four fields: two links, an id, a turn kind) | `src-tauri/src/model/graph.rs` |
| the TypeScript mirror of it | `src/model/types.ts` |
| the two fixtures + their provenance | `src-tauri/tests/fixtures/network/` |

`import.rs` holds both the pure conversion and the I/O shell, and the module doc
draws the line: `network_to_document` takes a parsed `NetworkFile` and touches no
filesystem, so every test above reaches it with a `&str`.

`mod network;` in `lib.rs` is **private**. Phase 1 needed `pub` only because
nothing in the binary called into it, which left every item unreachable from the
crate root and failed `cargo clippy --all-targets -- -D warnings` on `dead_code`;
`import_network` is that caller. Worth knowing before deleting anything else
here: **a registered Tauri command is what keeps `dead_code` quiet**, so removing
the last caller of a module breaks the lint rather than merely leaving dead code.

The fixtures are the **first checked-in test data in the repo**. They are loaded
with `include_str!` from the inline `#[cfg(test)]` modules, so no
`src-tauri/tests/*.rs` integration target exists — a `fixtures/` subdirectory with
no top-level `.rs` is invisible to cargo, and the bytes stay out of the release
binary.

## Cut, not unbuilt

Everything after "read", and **by decision rather than by plan** — the spec's
Phases 3 and 4 shipped and were reverted. Do not treat any of this as a to-do:

- **The writer**, `document_to_network` / `export_network`, and the File ▸ Export
  network… item that drove it. Reverted in `979a60d`; see the build-state note at
  the top for why.
- **The proof run that went with it** — an exported `cross-4` driven through
  Assimilator's own simulator, which passed and matched Assimilator's own network
  figure for figure. It is worth knowing that it *worked*: the export was cut for
  being outside this project's purpose, not for being broken.
- **The scale problem it exposed is still open**, and belongs to import alone.
  `UNITS_PER_METRE` makes `t_junction`'s 500 m arm 1285 units long against a
  9-unit lane; checking the two fixtures against each other shows **no fixed
  constant serves both**, so fit-to-extent is the only live answer — and it needs
  the factor stored per document. That is the one piece of this area a figure
  actually wants, since a network nobody can drag into shape is a network nobody
  can draw.
- **Opaque round-trip of the dropped blocks.** A file's `detectors` and
  `conflict_pairs` are destroyed by an import→export cycle. Storing them as an
  un-modelled blob in `.zkai` was considered and refused.
- **Merge on import, and auto-layout.** Import replaces the document; positions
  arrive true-to-life and a human makes them legible.
