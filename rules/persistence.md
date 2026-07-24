# Persistence (save / open)

How a `.zkai` document gets to disk and back. Spans Rust and TypeScript; the
design rationale lives in `specs/save_load_spec.md`. Hand-maintained.

## The path, end to end

| Step | Where |
|------|-------|
| Trigger | Toolbar `.file-actions` buttons (`src/components/Toolbar.tsx`) and Cmd/Ctrl+N/O/S, Shift for Save As (`src/App.tsx` keydown) |
| Dialog + IPC | `src/editor/files.ts` — the **only** module that touches the Tauri runtime |
| Commands | `save_document` / `load_document` (`src-tauri/src/persist.rs`), registered in `src-tauri/src/lib.rs` |
| Apply | `loadDocument` / `newDocument` / `markSaved` reducer cases (`src/editor/state.ts`) |
| Normalize | `normalizeDocument` (`src/model/document.ts`), applied only inside the `loadDocument` case |

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
- **`dirty` is set by document identity**, not action type (`reducer` in
  `state.ts`); the three persistence actions are the carve-out and set it
  explicitly. A new editing action needs no dirty bookkeeping.
- **Dialogs need the Tauri runtime.** Under plain `bun run dev` every command in
  `files.ts` fails; each is wrapped so the failure is reported (dialog `message()`,
  falling back to `console.error`) instead of leaving an unhandled rejection. Verify
  file behaviour with `bun run tauri dev`.
- **Permissions:** the dialog plugin needs `"dialog:default"` in
  `src-tauri/capabilities/default.json` (it grants `open`, `save`, `message`, and
  `ask`). A missing permission fails at runtime, not at build time.
- Save with no `currentPath` falls through to the Save As picker;
  `ensureZkaiExtension` (`src/model/document.ts`) adds `.zkai` when the platform
  dialog does not.

## Not implemented yet

Window `close-requested` guard, native OS menu, recent files — Phase 4 of
`specs/save_load_spec.md`, deferred.
