# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zukai is a schematic road network editor — it draws roundabouts, junctions, and motorway segments (onramps/offramps, lane counts, road markings, signage) as clean diagrams that are not necessarily to scale, the way a metro map represents a transit network rather than a surveyed one. Tauri 2 app: Rust backend, React + TypeScript frontend, Bun as the package manager.

## Relationship to Assimilator

Zukai is developed fully independently from `../assimilator` (a separate, partly-private repo under active development) — no shared Cargo workspace, no shared build, no code dependency in either direction. The only coupling is the `network.yaml` file format Assimilator uses for its to-scale, geometry-precise road networks:

- **Import** (Assimilator → Zukai): read a `network.yaml`'s topology (nodes, links, lanes, junctions, movements) and discard its literal polyline/coordinate geometry — a schematic intentionally distorts real geometry for clarity rather than reusing it.
- **Export** (Zukai → Assimilator): the harder direction, since Assimilator needs real metric geometry a schematic doesn't have by design. Export synthesizes placeholder geometry (default spacing, straight links) from Zukai's topology — useful for testing a junction's lane config or signal plan in isolation, not a substitute for surveyed geometry.
- Zukai owns its own small `serde` structs for the `network.yaml` shape rather than depending on Assimilator's `crates/config`/`crates/network` Rust types, which are still actively changing. The coupling point is the documented, `schema_version`-keyed file format, not Assimilator's internal code.
- Zukai represents **parts** of networks (a single interchange, one roundabout), not full networks. This mirrors how Assimilator's own example scenarios already work (small, hand-placed-coordinate configs), and Assimilator's `endpoint` node type already models dangling link ends for exactly this kind of fragment.

## Key Design Decisions

- **Two-layer schema**: a semantic layer (nodes, links, lanes-per-link, junction/movement/signal data — conceptually a subset of Assimilator's model, plus schematic-only extras like paint markings and sign types) and a presentation layer (glyph type, canvas position, connector bend points) that never round-trips through Assimilator.
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
phase from a spec still `status: draft`** — it must pass the review loop
(`specs/spec-authoring.md §7`) first.

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
  crossings, lane arrows, lane lines (reviewed; 4 phases, Phases 1–2 implemented)

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
  two-importer CSS rule, the pure/DOM/Tauri layers, and why an export is not a
  document
- `rules/road-rendering.md` — how a link becomes a road: the one lane-width
  derivation everything descends from, class-as-token, the carriageway pairing
  rule and its positive-offset trap, lane kinds, the one hatch `<pattern>` that
  cannot be a CSS rule, the junction arms that carry their own position, the
  three tests a joint passes before it tapers, and the arm pair a gore is drawn
  between
- `rules/road-markings.md` — the paint a human places: the one metre/unit
  boundary, the lane that falls out of the click, the two kind-aware Inspector
  controls, why the marking layer is a sibling and not a child of the road, the
  tiling that makes containment a property rather than a clamp, the third
  `Selection` arm and the three failures the compiler does not catch, and what
  removes a marking

Specs are authoritative for *intent and plan*; `rules/`, this file, and the code
are authoritative for *current state*. When a shipped phase changes what a rule
documents, update the rule (and the roadmap in project memory) in the same pass.
