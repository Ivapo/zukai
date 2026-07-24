---
status: reviewed — ready to implement (2 review rounds, 2026-07-24)
last_updated: 2026-07-24
note: Save/open Zukai documents as .zkai YAML files, with dirty tracking and an unsaved-changes guard.
implemented: ["Phase 1", "Phase 2"]
not_implemented: ["Phase 3", "Phase 4 (deferred)"]
related: []
reference: "Tauri 2 plugin-dialog (https://v2.tauri.app/plugin/dialog/) for native file pickers. network.yaml import/export is a SEPARATE future spec — this spec is Zukai's own format only."
---

# Save / Load Spec

## 1. Goal

Persist a Zukai schematic to disk and reopen it, losslessly, in Zukai's **own**
YAML format — not Assimilator's `network.yaml` (that interop is a separate spec).
This is the first feature to cross the Rust↔frontend IPC boundary; today the app
holds the document only in memory (`initialState()` at `src/editor/state.ts:42`)
and the only Tauri command is the template `greet` (`src-tauri/src/lib.rs:5`).

End state — the user draws a network, saves it, and reopens it later:

```
New (Cmd/Ctrl+N) · Open… (Cmd/Ctrl+O) · Save (Cmd/Ctrl+S) · Save As… (Cmd/Ctrl+Shift+S)
```

On-disk `intersection.zkai` (Zukai's full document — graph + layout + decorations):

```yaml
schema_version: 1
metadata:
  name: Five-arm roundabout
nodes:
  - id: N1
    type: junction
# … links, junctions, layout, markings, signs …
```

Tauri command surface (Rust authoritative for the on-disk shape):

```rust
#[tauri::command] fn save_document(path: String, doc: Document) -> Result<(), String>;
#[tauri::command] fn load_document(path: String) -> Result<Document, String>;
```

Frontend flow: a native file dialog picks the path, then the path + document are
handed to the Rust command; the document crosses IPC as JSON and YAML is only ever
the on-disk encoding.

## 2. Design

### 2.1 Where serialization happens

The Rust `Document` (`src-tauri/src/model/mod.rs`) already derives serde and
round-trips through `serde_yaml` (see the `yaml_round_trips` test). The frontend's
`Document` (`src/model/types.ts`) is a hand-kept mirror whose string-literal unions
match serde's output exactly (see `rules/document-model.md`).

### Why route through the Rust Document (decision, recorded)

Serialization lives on the **Rust side**, not in a JS YAML library:

- **Single source of truth for the on-disk shape.** `serde_yaml` + the model's
  serde attributes already define the format; a second JS encoder would drift.
- **Validation on load.** Deserializing into the typed `Document` rejects malformed
  or wrong-version files at the boundary, with a real error, before they reach the
  reducer.
- The document crosses IPC as **JSON** (Tauri's `invoke` marshals JS↔serde via
  `serde_json`); because the TS mirror matches the Rust field names (`type`,
  `snake_case`, `u-turn`), `serde_json` deserializes the incoming JS object straight
  into `Document`. YAML is used *only* for the file body (`std::fs` read/write inside
  the command).

### Why load must normalize the returned document (decision, recorded)

The **save** direction (JS→Rust) is sound: every TS-optional field has a
`#[serde(default)]` twin, and the frontend always supplies the no-default fields
(`emptyDocument`, `addNode`, `completeLink`, `setNodeKind`). The **return**
direction is *not* automatic. `Document`'s collections carry `#[serde(default,
skip_serializing_if = "Vec::is_empty")]` and `Layout`'s maps
`skip_serializing_if = "BTreeMap::is_empty"` (`graph.rs` / `layout.rs`), kept
deliberately so on-disk YAML stays terse. Tauri serializes a command's `Ok` value
with serde, which honours these — so `load_document` returns JSON with empty
collections **absent**. But the frontend treats them as always present
(`doc.links.map` / `doc.nodes.map` in `Canvas.tsx`, `nodePos` → `doc.layout.nodes[id]`
in `document.ts`), so an ordinary file (empty, or nodes-only) would crash load with
a `TypeError`.

Fix: a **`normalizeDocument(raw): Document`** helper (`src/model/document.ts`) fills
any missing collection with `[]` / `{}` and any missing `layout` sub-map. It is
applied at **exactly one boundary — the `loadDocument` reducer case** (§2.3) — so
there is a single place responsible: the IPC glue passes the raw `invoke` result
straight to `loadDocument`, which normalizes it. This also hardens against partial
or hand-edited files. Keep `skip_serializing_if` (we want terse YAML) and normalize
on the JS side rather than change the Rust struct. This is the load-crash guard
verified by the Phase 2/3 gates.

### Why the full document, not just the graph (decision, recorded)

Save writes the **entire `Document`** — semantic graph *and* `layout` *and*
`markings`/`signs`. This is Zukai's native format, where presentation is
first-class. That is the opposite of the future `network.yaml` *export*, which
deliberately drops `layout` (see `rules/document-model.md`); do not conflate them.

### 2.2 File format and extension

- Content is Zukai YAML, versioned by `SCHEMA_VERSION` (`src-tauri/src/model/mod.rs`),
  which is distinct from Assimilator's `network.yaml` `schema_version`.
- Extension: **`.zkai`** (YAML body). A distinct extension makes documents
  identifiable and enables file association / dialog filtering later. (See OQ-1.)
- **Version check on load:** accept `schema_version == SCHEMA_VERSION`; reject a
  newer file with a clear "made by a newer Zukai" error; no older versions exist
  yet, so no migration path is needed now (revisit when `SCHEMA_VERSION` bumps). To
  produce that message rather than a raw serde error, load **probes the version
  first** — parse the YAML to a `serde_yaml::Value` (or a minimal
  `{ schema_version }` struct), check it, *then* deserialize the full `Document`.

### 2.3 Editor state for persistence

`EditorState` (`src/editor/state.ts:29`) gains two fields:

- `dirty: boolean` — unsaved changes exist. For **editing** actions the reducer
  sets it by **document identity**, not by action type: `dirty = next.doc !==
  prev.doc ? true : prev.dirty`. The reducer already does immutable updates, so
  `doc` changes reference iff it actually changed — this avoids false-dirtying on
  no-op actions (`setTool`, `setView`, `select`, `startLink`, or a
  `moveNode`/`completeLink` that returns `state` unchanged). The three persistence
  actions below are **exempt** and set `dirty` explicitly: `loadDocument` /
  `newDocument` install a new `doc` (so the identity rule would wrongly mark them
  dirty) and set it `false`; `markSaved` leaves `doc` unchanged (so the rule would
  leave it `true`) and sets it `false`. Apply the identity rule to editing actions
  only.
- `currentPath: string | null` — the file backing the document (`null` = never
  saved). Drives Save-vs-Save-As and the window title.

New actions on the `Action` union (`src/editor/state.ts:53`):

- `loadDocument { doc: Document; path: string }` — **normalize** the payload (§2.1;
  it is the raw `invoke` result, possibly missing empty collections), replace the
  document, set `currentPath`, clear `dirty`, reset selection/linkFrom, reset the
  view.
- `newDocument` — replace with `emptyDocument("Untitled")`, clear path + dirty.
- `markSaved { path: string }` — clear `dirty`, set `currentPath` (post-save).

The title/dirty indicator uses `document.title` plus the toolbar wordmark. (Native
`setTitle` needs a window permission and only works under `tauri dev`; it's deferred
with the desktop menu in Phase 4.)

### Why split the dialog from the apply logic (decision, recorded)

The native file dialog (`tauri-plugin-dialog`) only works in the Tauri runtime, not
the Vite/browser dev server we normally verify in. So keep the **apply** logic
(`loadDocument`/`newDocument` reducer cases, `normalizeDocument`, dirty tracking)
separate from the **dialog + IPC** glue. The apply logic is then pure and
unit-testable (see Phase 2's `vitest` gate); only the actual file-picker path needs
`tauri dev`.

### 2.4 Operations and triggers

- **New**, **Open…**, **Save**, **Save As…** — as in-app toolbar buttons plus
  keyboard shortcuts (Cmd/Ctrl+N/O/S, Cmd/Ctrl+Shift+S), wired in `App.tsx`
  alongside the existing keydown handler. Toolbar buttons are the reliable trigger
  everywhere; some OS/browser shortcuts (notably Cmd/Ctrl+N) may be intercepted by
  the browser and are only guaranteed under `tauri dev`. Native OS menus are
  desktop-only and deferred (Phase 4).
- **Save** with `currentPath == null` behaves as **Save As…** (opens the picker).
- **Unsaved-changes guard:** New and Open, when `dirty`, first confirm "Discard
  unsaved changes?" via `tauri-plugin-dialog`'s `ask()` (reliable in the webview;
  `window.confirm` is not — see OQ-3). The window-close guard (Tauri
  `close-requested`) is desktop-only and deferred (Phase 4).

### 2.5 Plugins and permissions

- Add `tauri-plugin-dialog` (Rust, `src-tauri/Cargo.toml`) and
  `@tauri-apps/plugin-dialog` (JS, `package.json`); register it in the builder
  (`src-tauri/src/lib.rs:11`) and add **`"dialog:default"`** to the `permissions`
  array in `src-tauri/capabilities/default.json` (currently only `core:default`,
  `opener:default`).
- File **I/O is done in Rust** (`std::fs`) inside the commands, so `tauri-plugin-fs`
  and its permission surface are **not** required.

## 3. Open questions

- **OQ-1** — Extension `.zkai` vs `.zukai.yaml` vs plain `.yaml`. (design-call;
  proposed: `.zkai`.)
- **OQ-2** — On load, reset the view to identity, or fit-to-content? Fit needs a
  content-bounds pass. (design-call; proposed: identity for Phase 2, fit deferred.)
- **OQ-3** — ~~Confirm-dialog mechanism: `window.confirm` vs `tauri-plugin-dialog`
  `ask()`.~~ **RESOLVED (review r1):** use the dialog plugin's `ask()`.
  `window.confirm` in the Tauri webview is unreliable/unavailable on some platforms
  (the reason the plugin exists); we add the plugin in Phase 3 regardless. Applied
  in §2.4.
- **OQ-4** — ~~Stabilize key order / pretty-print for clean diffs?~~ **RESOLVED
  (review r1):** no action. `serde_yaml` emits fields in declaration order and
  `Layout`'s `BTreeMap`s sort keys, so output is already deterministic (see
  `rules/document-model.md`).

## 4. Implementation phases

Strictly sequential; each is one plan-mode pass with a concrete exit gate.

### Phase 1 — Rust persistence commands
- **Scope:** `save_document(path, doc)` / `load_document(path)` in
  `src-tauri/src/lib.rs` (or a new `src-tauri/src/persist.rs`): `std::fs` +
  `serde_yaml`, mapping errors to `String`. Load **probes `schema_version` first**
  (§2.2) so a newer file yields the friendly error, then deserializes `Document`.
  Register both in `generate_handler!` (`src-tauri/src/lib.rs:13`).
- **Exit gate:** `cargo test` green including (a) a round-trip-through-a-temp-file
  test (write a `Document`, read it back, assert equal) and (b) a version-rejection
  test (a `schema_version: 2` file returns the friendly error, not a raw serde
  message); `bun run build` unaffected.
- **Docs touched:** `rules/document-model.md` serialization note if the on-disk
  contract changes.

### Phase 2 — Editor persistence state  (depends on Phase 1)
- **Scope:** add `dirty` + `currentPath` to `EditorState` (`src/editor/state.ts:29`),
  set `dirty` by document-identity comparison in the reducer (§2.3); add
  `loadDocument` / `newDocument` / `markSaved` cases; add `normalizeDocument`
  (`src/model/document.ts`, §2.1); show the filename + a dirty dot via
  `document.title` and the toolbar wordmark. No file I/O yet.
- **Tooling:** add `vitest` (dev-only). The reducer and `normalizeDocument` are pure
  and exported, so they unit-test without a browser. (First frontend test runner;
  small, justified by this gate.)
- **Exit gate:** `bun run build` green + `vitest` green, with tests that: (a)
  `normalizeDocument` fills missing `nodes`/`links`/`junctions`/`markings`/`signs`
  and a wholly-absent `layout` and its sub-maps — feed it `{ schema_version: 1,
  metadata: { name } }` (the load-crash case from §2.1); (b) `loadDocument` fed a
  sparse payload yields a normalized doc, clears `dirty`, and sets `currentPath`,
  and `markSaved` clears `dirty`; (c) an editing action sets `dirty`, and a no-op
  action (`setTool`) does not.

### Phase 3 — File dialogs + IPC glue  (depends on Phase 2)
- **Scope:** add `tauri-plugin-dialog` (Rust `Cargo.toml` + JS `package.json`),
  register it in the builder, add `"dialog:default"` to `capabilities/default.json`;
  New/Open/Save/Save As in the toolbar + keyboard shortcuts in `App.tsx`; open the
  picker, `invoke` the Phase 1 commands, dispatch `markSaved`/`loadDocument` (the
  `loadDocument` reducer case normalizes — §2.1/§2.3 — so the glue passes the raw
  `invoke` result straight through); unsaved-changes guard on New/Open via the
  dialog plugin's `ask()`.
- **Exit gate:** `tauri dev` manual run — (a) draw a network, Save As `foo.zkai`,
  New, Open `foo.zkai`, verify it matches; (b) the **empty-document case**: New →
  Save As `empty.zkai` → Open it, confirm no load crash (guards §2.1); (c) the guard
  fires when dirty. `bun run build` green.
- **Docs touched:** update the project-memory roadmap (save/load shipped).

### Phase 4 — Desktop polish (deferred)
- Window `close-requested` unsaved guard, native OS menu, recent-files list.
- **Unblocks:** none needed for core save/load; do when the desktop app is the
  primary target.

## 5. Review log

- **Round 1 (2026-07-24, clean-context agent, repo read access).** Verdict: NOT
  READY — 1 blocking, 7 non-blocking; every `file:symbol` citation verified accurate.
  - **Blocking (fixed):** the load return-path dropped empty collections via
    `skip_serializing_if`, returning JSON with `nodes`/`links`/`layout` maps absent,
    which would crash the frontend (`doc.links.map`). Resolved by `normalizeDocument`
    (§2.1) + empty-document coverage in the Phase 2/3 gates.
  - **Non-blocking (folded in):** dirty gated on document identity, not action type
    (§2.3); two-step version probe for the friendly error (§2.2, Phase 1);
    `dialog:default` permission named + `ask()` guard (§2.4/2.5); Phase 2 test seam
    specified as `vitest` over the pure reducer/normalize; `document.title` for the
    Phase 2 title; softened the browser-shortcut claim (§2.4). Resolved OQ-3, OQ-4.
  - **Rejected:** "last_updated future-dated" — 2026-07-24 is today.
- **Round 2 (2026-07-24, same agent, resumed).** Verdict: **READY**. Confirmed the
  round-1 blocker is resolved (traced `normalizeDocument` against every crashing
  consumer) and accepted the #8 rejection. Two new non-blocking refinements, both
  folded in: (a) a carve-out so the three persistence actions set `dirty` explicitly
  rather than being governed by the identity rule, plus a `markSaved`-clears-dirty
  gate assertion (§2.3, Phase 2); (b) normalization pinned to a single boundary —
  the `loadDocument` reducer case (§2.1/§2.3/Phase 3). No new blocking issues.
- **Outcome:** converged in 2 rounds; ready for implementation.
