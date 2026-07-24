# Undo / Redo

How document history works. Frontend only — nothing here crosses IPC or reaches
disk. The design rationale lives in `specs/undo_redo_spec.md`; hand-maintained.

## Snapshots, not inverse commands

`EditorState` (`src/editor/state.ts`) carries three history fields:

| Field | Meaning |
|-------|---------|
| `past: Document[]` | Snapshots older than `doc`, oldest first; the **last** is one undo back |
| `future: Document[]` | Snapshots undone from, newest-undo first; the **first** is one redo forward |
| `coalesceKey: string \| null` | The gesture the top-of-`past` belongs to; `null` = no open gesture |

History stores whole past `Document` values. The reducer builds each next document
by spreading the previous one, so successive snapshots **share every untouched
node, link, and layout entry** — a snapshot costs about as much as the changed
sub-tree, and no edit action needs a hand-written inverse. `HISTORY_LIMIT = 100`
caps `past`; the oldest snapshot is dropped on overflow (`pushPast`).

## The one signal: document identity

`recordHistory(prev, next, key)` runs on the result of **every** editing action and
decides history and `dirty` in one pass:

- `next.doc !== prev.doc` → an undoable change. **Push** `prev.doc` onto `past`
  (or **replace** — see coalescing), clear `future`, set `dirty: true`.
- `next.doc === prev.doc` → record nothing, but **close any open gesture**
  (`coalesceKey: null`), so the next change starts a fresh entry.
- The identity-stable no-op is preserved: when the action returned `prev` *itself*
  and no gesture is open, `recordHistory` returns `prev`, so `useReducer` skips the
  re-render. Do not "simplify" this to an unconditional spread.

## Coalescing — a drag is one undo step

A node drag dispatches one `moveNode` per pointer-move (`onPointerMove`,
`src/components/Canvas.tsx`); pointer-up dispatches nothing. So `coalesceKeyFor`
gives `moveNode` the key `"moveNode:<id>"` and every other edit `null`:

- key non-null **and** equal to `state.coalesceKey` → the gesture is still open:
  update `doc`, leave `past` alone.
- otherwise → push a new entry.

**The run is broken by the leading `select`.** Every drag starts with
`onNodePointerDown` dispatching `select`, which leaves `doc` unchanged and
therefore resets `coalesceKey` — so move #1 pushes and moves #2…N replace, with no
Canvas involvement. A future high-frequency gesture *without* that leading dispatch
would silently merge with the previous one; that is the point to add an explicit
end-of-gesture action (spec OQ-2). Consequence worth knowing: a wheel-zoom mid-drag
dispatches `setView`, which also resets the key, so one drag becomes two undo steps.

Discrete clicks never coalesce. The Lanes and junction Size steppers are ±1 /
±0.25 per click, so N clicks are N undo steps — deliberate, since this design has
no time or focus boundary that could close such a gesture.

## What resets history, and what must not touch it

- `loadDocument` / `newDocument` install a whole document → `past: []`,
  `future: []`, `coalesceKey: null`. There is nothing to undo across a file
  boundary, and history is never written to `.zkai`.
- `markSaved` / `setRecents` leave **all three** fields alone, `coalesceKey`
  included. `setRecents` returns `state` by identity for an unchanged list (the
  menu rebuild keys off that identity, and `state.test.ts` asserts it), so it must
  not spread a new object just to clear a key.
- `undo` / `redo` (`restore`) are identity no-ops at the ends of the stacks. When
  they do move, they clear `linkFrom` (a half-drawn link may start at a node the
  undo removed), revalidate the selection — kept iff its id still exists in the new
  doc, else `null` — and set `dirty: true` unconditionally. That over-reports:
  undoing back to the last-saved document still reads as dirty (spec OQ-1).

## Triggers

All three dispatch the same `{ type: "undo" }` / `{ type: "redo" }`:

| Surface | Where |
|---------|-------|
| Keyboard | `src/App.tsx` keydown — Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Ctrl+Y. **Browser path only**: the handler returns early on every chord once `menuInstalled` |
| Toolbar | `.history` buttons left of the tool group (`src/components/Toolbar.tsx`), disabled via `past.length` / `future.length` |
| Native menu | Edit submenu (`src/editor/menu.ts`) — Zukai's items **replace** Tauri's predefined Undo/Redo, which drive webview text editing, not the document |

The menu items are always enabled and no-op at the ends; the toolbar carries the
disabled affordance, so no per-flip IPC. Ctrl+Y is browser-only by design: a
`MenuItem` carries exactly one accelerator.
