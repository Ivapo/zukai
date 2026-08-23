---
title: deploy
sources:
  - .github/workflows/pages.yml
  - .github/workflows/release.yml
  - vite.config.ts
  - package.json
  - index.html
  - demo/index.html
  - public/mark.svg
  - scripts/render-examples.ts
  - examples/README.md
  - src-tauri/tauri.conf.json
covers: >
  how one Vite build serves two hosts — the two entries and which is which,
  where the deploy's `base` lives and why never in the config, the one line in
  `tauri.conf.json` that keeps the desktop window on the editor and the two
  neighbouring edits that break it, the favicon that has to exist, where
  the landing page's figures come from and what keeps them honest, the
  workflow that makes a push to `main` the deploy, and the second one that
  turns a `v*` tag into a published desktop release
max_lines: 250
generated: 2026-08-23
---

# Deploy

**What is true right now.** The *why* lives in `specs/web_demo_spec.md` §2.6 and
its Phase 4; this is the *what is*.

## Two entries, one build

```
index.html        the landing entry     → https://ivapo.github.io/zukai/
demo/index.html   the editor            → https://ivapo.github.io/zukai/demo/
```

`vite.config.ts` names both in `build.rollupOptions.input`, keyed `landing` and
`demo`, through a local `entry()` helper that resolves each against
`import.meta.url` — absolute, so an entry does not depend on the cwd a caller
happens to use, and `tauri.conf.json`'s `beforeBuildCommand` is one such caller.

`demo/index.html` is the file that was `index.html` until zk-015 Phase 4. It
carries `<div id="root">` and `<script type="module" src="/src/main.tsx">`; the
root-absolute `src` still resolves, because Vite resolves it from the project
root and `script[src]` is in Vite's asset-attribute table, so it is rewritten
under whatever `base` the build was given.

The root `index.html` is the **landing page**: what Zukai draws, what it
deliberately is not, the one-way Assimilator relationship, and three diagrams.
**It mounts no React and must not reach `src/styles.css`** — that file is the
editor's chrome. Both are standing rules rather than facts about a placeholder:
this entry is static markup plus one inline stylesheet, and reaching for either
would put the editor's bundle on a page that needs neither.

**Its link is `href="demo/"` and never `href="/demo/"`.** `a[href]` is *not* in
Vite's asset-attribute table, so it never receives the base; the root-absolute
form would resolve against the host root and 404 on a project page.

## `base` lives in a script, never in the config

`vite.config.ts` sets **no `base`**. It stays `/`, which is what Tauri's
`tauri://localhost` needs and what `bun run dev` serves. The deploy passes the
non-root base through its own script:

```json
"build:web": "bun run build --base=/zukai/"
```

**That spelling is load-bearing, and a copy of `build`'s body is not
equivalent.** Bun appends a passthrough flag to the end of the script string, so
it lands on `vite build` *and* the existing `prebuild` → `bun run wasm` hook
still fires. `src-tauri/pkg/` is gitignored, so a fresh checkout has no target
for the loader's dynamic `import()`; a duplicated `tsc && vite build --base=…`
skips the wasm build and CI cannot survive it.

A `mode`- or env-conditional `base` inside the config was considered and
declined: it makes the desktop artifact depend on an env var being right, where a
separate script makes it depend on which command was typed.

`base` is baked at build time. Moving to a custom domain is a change to this one
flag plus a redeploy — not a DNS-level switch.

## The one line that keeps the desktop on the editor

`tauri.conf.json` sets `frontendDist: "../dist"`, and after the move
`dist/index.html` is the *landing* page. So `app.windows[0].url` is
`"demo/index.html"`, and **`build.devUrl` is left exactly as it is.** Both
neighbouring edits are wrong. Traced through the pinned `tauri 2.11.5`:
`prepare_webview` resolves a `WebviewUrl::App(path)` as `get_app_url().join(path)`,
and `get_app_url` returns `build.devUrl` verbatim under `cfg(dev)`.

| change | `tauri dev` | `tauri build` |
|---|---|---|
| `windows[0].url` only | `…:1420/demo/index.html` ✅ | `tauri://localhost/demo/index.html` ✅ |
| `devUrl` only | `…:1420/demo/` ✅ | serves `dist/index.html` — the **landing page** ❌ |
| both | `…:1420/demo/demo/index.html` ❌ | ✅ |

The middle row is the trap: that resolver skips the join for the literal string
`index.html`, so leaving `url` at its default makes the packaged app fall back to
the dist root — passing `tauri dev` while failing `tauri build`.

## The favicon has to exist

`public/mark.svg` is the master — a road bent into a Z, in the palette
`styles/diagram.css` defines. `public/favicon.png` (256px) and the whole of
`src-tauri/icons/` are rasterized from it, the latter by
`bunx tauri icon <1024px.png>`; that command also emits `android/` and `ios/`
trees this project has no target for, and they are deleted rather than
committed. Both entries carry `<link rel="icon" type="image/png"
href="/favicon.png" />`. Vite base-prefixes a `link[href]`
even in the nested entry, so one file serves both hosts. Without it a browser
requests `/favicon.ico` against the **host** root, which on a project page is
`ivapo.github.io/favicon.ico` and 404s no matter how right `base` is.

## The landing page's figures are drawn by the app

Every diagram on `index.html` is an SVG the demo itself exported, inlined
**byte for byte** between a marker pair:

```html
<!-- zukai:diagram roundabout -->  …the export…  <!-- /zukai:diagram -->
```

`scripts/render-examples.ts` owns the bytes between those markers. It builds and
serves `dist` (a `prerender-examples` hook plus `vite preview`, so the demo is at
`/demo/`), then for each `.zkai` in `examples/` drives headless Chromium: click
**Open…** and take the `filechooser` event — `host-browser.ts:pickFile` never
adds its `<input>` to the document — then click **Export SVG** and take the
`download` event, `host-browser.ts:download` delivering through an
`<a download>` over an object URL.

`examples/*.zkai` has a **second** consumer, and it is a build input rather than a
script's: `src/editor/examples.ts` globs the directory, so the build emits each
document as its own chunk (~8 kB for the three) behind the demo's Examples menu —
which the desktop artifact carries and never loads. The directory is still not
*served*: nothing fetches it, and `examples/rendered/` reaches the deploy only as
bytes inlined in `index.html`.

**It asserts by default; `ZUKAI_UPDATE_GOLDEN=1` is the only thing that writes**
— the discipline `src-tauri/tests/fixtures/golden/README.md` established, since a
script that rewrites its own reference every run always matches itself. The
default pass checks five things: each `examples/rendered/*.svg` still equals what
the app just drew; at least one carries text, so the embedded `@font-face` block
is exercised; those bytes are present in `index.html` **and** in
`dist/index.html`; the page has no other `<svg>` element; and at 380px
`document.documentElement` has `scrollWidth <= clientWidth` with no console
error.

**Why a browser and not a build step.** `export.tsx:diagramSvg(doc, bounds)` is
pure, but `bounds` come from `measureDiagram`, which needs `document.fonts`, a
rendered `document.body` host and `getBBox`. Getting it wrong is silent:
`bounds = null` does not throw, it collapses the frame to the margin around the
origin and lands the drawing outside its own `viewBox`. For the same reason the
script forces `document.fonts.load('400 16px "Overpass Mono"')` before pressing
Export — `measureDiagram` awaits `fonts.ready` *before* mounting its host, so it
guarantees a resolved face only if one was already requested, and measuring the
fallback writes a **stably** wrong frame that an assert-by-default diff cannot
tell from a right one.

**Two consequences of inlining.** Vite extracts every inline `<style>`, the two
inside each exported `<svg>` included, but re-inserts them **unminified** (the
CSS-post plugin returns early for an HTML proxy, and `url(data:…)` is skipped by
the URL replacer) — which is why byte-presence holds in the built page and not
only in the source. And each text-bearing diagram carries its own ~18 kB base64
Overpass Mono and its own copy of `diagram.css`: real page weight, accepted
deliberately. `public/mark.svg` stays an `img[src]`, keeping it out of the "no
other `<svg>`" check.

Byte-identity is scoped to headless Chromium at the pinned Playwright version;
across engines it is **not** claimed, `getBBox` and `fonts.ready` differing.

## The push is the deploy

`.github/workflows/pages.yml`, `on: push` to `main` plus `workflow_dispatch`,
under a `concurrency: {group: pages, cancel-in-progress: false}`. Two jobs:
a build job (checkout, Bun, a Rust toolchain with the `wasm32-unknown-unknown`
target, `wasm-pack`, `bun install --frozen-lockfile`, `bun run build:web`,
`configure-pages`, `upload-pages-artifact` with `path: dist`) and a deploy job
carrying `environment: github-pages` and running `deploy-pages`.

`permissions: {contents: read, pages: write, id-token: write}` and the
`environment` job are what `deploy-pages` authenticates with — neither is
optional. **The repository's own Pages source must be set to GitHub Actions**;
that is a settings change, not a step a commit can make.

No `apt-get` step is needed **in this workflow**: `tauri`, `tauri-plugin-dialog` and
`tauri-plugin-opener` sit behind a `cfg(not(target_arch = "wasm32"))` table in
`src-tauri/Cargo.toml`, and the only host-compiled Tauri crate is the
`tauri-build` build-dependency, which needs no webkit2gtk.

Nothing here needs COOP/COEP headers — which Pages cannot set — because nothing
uses threads or `SharedArrayBuffer`. Pages does serve `.wasm` as
`application/wasm`, **but nothing depends on that**: wasm-pack's generated glue
falls back from `instantiateStreaming` to `arrayBuffer()` +
`WebAssembly.instantiate` on a wrong content type, with a `console.warn` rather
than an error.

## A tag is the release

`.github/workflows/release.yml`, `on: push` to tags matching `v*` plus
`workflow_dispatch`, under `concurrency: {group: release-<ref>,
cancel-in-progress: false}`. `permissions: contents: write` — the **inverse** of
the sibling's first key, and not optional: the repository's own default workflow
permission is read.

Two jobs. `build` is a `fail-fast: false` matrix over `macos-latest`,
`ubuntu-latest` and `windows-latest` — checkout, bun, `dtolnay/rust-toolchain`,
`wasm-pack`, `Swatinem/rust-cache`, `bun install --frozen-lockfile`,
`bun run tauri build`, `actions/upload-artifact`. `publish` carries
`if: startsWith(github.ref, 'refs/tags/v')` and is the only thing that creates a
release, so **a dispatch run builds all three platforms and publishes nothing**.
That is what lets the pipeline be proven without cutting a release.

**Exactly three things are tag-conditional**: the version assert (step-level),
and the notes body and the publish (both by the `publish` job's own `if`). No
build step is. Written unconditionally the version assert reads perfectly and
fails every dispatch run — a dispatch carries no tag, and `github.ref_name` is
then the branch it was launched from.

**Every leg needs bun, `wasm-pack` and `wasm32-unknown-unknown`**, macOS and
Windows included, which no Tauri release example mentions: `beforeBuildCommand`
is `bun run build`, whose `prebuild` hook is `bun run wasm`, and `src-tauri/pkg/`
is gitignored. **The Linux leg additionally needs `apt-get`** — webkit2gtk,
librsvg, `patchelf` — because unlike the Pages build it compiles the real `tauri`
crate rather than the wasm32 one. The paragraph above is scoped to that workflow;
copying it here is the obvious move and the wrong one.

**macOS is one leg, not two.** `macos-latest` is arm64 and `bundle.targets:
"all"` selects bundle *formats* rather than architectures, so a plain build hands
every Intel reader a download that will not launch. `--target
universal-apple-darwin` with both Rust targets installed: one artifact, one name
on the release page — and the bundle moves under
`src-tauri/target/universal-apple-darwin/`.

One `path` list serves all three legs, and a pattern matching nothing contributes
nothing, so the format set is whatever `bundle.targets: "all"` produced rather
than something the file predicts; `if-no-files-found: error` is the assertion
that does the work. The macOS `.app` is deliberately absent — it is a directory,
and an artifact zip drops the executable bit.

**Tauri names bundles from `tauri.conf.json`, not from the tag.** The assert
compares `${GITHUB_REF_NAME#v}` against that file's `version`; without it a
`v0.2.0` tag over an unbumped config publishes a `v0.2.0` release full of `0.1.0`
files. **The release is published and not a prerelease, spelled rather than
defaulted** (`--draft=false --prerelease=false --latest`), because
`/releases/latest` resolves to the newest non-draft, non-prerelease release and a
draft is invisible to anonymous visitors entirely. **The builds are unsigned**;
the notes carry the Gatekeeper and SmartScreen bypasses, so a link that resolves
is a download that runs.

**No tag has been cut, and two sentences are waiting on one.** `index.html`'s
"Get the desktop app" section says "**no build has been cut yet**, so that page
is empty for now", and `README.md`'s Release pipeline bullet says the same. Both
go false the moment a `v*` tag lands, and nothing watches them.

## Where each piece lives

| piece | file | what checks it |
|---|---|---|
| the two entries | `index.html`, `demo/index.html` | `dist/` after `bun run build` |
| `rollupOptions.input` | `vite.config.ts` | `dist/index.html` + `dist/demo/index.html` both emitted |
| the non-root base | `package.json:build:web` | `/zukai/assets/…` in `dist/demo/index.html` |
| the root base | `vite.config.ts` (no `base`) | `/assets/…` in the same file after `bun run build` |
| the desktop window's page | `src-tauri/tauri.conf.json` `app.windows[0].url` | `bun run tauri dev` opens the editor |
| the mark | `public/mark.svg` → `public/favicon.png`, `src-tauri/icons/` | a cold load raises no error from the site's own assets |
| the page's figures | `examples/*.zkai` → `examples/rendered/*.svg` → `index.html` | `bun run render-examples`, which asserts all of it |
| the demo's examples | the same `examples/*.zkai`, globbed into per-document chunks | choosing one in the demo's Examples menu draws it |
| the deploy | `.github/workflows/pages.yml` | a push to `main` serves both URLs |
| the desktop release | `.github/workflows/release.yml` | a `workflow_dispatch` run builds all three platforms |
