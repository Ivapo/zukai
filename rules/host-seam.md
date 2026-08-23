---
title: host-seam
sources:
  - src/App.tsx
  - src/components/Banner.tsx
  - src/components/Canvas.tsx
  - src/components/Toolbar.tsx
  - src/editor/examples.ts
  - src/editor/export-target.ts
  - src/editor/files.ts
  - src/editor/host.ts
  - src/editor/host-browser.ts
  - src/editor/host-tauri.ts
  - src/editor/menu.ts
  - src/editor/wasm.ts
  - src/editor/notices.ts
  - src/model/document.ts
covers: >
  how the file commands reach the outside world on two hosts — the Host
  interface and its cancel/throw contract, which capabilities the browser has
  and which it answers differently, the three shapes of Open and the two of
  Import and where the codecs are called, the three readings of a null return,
  how a host is chosen and which surfaces vary by it, where an export's filename
  and MIME are decided, where the bundled examples come from, and the in-page
  error banner
max_lines: 225
generated: 2026-08-22
---

# The host seam

What the file commands need from the machine they run on. Zukai ships as a Tauri
app and as a page in a browser tab; this is the one place that difference is
written down. The *why* lives in `specs/web_demo_spec.md`.

## The layers

| Layer | Where | May name Tauri? |
|---|---|---|
| Commands | `src/editor/files.ts` — the thirteen exported commands | **no** |
| Interface | `src/editor/host.ts` — `Host`, `Unsubscribe`, `CloseGuard`, `OpenedDocument` | `isTauri()` only |
| Desktop | `src/editor/host-tauri.ts` — `invoke`, `ask`, `message`, `open`, `save`, `getCurrentWindow` | yes |
| Browser | `src/editor/host-browser.ts` — `Blob`, `<input type="file">`, `window.confirm`, `beforeunload` | **no** |
| Codecs | `src/editor/wasm.ts` — the crate, built for wasm32 | **no** |
| Export target | `src/editor/export-target.ts` — filename, format, MIME | **no** |
| Examples | `src/editor/examples.ts` — the `examples/*.zkai` glob, and a label | **no** |
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

`export-target.ts` and `examples.ts` are leaves for the same reason in miniature: `host.ts` imports
both implementations at runtime to choose between them, so a pure function
living there and called by `host-browser.ts` would close a real ESM cycle. Being
a leaf is also what lets both be tested with no DOM.

## What each host can do

| Capability | Desktop | Browser |
|---|---|---|
| `open` | open dialog → `load_document` | hidden `<input type="file">` → the wasm |
| `openDocumentText` | `load_document_text` | the wasm |
| `read` (Open Recent) | `load_document` | **throws** — unreachable, see `recents` |
| `save` | save dialog → `save_document` | the wasm → a download, returning `null` |
| `importNetwork` | open dialog → `import_network` | hidden `<input type="file">` → the wasm |
| `importNetworkText` | `import_network_text` | the wasm |
| `exportTarget` / `deliverExport` | save dialog → `write_text_file` / `write_binary_file` | pure decision → `Blob` download |
| `recents` / `rememberRecent` | `recent_files` / `push_recent_file` | `[]` — no Open Recent surface exists |
| `confirm` | the dialog plugin's `ask` | `window.confirm` |
| `notify` | native `message` dialog | the in-page banner |
| `closeGuard` | `onCloseRequested` + a real prompt | `beforeunload`, decided synchronously |

**There is no capability flag left.** `canOpenDocuments` gated `openDocument`
while the browser had no document codec; both hosts read both formats now, so it
retired with the throw it was guarding.

## `null` from `save` carries three readings, and they mean one thing

The seam's usual pair is *cancelled* (`null`) against *failed* (a throw). `save`
adds a third: **delivered, but there is nothing to adopt.** A browser download
has no address, so `browserHost.save` answers `null` rather than inventing a
path for a file the page cannot address — which is what makes its Save honestly
a **Save-a-copy**: the document stays dirty, `currentPath` stays unset, and a
second Cmd-S downloads again (`specs/web_demo_spec.md` OQ-3, resolved).

One sentinel still covers all three because the caller does the same thing with
each: `files.ts:adopt` does not run. Only `markSaved` would have been wrong, and
none of the three wants it.

## Open has three shapes and Import two, and the split keeps the seam intact

`open()` and `importNetwork()` are **pull**-shaped — they take no arguments and
each host sources its own file, which is what let the desktop paths stay
byte-identical when the browser gained its own. A dropped file is
**push**-shaped: it arrives already in hand. So each has a second entry point,
and that second one is where the line is drawn.

- `files.ts:openDocumentFile(state, dispatch, file)` and
  `files.ts:importNetworkFile(...)` read `file.text()` and nothing else. `File`
  is a web type both hosts have and `text()` names no codec, so the commands
  module stays free of both `invoke` and wasm.
- `Host.openDocumentText(text)` and `Host.importNetworkText(text)` are **the two
  seam methods that name a codec**, and **both hosts honour both** — the browser
  through `wasm.ts`, the desktop through `load_document_text` and
  `import_network_text`. A method one host refused would be a hole in the
  interface; a five-line Rust command is cheaper than the hole, and it is what
  makes wiring the Tauri webview's own file drop a later one-liner.

`files.ts:openExample(state, dispatch, stem)` is Open's **third** shape and needed
nothing new in the seam: the text comes out of `examples.ts` and goes to that same
`openDocumentText`. `stem` is a bare filename (`"roundabout"`), never a glob key,
and the document installs as `<stem>.zkai` through `install`, so it lands
**clean** — which is what an unedited example is.

`examples.ts` holds `examples/*.zkai` as a lazy `import.meta.glob`, so Vite emits
each document as its own chunk at build time: nothing reads
`import.meta.env.BASE_URL`, nothing calls `fetch`, there is no second copy to
drift from `examples/`, and no runtime 404 arm exists, the key set being fixed
when the build runs. The silent failure is the other one — a glob matching
*nothing* yields `{}` and an empty menu, so `examples.test.ts` holds the key set
against a `readdirSync` and requires both non-empty. Labels come off the stems
rather than each document's `metadata.name`, which would mean decoding every
example at page load: fetching the wasm the loader keeps behind a dynamic import,
for a visitor who may never open one. The menu can therefore disagree with a
document's own name, and does.

`OpenedDocument.path` is **host-opaque**, like `ExportTarget.destination`: an
absolute path on the desktop, a bare `File.name` in a browser, which is all a
page ever learns about where a file came from. It is what the toolbar shows and
what an export names itself after, and nothing else may read it as a location.

Neither host may call into `files.ts` to reach the banner: that edge closes the
ESM cycle above. The drop's own error path is `files.ts:reportUnsupportedDrop`.

The canvas drop is gated on `isTauri()` and is browser-only for now, because a
Tauri webview intercepts file drops itself and wants its own configuration. It
routes on `document.ts:isNetworkFile` and `isZkaiFile`, which the desktop's
dialog filters also read, so the two hosts cannot disagree about what either
kind is — and a network is *imported* (dirty and pathless) where a schematic is
*opened*, which is the whole of the difference between the arms.

Three things about the wasm that are easy to get wrong and fail *silently*.
Rust → JS must serialize through `Serializer::json_compatible()`, or a
`BTreeMap` crosses as an ES `Map` and `normalizeDocument` indexes it as an empty
object — a blank canvas that throws nothing. **JS → Rust goes the other way on
purpose**: `wasm.ts:encodeZkai` hands the crate `JSON.stringify(doc)` so
`serde_json` — the reader Tauri's IPC already uses on that same object — is the
only reader of that shape, where `serde_wasm_bindgen::from_value` would be a
second one that disagrees about a key present as `undefined`. And the module
loads on first use rather than at startup, so a visitor who only looks never
fetches the `.wasm`.

Both directions are pinned by committed goldens under
`src-tauri/tests/fixtures/golden/`, each read by a Rust test and a vitest. What
that pair catches is **marshalling** drift, not converter drift — the two sides
call the same Rust. It is not theoretical: the `.zkai` golden's first run caught
`-0.0` surviving in Rust and not in JSON, which had been silently wrong on the
desktop too.

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
- `Toolbar.tsx:ExampleSelect` — browser only, and **controlled at `""`, pinned to
  a disabled placeholder after a load *and* after a declined discard**: left
  showing its last pick, re-choosing that entry fires no `change` and the document
  is unreachable. Not a `FileCommand`, and its handler is a prop rather than a
  `FileActions` member — that interface is a button surface `menu.ts` shares, and
  a member taking an argument does not assign against `keyof FileActions`.

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
| `browserHost`, `pickFile`, `download` | `src/editor/host-browser.ts` | `bun run dev` in a browser |
| notice store | `src/editor/notices.ts` | `src/editor/notices.test.ts` |
| `Banner` | `src/components/Banner.tsx` | `bun run dev` |
| the thirteen commands | `src/editor/files.ts` | `bun run dev` / `tauri dev` |
| `EXAMPLES`, `exampleLabel` | `src/editor/examples.ts` | `src/editor/examples.test.ts` |
| `importNetworkYaml`, `decodeZkai`, `encodeZkai` | `src/editor/wasm.ts` | `src/editor/wasm.test.ts` |
| `isNetworkFile`, `isZkaiFile`, the extension consts | `src/model/document.ts` | `src/model/document.test.ts` |
| the canvas drop | `src/components/Canvas.tsx` | `bun run dev` in a browser |
| `FileActions`, `fileCommands`, `ExampleSelect` | `src/components/Toolbar.tsx` | `bun run dev` |
