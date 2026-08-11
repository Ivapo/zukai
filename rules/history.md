---
title: history
sources:
  - src/App.tsx
  - src/components/Canvas.tsx
  - src/components/Toolbar.tsx
  - src/editor/menu.ts
  - src/editor/state.ts
covers: >
  the undo/redo snapshot stack in the reducer: the document-identity signal,
  drag coalescing, the trap where an action deleting nothing must return the
  same doc, what resets history, and the three trigger surfaces
max_lines: 160
generated: 2026-08-10
---

# Undo / Redo

How document history works. Frontend only — nothing here crosses IPC or reaches
disk. The design rationale lives in `specs/undo_redo_spec.md`.

## Snapshots, not inverse commands

`EditorState` (`src/editor/state.ts`) carries three history fields:

| Field | Meaning |
|-------|---------|
| `past: Document[]` | Snapshots older than `doc`, oldest first; the **last** is one undo back |
| `future: Document[]` | Snapshots undone from, newest-undo first; the **first** is one redo forward |
| `coalesceKey: string \| null` | The gesture the top-of-`past` belongs to; `null` = no open gesture |

History stores whole past `Document` values. The reducer builds each next document
by spreading the previous one, so successive snapshots **share every untouched
node, link and layout entry** — a snapshot costs about as much as the changed
sub-tree, and no edit needs a hand-written inverse. `HISTORY_LIMIT = 100` caps
`past` (`pushPast`).

## The one signal: document identity

`recordHistory(prev, next, key)` runs on the result of **every** editing action —
it is the reducer's `default:` arm, so `setTool` and `setView` pass through it too
— and decides history and `dirty` in one pass:

- `next.doc !== prev.doc` → an undoable change. **Push** `prev.doc` onto `past`
  (or **replace** — see coalescing), clear `future`, set `dirty: true`.
- `next.doc === prev.doc` → record nothing, but **close any open gesture**
  (`coalesceKey: null`), so the next change starts a fresh entry.
- The identity-stable no-op is preserved: when the action returned `prev` *itself*
  and no gesture is open, `recordHistory` returns `prev`, so `useReducer` skips the
  re-render. Do not "simplify" this to an unconditional spread.

## Coalescing — a drag is one undo step

A node drag dispatches one `moveNode` per pointer-move (`onPointerMove`,
`src/components/Canvas.tsx`); pointer-up only clears the drag ref and dispatches
nothing. So `coalesceKeyFor` gives `moveNode` the key `"moveNode:<id>"`,
`moveSign` `"moveSign:<id>"`, `moveMarking` `"markingDrag:<id>"` and the bend
gesture `"bendDrag:<link>:<index>"` — **four drags**, the fourth since link bends
Phase 2 gave a road a vertex to move — and every other edit `null`:

- key non-null **and** equal to `state.coalesceKey` → the gesture is still open:
  update `doc`, leave `past` alone.
- otherwise → push a new entry.

**The run is broken by the leading `select`.** Every `…PointerDown` handler
dispatches `select` first, which leaves `doc` unchanged and therefore resets
`coalesceKey` — so move #1 pushes and moves #2…N replace, with no Canvas
involvement. A future high-frequency gesture *without* that leading dispatch would
silently merge with the previous one; that is the point to add an explicit
end-of-gesture action (spec OQ-2). A wheel-zoom mid-drag dispatches `setView`,
which also resets the key, so one drag becomes two undo steps.

**The bend drag is the one key covering two actions**, and the one opened by
something other than a `select`. A press on a road *creates* the thing it then
drags, so `addBend` answers the same key as `moveBend`; keyed on `moveBend` alone
the insert would carry `null`, push a snapshot of its own, and one undo would land
on a bend-inserted-but-unmoved document. The insert opens the run instead.

**The marking drag is the one whose reducer has to refuse a no-op.**
`moveNode`/`moveSign`/`moveBend` rebuild `doc` unconditionally, which is harmless
because a pixel of pointer travel is a new position. `moveMarking` re-projects onto
a road, where many neighbouring pixels resolve to the same `(position, lane)` — so
it returns `state` by identity when nothing changed, and `state.test.ts` pins it.

Discrete clicks never coalesce. The Lanes and junction Size steppers are ±1 /
±0.25 per click, so N clicks are N undo steps — deliberate, since this design has
no time or focus boundary that could close such a gesture. Every other marking,
sign and junction action is discrete on the same terms, which is the honest
reading of N deliberate clicks.

**Typing is the second gesture, and the only one that is not a drag.** The
Inspector's five text fields — a marking's **Words**, a sign's **Label**,
**Symbol** and **Destination**, and a link's **Length** — dispatch a whole
`setMarkingKind`/`setSignKind`/`setLinkLength` per keystroke so the drawing
follows the typing, so `coalesceKeyFor` gives them `"markingText:<id>"`,
`"signLabel:<id>"`, `"signSymbol:<id>"`, `"signText:<id>"` and
`"linkLength:<id>"` — without which a five-letter word would burn five of the
hundred snapshots.

**A key per field, not per kind.** The sign fields belong to different kinds and
cannot be typed into in the same breath — switching between them *is* a pick,
which closes the run — so one shared key would only make the runs
indistinguishable for nothing. `state.test.ts` asserts it: type a label, pick
Direction, type a destination, and two undos land on the label still whole.

**Only for non-empty content, and that boundary is the interesting half.** Each
picker mints its fresh payload empty (`content: ""`, `{ label: "" }`, Length's
"states nothing"), and if that shared the run's key the first keystroke would
*replace* it — so one undo after picking Text and typing a word would jump back
past the repaint to whatever the marking was before. Excluded, the pick is its own
step and the word another. The cost, recorded rather than discovered: clearing a
field back to empty also closes the run, the honest reading of deleting a word.
Verified in the app both ways — `BUS`, undo, an empty text marking, undo again,
the `stop_line` back; `TOLL`, undo, the sign still standing with an empty plate.

## The trap on the other side: an action that deletes nothing must return the doc

`recordHistory` decides everything from document **identity**, so an action that
rebuilds `doc` while changing nothing in it pushes a snapshot and dirties the
file for no visible change. `deleteSelection` had exactly that bug the moment
`Selection` grew a third arm: a marking selection fell into the **node** branch,
which filters no marking out and still spreads a fresh `doc`.

So every arm that may remove nothing preserves identity deliberately — the marking
arm returns `doc` itself when the id is not there, `keepMarkings` returns the
*same array* when its filter drops nothing, and the **bend** arm returns `state`
for an index already gone. `state.test.ts` asserts all three (`rules/road-markings.md`).

The **sign** arm has two places to delete from (`doc.signs` and
`doc.layout.signs`), so it checks before touching either; and `clearSignLinks` is
a `map` where `keepMarkings` is a `filter`, so it cannot recover identity from a
length comparison and pre-checks instead (`rules/signs.md`). The **link** arm needs
no such helper for junctions: a `Junction` names no link, so `doc.junctions` is
untouched by construction — as `doc.links` is by the bend arm, which reaches only
the layout.

## What resets history, and what must not touch it

- **All three file boundaries** — `loadDocument`, `newDocument` and
  `importDocument` — go through one `install()` helper, which clears `past`,
  `future` and `coalesceKey` along with `selection`, `linkFrom` and the view.
  There is nothing to undo across a file boundary, and history is never written to
  `.zkai`. Only `currentPath` and `dirty` differ: an import arrives **dirty and
  pathless**, because a `network.yaml` is not a `.zkai`.
- `markSaved` / `setRecents` leave **all three** fields alone, `coalesceKey`
  included. `setRecents` returns `state` by identity for an unchanged list (the
  menu rebuild keys off that identity, and `state.test.ts` asserts it), so it must
  not spread a new object just to clear a key.
- `undo` / `redo` (`restore`) are identity no-ops at the ends of the stacks. When
  they do move, they clear `linkFrom` (a half-drawn link may start at a node the
  undo removed), revalidate the selection through `selectionValid` — kept iff its
  id still exists in the new doc, else `null` — and set `dirty: true`
  unconditionally. That over-reports: undoing back to the last-saved document
  still reads as dirty (spec OQ-1). `selectionValid` is a `never`-checked
  `switch`, and that is a scar: every id is a bare `type X = string`, so a new
  `Selection` arm falls silently through a binary test and stops surviving undo.
- **A `bend` selection is dropped outright, ahead of that check**, and it is the
  only arm that is. The id-bearing arms survive a stale id correctly, because
  `selectionValid` finds nothing and clears; a bend is named `{ link, index }`, so
  a stale index can still be **in range** and then names a *different* vertex —
  the one outcome no id can produce. Pinned in `state.test.ts`.

## Triggers

All three dispatch the same `{ type: "undo" }` / `{ type: "redo" }`:

| Surface | Where |
|---------|-------|
| Keyboard | `src/App.tsx` keydown — Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Ctrl+Y. **Browser path only**: the handler returns early on every chord once `menuInstalled` |
| Toolbar | `.history` buttons left of the tool group (`src/components/Toolbar.tsx`), disabled via `past.length` / `future.length` |
| Native menu | Edit submenu (`src/editor/menu.ts`) — Zukai's items **replace** Tauri's predefined Undo/Redo, which drive webview text editing, not the document |

The menu items are always enabled and no-op at the ends; the toolbar carries the
disabled affordance, so no per-flip IPC. Ctrl+Y is browser-only by design — a
`MenuItem` carries exactly one accelerator.
