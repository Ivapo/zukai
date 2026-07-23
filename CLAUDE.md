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
