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

- **Import** (Assimilator → Zukai), and *only* import: read a `network.yaml`'s topology — nodes, links, lanes, junctions, and which turns a junction permits — and discard everything else, starting with its literal polyline/coordinate geometry. A schematic intentionally distorts real geometry for clarity rather than reusing it. The polyline's **total** is the one thing kept off it, and kept as a *label* rather than as a distance: an imported arm states `500m` while the canvas holds its ends 250 units apart. Import earns its keep by getting a real network onto the canvas quickly, to be schematised by hand.
- **Import reads only what the schematic draws — and *reading* is not *carrying*.** The file's `movements` block is the clean case of the distinction: every one is parsed, its `from_lanes` becomes a painted turn arrow on the approach, and **none of it is stored**. There is no `Movement` in the model. The file's remaining lane detail (`to_lanes`, `lane_mapping`) and right-of-way detail (`priority`, `yields_to`) are not even read. If a field is not drawn, it is not carried; if it is drawn as something else, only the something else survives.
- **Zukai does not write `network.yaml`, and this is a decision rather than a gap.** An export shipped and was reverted (`979a60d`). It synthesized placeholder geometry — which is not a substitute for surveyed geometry, as its own documentation conceded — so its only use was simulating one junction in isolation. A network you want to simulate is authored in Assimilator, where the geometry is real. **Do not rebuild it**, and do not add a model field whose only justification is surviving a round trip.
- Zukai owns its own small `serde` structs for the `network.yaml` shape rather than depending on Assimilator's `crates/config`/`crates/network` Rust types, which are still actively changing. The coupling point is the documented, `schema_version`-keyed file format, not Assimilator's internal code.
- Zukai represents **parts** of networks (a single interchange, one roundabout), not full networks. This mirrors how Assimilator's own example scenarios already work (small, hand-placed-coordinate configs), and Assimilator's `endpoint` node type already models dangling link ends for exactly this kind of fragment.

**The three things this narrowing has already cut**, recorded so they are not re-derived: the `network.yaml` **export** (above); **signal plans** past Phase 1 — a fixed-time plan is a table, its only drawable form is a stage diagram, and a stage diagram is not the figure this project is for; and the **turn movements** (`junction_semantics_spec.md` §0), which are the instructive one because they *did* draw something. Sixteen dashed arcs webbed across one junction pad is a picture; it is not the picture a reader of a figure wants, and a road answers the same question with paint on the approach. So "which phase produces the picture?" is necessary and not sufficient — the follow-up is **"and is that the picture?"**

## Key Design Decisions

- **Two-layer schema**: a semantic layer (nodes, links, lanes-per-link, junction control and right-of-way rule — conceptually a subset of Assimilator's model, plus schematic-only extras like paint markings and sign types) and a presentation layer (glyph type, canvas position, connector bend points). The split is about what each layer *means*, not about a round trip: both are Zukai's own and neither leaves for Assimilator.
- **Rendering: SVG, not Canvas/WebGL.** Unlike Assimilator's frontend (thousands of moving vehicles, needs Canvas/WebGL), Zukai draws a bounded number of draggable symbols and needs easy hit-testing/hover/selection — SVG's DOM-based interactivity fits a diagram editor better, and the scale that would justify Canvas doesn't apply to network fragments.
- **Layout is semi-automatic, not auto-layout.** Importing a network auto-populates parametrized glyphs (roundabout-N-arms, junction-with-N-lanes, motorway-segment-with-ramp) and the turn arrows on each approach lane, but a human positions and connects them on canvas. Fully automatic schematization (clean orthogonal/octilinear layout from arbitrary topology) is out of scope — it's a hard, open-ended algorithm problem, and manual placement leans on the human aesthetic judgment that makes schematics like metro maps legible.

## Commands

```bash
bun install                    # install frontend deps
bun run tauri dev              # run the app (desktop window, hot reload)
bun run dev                    # frontend only (Vite dev server, no native shell) —
                               # the landing placeholder at /, the editor at /demo/
bun run build                  # tsc typecheck + vite build (frontend), base `/`
bun run build:web              # the same build at `--base=/zukai/`, for GitHub Pages
bun run test                   # vitest (frontend)
bun run wasm                   # build the crate for the browser (→ src-tauri/pkg/)
cd src-tauri && cargo check    # type-check the Rust backend
cd src-tauri && cargo test     # run the Rust tests
cd src-tauri && cargo build    # build the Rust backend
```

`dev`, `build`, `build:web` and `test` each run `wasm` first, so the browser
build is never stale; `src-tauri/pkg/` is generated and gitignored. The crate
builds for `wasm32-unknown-unknown` with the desktop-only modules `cfg`-gated
out — see `rules/network-yaml.md`. How the two entries and the Pages deploy fit
together is `rules/deploy.md`.

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

Zukai uses a two-tier documentation system: `specs/` are design plans, `rules/` are
current-state reference. Both are checked by a linter; neither is catalogued here.

**`specs/` — design plans (the *why* and the how).** When a conversation settles on a
feature, work **§6.1's ordered test** before assuming a new document — step 0 asks
whether a decision changed at all (code only → fix the code, and the commit is the
record), and step 2, appending a phase to the spec that already owns the subject, is
the commonest real answer. Where the test says a spec is wanted, it is: a frontmatter
header (`id`, `title`, `status`, `last_updated`,
and a `phases:` list carrying each phase's `reviewed` / `shipped` / `cut` dates), a
Goal anchored to a concrete usage example, the design, open questions, and **numbered
implementation phases**. Each phase is strictly sequential and sized to **one
plan-mode pass** with a concrete exit gate (build + tests green, plus a behavioural
check). To implement, run "implement Phase N of `specs/<spec>.md`". Start a new spec
from `specs/_template.md`; its review record goes in `specs/reviews/<id>.md`, which is
append-only.

**`rules/` — current-state reference (the *what is*).** Terse, authoritative maps of
subsystems, read on demand. Unlike specs, rules describe the code as it is now. Each
declares its own provenance in frontmatter — `sources` (the files it is derived from),
`covers` (what to extract), `max_lines` (the cap on how far a reader should have to
scroll) — so the regeneration loop can rebuild it without knowing anything about this
project in advance. `sources: []` means **declared** hand-maintained, which is a
different thing from silently unmaintained. Start a new rule from `rules/_template.md`,
and seed one only where there is real cross-file knowledge worth extracting.

### Read the index at the moment you need it

- **Before drafting, reviewing or implementing a spec, read `specs/INDEX.md`.**
- **Before changing a subsystem, read `rules/INDEX.md`.**

Both are generated from frontmatter by the linter and are never hand-edited. They are
deliberately *not* reproduced in this file: a catalogue here is loaded into every
session, including the ones that never touch a spec.

### The methodology is not local to this repo

Conventions — the frontmatter schema, phase discipline, open-question rules, the
review loop and its round cap — live in the canonical document:

> `/Users/ivapo/.claude/skills/spec-driven-dev/spec-authoring.md`

There is deliberately **no copy in `specs/`**. A local copy is how two documents end
up describing one process. Section numbers cited anywhere in this repo (`§6.1`, `§7`,
`§7.6`) are that document's. The loops live beside it, and are run by path — this repo
has no `/review-spec` or `/sync-rules` command:

```bash
SDD=/Users/ivapo/.claude/skills/spec-driven-dev
$SDD/bin/spec-lint .                 # validate specs/ and rules/
$SDD/bin/spec-lint . --write-index   # regenerate both INDEX.md files
# review a spec:      $SDD/loops/review-spec.md
# regenerate a rule:  $SDD/loops/sync-rules.md
```

**Standing plan-mode rule:** when planning a phase of a spec, always include, as
explicit plan steps, (1) a **commit plan** — what gets committed, the message, whether
to push; a phase is **one plan, one push, and as many commits as the work wants**,
because the push is the unit something can gate and no count of commits is — and (2) a
**reconciliation step** (which `rules/`, `CLAUDE.md`, or
project-memory roadmap entries the phase changes — or "none needed"). These are
default steps, not things to request each time. **And when the exit gate passes, write
that phase's `shipped` date into `phases[]`** — the review loop owns `reviewed` and
nothing else owns `shipped`, so a phase that shipped and was never dated reads as
unbuilt for as long as nobody notices. And **never plan or implement a phase
that has not passed the review loop** (§7): `status: draft` blocks everything in the
spec, *and* a phase appended to an already-accepted one (§6.1) is blocked until its
own scoped round sets that phase's `reviewed` date. The gate is on the phase, not the
document.

**Additions go in the spec that owns the subject** (§6.1). An accepted spec can be
given a new phase; starting a second spec to avoid touching a finished one is how two
documents end up designing one subsystem. A new spec is for work spanning several
subsystems, or work that removes what another spec shipped.

**Which phase of this produces the picture?** The question at the top of this file is
the one a spec's phases have to answer. A phase whose output is a panel, a table, or a
file no reader ever sees is argued for explicitly, not assumed.

Specs are authoritative for *intent and plan*; `rules/`, this file, and the code are
authoritative for *current state*. When a shipped phase changes what a rule documents,
update the rule (and the roadmap in project memory) in the same pass.
