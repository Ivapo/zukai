# Persistence (save / open)

How a `.zkai` document gets to disk and back. Spans Rust and TypeScript; the
design rationale lives in `specs/save_load_spec.md`. Hand-maintained.

## The path, end to end

| Step | Where |
|------|-------|
| Trigger | Toolbar `.file-actions` buttons (`src/components/Toolbar.tsx`), the native File menu (`src/editor/menu.ts`), and Cmd/Ctrl+N/O/S, Shift for Save As (`src/App.tsx` keydown) — the same three surfaces undo/redo use (`rules/history.md`) |
| Dialog + IPC | `src/editor/files.ts` — with `menu.ts`, one of only two modules that touch the Tauri runtime |
| Commands | `save_document` / `load_document` (`src-tauri/src/persist.rs`), `recent_files` / `push_recent_file` (`src-tauri/src/recent.rs`), all registered in `src-tauri/src/lib.rs` |
| Apply | `loadDocument` / `importDocument` / `newDocument` / `markSaved` / `setRecents` reducer cases (`src/editor/state.ts`) |
| Normalize | `normalizeDocument` (`src/model/document.ts`), applied only in the reducer's document-install cases (`loadDocument`, `importDocument`) |
| Close guard | `installCloseGuard` (`files.ts`), installed once by `App.tsx`; reuses the New/Open prompt |

The document crosses IPC as JSON; YAML is only the file body, written and parsed
in Rust (`std::fs` + `serde_yaml`) so the on-disk shape has one owner. No
`tauri-plugin-fs`.

## Rules that are easy to break

- **Normalize in the reducer, never in the glue.** `load_document`'s JSON omits
  empty collections and layout sub-maps (`skip_serializing_if`, kept for terse
  YAML), so the glue passes the raw `invoke` result straight to the action and the
  reducer normalizes it. `import_network` returns the same `Document` shape and
  gets the same treatment. Do not normalize in `files.ts` too, and never consume a
  raw payload elsewhere — the frontend assumes `doc.links`/`doc.layout.nodes`
  always exist.
- **Three actions install a whole document, and they differ in exactly two
  fields.** `loadDocument`, `importDocument` and `newDocument` all go through
  `install()` (`state.ts`), which resets selection, link-in-progress, view and all
  three history fields; each arm supplies only its `currentPath` and `dirty`. A
  fourth whole-document action belongs there too, not in a fourth copy of the
  reset.
- **`dirty` is set by document identity**, not action type — for editing actions,
  inside `recordHistory` (`state.ts`), which decides the undo snapshot and the
  dirty flag in one pass. The carve-outs set it explicitly: the four persistence
  actions, plus `undo`/`redo`, which always dirty (undoing back to the saved
  document still reads as dirty — see `specs/undo_redo_spec.md` §2.5). A new
  editing action still needs no dirty bookkeeping.
- **Dialogs need the Tauri runtime.** Under plain `bun run dev` every command in
  `files.ts` fails; each is wrapped so the failure is reported (dialog `message()`,
  falling back to `console.error`) instead of leaving an unhandled rejection. The
  menu, close guard, and recents check `isTauri()` and quietly do nothing instead.
  Verify file behaviour with `bun run tauri dev`.
- **Permissions:** `"dialog:default"` and `"core:window:allow-destroy"` in
  `src-tauri/capabilities/default.json`. `dialog:default` grants `open`, `save`, and
  `message` — `ask()` rides on the `message` command, so it needs nothing extra. The
  window permission is what lets `onCloseRequested` actually close the window;
  `core:window:default` does *not* include it. Menu commands come with
  `core:default`. A missing permission fails at runtime, not at build time.
- Save with no `currentPath` falls through to the Save As picker;
  `ensureZkaiExtension` (`src/model/document.ts`) adds `.zkai` when the platform
  dialog does not — a thin wrapper over `ensureExtension(path, ext)`, which export
  shares.
- **Import is Open's twin, minus a path and minus a recent.** `importNetwork`
  (`files.ts`, `rules/network-yaml.md`) reuses the same close guard and the same
  raw-payload discipline, but dispatches `importDocument` — **dirty and
  pathless**, so Save asks for a `.zkai` instead of overwriting Assimilator's
  YAML — and calls no `rememberRecent`, because "Open Recent" opens through
  `load_document` and could never read the file back.
- **Export is a sibling of `write()`, not a caller.** `exportDiagram` (`files.ts`,
  `rules/diagram-export.md`) writes a picture, not a document: no `rememberRecent`
  — the recent list opens `.zkai` files — no `markSaved`, and no change to
  `dirty`/`currentPath`, which is why it takes no `dispatch`. It writes through
  its own command (`src-tauri/src/export.rs`), so nothing in the save path needs
  to know about it.

## Menu and recents

- The menu is **built in JS** so its items call the same `FileActions` the toolbar
  does. It is rebuilt whenever `state.recents` changes identity — which is why the
  `setRecents` reducer case returns the *same* state for an unchanged list, and why
  rebuilds queue behind one another in `menu.ts`.
- `installMenu` resolving `true` means the native accelerators own the Cmd/Ctrl
  chords, and `App.tsx`'s keydown handler stops claiming them. Both handling them
  would fire a command twice on platforms where the key still reaches the webview.
  That covers Cmd+Z / Shift+Cmd+Z too: `build()` **replaces** the Edit submenu's
  first two items — Tauri's *predefined* Undo/Redo, which drive webview text
  editing — with Zukai's own, so the chords undo the document (`rules/history.md`).
  Removing the pair takes two `removeAt(0)`; it is the only place the menu code
  removes anything, and it runs before `setAsAppMenu()` so a throw leaves nothing
  half-installed.
- **The menu carries one command the toolbar does not.** `FileActions`
  (`Toolbar.tsx`) is the shared surface; `FILE_COMMANDS`, the toolbar row, is a
  deliberate subset of it. Import network… sits below a separator, has no
  accelerator, and so needs no case in `App.tsx`'s keydown handler — under plain
  `bun run dev` there is no way to reach it, which is fine, since its dialog needs
  the Tauri runtime anyway.
- Zukai's commands are **prepended into Tauri's own File submenu** (found by title);
  the fallback branch that builds one is Linux's path, whose default menu has none.
  The Edit submenu has the same fallback, for the same reason and because a menu
  install without an undo accelerator would leave the app with none at all.
- Recents live in `recent.json` in the app config dir, owned by
  `src-tauri/src/recent.rs`. `recent_files` prunes paths that no longer exist — the
  webview cannot check that itself. The list is best-effort: a broken store reads as
  empty and `rememberRecent` swallows its own errors, because a failed recents write
  must never turn a successful save into a failure.
