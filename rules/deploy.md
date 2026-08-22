---
title: deploy
sources:
  - .github/workflows/pages.yml
  - vite.config.ts
  - package.json
  - index.html
  - demo/index.html
  - src-tauri/tauri.conf.json
covers: >
  how one Vite build serves two hosts — the two entries and which is which,
  where the deploy's `base` lives and why never in the config, the one line in
  `tauri.conf.json` that keeps the desktop window on the editor and the two
  neighbouring edits that break it, the favicon that has to exist, and the
  workflow that makes a push to `main` the deploy
max_lines: 130
generated: 2026-08-22
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

The root `index.html` is a **deliberate placeholder** — a title, one sentence and
a link — not the landing page. zk-015 Phase 5 fills it. It mounts no React and
must not reach `src/styles.css`, which is the editor's chrome.

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

`public/favicon.png` (Vite's default `publicDir`, copied from
`src-tauri/icons/32x32.png`) and a `<link rel="icon" type="image/png"
href="/favicon.png" />` in **both** entries. Vite base-prefixes a `link[href]`
even in the nested entry, so one file serves both hosts. Without it a browser
requests `/favicon.ico` against the **host** root, which on a project page is
`ivapo.github.io/favicon.ico` and 404s no matter how right `base` is.

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

No `apt-get` step is needed: `tauri`, `tauri-plugin-dialog` and
`tauri-plugin-opener` sit behind a `cfg(not(target_arch = "wasm32"))` table in
`src-tauri/Cargo.toml`, and the only host-compiled Tauri crate is the
`tauri-build` build-dependency, which needs no webkit2gtk.

Nothing here needs COOP/COEP headers — which Pages cannot set — because nothing
uses threads or `SharedArrayBuffer`. Pages does serve `.wasm` as
`application/wasm`, **but nothing depends on that**: wasm-pack's generated glue
falls back from `instantiateStreaming` to `arrayBuffer()` +
`WebAssembly.instantiate` on a wrong content type, with a `console.warn` rather
than an error.

## Where each piece lives

| piece | file | what checks it |
|---|---|---|
| the two entries | `index.html`, `demo/index.html` | `dist/` after `bun run build` |
| `rollupOptions.input` | `vite.config.ts` | `dist/index.html` + `dist/demo/index.html` both emitted |
| the non-root base | `package.json:build:web` | `/zukai/assets/…` in `dist/demo/index.html` |
| the root base | `vite.config.ts` (no `base`) | `/assets/…` in the same file after `bun run build` |
| the desktop window's page | `src-tauri/tauri.conf.json` `app.windows[0].url` | `bun run tauri dev` opens the editor |
| the favicon | `public/favicon.png` + both entries | a cold load raises no error from the site's own assets |
| the deploy | `.github/workflows/pages.yml` | a push to `main` serves both URLs |
