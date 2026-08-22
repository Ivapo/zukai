# Zukai

Zukai is a **schematic road-network editor**. It draws roundabouts, junctions, and
motorways — on/off-ramps, lane counts, road markings, signs — as clean diagrams
that are *not necessarily to scale*, the way a metro map represents a transit
network rather than a surveyed one.

The goal is to represent **parts** of networks (a single interchange, one
roundabout) legibly, rather than reproduce complete geographic maps.

**[Try it in your browser →](https://ivapo.github.io/zukai/demo/)** — the editor
runs in a tab, with no install and no server. Drop an Assimilator `network.yaml`
on the canvas and it draws.

## Status

Early. What works today:

- **From-scratch drawing** — place nodes, connect them with directed roads, drag
  to reposition, and delete.
- **Schematic road rendering** — asphalt casing with painted edge lines, dashed
  lane dividers scaled to lane count, and direction arrows.
- **Editing** — set node type (endpoint / junction / waypoint), lane count, and
  road class; pan and zoom.

Planned:

- Junction glyphs (roundabout ring, signalized cross, T-junction).
- Road markings (turn arrows, stop lines, crossings) and roadside signs.
- Save / load Zukai's own YAML documents.
- Import and export against [Assimilator](#relationship-to-assimilator)
  `network.yaml` files.

## Relationship to Assimilator

Zukai is developed independently from Assimilator, a to-scale microscopic traffic
simulator. The two are coupled only by Assimilator's `network.yaml` file format:

- **Import** reads a network's *topology* (nodes, links, lanes, junctions,
  movements) and discards its literal geometry — a schematic intentionally
  distorts real geometry for clarity.
- **Export** synthesizes placeholder geometry from the schematic, producing a
  network fragment useful for testing a junction's lane config or signal plan in
  isolation.

Zukai keeps its own document schema (a semantic graph, a presentation layer, and
schematic-only decorations) and its own copy of the `network.yaml` types, so it
never depends on Assimilator's code.

## Tech stack

[Tauri 2](https://tauri.app) · Rust backend · React + TypeScript frontend ·
Vite · [Bun](https://bun.sh). The canvas is rendered with SVG; type is set in
[Overpass](https://fonts.google.com/specimen/Overpass), an open face based on the
FHWA Highway Gothic road-sign lettering.

## Getting started

Prerequisites: [Rust](https://rustup.rs), [Bun](https://bun.sh), and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```bash
bun install            # install frontend dependencies
bun run tauri dev      # run the desktop app (hot reload)

bun run dev            # frontend only, in a browser (Vite dev server)
bun run build          # type-check + build the frontend
cargo test --manifest-path src-tauri/Cargo.toml   # run Rust tests
```

## License

[MIT](LICENSE) © Ivapo
