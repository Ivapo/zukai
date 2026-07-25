---
status: partial (Phases 1–2 landed; reviewed in 2 rounds, 2026-07-24)
last_updated: 2026-07-24
note: Export the schematic as a standalone SVG (and PNG) — the picture leaves the app, chrome-free, at its own scale.
implemented: ["Phase 1", "Phase 2"]
not_implemented: ["Phase 3", "Phase 4"]
related: [specs/save_load_spec.md]
reference: "Standalone SVG 1.1 as browsers, Inkscape, and Figma consume it — `xmlns`, explicit `width`/`height`/`viewBox`, and no external references (no linked stylesheet, no web font, no remote image). PDF, multi-page output, and print CSS are out of scope."
---

# Diagram Export Spec

## 1. Goal

Get the picture out of Zukai. Today the only output is `.zkai`
(`specs/save_load_spec.md`), which nothing but Zukai reads — a schematic you can
draw but can't put in a document, a ticket, or a slide deck is a drawing that
never leaves the drawing tool. Export is what turns the editor into something
whose output has a consumer.

End state — the user draws an interchange and ships the image:

```
File ▸ Export…   (Cmd/Ctrl+E, toolbar "Export…")
  → save dialog, filters: SVG image (.svg) · PNG image (.png)
  → chosen extension picks the format; no options panel
```

`interchange.svg`, opened in any browser — self-contained, no chrome, cropped to
the drawing rather than to wherever the canvas happened to be scrolled:

```svg
<svg xmlns="http://www.w3.org/2000/svg" class="zukai-diagram"
     width="612" height="438" viewBox="132 74 612 438">
  <style>:root, .zukai-diagram { --asphalt: #2b2f36; --paper: #e7ebee; … }
         .road-casing { fill: none; stroke: var(--asphalt); … }</style>
  <rect class="diagram-bg" x="132" y="74" width="612" height="438" />
  <g class="diagram">
    <g class="road"><path class="road-casing" d="M 260 180 L 520 340" stroke-width="21"/>…</g>
    <g class="node node-endpoint" transform="translate(260 180)">…</g>
  </g>
</svg>
```

Note what is **absent**: no `.road-hit` / `.jn-hit` invisible hit targets, no
`is-selected` halo, no half-drawn `.link-preview`, no dot grid, and no
`translate(…) scale(…)` view transform.

## 2. Design

### 2.1 The diagram is the artifact; the view is not

`view` (`ViewTransform`, `src/editor/geometry.ts`) is a scroll position — where
the user happens to be looking. It never enters the file. Export emits **world
units as SVG user units** (1 world unit = 1 px at 1×), so an export at 1× matches
the on-screen appearance at 100% zoom, and the `viewBox` is the diagram's own
content bounds plus a margin. Pan and zoom therefore cannot change what an export
looks like — a property worth keeping, since the alternative ("export what I see")
makes the output depend on invisible state.

The grid (`<pattern id="grid">` + `.grid-bg`, `src/components/Canvas.tsx`) is a
canvas affordance keyed to `view.k`/`view.tx`; it is not part of the drawing and
is not exported.

### 2.2 One render tree, two consumers (decision, recorded)

The export must not become a second renderer. Zukai already draws with pure
presentational components — `RoadShape`, `NodeShape`, `JunctionGlyphShape`
(`Canvas.tsx`) — and the whole drawing lives under one `<g transform={transform}>`.
Extract that content into `src/components/Diagram.tsx`:

```ts
/** Everything the live canvas adds on top of the drawing itself. */
export interface Interaction {
  selection: Selection | null;
  linkFrom: NodeId | null;
  cursor: Vec2 | null;
  onNodePointerDown: (e: React.PointerEvent, node: Node) => void;
  onLinkPointerDown: (e: React.PointerEvent, link: Link) => void;
}

export function Diagram({ doc, interaction }: {
  doc: Document;
  interaction?: Interaction;   // absent ⇒ export mode
}): JSX.Element
```

**`Diagram` emits its own root `<g className="diagram">`** wrapping the whole
drawing. That single element is what §1's example shows, what `diagramSvg` writes
into the file unchanged, and what `measureDiagram` calls `getBBox()` on — one
wrapper, owned by one component, rather than a class Canvas adds and the exporter
has to remember to re-create.

`Canvas` keeps the `<svg>` root, the grid, pan/zoom/wheel, and pointer routing,
and renders `<Diagram doc={doc} interaction={…} />` inside its transform group
(`<g transform={transform}>`, `Canvas.tsx:167`, which keeps that transform and
gains no class). The exporter renders the **same component** with `interaction`
omitted, through `renderToStaticMarkup` (`react-dom/server`, present in react-dom
19 — `node_modules/react-dom/server.browser.js` exports it).

Consequences that make this the right shape:

- **Every future glyph exports for free.** Decorations, roundabout variants, lane
  arrows: draw them once in `Diagram`, and export gains them with no second
  implementation to keep in sync.
- **Export is a pure function of the document.** `renderToStaticMarkup` needs no
  DOM, so the whole markup path is unit-testable under vitest's default node
  environment — which matters here, since the project has no jsdom or
  testing-library (`package.json`).
- **Chrome removal is one flag, not a prune pass.** The alternative — clone the
  live `<svg>` and delete hit targets, halos, and selection classes — has to be
  re-audited every time a new interactive affordance is added, and silently ships
  chrome when someone forgets.

### 2.3 What "export mode" omits

With `interaction` absent, `Diagram` renders **no**:

| Omitted | Why |
|---------|-----|
| `.road-hit`, `.jn-hit` | Invisible fat click targets; meaningless in a picture and they confuse editors that show hidden objects |
| `.road-halo`, `.node-halo`, `.jn-halo`, `is-selected` | Selection is app state, not diagram content — an export must not depend on what was clicked |
| `.link-preview` | A half-drawn link exists only mid-gesture |
| Pointer handlers, `cursor` CSS | No interaction in a file |
| `vector-effect="non-scaling-stroke"` | §2.5 — a canvas affordance that misrenders in a file |

This is a checkable property, not a hope: the Phase 1 gate asserts the rendered
string contains none of those class names, nor `vector-effect`.

### 2.4 The SVG must carry its own styling — via one CSS file, two importers

Every fill and stroke in the drawing comes from a class in `src/styles.css`
resolving CSS custom properties (`--asphalt`, `--paper`, `--paint-white`,
`--island`, …). A standalone `.svg` reaches no external stylesheet, so those rules
must travel inside it, in a `<style>` element.

**Decision:** split the paint rules out into **`src/styles/diagram.css`**, the
single definition of both the road palette and the `.road*` / `.node*` / `.jn-*`
rules. Two importers consume it:

- the app (`styles.css` imports it, so the live canvas is styled by exactly the
  rules that get exported);
- the exporter, as a string: `import diagramCss from "../styles/diagram.css?raw"`
  (Vite's `?raw`; vitest additionally needs `test.css: true`, since it otherwise
  stubs every CSS import with an empty string — found while implementing Phase 2,
  and without it each assertion about the exported stylesheet passes on `""`).

One source of truth, no runtime CSSOM scraping, no drift, and the builder stays
pure. The rejected alternatives: a hand-written export stylesheet constant (drifts
from `styles.css` silently — the classic version of this bug), scraping
`document.styleSheets` at export time (needs a DOM, and order/`var()` resolution
get fiddly), and inlining computed styles per element (exact, but needs a live DOM
and bloats every path element).

The palette block is emitted as `:root, .zukai-diagram { … }`. In a standalone SVG
document the root element *is* the `<svg>`, so `:root` matches it; the second
selector keeps the markup self-contained if someone pastes it inline into an HTML
page, where `:root` would instead be that page's `<html>`.

**Split rule:** a rule that paints the drawing moves to `diagram.css`; a rule that
serves interaction stays in `styles.css` (`.road-hit`, every `*-halo`, `.node`/
`.junction` `cursor`, `.link-preview`, `.grid-dot`, `.canvas`). The gate is that
the exported `<style>` matches none of
`road-hit|jn-hit|-halo|link-preview|grid|cursor` — **class tokens, not bare
words**: `--paint-white` contains the substring `hit`, so a `/hit/` test can
never pass on a file that carries the palette (caught implementing Phase 2).

**Palette ownership (resolves OQ-5).** `diagram.css` is the *single* declaration
site for every colour it defines; `styles.css` must **not** redeclare them. Four
of the seven drawing colours are also used by the chrome — `--asphalt` (7 uses),
`--paper` (2), `--paint-white` (10), `--paint-yellow` (11) across `styles.css`,
versus `--island`/`--ink`, which are drawing-only — and since `styles.css`
`@import`s `diagram.css` into the same `:root`, the chrome keeps resolving them
with nothing duplicated. Leaving the existing `:root` copies in place would be
actively worse than not splitting at all: the later declaration (`styles.css`)
wins in the app, so editing `diagram.css` would change the exported file and *not*
the canvas — the exact silent drift this split exists to prevent. Chrome-only
variables (`--desk`, `--line`, `--chrome-*`, `--radius`, the font stack) stay in
`styles.css`, and **`--grid-dot` stays there too** — moving it would fail the
`no /grid/` gate above.

### 2.5 `vector-effect="non-scaling-stroke"` must not survive export (decision, recorded)

The drawing's hairline strokes carry `vectorEffect="non-scaling-stroke"`
(`Canvas.tsx` — road edges, lane dividers, node dots, `.jn-edge`, `.jn-stopbar`,
`.jn-priority`, `.jn-signal-body`) so they stay legible while zooming the *canvas*.
The road casing and `.jn-ring` are the exceptions — both are deliberately thick and
scale-relative already. In an exported file the attribute is a bug: the stroke then
resolves against the viewport scale (`width` ÷ `viewBox` width), so the same file
rendered at 600 px and at 1200 px has hairlines of the same absolute thickness but
**half the relative weight** at the larger size — and a PNG rasterized at 2× comes
out with visibly thinner paint than the 1× one.

Export mode therefore omits the attribute: every stroke scales with the drawing,
so the picture behaves like one picture at any size. Because 1 world unit = 1 px at
1×, a 1× export is pixel-comparable to the canvas at 100% zoom, where
non-scaling-stroke is a no-op anyway.

**Where it happens: in `Diagram`, at render time** (Phase 1), driven by the same
absent-`interaction` flag as everything else in §2.3 — `vectorEffect={interaction
? "non-scaling-stroke" : undefined}`. It is *not* a string-rewriting pass over the
markup: a regex over generated SVG is a second place to keep in sync, and the
whole point of §2.2 is that export mode is one flag. Phase 2's global
`no vector-effect` assertion then re-checks the property at the file level.

### 2.6 Bounds: measure the clean tree, don't derive them (decision, recorded)

The `viewBox` needs the drawing's extent. Two ways:

1. **Analytic** — union of node positions and link polylines, expanded by
   `roadWidth(lanes)` (`geometry.ts`), junction glyph radii, and arrowheads. Pure
   and testable, but it re-derives geometry that lives in the glyph components
   (`ro = Math.max(20, maxW * 1.35) * scale` for a roundabout, the `SignalHead`
   offset), and every new glyph that forgets to update it clips silently.
2. **Measured** — mount the chrome-free markup off-screen and call `getBBox()`.

**Take the measured route**, in `measureDiagram(doc)` (`src/editor/export.tsx`):
it cannot drift from what is drawn, since it measures exactly the tree that will
be written. Measuring the *export* tree rather than the live canvas group also
keeps the result independent of the current selection — a halo is 4–5 world units
of extra bbox, and "the exported image is bigger when something is selected" is
precisely the kind of thing nobody would think to test.

Three functions, so that only one of them needs a DOM:

```ts
diagramInner(doc: Document): string          // pure — <g class="diagram">…</g>, via renderToStaticMarkup
measureDiagram(doc: Document): Rect | null   // needs a DOM — mounts diagramInner off-screen, getBBox()
diagramSvg(doc: Document, bounds: Rect | null): string   // pure — the whole standalone file
```

`null` bounds are the empty-document case, defined at the end of this section.

`measureDiagram` mounts into a detached-but-laid-out host (an `<svg>` appended to
`document.body`, `position:absolute; visibility:hidden`; a `display:none` subtree
returns a zero `getBBox`), reads the `<g class="diagram">`, and removes the host.
It is the *only* piece of §2.9 that touches the DOM; both string functions stay
unit-testable under vitest's node environment.

#### The margin must cover the stroke, and the widest stroke is not small

`getBBox()` measures path geometry and **excludes stroke width**, so the margin
has to absorb the widest half-stroke or the export clips paint that is plainly
visible on screen. The dominant term is the road casing, drawn at
`stroke-width = roadWidth(lanes)` with `stroke-linecap: round` (`styles.css`
`.road-casing`) — so it extends `roadWidth(lanes)/2` **past each polyline end**.
With `roadWidth(n) = n * 9 + 3` (`LANE_PX`/`ROAD_MARGIN`, `geometry.ts:57–63`)
and the lane count clamped to 1–8 (`setLinkLanes`, `state.ts:462`), that is up to
**37.5 world units** — comfortably more than a flat 24, i.e. a fixed 24-unit
margin would slice the round end-caps off any road of 5 lanes or more.

So the margin is **derived, not guessed**:

```ts
export const EXPORT_PAD = 24;   // aesthetic breathing room around the drawing

/** Half the widest stroke in the document, so no cap or edge is clipped. */
function strokeAllowance(doc: Document): number {
  return Math.max(2, ...doc.links.map((l) => roadWidth(l.lanes.length) / 2));
}
// margin = EXPORT_PAD + strokeAllowance(doc)
```

The `2` floor covers the widest stroke in a link-free document (`stroke-width: 4`,
the fattest non-casing rule in `styles.css`). Deriving from `roadWidth` rather
than hard-coding 37.5 means a future change to `LANE_PX` or the 8-lane clamp
cannot silently reintroduce clipping. Phase 2 pins this with a unit test.

**Degenerate/empty documents.** A document with no nodes or links has no geometry
to measure. `measureDiagram` returns `null` in that case (a zero-area or absent
bbox), and `diagramSvg` treats `null` bounds as the origin-centred empty rect —
emitting a plain square of paper `2 * (EXPORT_PAD + 2) = 52` units on a side,
`viewBox="-26 -26 52 52"`. Export never refuses and never writes `NaN`: a blank
diagram is a blank picture, not an error dialog.

### 2.7 Background (decision, recorded)

The canvas paints `--paper: #e7ebee` (`.canvas`, `styles.css`) and the drawing is
dark asphalt with white paint on top. Export emits an opaque `<rect class="diagram-bg">`
covering the `viewBox` in `--paper`: a transparent background would leave the
endpoint node fills (`--paper`) and the roundabout island (`--island`) floating
invisibly on a light page, and white lane paint invisible on a dark one. A
transparent option is OQ-1, not a default.

### 2.8 PNG: rasterize in the webview (decision, recorded)

PNG is produced by the webview, not by a Rust rasterizer: SVG string → `Blob` →
`Image` → `<canvas>` at the requested scale → `toBlob("image/png")` → bytes over
IPC. That adds no Rust dependency (`resvg`/`usvg` would be one), and reuses the
exact renderer that draws the app.

Two properties this relies on, both true today and worth stating because they stop
being true later:

- **No canvas tainting.** Rasterizing an SVG into a `<canvas>` taints it — making
  `toBlob` throw — if the SVG references anything external. Ours references
  nothing: styles are inline, and there are no images. Keep it that way.
- **No text, no fonts.** The diagram renders zero `<text>` today (verified across
  `Canvas.tsx`). The moment markings with `MarkingKind::Text` or signs render
  glyphs (`src-tauri/src/model/decoration.rs`), PNG export needs the font embedded
  as a data-URI `@font-face` in `diagram.css`, or the raster silently substitutes.
  That is a constraint on the decorations work, recorded here as OQ-4.

### 2.9 Where the logic lives

Mirrors the save/load split (`rules/persistence.md`): pure logic in modules the
tests can reach, Tauri runtime confined to the glue.

| Piece | Where | Pure? |
|-------|-------|-------|
| `Diagram` component | `src/components/Diagram.tsx` | ✅ |
| `diagramInner(doc) → string`, `diagramSvg(doc, bounds) → string` | `src/editor/export.tsx` | ✅ (vitest) |
| `measureDiagram(doc) → Rect \| null`, `rasterizePng(svg, scale) → Uint8Array` | `src/editor/export.tsx` | ❌ needs a DOM |
| Dialog + `invoke` | `src/editor/files.ts` (`exportDiagram`) | ❌ Tauri |
| `write_text_file` / `write_binary_file` | `src-tauri/src/export.rs`, registered in `lib.rs` | — |

The export module is **`export.tsx`**, not `.ts`: it renders `<Diagram doc={doc}/>`
through `renderToStaticMarkup`, and `tsc` rejects JSX in a `.ts` file. (`files.ts`
stays `.ts` — it calls `diagramSvg`/`rasterizePng` and never touches a component.)

Two traps in the glue, both from reusing the save path's shape:

- **An export is not a document.** It must not call `rememberRecent` (the recent
  list opens `.zkai` files), must not `dispatch({type:"markSaved"})`, and must
  leave `dirty`/`currentPath` untouched. Only `write()` in `files.ts` does those
  things; `exportDiagram` is a sibling, not a caller.
- **No new permission.** Writing goes through our own command with `std::fs`,
  exactly as `persist::save_document` does, so `src-tauri/capabilities/default.json`
  is unchanged — `dialog:default` already covers the picker.

`ensureZkaiExtension` (`src/model/document.ts`) is `.zkai`-specific; generalize it
to `ensureExtension(path, ext)` and keep the existing name as a thin wrapper so
`files.ts` call sites don't churn.

### 2.10 Triggers

Same three-surface pattern as save/load and undo (`rules/history.md`): a File-menu
item **Export…** below Save As (accelerator `CmdOrCtrl+E`), a toolbar `.file-btn`,
and the `App.tsx` keydown `e` case that only runs on the browser path (the handler
returns early on every chord once `menuInstalled`). One dialog with both filters;
**the chosen extension picks the format**, defaulting to `.svg` — no options panel
until someone asks for one (OQ-2).

The extension rule is exhaustive, since the save dialog hands back a path and not
which filter produced it, and a user can type any name they like:

| Returned path ends in (case-insensitive) | Format | Path written |
|---|---|---|
| `.png` | PNG | as given |
| `.svg` | SVG | as given |
| anything else, or no extension | SVG | `ensureExtension(path, "svg")` |

`ensureExtension` only appends when the basename contains no dot at all (it is
`ensureZkaiExtension` generalized, `src/model/document.ts:84`), so `drawing` →
`drawing.svg` while `drawing.jpg` is written as-is, holding SVG. That is the
deliberate choice: honour the name the user typed, and never write PNG bytes into
a file the user named something else.

### 2.11 Non-goals

- **Not PDF, not multi-page.** One diagram, one file.
- **Not "export the current view"** (§2.1), and not "export the selection only".
- **Not clipboard copy.** A file is the deliverable; clipboard image support is a
  separate, platform-fiddly problem.
- **Not a print stylesheet**, not a light/dark theme system — one palette, the one
  on screen.
- **No layout changes.** Export never repositions anything to make a nicer picture;
  placement stays the human's job (`CLAUDE.md`, "Layout is semi-automatic").

## 3. Open questions

- **OQ-1** — Transparent-background option alongside the opaque `--paper` default
  (§2.7)? (design-call; proposed: opaque only until asked — the failure mode of
  transparency is invisible geometry, which reads as a bug.)
- **OQ-2** — Export options (scale, margin, background) as a small dialog, vs the
  fixed constants of §2.5–2.7 with format chosen by extension? (design-call;
  proposed: fixed now — 1× SVG, 2× PNG, and the derived margin of §2.6
  (`EXPORT_PAD = 24` plus the document's stroke allowance).)
- **OQ-3** — Should export work on the browser path (`bun run dev`) via an
  `<a download>` blob, or stay Tauri-only like everything in `files.ts`?
  (design-call; proposed: Tauri-only, and rely on the pure `diagramSvg` unit tests
  for browser-path confidence — a second write path doubles the surface for one
  dev convenience.)
- **OQ-4** — PNG font embedding, once any marking or sign renders text (§2.8).
  (needs-input, blocked on the decorations spec; **blocks nothing here** — flagged
  so the decorations spec inherits it rather than discovering it in a raster.)
- **OQ-5** — **RESOLVED** (review round 1, answerable-from-code): yes —
  `diagram.css` is the sole declaration site for the colours it defines, and
  `styles.css` deletes its copies rather than keeping a parallel `:root`. Verified
  in `src/styles.css`: the overlap is exactly four variables (`--asphalt`,
  `--paper`, `--paint-white`, `--paint-yellow`), `--island`/`--ink` are
  drawing-only, and `--grid-dot` is chrome-only. Keeping duplicates would let
  `styles.css` (imported later) win in the app while `diagram.css` governs the
  export — drift in the one direction §2.4 exists to prevent. Landed in §2.4
  ("Palette ownership"); Phase 2 scope and gate.

- **OQ-6** — If `canvas.toBlob` proves unreliable in Tauri's macOS WKWebView
  (drawing an SVG `Image` into a canvas is the historically fragile path, though
  the explicit `width`/`height` of §2.4 is the documented precondition and we
  supply it), the fallback is a Rust rasterizer (`resvg`) behind the same
  `write_binary_file` command. (design-call, deferred; **blocks nothing** — Phase
  4's exit gate is precisely the detector, and SVG export from Phase 3 is
  unaffected either way.)

## 4. Implementation phases

Strictly sequential; each is one plan-mode pass with a concrete exit gate.

### Phase 1 — Extract the diagram render tree

- **Scope:** new `src/components/Diagram.tsx` holding `Diagram`, `Interaction`,
  and the moved `RoadShape` / `NodeShape` / `JunctionGlyphShape` / `SignalHead` /
  `junctionArms` / `arrowTriangle` / `diamondPoints` from `Canvas.tsx`; the hit
  targets, halos, `is-selected` classes, `link-preview`, and `vectorEffect` (§2.5)
  become conditional on `interaction`, and `Diagram` emits its own root
  `<g className="diagram">` (§2.2). `Canvas.tsx` keeps the `<svg>` root, grid,
  view transform, and all pointer/wheel handling, and renders `<Diagram>` inside
  `<g transform={transform}>`. **Also widen `vitest.config.ts`'s `include` to
  `src/**/*.test.{ts,tsx}`** — it is currently `src/**/*.test.ts`, which would
  silently skip the `.tsx` test below and let the gate pass without running it.
  No export code, no CSS changes, no behaviour change.
- **Exit gate:** `bun run build` + `bun run test` green, **and the reported test-file
  count goes from 2 to 3** (the proof the new file is actually collected, not
  skipped by the glob); the new `src/components/Diagram.test.tsx` asserts
  `renderToStaticMarkup(<Diagram doc={sample} />)` matches none of
  `road-hit|jn-hit|halo|is-selected|link-preview|vector-effect` and *does* contain
  `road-casing`, `node-dot`, and a `<g class="diagram">` root; plus a `bun run dev`
  Playwright pass proving the live canvas is unchanged — draw two nodes, link them,
  select the link, drag a node, and confirm the rendered node/road counts and the
  drag's single undo step behave exactly as before.
- **Docs touched:** none — no subsystem behaviour changes yet. (`rules/` gains its
  export note in Phase 3.)

### Phase 2 — The SVG string builder  (depends on Phase 1)

- **Scope:** split the paint rules from `src/styles.css` into
  `src/styles/diagram.css` per §2.4 (palette emitted as `:root, .zukai-diagram`;
  `styles.css` `@import`s it and **deletes its now-duplicate `:root` copies** of
  `--asphalt`/`--paper`/`--paint-white`/`--paint-yellow`, keeping `--grid-dot` and
  the chrome-only variables); new `src/editor/export.tsx` with
  `diagramInner(doc)` and `diagramSvg(doc, bounds)` — root `<svg>` with `xmlns`,
  `class="zukai-diagram"`, `width`/`height`/`viewBox` from bounds plus the derived
  margin (`EXPORT_PAD` + `strokeAllowance(doc)`, §2.6), the `<style>` from
  `diagram.css?raw`, and the background rect (§2.7). Also set `test.css: true`
  in `vitest.config.ts` — vitest stubs CSS imports with `""` by default, which
  would make every assertion about the embedded stylesheet vacuous.
- **Exit gate:** `bun run build` + `bun run test` green, with vitest cases (node
  env, no DOM) asserting: the `xmlns` and a `viewBox` matching the passed bounds
  expanded by the derived margin; `width`/`height` equal to the padded bounds at
  1×; the palette and `.road-casing` present in the embedded style; **no**
  `vector-effect`, and none of the §2.4 chrome class tokens anywhere in the
  output; `strokeAllowance` of an 8-lane document is `37.5` and of an empty one is `2`,
  with a regression assertion that the margin is `>= roadWidth(8)/2` so a
  round end-cap can never be clipped (§2.6); and `diagramSvg(emptyDoc, null)`
  yields `viewBox="-26 -26 52 52"` rather than any `NaN`. Visually confirm in a
  browser that the live canvas is unchanged by the CSS split.
- **Docs touched:** none yet (no user-visible surface until Phase 3).

### Phase 3 — Export SVG end to end  (depends on Phase 2)

- **Scope:** `measureDiagram(doc)` (off-screen mount + `getBBox`, §2.6) and
  `exportDiagram(state)` glue in `files.ts` — save dialog with both filters,
  format by the §2.10 extension table, `ensureExtension` generalized in
  `model/document.ts` (with `ensureZkaiExtension` kept as a wrapper),
  `invoke("write_text_file", …)`; new `src-tauri/src/export.rs` with
  `write_text_file`, registered in `lib.rs`; File-menu item + accelerator in
  `menu.ts`, toolbar button, and the `App.tsx` browser-path `e` case (§2.10).
  PNG not yet — the dialog offers `.svg` only in this phase.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green, plus
  `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` clean
  (`CLAUDE.md`; the pre-commit hook enforces them anyway); the Rust test writes and
  re-reads a temp file, mirroring `persist.rs`'s round-trip tests. Then a
  `tauri dev` run where a drawn interchange — **including at least one 8-lane
  link, whose round end-cap must be fully inside the frame** — exports to `x.svg`
  that opens in a browser looking like the canvas at 100%, **with the selection
  active during export**, proving no halo shipped and the extent didn't change,
  while the window title, `dirty` state, and the Open Recent list stay untouched.
- **Docs touched:** new `rules/diagram-export.md` (the `Diagram`/`Canvas` split,
  the two-importer CSS rule, the pure-vs-DOM boundary) and a cross-reference from
  `rules/persistence.md` noting that export is a sibling of `write()` that must not
  touch `dirty`/recents; add the spec to `CLAUDE.md`'s spec list and update the
  project-memory roadmap.

### Phase 4 — PNG  (depends on Phase 3)

- **Scope:** `rasterizePng(svg, scale)` in `export.tsx` (§2.8),
  `write_binary_file` in `export.rs` taking `Vec<u8>`, and the `.png` branch of the
  §2.10 table wired up; PNG at 2×.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green, plus
  `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` clean; a
  `tauri dev` run exporting the same drawing to `.png`, verified to be a valid PNG
  of exactly 2× the SVG's pixel dimensions with the paper background, and produced
  with no canvas-tainting or `toBlob` error in the console (if it does fail, that
  is OQ-6, not a Phase 4 redesign).
- **Docs touched:** extend `rules/diagram-export.md` with the raster path and its
  two standing constraints (no external references, no text without an embedded
  font); update the project-memory roadmap.

## 5. Review log

### Round 1 — 2026-07-24 — `VERDICT: NOT READY` (2 blocking, 10 non-blocking)

Clean-room reviewer with repo access. Grounding came back clean: every `file:symbol`
citation checked out (the `Canvas.tsx` shapes, `ViewTransform`/`roadWidth`, the
omit-table class names, `MarkingKind::Text`, `ensureZkaiExtension`, `dialog:default`,
`renderToStaticMarkup` in react-dom 19, no jsdom in `package.json`, zero `<text>` in
the drawing).

**Blockers fixed:**

1. **Phase 1's exit-gate test could never run.** `vitest.config.ts` includes
   `src/**/*.test.ts`, which does not match the `Diagram.test.tsx` the gate
   requires — `bun run test` would have run the two existing suites and reported
   green, so the gate self-certified. Phase 1 now scopes the glob widening to
   `*.test.{ts,tsx}` and its gate requires the test-file count to go 2 → 3.
2. **`EXPORT_MARGIN = 24` clipped real drawings.** `getBBox()` excludes stroke;
   the casing is `stroke-width: roadWidth(lanes)` with `stroke-linecap: round`, so
   it overhangs each polyline end by up to `roadWidth(8)/2 = 37.5` world units —
   every road of 5+ lanes would have lost its end-cap, and no gate caught it. §2.6
   now derives the margin (`EXPORT_PAD = 24` + `strokeAllowance(doc)`), Phase 2
   asserts `margin >= roadWidth(8)/2`, and Phase 3's manual check requires an
   8-lane link in frame.

**Non-blocking, all accepted and folded in:** `export.ts` → `export.tsx` (it renders
JSX); `measureDiagram(doc)` replaces `measureDiagram(markup)` with `diagramInner`
named as the markup producer, and its home stated once (§2.6 and §2.9 disagreed);
`Diagram` owns the `<g class="diagram">` wrapper rather than `Canvas`; §2.5's
element list corrected (it omitted `.jn-stopbar`/`.jn-priority`/`.jn-signal-body`)
and the removal pinned to render time, not a string pass; `opts` dropped from
`diagramSvg` (no consumer, and it contradicted OQ-2); degenerate/empty bounds given
a defined output (`viewBox="-26 -26 52 52"`); the unrecognized-extension case given
an exhaustive table (§2.10); WKWebView `toBlob` fallback recorded as OQ-6; Phase 3–4
gates gained `cargo fmt --check` / `cargo clippy --all-targets`, and all four phases
gained the **Docs touched** bullet both sibling specs carry.

**OQ-5 resolved during review** (it was `answerable-from-code`, which
`spec-authoring.md` §4 says to answer here): `diagram.css` owns the shared palette
outright and `styles.css` deletes its duplicate `:root` declarations — keeping both
would have let the app and the export disagree, since the later import wins.

No findings rejected.

### Round 2 — 2026-07-24 — `VERDICT: READY` (0 blocking)

Same reviewer resumed with the changelog. Both blockers confirmed resolved: the
`2 → 3` test-file count is a real counter (the repo has exactly two suites today),
and the derived margin verified arithmetically (`roadWidth(8)/2 = 37.5`;
`Math.max(2, ...[])` → `2`, the seed avoiding the `-Infinity` spread trap).

The reviewer additionally checked the one stroke `strokeAllowance` does *not*
model — `.jn-ring`, drawn at `strokeWidth={ringT}` where `ringT = ro * 0.42`, which
on a scale-2.5 roundabout with 8-lane arms is a ~106-unit stroke whose half-width
(53) exceeds 37.5 — and confirmed it cannot clip: the ring is centred at
`ro - ringT/2`, so its outer edge lands at exactly `ro`, where the coincident
`.jn-edge` circle is pure geometry `getBBox()` already includes. Round
`stroke-linejoin` at bends never exceeds `w/2` from the vertex, and the arrowhead is
inset by `w + 8`. `EXPORT_PAD + max(roadWidth/2)` therefore bounds every exported
mark. Also re-verified: the §2.4 variable-usage counts, the `?raw` declaration
(`vite/client.d.ts`, referenced via `src/vite-env.d.ts`), and `renderToStaticMarkup`
resolving under both browser and node conditions.

Two non-blocking consistency nits folded in on convergence: §2.6's signature block
now reads `Rect | null` to match §2.9 and Phase 2's gate, and §2.5 no longer claims
*every* stroked element carries `vectorEffect` (`.jn-ring` and the halos don't).

**Converged in 2 rounds — `status: reviewed`.** Phase 1 is cleared to plan.
