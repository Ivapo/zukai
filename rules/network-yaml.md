# `network.yaml`

Assimilator's file format — the one thing the two projects share, and the only
format Zukai reads that Zukai does not own. Nothing here moves `SCHEMA_VERSION`
(still **2**). Not to be confused with `rules/persistence.md`, which is `.zkai` —
Zukai's *own* YAML, a different format with a different owner. The design
rationale lives in `specs/network_yaml_spec.md`; hand-maintained.

**Build state: complete (Phase 4 of 4).** The format is read and written and
both directions are reachable from the File menu. `Movement` gained `priority`,
`yields_to` and `lane_mapping` in Phase 1; they are **carried, never edited**,
joining `Junction.signal_plan` and `Movement.from_lanes`/`to_lanes` on the list
of fields whose presence in `src/model/types.ts` is not evidence that anything
consumes them.

**And the claim is checked against the other program, not only against us.** An
exported `cross-4` was run by Assimilator's own CLI on **2026-07-27** and came
out **identical to the file it was exported from** — same completions, same
throughput, same average speed, ten-second line for ten-second line. The
procedure, and the two things that nearly stopped it, are under "How a network
leaves the editor".

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

Four consequences, three of them in `network/mod.rs`:

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
- The writer stamps it as a **text prefix**, in `document_to_yaml`, not as a
  struct field: `format!("schema_version: {…}\n{body}")`. Giving `NetworkFile` a
  field to match would break the mirror, and omitting the key is legal *today*
  only — it becomes a hard error the moment that constant reaches 2, which is a
  file that arrives already deprecated. The stamp is above serde on both sides.

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
reason to carry empty lists; the writer overrides it by going **through the
mirror**, whose bare fields cannot elide.

One corollary about the attribute the two sides *do* differ on. The mirror rule
governs `default` — what a reader must accept. `skip_serializing_if` is a
separate, write-side choice, set independently: every `Option` in the mirror
skips when absent (Assimilator's own files carry no `rule:` on a signalized
junction, and `rule: null` reads as a bug), while every **bare** field must never
gain one. Confusing the two is how `from_lanes` breaks.

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

`metres_to_canvas` and `canvas_to_metres` are the only two conversions, and they
sit beside each other in `mod.rs` rather than one per direction's module — the
scale and the handedness are a single decision, and a writer free to re-derive
either would be free to disagree with the reader. Each does two things:

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

They are inverses to within a rounding step, not to the bit — `x * K / K` is two
operations, each free to round once — so a test comparing a coordinate across a
round trip names a tolerance (a micrometre) rather than hoping for `==`.

Note what the scale means in practice: a 500 m arm arrives 1285 canvas units long
against a 9-unit lane. That is **true to life and wrong for a schematic**, and it
is the intended outcome. Phase 3 looked for a better constant and found that
**none exists**: the same 2.571 u/m that makes `t_junction`'s 500 m arm unusable
(143 lane-widths) leaves `cross-4`'s 100 m arms at a perfectly legible 28, and a
constant small enough to fix the first shrinks the second below its own road
width. A fixed number is now disproven rather than merely doubted, which leaves
fit-to-extent — a factor **stored per document**, so the two directions stay
inverses — as the only live answer, and that is a `SCHEMA_VERSION` bump for a
later spec (spec OQ-2).

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
- **`lateral_offset` belongs on that list too**, and it is the one the spec's
  §2.3.3 audit did not name. The mirror *reads* it, but nothing carries it into
  the `Document` — so a file with `lateral_offset: 2.0` comes back at whatever
  `LinkAlign` derives, which for a freshly imported link is **0**. Same shape as
  node `z`: parses cleanly, changes where the road is, no error. Not fixed
  because the honest fix is a metres→`align` inference that is lossy in the other
  direction; recorded here so it is a known cost and not a discovery.
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

## What export has to invent, and the two offsets it must not

Import discards; export **synthesizes**, because `LinkConfig.geometry` and
`NodeConfig.point` are both required and a schematic has neither. That asymmetry
is the whole design: an unsaveable `.zkai` is loud, while a `network.yaml` Zukai
writes happily and Assimilator refuses is silent until someone runs it.

**The polyline is built from the nodes, never from the drawing.** `linkPolyline`
— node position, bends, node position — not `drawnPolyline`, which is that
stepped sideways by two lateral terms:

| Term | Where it comes from | Why it must not be baked in |
|---|---|---|
| carriageway offset | `carriageways()`, from `median_gap` | Assimilator offsets each link by `median_gap / 2` itself |
| alignment | `alignmentShift()`, from `LinkView.align` | Assimilator applies `lateral_offset` itself |

Exporting the drawn polyline would therefore **double-offset every two-way road**.
Both are handed over as *values* instead. A useful side effect of building from
the nodes: the polyline's ends land exactly on them, so validation rule 5 (within
1 m) holds by construction rather than by care.

`lateral_offset` is derived from `align` — `nearside → −(Σ lane widths)/2`,
`offside → +that` — in **metres**, not from `alignmentShift`'s canvas value. The
signs already agree: a positive `lateral_offset` and a positive canvas shift both
mean *right of the direction of travel* (`geometry.ts`'s `DRIVE_SIDE` derives
that from SVG's y-down axis). What the canvas value folds in and metres must not
is `ROAD_MARGIN` (a three-unit casing lip) and the class width factor — both
exist to make a drawing legible and mean nothing surveyed.

**The three lane cases**, per list, each against its own link, and the only place
the writer decides anything:

1. **non-empty in the model** → verbatim, which is what makes a round trip exact;
2. **empty on a `u-turn`** → `[]`, matching what Assimilator's editor writes;
3. **empty on anything else** → every lane index. `[]` here would be a lie — the
   field means "lanes that can use this movement" — and it defeats Assimilator's
   positional `lane_mapping` computation, the thing that makes carrying no lane
   detail survivable at all.

Case 3 counts the link's lanes rather than reading their declared `id:`s, so
validation rule 3 (indices in range) cannot be broken by a hand-edit. Unequal
lane counts are fine and left alone: 2 lanes into 1 gives `[0, 1]` → `[0]`, and
export invents no `lane_mapping` to paper over the orphan.

**A node with no layout entry exports at the origin.** Refusing the whole
document would punish a state a hand-edited `.zkai` can reach.

**The gate is an audit, not a spot-check.** `comparable()` blanks `geometry` and
rounds coordinates to a micrometre, then compares the *whole* re-parsed
`NetworkFile` — so a field that stops round-tripping fails without anyone having
remembered to assert it, and adding a field to `comparable` is an admission. Two
mutations were run against it before the phase shipped: a `skip_serializing_if`
on the mirror's `from_lanes` fails 7 tests, and un-negating the export's y fails
5. The u-turn in the hand-built `authored()` document is load-bearing for the
first — every other movement there is filled by case 3 and would be written
either way.

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

## How a network leaves the editor

The same table with one row **missing**, and its absence is the point:

| Step | Where |
|------|-------|
| Trigger | File ▸ Export network… (`src/editor/menu.ts`) — menu only, no accelerator, directly below Import network… |
| Dialog + IPC | `exportNetwork` (`src/editor/files.ts`), defaulting to `network.yaml`, same `.yaml`/`.yml` filter |
| Command | `export_network` (`src-tauri/src/network/export.rs`), registered in `lib.rs` since Phase 3 |
| Apply | — |

- **An export is not a document**, inherited unchanged from
  `rules/diagram-export.md`: `exportNetwork` takes **no `dispatch`**, so it
  cannot `markSaved`, cannot adopt the path, and cannot reach `rememberRecent`.
  A document is exactly as dirty after an export as before one. The compiler
  holds the first half of that; `files.test.ts` holds the second by asserting the
  **whole IPC call list** is one `export_network` — not merely that the export
  happened, which a stray `push_recent_file` would also satisfy.
- **There is no unsaved-changes guard**, and that asymmetry with Import is not an
  oversight: an export destroys nothing on this side. Import replaces the
  document, which is what earns `confirmDiscard`.
- **The default name is `network.yaml` literally**, not the document's — every
  scenario in Assimilator's demo tree names the file that, and a scenario
  resolves its network through `project.yaml`. `ensureExtension` (not
  `withExtension`) adds `.yaml` only to a name with no extension, so a chosen
  `network.yml` is written as typed.
- **The notice is shown after the write, not before it** (chosen by the user over
  a blocking confirmation). Its first paragraph is unconditional — placeholder
  geometry, and `detectors`/`stops`/simulation-only fields not written (spec
  OQ-5). Its second appears only when `exportNotice` finds an **authored priority
  junction**: `unsignalized` + `rule: priority`, with movements, none of them
  `minor`. That is precisely the junction drawn here rather than imported, which
  exports as a give-way rule with nothing giving way (OQ-8) — an imported
  `t_junction` carries a `minor` movement and stays quiet. The notice rides on
  `notify()`, which **swallows its own error**: a dialog that failed to appear
  must not turn a write that succeeded into a reported failure.
- No new Tauri permission: `dialog:default` already grants `save` and `message`.

### The run that proves the format claim

Nothing in this repo can establish that *Assimilator* accepts what Zukai writes;
`cargo test` only shows the file satisfies `validation.rs`'s seven rules as Zukai
understands them. `assimilator validate` is a stub and the CLI cannot load a lone
`network.yaml`, so the check is a scenario swap — which works only because import
preserves ids verbatim and `cross-4`'s `demand.yaml` addresses nodes by id:

```bash
cp -r ../assimilator/demo/dist/scenarios/cross-4 <scratch>/exp
cp <the exported file>                           <scratch>/exp/network.yaml
# NOT `cargo build --bin assimilator` — see below.
cd ../assimilator && cargo build -p assimilator-cli --bin assimilator
./target/debug/assimilator run --config <scratch>/exp --duration 60 \
  --output <scratch>/exp.db
```

**Pass is vehicles arriving, not the absence of a parse error** — the validator
runs after parsing, and a network that loads but strands every vehicle is exactly
this direction's silent failure.

**Run against a control, not against a memory of what the numbers should be.**
Copy the scenario *twice*, swap the network into one of them, and run both. On
2026-07-27 that produced two runs agreeing on every printed figure — 10 completed
and 20 active at 60 s, 600 veh/h, 5.7 m/s, and the same counts at each ten-second
line. That is a much stronger result than "vehicles arrived": Assimilator cannot
tell Zukai's file from its own. The control is also what makes the *next* two
paragraphs answerable rather than alarming.

Two things nearly stopped this run, neither of them about the format:

- **Two packages in that workspace build a binary called `assimilator`**, and the
  subcommands are in the other one. `cargo build --bin assimilator` from the root
  yields a binary whose usage is `assimilator --config <CONFIG>` and which
  rejects `run` as an unexpected argument. The CLI is `-p assimilator-cli`, and
  both write to the same `target/debug/assimilator`.
- **The committed demo scenarios are stale against that CLI.** `cross-4`'s
  `project.yaml` carries `model_params.mobil.a_bias`, which the current
  `demand_manager.rs` panics on ("unknown model_params.mobil.a_bias"). This is a
  *vehicle-class* key: it fires on the pristine scenario too, which is exactly how
  the control earns its keep. Dropping those two lines from both copies is what
  let the run proceed; the network file was never implicated.

This proves the format claim and **nothing about the scale** (spec OQ-2): a
round trip is scale-neutral by construction, since import multiplies by
`UNITS_PER_METRE` and export divides by it. The simulated network has the
fixture's original 100 m arms whatever that constant is set to.

## Where each piece lives

| Piece | File |
|---|---|
| `NetworkFile` + the eight mirror structs | `src-tauri/src/network/mod.rs` |
| `ASSIMILATOR_SCHEMA_VERSION`, `UNITS_PER_METRE` | `src-tauri/src/network/mod.rs` |
| `VersionProbe`, `parse_network` | `src-tauri/src/network/mod.rs` |
| `metres_to_canvas` **and** `canvas_to_metres`, side by side | `src-tauri/src/network/mod.rs` |
| `network_to_document` and its three helpers | `src-tauri/src/network/import.rs` |
| `import_network`, the command around it | `src-tauri/src/network/import.rs` |
| `document_to_network`, `movement_lanes`, `lateral_offset` | `src-tauri/src/network/export.rs` |
| `document_to_yaml` (the header stamp) and `export_network` | `src-tauri/src/network/export.rs` |
| `importNetwork` (dialog + IPC), the `.yaml` filter | `src/editor/files.ts` |
| `exportNetwork`, `exportNotice`, `authoredPriority`, `notify` | `src/editor/files.ts` |
| the two `…Network` entries in `FileActions` | `src/components/Toolbar.tsx` |
| the two menu items, below the separator | `src/editor/menu.ts` |
| the `importDocument` case and the `install` helper | `src/editor/state.ts` |
| the glue's tests, with the Tauri runtime mocked | `src/editor/files.test.ts` |
| `MovementPriority`, `LaneMappingEntry`, the three carried fields | `src-tauri/src/model/graph.rs` |
| the TypeScript mirror of those | `src/model/types.ts` |
| the two fixtures + their provenance | `src-tauri/tests/fixtures/network/` |

`import.rs` and `export.rs` each hold both the pure conversion and the I/O shell,
and their module docs draw the line: `network_to_document` and
`document_to_network` touch no filesystem, so every test above reaches them
without one.

`mod network;` in `lib.rs` is **private**, and both commands are registered in
`generate_handler!`. That registration is not optional bookkeeping: an
unregistered command in a private module is unreachable from the crate root and
fails `cargo clippy --all-targets -- -D warnings` on `dead_code`, which is why
`export_network` landed in Phase 3 with the writer rather than in Phase 4 with
its menu item. Phase 1 needed `pub mod` for exactly the same reason, before
`import_network` existed to be its caller.

The fixtures are the **first checked-in test data in the repo**. They are loaded
with `include_str!` from the inline `#[cfg(test)]` modules, so no
`src-tauri/tests/*.rs` integration target exists — a `fixtures/` subdirectory with
no top-level `.rs` is invisible to cargo, and the bytes stay out of the release
binary.

## Still unbuilt

The path from a file to a drawing and back is complete; what is left is what the
spec declined, by plan rather than omission:

- **Editing any of the carried fields.** No Inspector control for `priority`,
  `yields_to`, `lane_mapping` or signal plans. An authored priority junction
  therefore exports with every movement `major`, which the export notice says out
  loud rather than hides.
- **Opaque round-trip of the dropped blocks.** A file's `detectors` and
  `conflict_pairs` are destroyed by an import→export cycle. Storing them as an
  un-modelled blob in `.zkai` was considered and refused.
- **Merge on import, and auto-layout.** Import replaces the document; positions
  arrive true-to-life and a human makes them legible.
