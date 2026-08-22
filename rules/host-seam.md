---
title: host-seam
sources:
  - src/App.tsx
  - src/components/Banner.tsx
  - src/components/Canvas.tsx
  - src/components/Toolbar.tsx
  - src/editor/export-target.ts
  - src/editor/files.ts
  - src/editor/host.ts
  - src/editor/host-browser.ts
  - src/editor/host-tauri.ts
  - src/editor/menu.ts
  - src/editor/network-wasm.ts
  - src/editor/notices.ts
  - src/model/document.ts
covers: >
  how the file commands reach the outside world on two hosts — the Host
  interface and its cancel/throw contract, which capabilities the browser has
  and which still wait for the .zkai codec, the two shapes of Import and where
  the codec is called, how a host is chosen and which surfaces vary by it, where
  an export's filename and MIME are decided, and the in-page error banner
max_lines: 165
generated: 2026-08-22
---

# The host seam

What the file commands need from the machine they run on. Zukai ships as a Tauri
app and as a page in a browser tab; this is the one place that difference is
written down. The *why* lives in `specs/web_demo_spec.md`.

## The layers

| Layer | Where | May name Tauri? |
|---|---|---|
| Commands | `src/editor/files.ts` — the eleven exported commands | **no** |
| Interface | `src/editor/host.ts` — `Host`, `Unsubscribe`, `CloseGuard`, `OpenedDocument` | `isTauri()` only |
| Desktop | `src/editor/host-tauri.ts` — `invoke`, `ask`, `message`, `open`, `save`, `getCurrentWindow` | yes |
| Browser | `src/editor/host-browser.ts` — `Blob`, `<input type="file">`, `window.confirm`, `beforeunload` | **no** |
| Network codec | `src/editor/network-wasm.ts` — the crate, built for wasm32 | **no** |
| Export target | `src/editor/export-target.ts` — filename, format, MIME | **no** |
| Error surface | `src/editor/notices.ts` + `src/components/Banner.tsx` | **no** |

`src/editor/menu.ts` is the *other* module that touches the Tauri runtime, and it
is not behind the seam: a native menu has no browser counterpart, so
`installMenu` resolves `false` and `App` keeps the Cmd/Ctrl chords itself.

## Two rules that hold it apart

- **The hosts throw; only `files.ts` reports.** No implementation imports
  `report` or `detail` — that edge would make `files.ts → host.ts →
  host-tauri.ts → files.ts` a cycle. A host signals failure by throwing and
  **cancellation by returning `null`**, which is the distinction the save and
  open dialogs already drew. Confusing the two makes a cancelled dialog look
  like a broken one.
- **No Tauri type crosses.** `installCloseGuard` used to return `UnlistenFn`
  from `@tauri-apps/api/event`; `host.ts` declares its own `Unsubscribe`
  instead. The two are structurally identical (`() => void`), so **`tsc` cannot
  catch a regression here** — it is a convention, not a check.

`export-target.ts` is a leaf for the same reason in miniature: `host.ts` imports
both implementations at runtime to choose between them, so a pure function
living there and called by `host-browser.ts` would close a real ESM cycle. Being
a leaf is also what lets it be tested with no DOM.

## What each host can do

| Capability | Desktop | Browser |
|---|---|---|
| `open` / `read` / `save` | dialogs + IPC | **throws** — needs the `.zkai` codec |
| `importNetwork` | open dialog → `import_network` | hidden `<input type="file">` → the wasm |
| `importNetworkText` | `import_network_text` | the wasm |
| `exportTarget` / `deliverExport` | save dialog → `write_text_file` / `write_binary_file` | pure decision → `Blob` download |
| `recents` / `rememberRecent` | `recent_files` / `push_recent_file` | `[]` — no Open Recent surface exists |
| `confirm` | the dialog plugin's `ask` | `window.confirm` |
| `notify` | native `message` dialog | the in-page banner |
| `closeGuard` | `onCloseRequested` + a real prompt | `beforeunload`, decided synchronously |

`canOpenDocuments` is `false` on the browser and **checked before the discard
prompt**, so a dirty document is never asked to throw away work for a command
that is about to refuse. It is the one capability flag, and it gates
`openDocument` alone: Import came off it when the wasm network reader landed, so
the flag now means exactly what its name says — `.zkai`, not any file. It goes
away when Phase 3 lands that codec.

## Import has two shapes, and the split is what keeps the seam intact

`importNetwork()` is **pull**-shaped — it takes no arguments and each host
sources its own file, which is what let the desktop path stay byte-identical
when the browser gained one. A dropped file is **push**-shaped: it arrives
already in hand. So there are two entry points, and the second one is where the
line is drawn.

- `files.ts:importNetworkFile(state, dispatch, file)` reads `file.text()` and
  nothing else. `File` is a web type both hosts have and `text()` names no
  codec, so the commands module stays free of both `invoke` and wasm.
- `Host.importNetworkText(text)` is **the one seam method that names a codec**,
  and **both hosts honour it** — the browser through `network-wasm.ts`, the
  desktop through `import_network_text`. A method one host refused would be a
  hole in the interface; a five-line Rust command is cheaper than the hole.

Neither host may call into `files.ts` to reach the banner: that edge closes the
ESM cycle above. The drop's own error path is `files.ts:reportUnsupportedDrop`.

The canvas drop is gated on `isTauri()` and is browser-only for now, because a
Tauri webview intercepts file drops itself and wants its own configuration. It
routes on `document.ts:isNetworkFile`, which the desktop's dialog filter also
reads, so the two hosts cannot disagree about what a network is.

Two things about the wasm that are easy to get wrong and fail *silently*: the
Rust must serialize through `Serializer::json_compatible()`, or a `BTreeMap`
crosses as an ES `Map` and `normalizeDocument` indexes it as an empty object —
a blank canvas that throws nothing; and the module loads on first import rather
than at startup, so a visitor who never imports never fetches the `.wasm`.

`CloseGuard` carries two methods and each host uses exactly one. That is not
unfinished: a desktop window can be held open across an `await`, so it gets
`mayClose()` and a real prompt, while `beforeunload` must answer inside the
event and gets the synchronous `hasUnsavedWork()`. **`mayClose` never rejects** —
a prompt that failed to appear is no reason to lose the document, so it reports
itself and resolves `false`, keeping the window.

## The export target

`ExportTarget.destination` is **host-opaque**: an absolute path on the desktop, a
bare download name in a browser. It is produced and consumed by the same host and
must never be re-derived by the other — running a desktop path through `basename`
is exactly how an export dialog loses the document's own folder. `mime` is the
browser's; the Rust write commands take no MIME type.

The two hosts decide differently because they must. The desktop reads the format
off the name the save dialog returns (`export.tsx:exportFormat`), which is the
only way one Export… command offers both; a browser download has no dialog and no
name to read, so the *command* carries the format and
`export-target.ts:browserExportTarget` derives the rest. Both then hand the same
string to `export.tsx:diagramSvg`, so the raster stays the file rendered rather
than a second drawing.

Asymmetry preserved from before the seam: an SVG destination gains the extension
if it has none, a PNG is written exactly as chosen. The format is read **before**
the extension is applied, or `drawing.jpg` changes meaning.

## Which surfaces vary, and how they are gated

Gated on synchronous **`isTauri()`**, never on `App`'s `menuInstalled`: that only
turns true once `installMenu` resolves over IPC, so a surface keyed to it renders
the browser's shape for the first frames of a desktop launch.

- `Toolbar.tsx:fileCommands()` — the desktop's five buttons, or the browser's
  seven (Export splits, Import gains a button because there is no menu).
- `App.tsx`'s `Cmd/Ctrl+E` — the desktop's one dialog command, or SVG with PNG
  on Shift.

`FileActions` is the shared command surface and carries all of them; each host
shows a subset. `menuInstalled` remains only what decides whether `App` handles
the Cmd/Ctrl chords itself.

## The banner

One notice, replaced rather than queued, read through `useSyncExternalStore`.
`getNotice()` returns a **stable reference** between changes — React re-renders
forever if a snapshot is minted per call. `Banner` renders nothing when the store
is empty and is mounted unconditionally, so it needs no host gate; the desktop
host simply never posts to it. Its CSS lives in `src/styles.css` and never in
`styles/diagram.css`, which travels inside every exported picture.

`report` still writes its console line first and unconditionally: that is what
survives a broken notice surface.

## Where each piece lives

| Piece | File | Tested by |
|---|---|---|
| `Host`, `Unsubscribe`, `CloseGuard`, `selectHost`, `host` | `src/editor/host.ts` | the app; no unit test |
| `browserExportTarget`, `exportMime`, `ExportTarget` | `src/editor/export-target.ts` | `src/editor/export-target.test.ts` |
| `tauriHost` | `src/editor/host-tauri.ts` | `bun run tauri dev` |
| `browserHost`, `notYet` | `src/editor/host-browser.ts` | `bun run dev` in a browser |
| notice store | `src/editor/notices.ts` | `src/editor/notices.test.ts` |
| `Banner` | `src/components/Banner.tsx` | `bun run dev` |
| the eleven commands | `src/editor/files.ts` | `bun run dev` / `tauri dev` |
| `importNetworkYaml` (the wasm loader) | `src/editor/network-wasm.ts` | `src/editor/network-wasm.test.ts` |
| `isNetworkFile`, `NETWORK_EXTENSIONS` | `src/model/document.ts` | `src/model/document.test.ts` |
| the canvas drop | `src/components/Canvas.tsx` | `bun run dev` in a browser |
| `FileActions`, `fileCommands` | `src/components/Toolbar.tsx` | `bun run dev` |
