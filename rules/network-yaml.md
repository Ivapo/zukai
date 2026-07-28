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
mirror — and then, on 2026-07-28, **lost the model side entirely**: a junction's
turns are paint on the approach now, so `graph.rs` has no `Movement` at all. The
mirror's `NetworkMovement` survives because the paint is derived from it.

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

`NetworkMovement` is where that bites, and since 2026-07-28 it is the sharpest
case in the module: **the whole struct is read and none of it is carried.** A
junction's turns are paint on the approach now, so `graph.rs` has no `Movement`
type and `Junction` has no `movements` field — the movement block is parsed,
handed to `lane_arrows`, and dropped. `import_junction` builds three fields and
stops.

It reads `id`, `from_link`, `to_link`, `type` and `from_lanes`, and drops
`to_lanes`, `lane_mapping`, `priority` and `yields_to`. All five of those *were*
mirrored, and the reason is worth keeping because it is the trap the whole
read-only turn removes: while Zukai wrote the format,
`MovementConfig.from_lanes` carrying no `serde(default)` meant an absent key
failed the *whole file*, so the mirror had to declare it bare and the writer had
to always emit it — `[]` parses, nothing does not. A rule with a test each side.
None of it applies now, and the test that pinned it
(`a_movement_without_from_lanes_fails_to_parse`) has been replaced by its
inverse, `the_lane_and_priority_keys_are_ignored_either_way`.

### `from_lanes` is read, and that is not the same as carried

It came back, because something draws it now. A movement's `from_lanes`
says which lanes of an approach may take that turn, which is exactly the claim a
**painted lane arrow** makes, so `lane_arrows` converts it to markings on the way
in — and **nothing stores it.** It reaches no model struct, no `.zkai` key and no
panel row; the paint is the whole of what survives.

That is the read-only mirror at its cleanest, and it sharpens the bucket rule
into two: *mirror a field you draw* is one thing, *carry a field* is another, and
this field is the case that separates them.

It returns with **`#[serde(default)]` against the optionality clause below**, and
the departure is the point rather than an oversight: Assimilator declares it
required, and the clause it violates exists to guarantee faithful **writing** —
a movement Zukai could not reproduce byte-for-byte was a bug while an export
existed. Nothing writes this format. An absent key and an empty list therefore
take one path: **paint nothing**, which is also what `cross-4`'s four u-turns do
without needing a case of their own.

**Import seeds and lets go.** No arrow is bound to the movement it came from —
re-deriving would stomp a hand edit with no way to refuse, and a simplified
drawing may deliberately say less than the junction permits.
`rules/road-markings.md` records the other half: paint now has two authors.

**One direction of the old mirror rule survives**, because it is about accepting
files rather than reproducing them: a mirror copied field-for-field from a Zukai
model type would **reject legal files**. `MovementConfig.movement_type` is
`#[serde(default, rename = "type")]` in Assimilator, so a movement omitting
`type:` parses there; the mirror's `kind` therefore carries
`default_movement_kind`. Neither fixture catches it — both write `type:` on every
movement — so `a_movement_without_a_type_reads_as_through` exists instead.
**Optionality on a field we keep still follows Assimilator's source, not Zukai's
model.**

## Three enums are shared, one is the mirror's own, and a test keeps both honest

`NodeKind`, `JunctionControl` and `UnsignalizedRule` are **Zukai's own, reused
rather than redeclared** — every variant already produces Assimilator's exact wire
spelling, checked value by value. So the importer has no match arms for them at
all. (`MovementPriority` and `LaneMappingEntry` were shared the same way and are
gone with the fields that used them.)

**`MovementKind` is the fourth, and since 2026-07-28 it is declared *here*** —
`network/mod.rs`, beside `NetworkMovement`. It was a model type while a `Junction`
recorded the turns through it; those are paint now, so the only thing left that
names a turn this way is the file being read, and the vocabulary belongs to the
mirror that reads it. That is the shape of the coupling rather than an exception
to it: a type that mirrors nothing on the Zukai side has no business in
`model::graph`.

Two things follow, and both are the point:

- **The hyphen stops being a hazard and becomes simply correct.** `u-turn` is
  Assimilator's spelling; `TurnDirection`'s `u_turn` is Zukai's, and there is now
  exactly one turn enum on each side of the boundary instead of two in one model
  (`rules/junctions.md`). `import::turn_direction` is the whole of the crossing —
  four kinds onto four of the six directions, and `MovementKind` does not exist
  past that function.
- **The coupling is still pinned.** `the_shared_enums_spell_what_assimilator_spells`
  needed no edit across the move (it has always asserted through `parse_network`
  rather than through a model type), and it still bites: dropping the
  `#[serde(rename = "u-turn")]` fails six tests, so the relocation did not take the
  coverage with it.

One inert difference, recorded so nobody "fixes" it: Assimilator's `MovementType`
is `rename_all = "lowercase"` and this one is `snake_case`. Every variant is one
word and `UTurn` is explicitly renamed on both sides, so the wire spellings are
identical.

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

## The two projects number lanes in opposite directions

The one thing here that fails silently while looking entirely plausible.

- **Assimilator counts from the median** — "0 is the leftmost/fastest lane"
  (`crates/config/src/network.rs`).
- **Zukai counts from the kerb** — "lane 0 is the nearside (kerb) lane", the
  convention that makes a `shoulder` at index 0 an outside hard shoulder rather
  than one hiding in the median (`geometry.ts`).

So `kerb_lane(count, index) = count - 1 - index`, applied **once, at this
boundary** — `rules/persistence.md`'s normalize-at-one-boundary rule arriving one
format over. Nothing downstream knows there was ever another numbering.

**One function, two callers, because `n - 1 - i` is its own inverse.**
`import_link` maps a file index to a new array position; `lane_arrows` maps a file
index into that already-reversed array. Applying each once is correct and they do
not compound.

Two things about the reversal are worth stating because getting either wrong
leaves the drawing disagreeing with itself:

- **Both callers, or neither.** Flipping only the arrows puts the paint right and
  leaves the lane *widths* mirrored — a hard shoulder drawn in the median under a
  correct arrow.
- **It renumbers, it does not just reorder.** Each lane takes its **new position**
  as its `Lane.id`, because that field is documented as the index and every reader
  is positional (`Diagram.tsx`, `state.ts`). Copying the file's id through a
  reversal leaves `lanes[0].id == 1` — the struct's own invariant broken while
  every positional reader carries on working, a second silent failure hiding
  inside the fix for the first.

`import_link` carried the un-flipped version from the first commit and **nothing
noticed**: `t_junction`'s links are single-lane (the reversal is a no-op),
`cross-4`'s lanes are uniform 3.5 m, and import sets every `kind: None`. The
array was mis-ordered and indistinguishable. `import_link_renumbers_the_lanes_from_the_kerb`
exists because no committed fixture can catch it — it needs **distinct lane
widths**, so it carries its own inline YAML.

Nothing migrates a `.zkai` saved from an earlier import. The fix is at the import
boundary only, and the mis-ordering is invisible for uniform-width lanes, which is
every network imported so far.

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

## The one thing import *mints*: a turn arrow per approach lane

Everything else here is a copy, a demotion or a drop. `lane_arrows` is the
exception — it produces `Marking`s the file has no equivalent of, and it is the
reason the module reads `from_lanes` at all.

Four steps, and each one falls out rather than being decided:

1. Group movements by `from_link`. **Approach links only, for free** — a
   movement's `from_link` *is* the road arriving, so there is no exit link to
   filter out.
2. Translate every `from_lanes` index through `kerb_lane`.
3. `MovementKind` → `TurnDirection`, four onto four. The two vocabularies are
   separated by one hyphen (`u-turn` on the wire, `u_turn` in paint) and the two
   slight turns have no movement kind to come from.
4. One `turn_arrow` per lane holding at least one direction. A lane serving
   several turns gets **one** arrow with several branches; a lane with none gets
   no paint at all, rather than a symbol Zukai would be inventing.

**The `BTreeMap`s are load-bearing.** Two imports of one file must produce
identical documents, ids included, and a `HashMap` costs exactly that — its
iteration order shuffles the marking sequence and therefore the minted ids.
`two_imports_of_one_file_paint_identically` is the test; the direction order
inside each arrow is `CANONICAL_TURN_DIRECTIONS`.

**Two constants are hand-mirrors of TypeScript**, joining `UNITS_PER_METRE`:
`TURN_ARROW_LENGTH` (`geometry.ts`) and `CANONICAL_TURN_DIRECTIONS`
(`TURN_DIRECTIONS` in `Inspector.tsx`, a module-private const). Both are pinned by
tests that `include_str!` the frontend file and parse the value out of it, so
drift fails here rather than showing up as arrows in the wrong place.

Ids are minted `M1`, `M2`, … — `nextId(…, "M")`'s own scheme, so the first
marking a human places after an import lands one past the last minted rather than
colliding with it.

### Where the arrow sits, and what the pad does to it

`position` is `1.5 × TURN_ARROW_LENGTH / UNITS_PER_METRE` = **8.75 m**, with
`anchor: end`. Neither number is chosen: links are not to scale, so the offset is
derived from the arrow's own drawn size — one arrow-length of clear road ahead of
the junction — and the `1.5` is a conversion, because the canvas centres the shaft
on `position`. The `end` anchor is the whole reason `Marking.anchor` exists: an
imported arm is over a thousand units long and is about to be dragged into shape.

**Measured on an imported `cross-4`, via the app's own SVG export:** every arrow
occupies 15.0 → 30.0 units from its junction node, on all four approaches, on both
lanes, with the left-turn branch on the median lane and the right-turn branch on
the kerb lane — the flip, confirmed in the drawing rather than only in the
importer.

And the pad covers it. `jn-pad` is an **opaque** `fill: var(--asphalt)` circle
drawn *after* the marking layer, at `rp = max((maxW × 0.62 + 3) × scale, reach)`.
`cross-4`'s arms are **dual carriageways**, so `maxW` is two 18-unit carriageways
plus the median and `rp = 24` — against an arrow whose head sits at 15.0. Only the
outer ~6 units of bare shaft survive; the heads and the fork are painted over.

This is the cost lane arrows §2.4 recorded, arriving harder than its estimate
(which assumed an undivided 2-lane road at `rp = 16`). It is not a correctness
bug and nothing about the model is wrong — **the end node is a stand-in for the
junction's rim**, and the rim is what both this arrow and the stop bar actually
want. A narrower junction clears the pad today; a divided one does not.

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
| `network_to_document` and its helpers | `src-tauri/src/network/import.rs` |
| `lane_arrows`, `kerb_lane`, `turn_direction` | `src-tauri/src/network/import.rs` |
| `TURN_ARROW_LENGTH`, `CANONICAL_TURN_DIRECTIONS`, `ARROW_SETBACK_METRES` | `src-tauri/src/network/import.rs` |
| `import_network`, the command around it | `src-tauri/src/network/import.rs` |
| `importNetwork` (dialog + IPC), the `.yaml` filter | `src/editor/files.ts` |
| the `importDocument` case and the `install` helper | `src/editor/state.ts` |
| `NetworkMovement` and `MovementKind` — read, never carried, so **no model or TypeScript mirror** | `src-tauri/src/network/mod.rs` |
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
