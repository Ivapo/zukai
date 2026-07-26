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
gives `moveNode` the key `"moveNode:<id>"` — and `moveSign` the key
`"moveSign:<id>"`, the second drag and the only other one, since a marking has no
position of its own to drag (`rules/signs.md`) — and every other edit `null`:

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
no time or focus boundary that could close such a gesture. The marking actions are
discrete on the same terms: placing three stop lines across a carriageway is three
undo steps, and repainting one as a crossing and then widening it to the whole
carriageway is two more, which is the honest reading of five deliberate clicks.

**Typing is the second gesture, and the only one that is not a drag.** The
Inspector's three text fields — a marking's **Words**, a sign's **Label**, and a
warning sign's **Symbol** — dispatch a whole `setMarkingKind`/`setSignKind` per
keystroke so the paint follows the typing, so `coalesceKeyFor` gives them
`"markingText:<id>"`, `"signLabel:<id>"` and `"signSymbol:<id>"` — without which a
five-letter word would burn five of the hundred snapshots.

**A key per field, not per sign.** The two sign fields belong to different kinds
and cannot be typed into in the same breath — switching between them *is* a pick,
which closes the run — so one shared key would only make two runs
indistinguishable in the stack for nothing.

**Only for non-empty content, and that boundary is the interesting half.** The
Kind picker mints a fresh text marking as `content: ""`; if that shared the run's
key, the first keystroke would *replace* it and one undo after picking Text and
typing a word would jump back past the repaint to whatever the marking was before.
Excluded, the pick is its own step and the word is another. The cost, recorded
rather than discovered: clearing a field back to empty also closes the run, which
is a fair reading of deleting a word. Verified in the app — `BUS` then undo gives
an empty text marking, undo again gives back the `stop_line`.

A sign's empty label arrives from `addSign` instead, a different action that gets
`null` anyway — so for one phase the carve-out was doing nothing there. **Signs
Phase 3's Kind picker is what made it load-bearing**: picking Warning or Custom
mints `{ symbol: "" }`/`{ label: "" }` through `setSignKind` itself, so without the
carve-out the first keystroke would swallow a kind change the user can see. Both
verified in the app — `TOLL`, undo, and the sign is still standing with an empty
plate; undo again and it is gone. `state.test.ts` pins the picker case directly.

## The trap on the other side: an action that deletes nothing must return the doc

`recordHistory` decides everything from document **identity**, so an action that
rebuilds `doc` while changing nothing in it pushes a snapshot and dirties the
file for no visible change. `deleteSelection` had exactly that bug the moment
`Selection` grew a third arm: a marking selection fell into the **node** branch,
which filters no marking out and still spreads a fresh `doc`.

So every arm that may remove nothing has to preserve identity deliberately — the
marking arm returns `doc` itself when the id is not there, and `keepMarkings`
returns the *same array* when its filter drops nothing, so history snapshots keep
sharing it. `state.test.ts` asserts both. See `rules/road-markings.md`, "What
removes a marking".

The **sign** arm has two places to delete from (`doc.signs` and
`doc.layout.signs`), so it checks before touching either; and `clearSignLinks` is
a `map` where `keepMarkings` is a `filter`, so it cannot recover identity from a
length comparison and pre-checks instead — otherwise every link deletion in a
document with signs would hand history a fresh array to stop sharing
(`rules/signs.md`).

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
