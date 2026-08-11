---
title: diagram-export
sources:
  - src/App.tsx
  - src/components/Canvas.tsx
  - src/components/Diagram.tsx
  - src/components/Toolbar.tsx
  - src/editor/export.tsx
  - src/editor/export.test.ts
  - src/editor/files.ts
  - src/editor/fonts.ts
  - src/editor/menu.ts
  - src/styles/diagram.css
  - src-tauri/src/export.rs
covers: >
  the SVG/PNG export path: the one render tree and its two consumers, which
  paint travels inside the file, the pure/DOM/Tauri layers, how bounds and the
  margin are derived, and the self-contained-file constraints that fail silently
max_lines: 275
generated: 2026-08-09
---

# Diagram export (SVG, PNG)

How the drawing leaves Zukai as a standalone picture. Spans React, CSS and two
Rust write commands; rationale in `specs/diagram_export_spec.md`.

## One render tree, two consumers

`Diagram` (`src/components/Diagram.tsx`) is the whole drawing under one
`<g class="diagram">`, with exactly two callers: `Canvas.tsx` renders
`<Diagram doc interaction={…} />` inside its `<g transform>` and keeps the `<svg>`
root, grid, pan/zoom and pointer routing; `diagramInner(doc)`
(`src/editor/export.tsx`) renders the same component through
`renderToStaticMarkup` with **`interaction` omitted**.

**The absent `interaction` prop is the whole of "export mode."** It switches off
`.road-hit`/`.jn-hit`/`.marking-hit`/`.sign-hit`, every `*-halo` and
`is-selected`, `.link-preview`, the pointer handlers, and
`vector-effect="non-scaling-stroke"` — a canvas affordance, because in a file the
stroke resolves against the viewport scale, so the same picture rendered twice as
large would carry half the relative paint weight.

The consequence that matters: **a new glyph exports for free.** Draw it in
`Diagram` and it is in the file, with no second implementation to keep in sync.
The rejected alternative — clone the live `<svg>` and delete the chrome — ships
chrome the day someone adds an affordance and forgets. `export.test.ts` asserts
the class tokens are absent, matching **tokens, not bare words** (`road-hit|jn-hit|
marking-hit|sign-hit|bend-hit|bend-handle|node-dot|-halo|is-selected|link-preview|
grid|cursor`), because `--paint-white` contains the substring `hit`.

## The paint travels inside the file

A standalone `.svg` reaches no external stylesheet, so `src/styles/diagram.css` is
the single definition site of the palette and every `.road*`/`.jn-*`/`.marking-*`/
`.sign-*` rule, with two importers: `styles.css` `@import`s it for the
app, and `export.tsx` embeds the same text verbatim via `?raw`. One source of
truth, so a file on disk cannot disagree with the picture on screen.

Three rules about that file, each asserted in `src/editor/export.test.ts`:

- **A rule belongs in `diagram.css` if it paints something a *figure carries*;
  everything else stays in `styles.css`** (hit targets, halos, `cursor`,
  `.link-preview`, `.grid-dot`, `.canvas`). The test of the rule is `.node-dot`,
  which **paints and still lives in `styles.css`**: a node's dot is where a human
  clicks, and a figure carries none (ramps §2.11.1). Put here, it ships in every
  export.
- **`diagram.css` owns its variables outright.** `styles.css` must not redeclare
  `--asphalt`/`--paper`/`--paint-white`/`--paint-yellow`: the later declaration
  wins in the app, so a duplicate would let an edit to `diagram.css` change the
  export and *not* the canvas — the exact drift the split exists to prevent.
- **No `<` or `&` anywhere in `diagram.css`, comments included.** It is embedded
  raw inside XML, where either would end the style element.

Vitest stubs CSS imports with `""` by default, which would make every assertion
about the embedded stylesheet vacuously true — hence `css: true` in
`vitest.config.ts`.

**There is a second stylesheet, and it is not a hole in the one-definition-site
rule.** A document that draws a glyph gets a gated `@font-face` block after this
one. That rule governs **paint**, which must match between canvas and file; an
`@font-face` is not paint but *where the bytes come from*, and the canvas gets its
from `@fontsource` (`main.tsx`). What must not drift is the **family name**, and
that is one constant in `src/editor/fonts.ts`.

## Pure, DOM, Tauri — the three layers

| Piece | Where | Needs |
|---|---|---|
| `diagramInner`, `diagramSvg`, `strokeAllowance`, `exportFormat` | `export.tsx` | nothing — unit-tested under vitest's node environment |
| `measureDiagram`, `rasterizePng` | `export.tsx` | a DOM; both `async` |
| `exportDiagram` (dialog + `invoke`) | `files.ts` | the Tauri runtime |
| `write_text_file`, `write_binary_file` | `src-tauri/src/export.rs`, registered in `lib.rs` | — |

`export.tsx` is **`.tsx`, not `.ts`**: it renders `<Diagram/>`, and `tsc` rejects
JSX in a `.ts` file. `files.ts` stays `.ts` — it calls the builders and never
touches a component. Both write commands are our own, using `std::fs` exactly as
`persist::save_document` does, so **no new permission** is needed and neither
command knows what an export is: one takes a `String`, the other a `Vec<u8>`.

## Bounds are measured, and the margin is derived

`measureDiagram(doc)` mounts `diagramInner(doc)` into a host `<svg>` on
`document.body` (`position:absolute; left:-10000px; visibility:hidden` — a
`display:none` subtree returns a zero `getBBox` in WebKit), reads the
`<g class="diagram">`, and removes the host in a `finally`. It is the only
DOM-touching function here and has no unit test by construction: the project has
no jsdom. Verify it in a browser.

Measured, not derived from node positions and polylines, for two reasons: it
cannot drift from what is drawn, and it measures the *export* tree, so the extent
does not change when something happens to be selected.

**It is `async`, and the font is the only reason.** `getBBox` on a `<text>`
measures whatever face is *currently resolved*, so a measurement taken before
Overpass Mono has loaded frames the export to a fallback-font box — clipped or
over-padded, with nothing to say it happened. It awaits `document.fonts?.ready`,
gated on `needsText(doc)` so a glyph-free document is measured exactly as before.
One caller (`exportDiagram`, already `async`), one `await` (signs OQ-2).

`getBBox` **excludes stroke width**, so the margin must absorb the widest
half-stroke:

```
margin = EXPORT_PAD (24) + strokeAllowance(doc)
strokeAllowance = max(2, …roadWidth(link.lanes, linkStyle(doc, link.id)) / 2)
```

The road casing is drawn at `roadWidth` with a round linecap, so it overhangs each
polyline end by half that — **37.5 units at 8 default lanes**, which is why a flat
24 clipped the end-cap off every road of **6** default lanes or more; 5 overhangs
exactly 24 and lands flush. `roadWidth` sums each `Lane.width` rather than
multiplying a lane count, so the allowance follows a document whose lanes are
wider than the default. **Each road is measured at its own class**, because
`classWidthFactor` is part of the drawn width
(`rules/road-rendering.md`): every factor is ≤ 1 today, so a miss would only
over-pad, but a class that ever drew *wider* would reintroduce exactly the
clipping this function exists to prevent. `.jn-ring` is the one stroke not
modelled and needs none — it is centred so its outer edge lands on the coincident
`.jn-edge` circle, pure geometry `getBBox` already has.

**A taper wedge, a gore, painted text, a sign plate and a length label need no
allowance either, and that is a conclusion rather than luck.** `getBBox` excludes
stroke but *includes* fill, and all five are fill inside the measured `<g>`. A
wedge's corners sit on the casing rim the allowance is derived from; a gore's sit
inside the lane region; a plate is fill with a 1-unit outline, half of which is
under the `2` floor; a length label sits beside the road with no stroke at all.
`export.test.ts` pins the unchanged allowance for every one of them,
including a 19-character destination — the only element whose extent is unbounded
by a build constant.

A document with nothing to measure yields `null` bounds, which `diagramSvg` frames
as `viewBox="-26 -26 52 52"` — a blank diagram is a blank picture, never an error
or a `NaN`.

**The padded frame is snapped outwards to whole world units** (`frame()`,
`floor`/`ceil`, never `round`). Two reasons, and the second is not obvious: a
browser rounds an image's *intrinsic* size to whole pixels, so a fractional
`width="265.77"` gets a 266-px viewport, the viewBox letterboxes inside its own
frame, and the picture picks up a sub-pixel transparent gap at the edge — paper
not quite opaque, and a raster not quite `scale`× the SVG. Outwards-only keeps the
derived margin a clipping *guarantee*: snapping can grow the frame, never shave it.

## PNG is the same SVG, rasterized by the webview

`rasterizePng(svg, scale)` takes the string `diagramSvg` just built and runs it
through the engine the user was looking at: `Blob` → object URL → `Image` →
`<canvas>` → `toBlob("image/png")` → `Uint8Array`. `PNG_SCALE` is **2** — a 1×
raster of a line drawing reads as soft on a retina display or in print. No Rust
rasterizer: `resvg` would be a second renderer to keep in sync, plus a dependency;
this way PNG inherits every future glyph the same way SVG does.

Three things that are easy to undo by accident:

- **The target size comes from `img.naturalWidth`/`naturalHeight`**, never from
  re-parsing our own SVG, which makes "the PNG is exactly `scale`× the SVG" true by
  construction. It is why the root `<svg>` must keep explicit `width`/`height`:
  WebKit gives a viewBox-only SVG *no* intrinsic size, which would rasterize
  nothing. A zero size throws rather than writing a blank file.
- **`toBlob` returning `null` is rejected with a named error**, not swallowed —
  the tainted-canvas signal (spec OQ-6).
- **The raster paints no background of its own.** The opaque sheet comes from the
  SVG's own `.diagram-bg` rect, so the raster path never learns the palette.

`Array.from(bytes)` at the `invoke` call is load-bearing: nested in the argument
object a `Uint8Array` stringifies to `{"0":…,"1":…}`, which serde will not read
back as a `Vec<u8>`. Like `measureDiagram`, `rasterizePng` is verified in the app.

## An export is not a document

`exportDiagram(state)` is a **sibling of `write()`, never a caller**
(`rules/persistence.md`): no `rememberRecent` (that list opens `.zkai` files), no
`markSaved`, no touching `dirty`/`currentPath` — which is why it takes no
`dispatch` at all. The view transform never enters the file either: world units
are emitted as SVG user units, so a 1× export matches the canvas at 100% zoom and
pan or zoom cannot change what an export looks like.

## Format by extension

The save dialog hands back a path, not which filter produced it, and the user may
type any name. `exportFormat(path)` is the whole rule: `.png` means PNG,
everything else — extension or not — means SVG, and `ensureExtension(path, "svg")`
only appends when the basename has no dot. So `drawing` → `drawing.svg`, while
`drawing.jpg` is written as-is holding SVG. A `.png` name is written **exactly as
given**, since `exportFormat` only says `"png"` for a name already ending in it.
Honour the name the user typed; never write bytes of one format into a file named
for another. The dialog offers both filters and still proposes `.svg`.

## Triggers

Same three surfaces as save/open and undo/redo: `Export…` in the toolbar's
`.file-actions`; the File submenu below Save As at `CmdOrCtrl+E` (`menu.ts`); and
`App.tsx`'s keydown `case "e"` — **browser path only**, since the handler returns
early on every chord once `menuInstalled`.

## Standing constraints (they stop being true silently)

**No external references.** Styles are inline, there are no images, and the font
is bytes rather than a fetch. This makes the file self-contained anywhere it is
opened and — since an `<svg>` reaching outside itself taints the `<canvas>` it is
drawn into — it is the precondition for PNG working at all. Add one linked asset
and `toBlob` starts returning `null`.

- **The assertion's subject is the whole file, not the first stylesheet.**
  `expectSelfContained(svg)` is the one helper every site shares: every `url(…)`
  anywhere in the file is `url(#…)` or `url(data:…)`, and `diagram.css` on top of
  that carries no `url(` at all. The widening is deliberate — scoped to
  `embeddedCss()` the rule kept passing *by accident* once the font arrived,
  because the font block is a second `<style>` the slice never reaches.
- **The shoulder hatch is not a violation and must not be "fixed".** A hatched
  document carries one `url(#road-hatch)` — an **in-document fragment reference**
  to a `<pattern>` emitted inside the same `<g class="diagram">`, the only paint
  the class-in-CSS rule cannot carry. It resolves inside the file, does not taint
  the canvas, and rasterizes. **A hard shoulder is the only thing that reaches
  it**, so the `<defs>` gate is `hasShoulder(doc)` and `export.test.ts` pins the
  whole `url()` list for a shouldered document. A **gore** briefly borrowed the
  same pattern, which is what widened that gate and renamed it `needsHatch`;
  chevrons of its own took the borrowing back, so a gored document with no
  shoulder now reaches **no paint server at all** — pinned in the same suite, in
  the other direction.

**Text costs a font, and the font travels only when a glyph does.** The drawing
rendered zero `<text>` until signs Phase 1; the constraint behind that has not gone
away — an SVG naming a face it does not carry falls back to whatever the viewer
has, and the PNG bakes that in permanently. Four rules hold it together, each a
separate way to get it wrong:

- **`needsText(doc)` (exported from `Diagram.tsx`) gates the whole thing**, on
  `hasShoulder`'s model. Three arms counting different things **on purpose**: for
  markings it counts exactly what `markingPaint` emits a `<text>` for — non-empty
  content — so one predicate answers both "is there a glyph" and "is there a face";
  for **signs** it counts every sign, label or no label, because refining it to
  "kinds that draw a glyph" would put the sign vocabulary in the export path, where
  it can fall out of step with the drawing. A sign with an empty label carries
  ≈18 kB for no glyph — the deliberate price, pinned so it reads as a decision.
  The third arm, **a link stating a `length`**, takes the marking half's posture:
  it is the label layer's own first test, character for character, so the two
  cannot drift. It over-counts only for a link whose polyline is undrawable, which
  is the safe direction. Adding a fourth thing that draws a `<text>` and *not* an
  arm here is the failure this whole section exists to prevent — the drawing would
  name a face the file does not carry (`rules/road-rendering.md`).
- **The `@font-face` is a second `<style>`, emitted *after* `diagram.css`'s.** Not
  a rule inside it, which travels in every export and would name a face most files
  have no bytes for; and not an `@import`, which is the forbidden external
  reference. **The order is load-bearing:** `embeddedCss()` slices the *first*
  `<style>`, so a font block emitted first silently redirects every existing
  assertion about the paint.
- **`font-family` and `font-size` are presentation attributes on the `<text>`,
  never CSS.** In `diagram.css` they would ship to every text-free export (four
  assertions forbid the substring); in the gated block alone the *canvas* would
  draw the chrome's proportional Overpass while the file drew the mono face. Both
  come from `FONT_FAMILY`/`TEXT_SIZE`, on the turn arrow's `stroke-width`
  precedent, and the attribute beats the root's inherited family because a
  declaration on the element outranks inheritance.
- **`diagram.css` may not even *spell* those two property names**, comments
  included, for the same reason it may not contain `<` or `&`: the assertions match
  substrings across the whole file. `.marking-text` carries a fill and a comment
  that deliberately talks around them.

**The bytes come from `src/editor/fonts.ts`, and it must be TypeScript.**
`FONT_FAMILY`, `fontFaceCss()` and `FONT_NOTICE`, built from a `?inline` woff2
import Vite resolves to a `data:` URL at build time (≈18 kB base64, Overpass Mono
latin 400, unsubsetted). It cannot be a `.css` file: `?raw` does **no** URL
rewriting, so a literal `url(…)` in a stylesheet would travel as an unresolved
external reference. The `?inline` transform runs under `vitest.config.ts` too,
despite that config carrying no plugins, so the export tests see the real thing.
OFL-1.1's notice rides as an XML comment beside the block — legal outside
`<style>`, and the attribution string contains no `--`.

**A raster does keep the face** — the question this design turned on, answered
rather than assumed. `rasterizePng` loads the SVG through a blob URL into an
`Image`, which puts it in *secure static mode* (no external fetches at all); a
`data:` URI is not a fetch, and WKWebView honours it. Measured in a real WKWebView
on the exact `rasterizePng` path: `IIIIIIII` inks 58 px with the block present and
32 px with it deleted, against 56.6 px predicted from the face's own metrics. The
canvas is **not** tainted and `toBlob` returns bytes.
