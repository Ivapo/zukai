# Persistence (save / open)

How a `.zkai` document gets to disk and back. Spans Rust and TypeScript; the
design rationale lives in `specs/save_load_spec.md`. Hand-maintained.

## The path, end to end

| Step | Where |
|------|-------|
| Trigger | Toolbar `.file-actions` buttons (`src/components/Toolbar.tsx`), the native File menu (`src/editor/menu.ts`), and Cmd/Ctrl+N/O/S, Shift for Save As (`src/App.tsx` keydown) |
| Dialog + IPC | `src/editor/files.ts` — with `menu.ts`, one of only two modules that touch the Tauri runtime |
| Commands | `save_document` / `load_document` (`src-tauri/src/persist.rs`), `recent_files` / `push_recent_file` (`src-tauri/src/recent.rs`), all registered in `src-tauri/src/lib.rs` |
| Apply | `loadDocument` / `newDocument` / `markSaved` / `setRecents` reducer cases (`src/editor/state.ts`) |
| Normalize | `normalizeDocument` (`src/model/document.ts`), applied only inside the `loadDocument` case |
| Close guard | `installCloseGuard` (`files.ts`), installed once by `App.tsx`; reuses the New/Open prompt |

The document crosses IPC as JSON; YAML is only the file body, written and parsed
in Rust (`std::fs` + `serde_yaml`) so the on-disk shape has one owner. No
`tauri-plugin-fs`.

## Rules that are easy to break

- **Normalize at exactly one boundary.** `load_document`'s JSON omits empty
  collections and layout sub-maps (`skip_serializing_if`, kept for terse YAML), so
  the glue passes the raw `invoke` result straight to the `loadDocument` action and
  the reducer normalizes it. Do not normalize in `files.ts` too, and never consume
  a raw payload elsewhere — the frontend assumes `doc.links`/`doc.layout.nodes`
  always exist.
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
  dialog does not.

## Menu and recents

- The menu is **built in JS** so its items call the same `FileActions` the toolbar
  does. It is rebuilt whenever `state.recents` changes identity — which is why the
  `setRecents` reducer case returns the *same* state for an unchanged list, and why
  rebuilds queue behind one another in `menu.ts`.
- `installMenu` resolving `true` means the native accelerators own the Cmd/Ctrl
  chords, and `App.tsx`'s keydown handler stops claiming them. Both handling them
  would fire a command twice on platforms where the key still reaches the webview.
- Zukai's commands are **prepended into Tauri's own File submenu** (found by title);
  the fallback branch that builds one is Linux's path, whose default menu has none.
- Recents live in `recent.json` in the app config dir, owned by
  `src-tauri/src/recent.rs`. `recent_files` prunes paths that no longer exist — the
  webview cannot check that itself. The list is best-effort: a broken store reads as
  empty and `rememberRecent` swallows its own errors, because a failed recents write
  must never turn a successful save into a failure.
