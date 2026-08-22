---
id: zk-015
title: web-demo
note: >
  Publish Zukai on the web — the editor running in a browser tab with no Rust
  toolchain, and a landing page made of the diagrams it draws.
status: accepted
last_updated: 2026-08-22

phases:
  - name: "Phase 1 — The host seam, and the file commands working in a browser"
    reviewed: 2026-08-20
    shipped: 2026-08-21
    cut: null
    by: null
  - name: "Phase 2 — Import in the tab: the wasm core, and a dropped `network.yaml`"
    reviewed: 2026-08-21
    shipped: 2026-08-21
    cut: null
    by: null
  - name: "Phase 3 — `.zkai` in the tab: decode, encode, Open and Save"
    reviewed: 2026-08-21
    shipped: 2026-08-22
    cut: null
    by: null
  - name: "Phase 4 — The GitHub Pages deploy"
    reviewed: 2026-08-22
    shipped: 2026-08-22
    cut: null
    by: null
  - name: "Phase 5 — The landing page, and the examples it is made of"
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
https://ivapo.github.io/zukai/       the landing page — what Zukai draws
https://ivapo.github.io/zukai/demo/  the editor, in the tab
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
  GitHub Pages. A document lives in the tab and leaves as a file the browser
  downloads — through Export (Phase 1) or, once Phase 3 lands, through Save,
  which is honestly Save-a-copy (OQ-3). Nothing is stored anywhere. Encoding
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
that crosses sits in an outermost shell function**, and there are three of
those — with `lib.rs:run` and the template's unused `lib.rs:greet` outside the
count, being neither file commands nor part of the two native-only modules, and
gated wholesale (Phase 2). The three:
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

> **CORRECTED 2026-08-21, after Phase 1 shipped.** This section is written in
> the present tense about the code as it stood *before* Phase 1, and is kept
> that way because it is the argument that produced the phase. It is no longer a
> description of the repo: `files.ts` now names no dialog, no `invoke` and no
> window, the seam is `host.ts` with two implementations, and the toolbar row
> varies by host. `rules/host-seam.md` is the current-state map. Phases 2 and 3
> lean on that rule, not on the paragraphs below.

Both modules declare in their own doc comments that they are the only two that
touch the Tauri runtime. What they do **not** have is a working browser path:
only `files.ts:refreshRecents` and `files.ts:installCloseGuard` branch on
`isTauri()`, while the other seven exported commands call a dialog or `invoke`
unguarded and fail at runtime under a plain `vite dev` today. Of nine exported
commands the seam is marked in two and open in seven.

Three things behave differently in a browser:

- **The command buttons already exist — they just fail.**
  `Toolbar.tsx:fileCommands` renders New, Open…, Save, Save As… and Export…
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

**One build, two entries, and the desktop must not notice (decision, recorded).**
This is where "one Vite build" stops being a slogan and becomes a constraint,
because the same `vite.config.ts` and the same `bun run build` feed Tauri:
`src-tauri/tauri.conf.json` sets `beforeBuildCommand: "bun run build"` and
`frontendDist: "../dist"`, and today `dist/index.html` **is** the editor. So the
two obvious moves each break the primary artifact §1.1 says must keep winning,
and both were measured rather than feared:

- Setting `base: "/zukai/"` in `vite.config.ts` rewrites every asset URL to
  `/zukai/assets/…`, which does not resolve under Tauri's `tauri://localhost`,
  and leaves `bun run dev` serving the app at `/zukai/` while `devUrl` still
  points at `/`.
- Moving the editor to `demo/index.html` makes `dist/index.html` the *landing*
  page — which is the file the desktop window opens.

The resolution, and the reason the phase below names files:

- **`base` is never set in `vite.config.ts`.** It stays `/`, which is what Tauri
  needs, and the deploy passes `--base=/zukai/` through its own script. The
  non-root base then exists only on the path that wants it, and no build a
  developer runs locally can acquire it by accident. A `mode`-conditional `base`
  inside the config was considered and declined: it makes the desktop artifact
  depend on an env var being right, where a separate script makes it depend on
  which command was typed.
- **The editor moves to `demo/index.html` and `tauri.conf.json` follows it** — in
  **`app.windows[0].url` alone**. That is a real change to the desktop app's
  configuration, it is **one line**, and it is named here rather than discovered,
  which is why Phase 4 can no longer say "nothing about the app changes" and why
  its gate launches the desktop app.

  **The one line is exact, and both neighbouring edits are wrong.** Traced
  through the pinned `tauri 2.11.5` (`Cargo.lock`), in its own
  `src/manager/` — `prepare_webview` resolves a `WebviewUrl::App(path)` as
  `get_app_url().join(path)`, and `get_app_url` returns `build.devUrl` verbatim
  under `cfg(dev)` and the `tauri://` protocol URL otherwise. So:

  | change | `tauri dev` | `tauri build` |
  |---|---|---|
  | `windows[0].url` only, `devUrl` untouched | `…:1420/demo/index.html` ✅ | `tauri://localhost/demo/index.html` ✅ |
  | `devUrl` only | `…:1420/demo/` ✅ | serves `dist/index.html` — the **landing page** ❌ |
  | both | `…:1420/demo/demo/index.html` ❌ | ✅ |

  The middle row is the trap, and it is this section's own failure mode
  surviving into the cure: that resolver skips the join for the literal
  string `index.html`, so leaving `url` at its default makes the packaged app
  fall back to the dist root and open the placeholder — passing `tauri dev`
  while failing `tauri build`. **Do not touch `devUrl`.**

The wasm artifact imposes no exotic hosting requirement: nothing here uses
threads or `SharedArrayBuffer`, so no COOP/COEP headers are needed — which
matters, because Pages cannot set them. GitHub Pages also serves `.wasm` as
`application/wasm`, **but nothing depends on that**: wasm-pack's generated glue
already falls back from `instantiateStreaming` to `arrayBuffer()` +
`WebAssembly.instantiate` on a wrong content type, and does it with a
`console.warn` rather than an error. Worth recording in `rules/deploy.md` so the
claim is not trusted as load-bearing when it is not.

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
  Phase 5's exit gate; does not block Phases 1–4, which can use the fixtures.
- **OQ-2 — RESOLVED 2026-08-22: the project page, `base: "/zukai/"`.**
  ~~Project page (`<user>.github.io/zukai/`) or a custom domain? This
  fixes Vite's `base` and therefore every asset URL, so it wants answering
  before Phase 4 rather than during it.~~ *(needs-input; answered by the repo
  owner.)*

  The deploy is `https://ivapo.github.io/zukai/`, with the editor at
  `/zukai/demo/` — which is what §1's end state now states literally, the
  `<pages-host>` placeholder having been the other thing this question was
  holding open. A custom domain is not refused, only not bought; moving to one
  later is a change to the one `--base` this spec passes plus a redeploy,
  because **`base` is baked at build time and is not a DNS-level switch**.

  Where it landed: §2.6 owns the mechanism — `base` is never written into
  `vite.config.ts`, so the desktop build cannot acquire it — and Phase 4 spends
  it.
- **OQ-3 — RESOLVED 2026-08-21: download-only everywhere.** ~~Does the browser
  host use the File System Access API where it exists (Chrome: a real
  save-in-place, so Cmd-S means what it means on the desktop) or download-only
  everywhere (universal, but Save silently becomes Save-a-copy)? A hybrid is
  possible and is the likely answer, at the cost of two code paths through
  Save.~~ *(design call)* ~~Blocks Phase 2's scope.~~

  One code path, every browser, and **Save is honestly Save-a-copy**: it does
  not mark the document clean and does not set `currentPath`, so a second Cmd-S
  downloads again rather than writing in place. That is the reading §1.1 already
  leans toward — *"a document lives in the tab and leaves through Export"* — and
  §1's usage narrative ends at Cmd-E with no Save at all.

  It matters more than it looks: `host.ts:Host.save` returns **where the
  document landed**, and `files.ts:adopt` feeds that to `markSaved`, which sets
  `currentPath` and clears `dirty`. Download-only means the browser host's
  `save` returns **`null`** — the value that already means "nothing was
  adopted" — rather than inventing a path for a file the page cannot address.
  The hybrid was declined because a `FileSystemFileHandle` is not the `string`
  that interface returns, so it would have reopened a seam Phase 1 shipped, for
  a capability two of four browsers lack. Lands in **Phase 3**, which is the
  phase that owns Save.
- **OQ-4 — MEASURED 2026-08-21: 118 kB gzipped, 314 kB raw.** ~~Is there a size
  budget for the wasm bundle?~~ `serde_yaml` plus the
  model should land in the low hundreds of KB gzipped, which is unremarkable
  for a demo but worth measuring rather than assuming. *(design call.)* It was
  tagged answerable-from-code, and that was wrong twice: §4 wants such questions
  answered **during review by reading the source**, and a gzipped bundle size
  cannot be read from source — it needs the build Phase 2 creates. **No budget
  is set, so this is a recorded measurement and not a gate item**: nothing about
  it can turn Phase 2 red. If the number is alarming when it lands, that
  argues for a *new* question with a threshold, not for a gate written after
  the fact.

  It is not alarming: `zukai_lib_bg.wasm` is **313.7 kB raw, 118 kB gzipped**,
  at the low end of the prediction, and Vite emits it as its own chunk behind a
  dynamic import — so it is fetched on the first Import and not on page load.
  For scale, the app's own JS chunk is 170 kB gzipped and the embedded Overpass
  Mono face is ~18 kB. No threshold is proposed on the strength of one
  measurement; the number is here so a later one has something to be compared
  against.

  **Re-measured after Phase 3: 683.4 kB raw, 239.6 kB gzipped** — the `.zkai`
  codec roughly doubled it, which is `serde_yaml`'s *deserializer* for the whole
  `Document` arriving on top of the serializer that was already there. Still
  behind the same dynamic import, and now fetched by Open and Save as well as
  Import. This is the second measurement the paragraph above wanted, and it
  still argues for no threshold: the growth is one feature's worth and it is
  explainable, so a number invented now would be fitted to it rather than
  derived from anything. Phase 4 deploys it over a CDN, which is the point at
  which the figure starts to mean something about what a visitor waits for.
- **OQ-5** — Does the web build ever become the *only* build? Assume no; the
  non-goal in §1.1 stands until something forces the question. *(deferred by
  evidence)*

## 4. Implementation phases

Strictly sequential. Phases 1, 2 and 3 each light up a real capability in a
plain `vite dev` browser with no Tauri present, which is what makes Phase 4 a
deploy of something that already works rather than a debugging session in CI.

Phases 2 and 3 were **one phase** until Phase 1 shipped and the round on it
measured what a pass in this repo actually costs. Splitting them by *format*
rather than by language keeps the observable in the first half — an imported
network is a picture, a saved file is not — and confines OQ-3 to the second.

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

### Phase 2 — Import in the tab: the wasm core, and a dropped `network.yaml`
*Produces the observable: **yes** — a real `network.yaml` becomes a drawn
junction in a browser, which is the most persuasive thing this app does, and is
§1's usage example verbatim.*

Split from what was one phase covering both formats. Import alone produces the
picture; `.zkai` (Phase 3) produces a file. Cutting there also keeps the wasm
surface to **one** function for its first outing, and leaves Save — the one
thing OQ-3 governed — out of the phase entirely.

- **Scope, Rust:** make the crate build for `wasm32-unknown-unknown`. Move
  `tauri`, `tauri-plugin-dialog` and `tauri-plugin-opener` in
  `src-tauri/Cargo.toml` under
  `[target.'cfg(not(target_arch = "wasm32"))'.dependencies]`, `#[cfg]`-gate the
  command shells and the two native-only modules (`export`, `recent`), and gate
  `lib.rs:run` and `lib.rs:greet` with them.

  **That is not sufficient, and the missing step is the one that bites.**
  `[build-dependencies]` are host-compiled and a target table does not touch
  them, so `src-tauri/build.rs` still runs `tauri_build::build()` on a wasm32
  build and **panics** — measured, applying exactly the recipe above:

  ```
  error: failed to run custom build command for `zukai v0.1.0`
    panicked at tauri-build-2.6.3/src/lib.rs:427:6:
    missing `cargo:dev` instruction, please update tauri to latest
  ```

  The message misdirects: the fix is not a version bump but gating the call on
  `std::env::var("CARGO_CFG_TARGET_ARCH")`, after which the lib builds clean.
  The rest of the tree needs nothing — `serde`, `serde_json` and `serde_yaml`
  (pure-Rust `unsafe-libyaml`) all cross, there is no C dependency, and
  `crate-type` needs no change.

  One seam artifact the split creates, worth naming so "`wasm-pack build`
  clean" is unambiguous: with both its commands gated out and the codec not yet
  extracted, `persist.rs` still compiles for wasm32 in this phase with
  `migrate` and `VersionProbe` unreachable, so it will warn `dead_code`. Gate
  `mod persist` for wasm32 here and un-gate it in Phase 3, rather than leaving
  the build's cleanliness to interpretation.

  Then a `wasm` module exposing **one** `#[wasm_bindgen]` function: a
  `network.yaml` string in, a document out. It is a thin call onto
  `network::parse_network` plus `network::import::network_to_document`, both
  already `pub` and neither reading a path.

  **Marshalling is the one place it is not thin (decision, recorded).**
  `serde_wasm_bindgen::to_value` maps a Rust map to an ES `Map`, while
  `model/layout.rs:Layout` is four `BTreeMap`s and `document.ts:normalizeDocument`
  indexes plain objects — `layout.nodes ?? {}` passes a `Map` straight through
  and every lookup then yields `undefined`, i.e. a blank canvas that throws
  nothing. Use `Serializer::json_compatible()`. This is also the honest answer to
  what the equivalence gate below is *for*: the two paths share a converter, so
  it cannot catch converter drift — it catches **marshalling** drift, which is
  the real hazard and the one §2.4's argument does not cover.

- **Scope, build:** `wasm-pack build --target web`, output to `src-tauri/pkg/`,
  **gitignored** rather than committed, with a `prewasm`-style script so
  `bun run dev`, `bun run test` and `bun run build` each build it first. Under
  vitest's `node` environment the generated `init()` `fetch`es an
  `import.meta.url`-relative `.wasm`, which fails on `file:` — the test reads
  the bytes and passes them in (`init({ module_or_path })`). No second
  `--target nodejs` build, and no jsdom.

- **Scope, frontend:** Import lights up, in two halves that must not be
  confused with each other.

  **The button keeps the shipped seam untouched.** `Host.importNetwork()` stays
  exactly as Phase 1 shipped it — no arguments, returns a `RawDocument` — and
  each host still sources its own file: the Tauri host its dialog plus
  `invoke`, the browser host a hidden `<input type="file">` plus the wasm. The
  toolbar's existing `Import…` button already dispatches
  `files.ts:importNetwork`, which is unchanged. **Nothing about the desktop path
  moves**, which §1.1's first non-goal requires.

  **The drop needs a second entry point, because Phase 1's seam is
  pull-shaped**: `host.importNetwork()` sources the file itself, while a drop
  *arrives* with a `File` already in hand. Three things, and the third is the
  one that keeps the seam intact:

  1. `files.ts` gains one exported command, `importNetworkFile(state, dispatch,
     file)`. It runs `confirmDiscard` exactly as the button does, reads the file
     with `await file.text()` — `File` is a web type both hosts have, and this
     names no codec — and dispatches `importDocument`.
  2. `Host` gains one method, `importNetworkText(text: string):
     Promise<RawDocument>`. **This is where the codec is called**, so
     `files.ts` still names neither wasm nor `invoke` and no host ever imports
     `files.ts` — the cycle `host.ts`'s own doc comment forbids does not open.
  3. **Both hosts honour it**, so the seam carries no method a host refuses.
     The browser calls the wasm. The desktop gets a new five-line
     `#[tauri::command] import_network_text(text: String)` onto the same
     `parse_network` + `network_to_document` pair the path command already
     uses — registered in `lib.rs:run`'s `generate_handler!` list like the
     others, and needing no `capabilities/default.json` change, since that file
     carries only `core:`/`dialog:`/`opener:` permissions and no app-command
     entries. That is a real addition to the scope and is named here rather than
     discovered: it is what makes desktop drag-and-drop a later one-liner
     instead of a redesign of this seam.

  The drop listener lives on `Canvas`, which already receives `state` and
  `dispatch`, and routes by extension: `.yaml`/`.yml` → `importNetworkFile`;
  anything else → a `notify`, since `.zkai` is Phase 3. **Browser-only in this
  phase**, gated on `isTauri()`, because a Tauri webview has its own drag-drop
  handling to configure — the host method above is honoured on both hosts
  regardless, which is what makes turning it on later cheap.

  **`canOpenDocuments` needs no rename and no split.** It gates `openDocument`
  and `importNetwork` today; this phase removes the guard from `importNetwork`
  only, leaving the flag gating exactly the command its name describes. It
  retires in Phase 3.

  **The `notYet` message in `host-browser.ts` goes partly stale here** and must
  be reworded: its text says the web build "does not carry the document codec",
  which stops being true for `open` and `save` the moment this phase lands a
  codec that simply does not decode `.zkai` yet.

- **Exit gate:** `cargo test` green, and **the 69 that exist today all still
  run** — this phase adds the golden-writer below, so the total lands at 70.
  Assert the count rather than eyeballing "ok": this phase edits the modules
  those tests cover, and a `#[cfg]` gate that excises a module leaves a
  *smaller* green run, which reads identically to a passing one. `cargo check`
  never compiles `#[cfg(test)]` code at all, and `clippy --all-targets`
  compiles it without running it. Plus `cargo check`, `cargo fmt --check`,
  `cargo clippy --all-targets -- -D warnings` for the native target;
  `wasm-pack build` clean; `bun run test` and `bun run build` green.
  - **Deterministic — and the artifact it compares against is created by this
    phase, because none exists.** There is no committed golden document
    anywhere in the repo: `import.rs`'s tests build a `Document` in-process and
    assert *properties*, and `CROSS_4` is a `#[cfg(test)]` const. So add a Rust
    test over `src-tauri/tests/fixtures/golden/cross-4.document.json`
    (serde_json, committed) that **asserts by default and rewrites only behind
    an explicit opt-in** (an env var). That distinction is the whole value: a
    test that regenerates the file on every run always matches itself and
    asserts nothing. Then a vitest loads the built wasm, feeds it
    `src-tauri/tests/fixtures/network/cross-4.yaml`, and asserts the result
    deep-equals that same committed JSON. Two readers, one file, and the golden
    cannot rot without the Rust test going red.
  - **Behavioural:** in a plain `vite dev` browser, drag `cross-4.yaml` onto the
    canvas and get a four-arm junction with painted turn arrows — the fixture
    carries 16 movements and the shipped Rust test pins **8** turn-arrow
    markings on `L1/L1/L4/L4/L5/L5/L8/L8` around node `N5`, so this is
    eyeball-checkable against a known count. Then export it as SVG, which is
    Phase 1's capability meeting Phase 2's on one document.
  - **Recorded, not gated:** OQ-4's measured bundle size.
- **Close-out:** updates `rules/network-yaml.md` (**313 of `max_lines: 315`** —
  two lines, so this one needs a bump or a trim, and the phase should say which)
  and `rules/host-seam.md` (122/150, room), whose capability table, its
  `canOpenDocuments` paragraph and its "Where each piece lives" table all go
  partly false here, and whose `sources` gains the wasm loader and the drop
  handler. Updates `CLAUDE.md`'s Commands block with the wasm build. One push.

### Phase 3 — `.zkai` in the tab: decode, encode, Open and Save
*Produces the observable: **no** — it produces a file, not a picture, and that
is precisely why it was split out rather than left riding along with the phase
that does.*

**So it needs the argument §3 demands, and here it is.** This spec's case is
**reach**, not capability (§1), and the test is whether a phase gets a real
figure in front of someone who does not have the app. Phase 3 does that
indirectly and specifically: Phase 1 shipped Open, Save and Save As as *live
toolbar buttons that explain they do not work yet*, which is honest for one
release and untenable as a permanent state — a deployed demo with three dead
buttons reads as broken software rather than as a deliberate subset. Either this
phase lands or those buttons come out, and taking them out is worse, because a
visitor who spends ten minutes schematising an imported network and then cannot
keep it has been actively misled by the presence of a Save button.

**The honest counter, recorded rather than buried:** §1.1 says the demo is not a
replacement for the desktop app, and a reader who wants to keep work can install
one. If that view wins, the right move is not to build this phase badly but to
**cut it and remove the three buttons from the browser row** — which is a real
option, and cheaper than it will ever be again, since Phase 2 already carries
every piece of wasm machinery it would share. The roadmap records two features
in this project cut *after* shipping for want of exactly this question, so it is
asked here rather than assumed away.

- **Scope:** two more `#[wasm_bindgen]` functions — decode a `.zkai` string to a
  document, encode a document to `.zkai`. Both are the bodies of
  `persist::load_document` and `persist::save_document` minus their one `fs`
  call each, **with `persist::migrate` and the version probe preserved**. Note
  that `migrate` and `VersionProbe` are **private today**, so this is an
  extraction into pure `encode`/`decode` functions that both the native command
  and the wasm shell call — not a visibility change, and not a copy.

  Then Open (a file input, and `.zkai` joins the canvas drop's routing table)
  and Save. Per **OQ-3, resolved: download-only**. `browserHost.save` returns
  **`null`**, so `files.ts:adopt` never runs, the document stays dirty and
  `currentPath` stays unset — Save is Save-a-copy and the app does not pretend
  otherwise. `canOpenDocuments` and the `notYet` helper retire; note
  `browserHost.read` (Open Recent) **keeps throwing**, because §2.5 keeps
  recents empty on this host, so its message must stop citing the codec.
- **Exit gate:** `cargo test` green, and **every test Phase 2 left behind still
  runs** — assert the count, for the reason Phase 2 gives; `cargo check`,
  `cargo fmt --check`,
  `cargo clippy --all-targets -- -D warnings`; `wasm-pack build` clean;
  `bun run test` and `bun run build` green.
  - **Deterministic:** a `.zkai` round trip through wasm is byte-identical to
    what the Rust path writes for the same document. As in Phase 2 the reference
    must be created: add a Rust test over a committed
    `src-tauri/tests/fixtures/golden/cross-4.zkai` written from the imported
    fixture — asserting by default and rewriting only behind the same explicit
    opt-in Phase 2 uses — then assert the wasm encoder reproduces those bytes.
    **Feed that encoder the document its own wasm importer produced from
    `cross-4.yaml`**, not a `JSON.parse` of Phase 2's golden: chaining the two
    wasm functions is what the demo actually does, and it is the strictly
    stronger test. **Not**
    `tests/fixtures/zkai/t-junction-glyph.zkai` — that one is hand-authored, its
    README forbids regenerating it from the app, and loading it runs `migrate`,
    so a round trip through it is guaranteed *not* byte-identical. Byte-identity
    is achievable across the two targets: `serde_yaml` formats floats through
    `ryu`, key order is struct field order plus `BTreeMap`, and every
    `skip_serializing_if` is a pure predicate.
  - **Behavioural:** in a plain `vite dev` browser, import `cross-4.yaml`, press
    Save, reopen the downloaded `.zkai` through Open, and get the same drawing.
- **Close-out:** updates `rules/persistence.md` (**130 of `max_lines: 132`** —
  bump or trim) and `rules/host-seam.md`, which loses its "throws — needs the
  wasm codec" row and its `canOpenDocuments` paragraph. That rule also states
  the seam's cancel/throw contract as two cases — `null` means the user backed
  out, a throw means failure — and download-only Save adds a **third** reading
  of `null`: *delivered, but nothing to adopt*. Spell it out there rather than
  letting the sentinel quietly carry two meanings. One push.

### Phase 4 — The GitHub Pages deploy
*Produces the observable: **yes** — it is the phase that puts the figures at a
URL, which is the entire point of the spec.*

**It is also the phase that can silently break the desktop app**, which the
first draft of it did not notice and three reviewers did. §2.6 carries the
decision; this phase spends it, and says so in its gate.

- **Scope, the build.** Four files, named rather than left to be found:
  - `index.html` — the repo's single entry today, and it *is* the editor —
    **moves to `demo/index.html`**. A new `index.html` takes its place as the
    landing entry.
  - `vite.config.ts` — gains `build.rollupOptions.input` naming both entries.
    **It does not gain a `base`**, for the reason §2.6 gives.
  - `package.json` — gains `build:web`, spelled **`bun run build --base=/zukai/`**
    and not as a copy of `build`'s own body. The spelling is load-bearing: bun
    appends a passthrough flag to the end of the script string, so it lands on
    `vite build` *and* the existing `prebuild` → `bun run wasm` hook still fires
    (measured). A duplicated `tsc && vite build --base=…` would look equivalent
    and skip the wasm build, which CI cannot survive — `src-tauri/pkg/` is
    gitignored, so a fresh checkout has no dynamic-import target. The deploy runs
    this script; every other command keeps the root base Tauri needs.
  - `src-tauri/tauri.conf.json` — **one line**: `app.windows[0].url` becomes
    `demo/index.html`, so the desktop window still opens the editor.
    **`devUrl` is left exactly as it is** — §2.6 carries the truth table, and
    both of the neighbouring edits an implementer would reach for are wrong.

- **Scope, what `/` serves.** A **deliberate placeholder**, not the landing page:
  a title, one sentence, and a link to `demo/` — **`href="demo/"`, never
  `href="/demo/"`**, because `a[href]` is not in Vite's asset-attribute table and
  so never gets the base applied: the root-absolute form would point at
  `ivapo.github.io/demo/` and 404. Phase 5 fills it. The point of
  shipping any file at all is that the second entry is *built, deployed and
  reachable* one phase before there is content to put in it — an entry that
  exists only in Phase 5 is an entry whose routing is first exercised in Phase 5.

- **Scope, the deploy.** A GitHub Actions workflow at
  `.github/workflows/pages.yml`: Bun, a Rust toolchain with the
  `wasm32-unknown-unknown` target, `wasm-pack`, `bun install`, `bun run
  build:web`, then `actions/configure-pages`, `actions/upload-pages-artifact`
  (`path: dist`) and `actions/deploy-pages`. It needs
  `permissions: {contents: read, pages: write, id-token: write}` and an
  `environment: github-pages` job, both of which `deploy-pages` requires and
  neither of which is optional. Triggered `on: push` to `main` plus
  `workflow_dispatch`, under a `concurrency` group, so "the push is the deploy"
  names a mechanism rather than a hope.

- **Scope, one thing a commit cannot do.** **Repository Pages settings are a
  human action, not a step** — `Ivapo/zukai` currently has Pages *off*
  (`gh api repos/Ivapo/zukai/pages` → 404), and `deploy-pages` fails until the
  source is switched to GitHub Actions. Arrange it before the pass, not during
  it; it is the one step between a green workflow and a red one.

- **Scope, the favicon.** `src-tauri/icons/32x32.png` is copied to a new
  `public/favicon.png` — Vite's default `publicDir`, which the repo does not have
  yet — and both entries get a `<link rel="icon" href="/favicon.png">`. Vite
  rewrites a root-relative `href` under the deploy's base, so the one file serves
  both hosts. It is in scope because of the gate below: with no icon declared a
  browser requests `/favicon.ico` against the **host** root, which on a project
  page is `ivapo.github.io/favicon.ico` and 404s no matter how right `base` is.

- **Exit gate.** In four parts, because this phase's blast radius is both hosts
  and a deploy — not just a URL.

  1. **The desktop still works, and this is checked first.** `bun run build`
     green with the root base (the assets it emits are `/assets/…`, not
     `/zukai/assets/…`), and `bun run tauri dev` opens a window showing **the
     editor** — the toolbar, the canvas, the grid — rather than the landing
     placeholder or a blank page. Without this clause the §2.6 breakage ships
     green, which is exactly how it nearly did.
  2. **Both URLs serve.** `https://ivapo.github.io/zukai/` serves the
     placeholder and its link reaches `https://ivapo.github.io/zukai/demo/`,
     which serves the editor.
  3. **The demo works where it is deployed**, in **both Chrome and Firefox**.
     Written out here rather than delegated to Phases 1–3, whose own wording has
     since drifted: Phase 1's ends at confirming a banner appears when Open
     *refuses*, and Phase 3 made Open work, so that check has nothing left to
     observe. (The banner itself survives — it is still `notify`'s surface; what
     retired is the `notYet` message behind it.) The checker
     needs a repo checkout for the fixtures; the in-app "Open an example" menu
     is Phase 5, so nothing on the deployed site supplies them yet:
     - drop `src-tauri/tests/fixtures/network/cross-4.yaml` on the canvas → a
       four-arm junction carrying **8** turn-arrow markings, the count Phase 2
       pinned;
     - Export SVG, and open the downloaded file — it shows what the canvas does;
     - Export PNG, likewise;
     - Save, then Open the downloaded `.zkai` → the same drawing.
  4. **A cold load with an empty cache** — hard-reload, devtools open — raises
     **no console error from the site's own assets**. That is where a wrong
     `base` surfaces for the JS, CSS and fonts. It is deliberately *not* claimed
     to surface a mis-served `.wasm`: OQ-4 already records that the wasm sits
     behind a dynamic import and is fetched on the first Import, so part 3 is
     what covers it. The qualifier "from the site's own assets" is load-bearing
     too — Chrome and Firefox disagree about whether a favicon 404 is an error
     at all, and a gate that two browsers score differently is not a gate.

- **Close-out:** seeds `rules/deploy.md`, whose `sources` are the workflow,
  `vite.config.ts`, `package.json`, `index.html`, `demo/index.html` and
  `src-tauri/tauri.conf.json` — no existing rule declares any of those, so this
  is genuinely new ground rather than a gap in an old rule. Adds the demo URL to
  `README.md` — **the link only**; that file is stale in two ways Phase 5 owns,
  and this phase should say so in its commit rather than quietly widen.

  **`CLAUDE.md`'s Commands block needs two edits, not one.** `build:web` is the
  obvious one. The other is easy to miss: after the move, `bun run dev` serves
  the *placeholder* at `/` and the editor at `/demo/`, so the block's
  `bun run dev # frontend only` line and every "under plain `bun run dev`"
  reading of it now points at the wrong page. The same block's "`dev`, `build`
  and `test` each run `wasm` first" sentence wants `build:web` in its list, and
  that is part of the same edit rather than a third one.

  `README.md`'s own `bun run dev` line acquires that same staleness. It is
  staleness **this** phase creates rather than one of the two Phase 5 owns, so
  say which is which in the commit; Phase 5's `README.md` reconciliation is
  still where it gets fixed. Also updates the project-memory roadmap, because a
  demo going live is exactly a roadmap line. One push, and the push is the
  deploy.

### Phase 5 — The landing page, and the examples it is made of
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
