---
title: network-yaml
sources:
  - src-tauri/src/network/mod.rs
  - src-tauri/src/network/import.rs
  - src-tauri/src/lib.rs
  - src/editor/files.ts
  - src/editor/menu.ts
  - src/editor/state.ts
covers: >
  reading Assimilator's network.yaml: the serde mirror and what earns a place in
  it, the header and version probe, the scale and the two lane-numbering
  conventions, what import throws away and the turn arrows it mints, and why
  there is no writer
max_lines: 300
generated: 2026-08-08
---

# `network.yaml`

Assimilator's format — the only one Zukai reads that Zukai does not own. Nothing
here moves `SCHEMA_VERSION` (still **2**). Not `rules/persistence.md`, which is
`.zkai`: a different format with a different owner. The module rustdoc carries the
per-field reasoning; this is the map. Rationale: `specs/network_yaml_spec.md`.

**Read-only, and permanently so.** A serde mirror, a version probe,
`network_to_document`, the `import_network` command, a File ▸ Import network… item.
**There is no writer and there will not be one** — `document_to_network` and an
Export network… item shipped and were **reverted** (`979a60d`). They synthesized
placeholder geometry, so all they bought was simulating one junction in isolation,
and Zukai prints figures. Do not rebuild it.

**What that changed, and it is the main thing to know:** the mirror no longer has
to be *faithful*, only *permissive*. **Mirror a field if the schematic draws
something from it; drop it otherwise.** `Movement` lost all five round-trip fields
with the export, then on 2026-07-28 lost the model side entirely — a junction's
turns are paint now, so `graph.rs` has no `Movement`. `NetworkMovement` survives
only because the paint is derived from it.

## Two formats, two owners — why this is not `persist.rs`

| | `.zkai` (`persist.rs`) | `network.yaml` (`network/`) |
|---|---|---|
| Owner | Zukai | Assimilator |
| May change when | Zukai likes | Assimilator's does |
| Version constant | `model::SCHEMA_VERSION` (2) | `ASSIMILATOR_SCHEMA_VERSION` (1), **a copy** |
| Version lives | a `Document` field | a header read *above* serde |

Row two is the whole reason the module is separate; merging them would hide it.

## The header is real, and it is not a struct field

`network.yaml` carries `schema_version` **and** `NetworkConfig` has no field for
it: Assimilator's `version.rs` reads the key off the parsed value and **strips it**
before typed deserialization. So:

- `parse_network` probes first, `persist.rs`'s shape with one load-bearing
  difference — **the field is an `Option`**. Both committed fixtures start at
  `metadata:`, so a probe demanding a header would reject the very files this
  module exists to read. **Absent / `0` / `1` accept; higher rejects by number.**
- No stripping is needed: nothing derives `deny_unknown_fields`, the property that
  also lets every simulation-only block pass through untouched.
- `ASSIMILATOR_SCHEMA_VERSION = 1` is **a hand copy**, read at commit `d79c32d` on
  **2026-07-26** — the one number here that can rot silently, so the date travels
  with it.

## A mirror field earns its place by being drawn

Seven mirror structs: `NetworkFile`, `NetworkMetadata`, `NetworkNode`,
`NetworkLink`, `NetworkLane`, `NetworkJunction`, `NetworkMovement`. A dropped field
costs nothing on the read side, and a field carried but never drawn is a claim the
model cannot back.

`NetworkMovement` is the sharpest case: **the whole struct is read and none of it
is carried.** `import_junction` builds `node_id`, `control`, `rule` and stops.

### `from_lanes` is read, and that is not the same as carried

It says which lanes of an approach may take a turn — exactly what a **painted lane
arrow** says — so `lane_arrows` converts it on the way in and **nothing stores
it**: no model struct, no `.zkai` key, no panel row. That splits the bucket rule in
two: *mirror a field you draw* is one thing, *carry* it is another, and this field
is what separates them.

It carries `#[serde(default)]` **against the optionality clause below**, and the
departure is the point: Assimilator declares it required, and that clause existed
to guarantee faithful *writing*. Absent and empty take one path — **paint
nothing** — which is also what `cross-4`'s four u-turns do with no case of their
own.

**Import seeds and lets go.** No arrow is bound to the movement it came from:
re-deriving would stomp a hand edit with no way to refuse, and a simplified drawing
may deliberately say less than the junction permits. `rules/road-markings.md`
records the other half — paint has two authors.

**One direction of the old rule survives**, because it is about accepting files
rather than reproducing them: **optionality on a field we keep follows
Assimilator's source, not Zukai's model.** A movement omitting `type:` parses
there, so it must parse here; neither fixture catches it, so
`a_movement_without_a_type_reads_as_through` exists instead.

## Three enums are shared, one is the mirror's own

`NodeKind`, `JunctionControl` and `UnsignalizedRule` are **Zukai's own, reused
rather than redeclared** — every variant already spells Assimilator's wire form, so
the importer has no match arms for them at all.

**`MovementKind` is the fourth and is declared *here***, beside `NetworkMovement`.
It was a model type while a `Junction` recorded turns; those are paint now, so the
only thing that still names a turn this way is the file being read. That is the
shape of the coupling, not an exception to it. `u-turn` (wire) against
`TurnDirection::u_turn` (paint) is now one turn enum on each side of the boundary
instead of two in one model, and `import::turn_direction` is the whole crossing —
four kinds onto four of six directions, after which `MovementKind` does not exist.
`the_shared_enums_spell_what_assimilator_spells` needed no edit across the move (it
always asserted through `parse_network`) and still bites: dropping the
`rename = "u-turn"` fails six tests.

One inert difference, recorded so nobody "fixes" it: Assimilator's `MovementType`
is `rename_all = "lowercase"` and this one is `snake_case`. Every variant is one
word and `UTurn` is renamed on both sides, so the wire forms match.

## The scale, and the y that is a compass bearing

`metres_to_canvas` **scales by `UNITS_PER_METRE`** = `9 / 3.5` (a hand-mirror of
`geometry.ts`, written out literally because Rust has neither half) and **negates
y** — SVG's y grows down, the metric frame's grows up, so a node 300 m **south** of
the origin lands at a **positive** canvas y. Getting the sign wrong mirrors the
whole network: self-consistent, silently wrong, and it passes any test written from
the same premise, so every test names a **compass bearing** rather than a sign.

A 500 m arm therefore arrives 1285 canvas units long against a 9-unit lane —
**true to life and wrong for a schematic**, which is the intended outcome.

## The two projects number lanes in opposite directions

The one thing here that fails silently while looking entirely plausible.
Assimilator counts **from the median**; Zukai counts **from the kerb** — the
convention that makes a `shoulder` at index 0 an outside hard shoulder rather than
one hiding in the median. So `kerb_lane(count, index) = count - 1 - index`, applied
**once, at this boundary**.

**One function, two callers, because `n - 1 - i` is its own inverse.**
`import_link` maps a file index to a new array position; `lane_arrows` maps a file
index into that already-reversed array. Each applies once and they do not compound.
Two things about the reversal matter:

- **Both callers, or neither.** Flipping only the arrows puts the paint right and
  leaves the lane *widths* mirrored — a hard shoulder drawn in the median under a
  correct arrow.
- **It renumbers, it does not just reorder.** Each lane takes its **new position**
  as its `Lane.id`, because that field is documented as the index and every reader
  is positional. Copying the file's id through leaves `lanes[0].id == 1` — the
  invariant broken while every positional reader carries on working, a second
  silent failure hiding inside the fix for the first.

`import_link` carried the un-flipped version from the first commit and **nothing
noticed**: `t_junction`'s links are single-lane, `cross-4`'s lanes are a uniform
3.5 m, and import sets every `kind: None`. No committed fixture can catch it — it
needs **distinct lane widths** — so
`import_link_renumbers_the_lanes_from_the_kerb` carries its own inline YAML.
Nothing migrates a `.zkai` saved from an earlier import.

## What import drops, demotes and seeds

- **`geometry` polylines are discarded** — the founding claim: a schematic
  intentionally distorts real geometry for clarity.
- **`point` is demoted, not discarded.** It seeds `layout.nodes` and never reaches
  `doc.nodes`. Not a nicety: a node with no layout entry has no drawable polyline,
  so an unseeded import renders a **blank page**. Asserted by
  `the_semantic_graph_carries_no_coordinates`, whose needles are the *key* forms
  with trailing colons — a bare `point` matches the word `endpoint`.
- **`layout.links`/`layout.junctions` are seeded with defaults, never derived**
  (`Arterial`, the `generic` glyph). A road class inferred from a speed limit is a
  guess dressed as a fact, and the human is about to redraw it. `layout.junctions`
  keys off **node kind**, the pairing `setNodeKind` maintains.
- **Dropped with a stated cost:** node `z` (a `z_enabled: true` file comes back
  flat), the three lane-change flags (a file prohibiting a lane change comes back
  permitting it), `to_lanes`/`lane_mapping`/`priority`/`yields_to`, `turn_speed`
  and `control_points`, `signal_plan` (not even mirrored — a plan is a table,
  `specs/signal_plans_spec.md` §0), and the instrumentation blocks.
- **The only error is a non-`metric` `coordinate_system`**, and the check must not
  fire on an **absent** key, which the mirror's default already reads as metric.
  Both halves are tested.

## The one thing import *mints*: a turn arrow per approach lane

`lane_arrows` produces `Marking`s the file has no equivalent of. Four steps, each
falling out rather than being decided:

1. Group movements by `from_link`. **Approach links only, for free** — a movement's
   `from_link` *is* the road arriving.
2. Translate each index through `kerb_lane`. One the link does not have is skipped,
   never clamped onto a lane it never named: `kerb_lane` returns an `Option`
   because `count - 1 - index` **underflows** on `usize`, and Zukai does not
   validate what Assimilator wrote.
3. `MovementKind` → `TurnDirection`, four onto four.
4. One `turn_arrow` per lane holding a direction. A lane serving several turns gets
   **one** arrow with several branches; a lane with none gets no paint rather than a
   symbol Zukai would be inventing. `back` is always empty — a lane in
   `network.yaml` is one-directional by construction.

**The `BTreeMap`s are load-bearing**: two imports of one file must produce identical
documents, ids included, and a `HashMap` shuffles the marking sequence and so the
minted ids. Ids are `M1`, `M2`, … — `nextId(…, "M")`'s scheme, so the first marking
a human places lands one past the last minted.

**Two constants are hand-mirrors of TypeScript**, joining `UNITS_PER_METRE`:
`TURN_ARROW_LENGTH` (`geometry.ts`) and `CANONICAL_TURN_DIRECTIONS`
(`TURN_DIRECTIONS` in `Inspector.tsx`, module-private). Both are pinned by tests
that `include_str!` the frontend file and parse the value out. **That is the
pattern for any future hand-mirror** — a comment is not a test.

### Where the arrow sits

`position` is `1.5 × TURN_ARROW_LENGTH / UNITS_PER_METRE` = **8.75 m**, `anchor:
end`. Neither number is chosen: links are not to scale, so the offset is one
arrow-length of clear road derived from the arrow's own drawn size, and the `1.5`
is a conversion because the canvas centres the shaft on `position`. The `end`
anchor is the whole reason `Marking.anchor` exists — an imported arm is over a
thousand units long and is about to be dragged into shape.

**The arrow clears the glyph, and that took a second phase.** Measured on an
imported `cross-4` after Phase 3, every arrow sat 15.0 → 30.0 units from its
junction *node*; `cross-4`'s arms are dual carriageways, so the opaque `jn-pad` has
`rp = 24` and painted over the heads and the fork. Lane arrows Phase 5 fixed it: an
`end`-anchored marking measures from the glyph's **rim** (`rimClearance`,
`junctionRadius` in `geometry.ts`), the same expression that places the stop bar, so
the paint and the glyph can no longer disagree about where the road meets it.
Re-measured after: nearest point 35.99, clearing the rim by 11.99. A **roundabout
is included** — its ring buries an arrow exactly as a pad does, and the exclusion
list that skipped it belonged to the movement arcs.

## The four fields that failed quietly, and why they no longer can

This format's characteristic bug **was** a `#[serde(default)]` field that parses
cleanly and changes what the network *means* on the way back out. Review found four:
`from_lanes`/`to_lanes` (omitted rather than emptied, so the file became unparseable
*on write*), `priority`/`yields_to` (a minor movement **promoted to major** — a
give-way junction where nothing gives way), `signal_plan` (a signalized junction
arriving with no timing, sitting at red), and `lane_mapping` (a **crossed** mapping
`0→1, 1→0` coming back re-wired, the only case that diverges because Assimilator
regenerates the positional identity).

**Every one of those describes a *write*.** With no writer none can happen, and all
four are dropped on purpose. Keep the list anyway: it is why the export is not
coming back, documenting how much fidelity a round trip demands and how little of it
a picture needs. **Mirror what is drawn** is the one-line replacement, and the old
shape is what put five dead fields on `Movement` for two specs.

## How a network reaches the editor

The Open path of `rules/persistence.md`, one format over: File ▸ Import network…
(`menu.ts`, **menu only** — no toolbar button, no accelerator) → `importNetwork`
(`files.ts`, `.yaml`/`.yml` filter, Open's unsaved-changes guard) → `import_network`
(`network/import.rs`, registered in `lib.rs`) → the `importDocument` reducer case.
Two deliberate differences, both following from the file belonging to another
program:

- **The document arrives dirty and pathless**, so Save falls through to Save As
  rather than writing a schematic over Assimilator's network. The one part that is
  not plumbing; `state.test.ts` holds it.
- **The path is not remembered** — "Open Recent" opens through `load_document`,
  which reads `.zkai`, so a `network.yaml` there could only ever fail.

Everything else it inherits, history reset included (`rules/history.md`). The
**extension filter is the only guard** against crossing Import and Open: neither
reader sniffs content, and the fallback is an error rather than a half-formed
document, carrying the version probe's message because `.zkai` is at schema 2
against Assimilator's 1. No new Tauri permission — `dialog:default` grants `open`.

`mod network;` in `lib.rs` is **private**. Phase 1 needed `pub` only because nothing
in the binary called into it, which failed `clippy --all-targets` on `dead_code`;
`import_network` is that caller. **A registered Tauri command is what keeps
`dead_code` quiet**, so removing a module's last caller breaks the lint rather than
merely leaving dead code. `network_to_document` takes a parsed `NetworkFile` and
touches no filesystem, so every test reaches it with a `&str`. The two fixtures
under `src-tauri/tests/fixtures/network/` are the repo's **first checked-in test
data**, loaded with `include_str!` from inline `#[cfg(test)]` modules — a
`fixtures/` directory with no top-level `.rs` is invisible to cargo, so the bytes
stay out of the release binary.

## Cut, not unbuilt

By decision rather than by plan — the spec's Phases 3–4 shipped and were reverted.
Not a to-do list:

- **The writer** and the Export network… item that drove it (`979a60d`).
- **The proof run with it** — an exported `cross-4` through Assimilator's own
  simulator, which passed and matched figure for figure. Worth knowing it *worked*:
  the export was cut for being outside this project's purpose, not for being broken.
- **The scale problem it exposed is still open**, and belongs to import alone.
  Checking the two fixtures against each other shows **no fixed constant serves
  both**, so fit-to-extent is the only live answer — and it needs the factor stored
  per document, which is a `SCHEMA_VERSION` bump. The one piece of this area a
  figure actually wants.
- **Opaque round-trip of the dropped blocks**, considered and refused; **merge on
  import**; **auto-layout**. Import replaces the document.
