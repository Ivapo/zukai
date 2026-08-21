---
id: zk-015
title: web-demo
note: >
  Publish Zukai on the web — the editor running in a browser tab with no Rust
  toolchain, and a landing page made of the diagrams it draws.
status: accepted
last_updated: 2026-08-20

phases:
  - name: "Phase 1 — The host seam, and the file commands working in a browser"
    reviewed: 2026-08-20
    shipped: null
    cut: null
    by: null
  - name: "Phase 2 — The wasm core: import and `.zkai` inside the tab"
    reviewed: null
    shipped: null
    cut: null
    by: null
  - name: "Phase 3 — The GitHub Pages deploy"
    reviewed: null
    shipped: null
    cut: null
    by: null
  - name: "Phase 4 — The landing page, and the examples it is made of"
    reviewed: null
    shipped: null
    cut: null
    by: null

extends: null
supersedes: null
superseded_by: null
related: [zk-001, zk-003, zk-009]
reference: null
---

# Web demo

## 1. Goal

**The observable this project produces is a road figure** — a clean schematic
of an interchange, fit to go in a paper. This spec produces no new one. It
produces a **reader**: someone who can look at those figures, and try drawing
one, without a Rust toolchain, a `cargo build`, or a signed binary.

That distinction is load-bearing, because `CLAUDE.md`'s standing test — *a
feature earns its place if it makes the drawn network clearer, or makes drawing
it faster* — this spec fails on both counts, deliberately. Its argument is
**reach**, not capability, and it is the first spec in this repo whose subject
is the project rather than the road. Every phase below is measured against
whether it gets a real diagram in front of someone who does not have the app.

The concrete end state:

```
https://<pages-host>/zukai/          the landing page — what Zukai draws
https://<pages-host>/zukai/demo/     the editor, in the tab
```

A reader follows the second link, drags `cross-4.yaml` onto the canvas, and
watches it become a four-arm junction with turn arrows painted on every
approach. They drag an arm somewhere it reads better. They retype a length
label from `500m` to `1500m` — **and the drawing does not move**, which is the
one idea the whole project follows from. They press Cmd-E and an SVG lands in
their downloads folder. Nothing was installed and no server was involved.

### 1.1 Non-goals

- **Not a replacement for the desktop app.** Tauri stays the primary artifact.
  Where the two hosts differ, the desktop one wins; the web one degrades.
- **No server, no accounts, no shareable links.** The deploy is static files on
  GitHub Pages. A document lives in the tab and leaves through Export. Encoding
  a document into a URL was considered and declined — it bounds document size
  and adds a compression-and-versioning concern to a format that already
  carries a migration (`persist.rs:migrate`).
- **No second renderer, and no second encoder.** The browser already draws the
  diagram; wasm carries no drawing code. See §2.4.
- **Not a resurrection of `network.yaml` export.** `CLAUDE.md` is explicit and
  `zk-009` §0 is the record. The demo imports; it does not write Assimilator's
  format.
- **No auto-layout.** Out of scope project-wide; a browser does not change that.

## 2. Design

### 2.1 There is almost no backend to port

The premise that shaped every phase below: Zukai's Rust is not a compute
backend, it is a **file-dialog backend**, and dialogs do not compile to wasm —
they get replaced. What is left over is small, pure, and already isolated.

| module | what it is | crosses to wasm |
|---|---|---|
| `network/import.rs`, `network/mod.rs` | `network.yaml` → `Document` | **yes** — already pure |
| `model/` | the types those operate on | **yes** — already pure |
| `persist.rs` | the `.zkai` serde codec, version probe, migration | yes, minus its two `fs` calls |
| `export.rs`, `recent.rs` | `fs::write`, a recent-files list | **no** — replaced, see §2.5 |

This is verifiable rather than hopeful. **Every non-portable call in the Rust
that crosses sits in an outermost shell function**, and there are three:
`persist::save_document` and `persist::load_document` (one `fs` call each, in
`persist.rs`) and `network::import::import_network` (`use std::fs` plus the
`#[tauri::command]` attribute). Inside the `model/` and `network/` trees the
count is one — `import_network` — and it is that module's own outermost
function. Nothing below those shells touches the filesystem, the clock, the
environment, or `tauri::`. `import.rs`'s own module documentation states the
property this spec depends on — that `network_to_document` "touches no
filesystem and no IPC, and everything a test needs to exercise it is a `&str`".
The pair of entry points is already `pub`: `network::parse_network` takes the
`&str` and returns a `NetworkFile`, which
`network::import::network_to_document` then converts. Composing the two is what
the wasm shell does; neither reads a path.

The drawing side needs nothing at all: `editor/geometry.ts` is the largest
module in the project and it is TypeScript, `components/Diagram.tsx` emits the
SVG, and PNG rasterization already runs in the webview through a `<canvas>` in
`editor/export.tsx:rasterizePng` — chosen there over a Rust rasterizer
precisely so there would be no second renderer (`zk-003` §2.8).

### 2.2 The seam is `files.ts` and `menu.ts`, and most of it is unguarded

Both modules declare in their own doc comments that they are the only two that
touch the Tauri runtime. What they do **not** have is a working browser path:
only `files.ts:refreshRecents` and `files.ts:installCloseGuard` branch on
`isTauri()`, while the other seven exported commands call a dialog or `invoke`
unguarded and fail at runtime under a plain `vite dev` today. Of nine exported
commands the seam is marked in two and open in seven.

Three things behave differently in a browser:

- **The command buttons already exist — they just fail.**
  `Toolbar.tsx:FILE_COMMANDS` renders New, Open…, Save, Save As… and Export…
  unconditionally, and `rules/persistence.md` names that row as one of the
  three trigger surfaces. The native menu is *not* the only way to reach the
  file commands; it is the only way to reach `onImport` (whose own comment
  reads "menu-only, no toolbar button") and Open Recent. So the browser needs
  **no new menu component** — it needs the existing buttons to work, plus a
  reachable Import. That is a materially smaller phase than "build an in-page
  menu", and `menu.ts:installMenu` still resolving `false` with no runtime
  remains the signal `App` uses to keep the Cmd/Ctrl chords itself.
- `editor/files.ts` reaches for a path from a dialog and hands it to a command.
  A browser has no path. Open becomes a file input or a drop; Save and Export
  become a `Blob` download; recents go away entirely (§2.5).
- **Three of the seam's calls are not path-shaped at all**, and the "a dialog
  returns a path" framing hides them: `files.ts:confirmDiscard` calls `ask()`,
  `files.ts:report` calls `message()`, and `files.ts:installCloseGuard` calls
  `getCurrentWindow().onCloseRequested`. A host modelling only
  open/save/export/import leaves New silently broken and every browser error
  invisible — §2.7 decides both.

### 2.3 Why not a shimmed `invoke` (decision, recorded)

The tempting cheap route is a browser `invoke()` that dispatches to wasm,
leaving `files.ts` untouched. **Declined.** Every *file* command in
`lib.rs:run`'s handler list — `save_document`, `load_document`,
`import_network`, `write_text_file`, `write_binary_file` — takes a
`path: String`, and in a browser that argument is a lie — there is no path to pass and nothing to write it to. A shim
would have to invent one and then keep the fiction consistent through Save As,
Open Recent, and the close guard. Making the host explicit puts the difference
where a reader can see it, and keeps the reducer's purity argument intact.

### 2.4 Why wasm rather than a JavaScript YAML library (decision, recorded)

`persist.rs`'s module documentation states the constraint directly: serde plus
the model's attributes are the single source of truth for the on-disk shape,
and **"a second (JS) encoder would drift."** A browser build that parsed
`.zkai` with a JS YAML library would be exactly that second encoder, and the
drift would be silent — a document that round-trips on the desktop and loses a
field on the web. The same argument covers `network.yaml`, where the reading
rules are considerably subtler (`zk-009`; the lane-numbering reconciliation in
`import.rs:kerb_lane` is the sharp case).

So wasm here is not an extra: it is what **protects an existing decision**. It
is also why the demo cannot be reduced to "ship pre-baked example documents as
JSON" — that variant works only until someone opens a file.

### 2.5 What does not cross, and why that is correct

`export.rs:write_text_file`, `export.rs:write_binary_file`,
`recent.rs:recent_files` and `recent.rs:push_recent_file` contain no
computation whatsoever — they are `fs::write` and a JSON list in the app data
directory. Compiling them to wasm would be compiling a filesystem that does not
exist. The browser host supplies export by different means, and **the recents
list is simply absent on the web** — a demo that reopens your last session is
not what the demo is for. That is the decision, not an option: `recents` on the
browser host is a no-op returning an empty list, and no Open Recent surface
appears.

### 2.6 Two deliverables, one deploy

The landing page and the demo are one Vite build published to one GitHub Pages
site, not two projects. They share the type stack (`editor/fonts.ts:FONT_FAMILY` is
Overpass **Mono**, embedded into an exported SVG whenever the diagram has text
in it — `export.tsx:diagramSvg` gates the `@font-face` block on `needsText` —
so the file carries its own lettering, which is what a landing page made of
exported SVGs needs) and they
share the example diagrams. Two deploys would mean two builds sharing one component
library and drifting apart — the same failure §2.4 rejects, one layer up.

The wasm artifact imposes no exotic hosting requirement: GitHub Pages serves
`.wasm` with the correct MIME type, and nothing here uses threads or
`SharedArrayBuffer`, so no COOP/COEP headers are needed — which matters,
because Pages cannot set them.

### 2.7 Errors need somewhere to go, and PNG needs a chooser (decision, recorded)

Two capabilities have no browser analogue. Both are decided here rather than
left for an implementer to invent.

**Errors need a visible surface.** `files.ts:report` writes a console line and
then calls `message()`, whose failure it deliberately swallows — its own
comment reads "No Tauri runtime (plain `bun run dev`) — the console line above
is it." Every browser error would therefore be silent, including the "not
available yet" replies Phase 1 relies on. A console line is not acceptable for
a demo whose visitors will not have devtools open, so **the browser host gets a
minimal in-page banner**: one dismissible line carrying the text `report`
already composes through `files.ts:detail`. It is small, and Phase 2's import
failures need it too. `alert()` is not an option — a modal blocks the page.

**Export format cannot be chosen by filename.** On the desktop,
`export.tsx:exportFormat` reads the extension off the path the save dialog
returned, so the user picks SVG or PNG by naming the file. A browser download
has neither dialog nor path, so that mechanism has no analogue. **Decision:**
in the browser, Export becomes two explicit commands — Export SVG and Export
PNG — while the desktop keeps its single dialog-driven command unchanged. Both
still build the picture once through `export.tsx:diagramSvg` and hand that same
string to `export.tsx:rasterizePng`, so `exportDiagram`'s "the raster is this
very file rendered by the webview rather than a second drawing of it" property
survives. The download filename comes from `document.ts:withExtension` over
`state.currentPath ?? state.doc.metadata.name` — already the dialog's default.

## 3. Open questions

- **OQ-1** — Which network do the examples use? The repo ships only
  `src-tauri/tests/fixtures/network/t_junction.yaml` and `cross-4.yaml`, both
  deliberately minimal test fixtures. A demo wants at least one network with
  enough in it to be worth looking at — an interchange, a real roundabout. The
  candidates live in Assimilator, which is **partly private**, so this is a
  permission question before it is a technical one. *(needs-input)* Blocks
  Phase 4's exit gate; does not block Phases 1–3, which can use the fixtures.
- **OQ-2** — Project page (`<user>.github.io/zukai/`) or a custom domain? This
  fixes Vite's `base` and therefore every asset URL, so it wants answering
  before Phase 3 rather than during it. *(needs-input)*
- **OQ-3** — Does the browser host use the File System Access API where it
  exists (Chrome: a real save-in-place, so Cmd-S means what it means on the
  desktop) or download-only everywhere (universal, but Save silently becomes
  Save-a-copy)? A hybrid is possible and is the likely answer, at the cost of
  two code paths through Save. *(design call)* Blocks Phase 2's scope.
- **OQ-4** — Is there a size budget for the wasm bundle? `serde_yaml` plus the
  model should land in the low hundreds of KB gzipped, which is unremarkable
  for a demo but worth measuring rather than assuming. *(answerable from code —
  measure during Phase 2, record the number here.)*
- **OQ-5** — Does the web build ever become the *only* build? Assume no; the
  non-goal in §1.1 stands until something forces the question. *(deferred by
  evidence)*

## 4. Implementation phases

Strictly sequential. Phases 1 and 2 each light up a real capability in a plain
`vite dev` browser with no Tauri present, which is what makes Phase 3 a deploy
of something that already works rather than a debugging session in CI.

### Phase 1 — The host seam, and the file commands working in a browser
*Produces the observable: **yes** — a diagram leaves a browser tab as an SVG.*

- **Scope:** Introduce a host abstraction (`src/editor/host.ts`) covering every
  capability `files.ts` reaches for — which is more than the path-shaped ones:
  `open`, `save`, `export`, `import`, `recents`, plus `confirm` (the discard
  prompt), `notify` (the error surface, §2.7) and `closeGuard`. Two
  implementations: the Tauri host, which is today's `invoke`, `plugin-dialog`
  and `getCurrentWindow` calls moved verbatim, and the browser host. The host
  interface must declare its **own** unsubscribe type: `installCloseGuard`
  currently returns `UnlistenFn | null` from `@tauri-apps/api/event`, and
  carrying that name down the browser path would put a Tauri type in the one
  place this phase exists to keep free of them. All nine
  exported commands in `files.ts` — `newDocument`, `openDocument`,
  `importNetwork`, `openRecentDocument`, `saveDocument`, `saveDocumentAs`,
  `exportDiagram`, `refreshRecents`, `installCloseGuard` — keep their names and
  their error handling but talk to the host instead of to `invoke` and the
  dialog plugin directly.

  The browser host implements **export, confirm, notify and closeGuard** here.
  `open`, `save` and `import` need the wasm codec (§2.4) and light up in Phase
  2; until then they call `notify` with a plain "not available in the browser
  yet", which is a visible banner rather than a swallowed console line.
  `recents` is a no-op (§2.5), so `refreshRecents` yields an empty list and no
  Open Recent surface appears.

  Export splits into two commands per §2.7. **Extract the host-independent
  decision — filename, format, MIME type — into a pure function**, leaving the
  `Blob` and object-URL delivery a thin shim over it; that split is what makes
  the gate below runnable without a DOM. Add the menu-only `onImport` to the
  browser's command surface (§2.2) so Phase 2 has somewhere to land. No new
  menu component is built.

  One trap, and its cheap answer: `App.tsx`'s `menuInstalled` initialises
  `false` and flips `true` only after `installMenu` resolves over IPC, so any
  surface gated on `!menuInstalled` renders for the first frames of a *desktop*
  launch. **Gate the host-varying surface on `isTauri()` instead** — it is
  synchronous, so it avoids the flash outright, and what is being varied here
  is host-shaped rather than menu-shaped. `menuInstalled` stays what `App` uses
  to decide whether it keeps the Cmd/Ctrl chords.

- **Exit gate:** `bun run test` and `bun run build` green; `cargo check` still
  green (this phase writes no Rust).
  - **Deterministic:** new unit tests for the pure export-target function cover
    SVG, PNG, a document with a `currentPath` and a pathless one, asserting
    filename, format and MIME. The existing `editor/export.test.ts` passes
    unchanged — that is what proves the SVG builder was not touched. Both run
    in vitest's `node` environment; **nothing in the gate requires a DOM**,
    which is the reason the decision was extracted from the delivery.
  - **Behavioural:** under plain `bun run dev` with no Tauri, place two nodes
    and a link, press Export SVG, and open the downloaded file — it shows the
    same diagram the canvas does. Repeat for Export PNG. Then press Open and
    confirm the banner appears, rather than the failure being console-only.
  - **Explicitly not claimed:** byte-identity between the desktop and browser
    exports. `export.tsx:measureDiagram` depends on `getBBox` and
    `document.fonts.ready`, which differ between WKWebView and Blink, so the
    measured bounds — and therefore the `viewBox` — may legitimately differ
    between hosts. Everything downstream of `bounds` is deterministic and is
    already covered by `export.test.ts`, which passes literal bounds for
    exactly this reason.

- **Close-out:** seeds `rules/host-seam.md`; updates `rules/persistence.md`
  (at 121 of its declared `max_lines: 122`, so a second host path needs a bump
  or a trim) and `rules/diagram-export.md`, whose declared `sources` already
  include `files.ts`, `export.tsx` and `menu.ts` and whose `covers` names the
  pure/DOM/Tauri layering this phase changes. Commit the seam and the browser
  host separately; one push.

### Phase 2 — The wasm core: import and `.zkai` inside the tab
*Produces the observable: **yes** — a real `network.yaml` becomes a drawn
junction in a browser, which is the most persuasive thing this app does.*

- **Scope:** Move `tauri`, `tauri-plugin-dialog` and `tauri-plugin-opener` in
  `src-tauri/Cargo.toml` under `[target.'cfg(not(target_arch = "wasm32"))'.dependencies]`,
  and `#[cfg]`-gate the command shells and the two native-only modules
  (`export`, `recent`) so the crate builds for `wasm32-unknown-unknown`. Add a
  `wasm` module exposing three `#[wasm_bindgen]` functions over
  `serde-wasm-bindgen`: import a `network.yaml` string, decode a `.zkai`
  string, encode a document to `.zkai`. Each is a thin call onto the pure
  functions that already exist — `network::parse_network` plus
  `network::import::network_to_document` for the first, and the bodies of
  `persist::load_document` and `persist::save_document` minus their `fs` calls
  for the other two, with `persist::migrate` and the version probe preserved.
  Build with `wasm-pack build --target web`; load it from the browser host.
  Open and Import in the browser host become a file input plus drag-and-drop
  onto the canvas; Save becomes a download, or a real write where OQ-3 lands.
- **Exit gate:** `cargo check`, `cargo fmt --check`, and
  `cargo clippy --all-targets -- -D warnings` green for the native target;
  `wasm-pack build` clean. **An equivalence test is the real gate:** a vitest
  loads the built wasm, feeds it `tests/fixtures/network/cross-4.yaml`, and
  asserts the document deep-equals the one the existing Rust import test
  produces from the same fixture — the two paths share a converter, and this is
  what proves it. A second asserts a `.zkai` round trip through wasm is
  byte-identical to the file the Rust path writes. Behavioural: in a plain
  `vite dev` browser, drag `cross-4.yaml` onto the canvas and get a four-arm
  junction with painted turn arrows. Record OQ-4's measured bundle size.
- **Close-out:** updates `rules/network-yaml.md` and `rules/persistence.md`
  (both now describe two callers of one converter); updates `CLAUDE.md`'s
  Commands block with the wasm build. One push.

### Phase 3 — The GitHub Pages deploy
*Produces the observable: **yes** — it is the phase that puts the figures at a
URL, which is the entire point of the spec.*

- **Scope:** Vite `base` per OQ-2, a landing entry at `/` and the editor at
  `/demo/`. A GitHub Actions workflow: Rust toolchain with the
  `wasm32-unknown-unknown` target, `wasm-pack`, Bun, build, `upload-pages-artifact`,
  `deploy-pages`. Repository Pages settings. Nothing about the app changes.
- **Exit gate:** the public URL serves the demo, and **Phase 1's and Phase 2's
  behavioural checks are re-run against the deployed site** — import the
  fixture, export an SVG — in both Chrome and Firefox. A cold load with an
  empty cache completes without console errors, which is where a wrong `base`
  or a mis-served `.wasm` surfaces.
- **Close-out:** seeds `rules/deploy.md`; adds the demo URL to `README.md`.
  One push, and the push is the deploy.

### Phase 4 — The landing page, and the examples it is made of
*Produces the observable: **yes**, and more directly than any phase above — the
page is literally made of exported diagrams.*

- **Scope:** The landing page: what Zukai draws, what it deliberately does not
  (not to scale, not a GIS tool, not a simulator), the one-way Assimilator
  relationship, desktop download links, and the demo link. **Every picture on
  it is generated by `editor/export.tsx:diagramSvg` from a real document** —
  none hand-drawn — which is nearly free content and is honest about the
  output. Add an "Open an example" menu to the demo, carrying the documents
  from OQ-1. Fix `README.md`, which is stale in two ways that matter on a page
  people will now read: it advertises `network.yaml` **export** as a feature
  after it was cut (`979a60d`, `zk-009` §0), and it lists shipped work under
  "Planned".
- **Exit gate:** the page renders legibly at 380px wide and passes an
  accessibility audit at 90 or above; every diagram on it is regenerated by the
  app from a document committed to the repo, verified by regenerating one and
  diffing; `README.md`'s Status section agrees with `specs/INDEX.md`'s rollup,
  with no cut feature listed as present.
- **Close-out:** reconciles `README.md` and the roadmap in project memory. One
  push.
