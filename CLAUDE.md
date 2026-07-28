# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zukai is a schematic road network editor — it draws roundabouts, junctions, and motorway segments (onramps/offramps, lane counts, road markings, signage) as clean diagrams that are not necessarily to scale, the way a metro map represents a transit network rather than a surveyed one. Tauri 2 app: Rust backend, React + TypeScript frontend, Bun as the package manager.

**Zukai is a road *drawing* app.** It draws road networks so they can go in a paper as readable figures, and it can *also* read Assimilator's networks and draw those. That is the whole scope, and it is deliberately narrower than "a road network editor" — a distinction that has already cost this project real work, twice (see below).

### The shrunk-down road, and the one idea everything follows from

Assimilator holds a network at **real scale with real geometry**. Zukai holds **the same network shrunk down to represent it** — the drawing is a diagram of the road, not a measurement of it.

So the drawing and the facts about the road are **deliberately decoupled**, and the worked example is the whole idea in one line:

> A link can carry text reading **`1800m`**, meaning *this road is 1800 metres long*. Change the text to `1500m` and **the drawing does not move.** The label is the truth about the world; the picture is a diagram.

Three things follow, and they are the difference between building this well and re-deriving it badly:

- **A number is an annotation, not a measurement of the drawing.** Nothing should compute a real-world quantity *from* canvas geometry, and nothing should resize the canvas to honour a real-world quantity. They are two independent records of the same road.
- **Import lays out for legibility, not for fidelity.** The file's coordinates say where things are in metres; the canvas says where they read well. Real lengths come across as *labels*, not as distances. (This is the answer to `network_yaml_spec.md` OQ-2, which had been stuck looking for a scale factor — the honest answer is that there is no right one, because scale is not what the drawing is carrying.)
- **A feature earns its place if it makes the drawn network clearer, or makes drawing it faster.** Before planning anything, ask: **which phase of this produces the picture?** A phase whose output is a panel, a table, or a file no reader ever sees is a phase to argue for explicitly, not to assume.

## Relationship to Assimilator

Zukai is developed fully independently from `../assimilator` (a separate, partly-private repo under active development) — no shared Cargo workspace, no shared build, no code dependency in either direction. The coupling is **one-way**: Zukai reads the `network.yaml` file format Assimilator uses for its to-scale, geometry-precise road networks.

- **Import** (Assimilator → Zukai), and *only* import: read a `network.yaml`'s topology — nodes, links, lanes, junctions, and which turns a junction permits — and discard everything else, starting with its literal polyline/coordinate geometry. A schematic intentionally distorts real geometry for clarity rather than reusing it. Import earns its keep by getting a real network onto the canvas quickly, to be schematised by hand.
- **Import reads only what the schematic draws.** A movement is the two links it joins and the kind of turn it is; the file's lane detail (`from_lanes`, `to_lanes`, `lane_mapping`) and right-of-way detail (`priority`, `yields_to`) are dropped on the way in. If a field is not drawn, it is not carried.
- **Zukai does not write `network.yaml`, and this is a decision rather than a gap.** An export shipped and was reverted (`979a60d`). It synthesized placeholder geometry — which is not a substitute for surveyed geometry, as its own documentation conceded — so its only use was simulating one junction in isolation. A network you want to simulate is authored in Assimilator, where the geometry is real. **Do not rebuild it**, and do not add a model field whose only justification is surviving a round trip.
- Zukai owns its own small `serde` structs for the `network.yaml` shape rather than depending on Assimilator's `crates/config`/`crates/network` Rust types, which are still actively changing. The coupling point is the documented, `schema_version`-keyed file format, not Assimilator's internal code.
- Zukai represents **parts** of networks (a single interchange, one roundabout), not full networks. This mirrors how Assimilator's own example scenarios already work (small, hand-placed-coordinate configs), and Assimilator's `endpoint` node type already models dangling link ends for exactly this kind of fragment.

**The two things this narrowing has already cut**, recorded so they are not re-derived: the `network.yaml` **export** (above), and **signal plans** past Phase 1 — a fixed-time plan is a table, its only drawable form is a stage diagram, and a stage diagram is not the figure this project is for.

## Key Design Decisions

- **Two-layer schema**: a semantic layer (nodes, links, lanes-per-link, junction/movement/signal data — conceptually a subset of Assimilator's model, plus schematic-only extras like paint markings and sign types) and a presentation layer (glyph type, canvas position, connector bend points). The split is about what each layer *means*, not about a round trip: both are Zukai's own and neither leaves for Assimilator.
- **Rendering: SVG, not Canvas/WebGL.** Unlike Assimilator's frontend (thousands of moving vehicles, needs Canvas/WebGL), Zukai draws a bounded number of draggable symbols and needs easy hit-testing/hover/selection — SVG's DOM-based interactivity fits a diagram editor better, and the scale that would justify Canvas doesn't apply to network fragments.
- **Layout is semi-automatic, not auto-layout.** Importing a network auto-populates parametrized glyphs (roundabout-N-arms, junction-with-N-lanes, motorway-segment-with-ramp) from lane/movement data, but a human positions and connects them on canvas. Fully automatic schematization (clean orthogonal/octilinear layout from arbitrary topology) is out of scope — it's a hard, open-ended algorithm problem, and manual placement leans on the human aesthetic judgment that makes schematics like metro maps legible.

## Commands

```bash
bun install                    # install frontend deps
bun run tauri dev              # run the app (desktop window, hot reload)
bun run dev                    # frontend only (Vite dev server, no native shell)
bun run build                  # tsc typecheck + vite build (frontend)
cd src-tauri && cargo check    # type-check the Rust backend
cd src-tauri && cargo build    # build the Rust backend
```

## Conventions

- Run `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` (from
  `src-tauri/`) before committing. `--all-targets` is load-bearing — it lints the
  `#[cfg(test)]` modules and any integration tests, not just the built binary.
- A tracked **pre-commit hook** (`.githooks/pre-commit`) enforces this
  automatically; enable it once per clone (it's a local git setting, not committed):
  ```bash
  git config core.hooksPath .githooks
  ```
  The hook skips commits that stage no Rust files, so docs-only commits stay fast.

## Development flow

Zukai uses a two-tier documentation system, adapted from Assimilator and sized for
this project.

**`specs/` — design plans (the *why* and the how).** Before building a non-trivial
feature, write a spec: a frontmatter header (`status`, `last_updated`,
`implemented`/`not_implemented`), a Goal anchored to a concrete usage example, the
design, open questions, and **numbered implementation phases**. Each phase is
strictly sequential and sized to **one plan-mode pass** with a concrete exit gate
(build + tests green, plus a behavioural check). To implement, run "implement Phase
N of `specs/<spec>.md`". Conventions live in `specs/spec-authoring.md`; start new
specs from `specs/_template.md`. Review a draft before implementing with
`/review-spec <spec>` (the §7 loop) — a spec must reach `status: reviewed` first.

**Standing plan-mode rule:** when planning a phase of a spec, always include, as
explicit plan steps, (1) a **commit plan** (what gets committed, the message,
whether to push) and (2) a **reconciliation step** (which `rules/`, `CLAUDE.md`, or
project-memory roadmap entries the phase changes — or "none needed"). These are
default steps, not things to request each time. And **never plan or implement a
phase that has not passed the review loop** (`specs/spec-authoring.md §7`) —
which means `status: draft` blocks the whole spec, *and* a phase added to an
already-shipped spec (§6.1) is blocked until its own scoped round says
`reviewed`, even though that spec is at `partial` rather than `draft`. The gate
is on the phase, not the document.

**Additions go in the spec that owns the subject** (`spec-authoring.md §6.1`).
An implemented spec can be reopened to `partial` and given a new phase; starting
a second spec to avoid touching a finished one is how two documents end up
designing one subsystem. A new spec is for work spanning several subsystems, or
work that removes what another spec shipped.

- `specs/spec-authoring.md` — how to write specs (read before drafting one)
- `specs/_template.md` — copy this to start a new spec
- `specs/save_load_spec.md` — save/open `.zkai` documents (implemented; 4 phases)
- `specs/undo_redo_spec.md` — undo/redo over document edits (implemented; 2 phases)
- `specs/diagram_export_spec.md` — export the schematic as SVG/PNG (implemented; 4 phases)
- `specs/road_rendering_spec.md` — make the drawn road honour the road model:
  lane widths, road class, two-way carriageways, lane kinds (implemented; 4 phases)
- `specs/ramps_and_tapers_spec.md` — the joins between roads: arm positions, link
  alignment, lane-drop tapers, gores (implemented; 4 phases)
- `specs/road_markings_spec.md` — the paint on the road: stop and give-way lines,
  crossings, lane arrows, lane lines (Phases 1–4 implemented; **reopened** for
  Phase 5, the two-headed arrow — added 2026-07-28, review pending). The worked
  example of `spec-authoring.md` §6.1.
- `specs/signs_and_text_spec.md` — letters in the drawing: the embedded font,
  painted road text, and roadside signs (implemented; 4 phases)
- `specs/junction_semantics_spec.md` — what a junction *means*: control,
  right-of-way rule, and the turn movements through it (implemented; 4 phases)
- `specs/network_yaml_spec.md` — import and export Assimilator's `network.yaml`:
  the serde mirror, the two directions and their asymmetry, and the four
  `#[serde(default)]` fields that fail silently (**Phases 1–2 implemented;
  Phases 3–4 cut** — Zukai does not write `network.yaml`, see below)
- `specs/signal_plans_spec.md` — the stages a signalized junction cycles
  through (**all 4 phases cut** — a plan is a table, and this project prints
  pictures; kept only as the record of why)
- `specs/lane_arrows_spec.md` — which lane goes where, said with paint on the
  approach instead of arcs across the pad: a marking you can drag, a marking
  anchored to the junction end, import painting the lanes from the file's own
  lane data, and the removal of the movement arcs and the movement list
  (**Phases 1–3 implemented**; reviewed in 2 rounds — 4 phases plus a deferred
  Phase 5 for the junction rim, which Phase 3's dev pass promoted from polish to
  the thing that makes a divided junction's arrows visible)

**`rules/` — current-state reference (the *what is*).** Terse, authoritative maps
of subsystems, read on demand. Unlike specs, rules describe the code as it is now;
keep them current when the code changes (hand-maintained — no `/sync-rules` skill
yet; add one if the rules corpus grows enough to regenerate). Seed rules only when
there's real cross-file knowledge worth extracting, not for every file.

- `rules/document-model.md` — the three-part `Document`, the geometry-free/
  presentation split, and the Rust↔TypeScript mirror discipline
- `rules/persistence.md` — the save/open path: toolbar → dialog+IPC glue → Rust
  commands → reducer, and the normalize-at-one-boundary rule
- `rules/history.md` — undo/redo: the snapshot stack in the reducer, the
  document-identity signal, drag coalescing, and the three trigger surfaces
- `rules/diagram-export.md` — SVG export: the `Diagram`/`Canvas` split, the
  two-importer CSS rule, the pure/DOM/Tauri layers, why an export is not a
  document, and the embedded font — the second stylesheet, the four rules that
  keep the canvas and the file asking for the same face, and the WKWebView
  measurement that proved a raster keeps it
- `rules/road-rendering.md` — how a link becomes a road: the one lane-width
  derivation everything descends from, class-as-token, the carriageway pairing
  rule and its positive-offset trap, lane kinds, the one hatch `<pattern>` that
  cannot be a CSS rule, the junction arms that carry their own position, the
  three tests a joint passes before it tapers, and the arm pair a gore is drawn
  between
- `rules/road-markings.md` — the paint a human places: the one metre/unit
  boundary, the lane that falls out of the click, the kind-aware Inspector
  controls, why the marking layer is a sibling and not a child of the road, the
  tiling that makes containment a property rather than a clamp, the one number
  that bounds all six turn-arrow directions, the lane line that runs *along* the
  road and replaces the divider it lands on, the third `Selection` arm and the
  three failures the compiler does not catch, what removes a marking, the
  seventh kind — text set along the road, centred by arithmetic rather than
  `dominant-baseline`, and the panel's first `<input>` — and the end a marking
  measures from: the involution that lets one function serve both directions, why
  the frame flip lives inside the two functions that already convert rather than
  making a third, and the one half of it no test can see
- `rules/signs.md` — the objects beside the road: why a sign is node-shaped
  rather than marking-shaped, the bare `Vec2` in `layout.signs`, the four actions
  and their three coalescing keys, clear-instead-of-cascade and the map-vs-filter
  identity trap it hides, the layer that is topmost rather than under the glyphs,
  the plate that sizes itself to its label, the deliberately conservative
  `needsText`, the two pointer dead zones, the fourth `Selection` arm the compiler
  only half catches, and the vocabulary — shape first and colour second, the one
  box the chrome is grown from whatever a kind paints, the roundel's ring that is
  fat because the type size is fixed, and the one place that ordering runs out:
  the destination panel, which colour has to separate because shape cannot
- `rules/junctions.md` — what a junction *means* rather than looks like: the three
  records keyed by one `NodeId` and which of them a hand-edited file may omit, the
  glyph/control split and the one-way traffic between them, the nudge and its
  "only from the default glyph" clause, why clearing `rule` belongs to the control
  action but guarding it does not, the two identity returns no behavioural test
  sees — and the movements: why one is a relation rather than an object on the
  canvas (no tool, no `Selection` arm, delete is a per-row button), the id that
  **is** the ordered pair and the three things that fall out of it, the
  topological u-turn test that runs first so the angular bands need no boundary,
  the y-down handedness that makes a positive cross product a *right* turn, the
  third cascade answer and why it is `clearSignLinks`' shape wearing
  `keepMarkings`' meaning, the empty list stored as an absent key, and the two
  turn vocabularies separated by one hyphen — and the drawn arc: why it is a child
  of the glyph rather than a layer (the pad is opaque, and a sibling would be
  invisible while passing every source-order assertion), the two of six glyphs that
  paint none, the arms found by link id because an arm carries no direction, the
  cubic whose second control point is the whole reason a `through` and a `u-turn`
  need no special case, and the arc constant a flat `chord/3` fails while still
  passing the gate — and Derive: the u-turn subtraction that goes through
  `movementKind` rather than through a second copy of the topological test, the
  merge that is the third thing the id-*is*-the-pair rule pays for, why the
  remainder is exported rather than inlined (the button must be dead exactly when
  the action would be), and the one panel row shown when spent rather than hidden
- `rules/network-yaml.md` — the format Zukai reads but does not own **and does
  not write**: two formats with two owners and why the module is not
  `persist.rs`, the `schema_version` header that is real *and* not a struct field
  (read above serde, so the probe takes an `Option` and an absent one must be
  accepted), the four enums reused rather than redeclared and the one test that
  keeps that honest, the scale and the y that is stated as a compass bearing
  because a mirrored network is self-consistently wrong, what import discards —
  the geometry, and the right-of-way detail as well, on the rule that a field
  nothing draws is a field nothing carries — versus the one thing it *demotes*
  (`point` seeds the layout, or the page renders blank), the one field it **reads
  without carrying** (`from_lanes` becomes paint and reaches no struct, which is
  what separates *mirror what is drawn* from *carry*), the two projects' opposite
  lane numberings and the single involution that reconciles them at this boundary
  — for both the arrows and the lane array, which carried the bug invisibly —
  the one thing import *mints* and the opaque pad that covers it, the defaults
  seeded rather than derived, and how a network reaches the editor: Open's path
  one format over, a command that is a shell around the pure conversion, and the
  two differences that are the whole of Phase 2 (dirty and pathless, so Save
  cannot write a schematic back over Assimilator's file; and never remembered as
  a recent, because "Open Recent" opens through `load_document`)

Specs are authoritative for *intent and plan*; `rules/`, this file, and the code
are authoritative for *current state*. When a shipped phase changes what a rule
documents, update the rule (and the roadmap in project memory) in the same pass.
