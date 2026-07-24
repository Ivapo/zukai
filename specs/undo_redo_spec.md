---
status: partial (Phase 1 landed; reviewed in 2 rounds, 2026-07-24)
last_updated: 2026-07-24
note: Linear undo/redo for document edits — snapshot history in the reducer, with drag coalescing, wired to keyboard, toolbar, and the native Edit menu.
implemented: ["Phase 1"]
not_implemented: ["Phase 2"]
related: [specs/save_load_spec.md]
reference: null   # Not an Assimilator-coupled feature; Zukai-internal only.
---

# Undo / Redo Spec

## 1. Goal

Let the editor take back and reapply document edits — the single most-missed
affordance in a direct-manipulation editor, and the substrate that makes every
heavier editing feature (decorations, junction semantics) safe to use. The
reducer is already the perfect base for it: it does immutable, structurally-shared
updates and already isolates "did the document actually change?" to one identity
check (`next.doc !== state.doc`, in `reducer`, `src/editor/state.ts`) — the exact
signal a history stack needs.

End state — the user draws, regrets, and recovers:

```
Draw two nodes, link them, drag one across the canvas, click Lanes + once (1 → 2).
  Cmd/Ctrl+Z  → lanes back to 1
  Cmd/Ctrl+Z  → node back where the drag started   (the whole drag = one step)
  Cmd/Ctrl+Z  → link removed
  Cmd/Ctrl+Shift+Z → link back
Undo/Redo also on the toolbar (disabled at the ends) and the native Edit menu.
```

Each stepper *click* is its own undo step — the Lanes control is ±1 per click
(`Inspector.tsx`), so going 1 → 3 takes two undos, by design (§2.3a).

Scope is **document edits only** — nodes, links, junctions, layout positions,
lanes, styles, and (later) markings/signs. Panning, zooming, tool switches, and
selection are **not** undoable (they aren't document content); see §2.6 non-goals.

## 2. Design

### 2.1 What is undoable, and the one signal that decides it

The reducer (`reducer`, `src/editor/state.ts`) already splits into **editing
actions** — routed through `editReducer` and marked dirty by document identity
(`next.doc !== state.doc`) — and **persistence actions** (`loadDocument` /
`newDocument` / `markSaved` / `setRecents`) handled explicitly.

History reuses that split exactly:

- An editing action whose `next.doc !== state.doc` is an **undoable change**:
  push a snapshot.
- An editing action that returns `doc` unchanged (`setTool`, a `moveNode` on a
  node with no layout entry, a `select`) touches no history — but *does* break a
  drag's coalescing run (§2.3).
- `loadDocument` / `newDocument` install a fresh document, so they **reset**
  history (nothing to undo across a file boundary): `past: []`, `future: []`,
  `coalesceKey: null`.
- `markSaved` / `setRecents` leave the document **and all three history fields**
  untouched — including `coalesceKey`. They are not part of the "reset on any
  non-continuation" rule of §2.3, which covers only editing actions and
  undo/redo. This matters for `setRecents`, which returns `state` **by identity**
  for an unchanged list; `src/editor/state.test.ts` asserts that identity
  (`expect(again).toBe(next)`) because the menu rebuild keys off it, so a
  `{...state, coalesceKey: null}` there would break an existing test. No
  behavioural difference either way (every gesture is fenced by the leading
  `select` — §2.3), but the reducer must be written the way this bullet says.

### Why full snapshots, not inverse commands (decision, recorded)

History stores **past `Document` values**, not a log of invertible operations.
The reducer already builds each next document by spreading the previous one
(`addNode`, `deleteSelection`, … in `state.ts`), so successive snapshots **share
every untouched node, link, and layout entry** — storing the whole `Document`
costs about as much as the changed sub-tree, not a deep copy. Snapshots are also
far less bug-prone than hand-written inverse operations (every future edit action
would otherwise need a correct undo twin). This is the standard trade for an
editor of this size; revisit only if snapshot memory ever shows up as a problem
(it won't at the scale of a network fragment).

### 2.2 State shape and the two new actions

`EditorState` (`src/editor/state.ts`) gains three fields:

- `past: Document[]` — snapshots older than the current doc, oldest first. The
  last element is the state one undo returns to.
- `future: Document[]` — snapshots undone from, newest-undo first. The first
  element is the state one redo advances to.
- `coalesceKey: string | null` — the "gesture" the current top-of-`past` belongs
  to, so a continuous drag collapses to one entry (§2.3). `null` = no open
  gesture.

`initialState()` sets `past: []`, `future: []`, `coalesceKey: null`.

Two new actions on a `HistoryAction` group (a third arm of the `Action` union
alongside `EditAction` / `PersistAction`, so `editReducer`'s exhaustive switch
still narrows to `EditAction`):

- `{ type: "undo" }` — no-op (**return `state` by identity**) when `past` is
  empty; else move current `doc` to the front of `future`, pop the last `past`
  entry into `doc`, clear `coalesceKey`, clear `linkFrom`, set `dirty: true`, and
  **revalidate selection** (§2.5).
- `{ type: "redo" }` — symmetric: no-op when `future` is empty.

`linkFrom` is cleared because a half-drawn link may point at a node the undo just
removed; `Canvas` degrades to no preview in that case (`nodePos` returns
undefined), but leaving a stale start node dangling is not a state we want to
reason about.

### 2.3 Drag coalescing — the central trap

A node drag dispatches a `moveNode` **per pointer-move** (`onPointerMove`,
`src/components/Canvas.tsx`), and pointer-up only clears a ref — it dispatches
nothing (`onPointerUp`). A naive "push on every doc change" would put dozens of
entries on the stack for one drag, so a single Cmd+Z would nudge the node one
mouse-step. Coalescing is mandatory, not polish.

**Mechanism — coalesce by key, break on any non-continuation.** Each undoable
edit has a `coalesceKey`:

- `moveNode` → `"moveNode:" + id` (per-node, so dragging A then B are two steps).
- every other edit → `null` (discrete; never coalesces).

On an undoable change with key `k`:

- if `k !== null` **and** `k === state.coalesceKey`, the current gesture is still
  open: **replace** — update `doc`, leave `past` as-is (it already holds the
  pre-gesture snapshot), clear `future`, keep `coalesceKey = k`.
- otherwise **push**: append `state.doc` to `past`, update `doc`, clear `future`,
  set `coalesceKey = k`.

Any **editing** action that is not an undoable change resets `coalesceKey` to
`null`, as do `undo` / `redo` / `loadDocument` / `newDocument` (but not
`markSaved` / `setRecents` — §2.1). This is what makes each drag a separate entry
with **no Canvas change required**: every drag begins with a `select` dispatch
(`onNodePointerDown`, `Canvas.tsx`) which returns `doc` unchanged and therefore
resets `coalesceKey` before the drag's first `moveNode` — so move #1 pushes and
moves #2…N replace. During the drag itself `onPointerMove` dispatches only
`moveNode` for the one node, an uninterrupted run. (See OQ-2 for making this
robust against a future gesture that lacks a leading `select`.)

**Accepted consequence — zooming mid-drag splits the drag in two.** `onWheel`
sits on the `<svg>` root and still fires during a captured node drag, dispatching
`setView` — a doc-unchanged editing action, which resets `coalesceKey`, so the
next `moveNode` pushes a fresh entry. Two undo steps for one drag is a defensible
reading of "the user did two things", and exempting `setView` from the reset
would weaken the one rule that keeps the mechanism simple. Noted so it isn't
mistaken for a bug; the exemption is the fallback if OQ-2 is ever revisited.

### 2.3a Why discrete clicks don't coalesce (decision, recorded)

The Lanes stepper (`Inspector.tsx`) and the junction Size stepper are **±1 /
±0.25 per click**, so holding a value down N steps dispatches N `setLinkLanes` /
`setJunctionScale` actions and produces **N undo entries**. That is deliberate:
coalescing them would need a *time or focus* boundary to close the gesture, and
this design has neither — under "break on any non-continuation" alone, two clicks
on the same button ten minutes apart would merge into one step, and a click on
the − button would merge into a run of + clicks. A pointer-move stream is a
genuine single gesture; separate deliberate clicks are not. Undoing them one by
one costs a keystroke each and is never surprising.

### 2.4 Where the logic lives

All of it is in the **reducer** (`state.ts`), pure and unit-testable — no
component or IPC involvement, mirroring the save/load "apply logic is pure"
split. Factor the push/coalesce/reset decision into one helper applied to the
result of the editing branch, e.g.:

```ts
// pseudo — the default (editing) branch of reducer()
const next = editReducer(state, action);
return recordHistory(state, next, coalesceKeyFor(action));
// recordHistory:
//   doc unchanged AND next === state AND state.coalesceKey === null → state
//                       (preserve the identity-stable no-op; see below)
//   doc unchanged                    → {…next, coalesceKey: null}
//   doc changed                      → push-or-replace per §2.3, dirty: true
```

**Keep the identity-preserving no-op.** Today `moveNode` on a node with no layout
entry and `deleteSelection` with nothing selected return `state` *itself*, so
`useReducer` bails out of the re-render. `{...next, coalesceKey: null}`
unconditionally would allocate a new object on every such action and lose that;
the early-out above preserves it.

`undo` / `redo` / `loadDocument` / `newDocument` set the history fields directly
(the first two pop/shift; the last two clear). Cap `past` at `HISTORY_LIMIT = 100`
(OQ-3, resolved) by dropping the oldest when a push would overflow.

### 2.5 Selection and dirty across undo (decision, recorded)

- **Selection is revalidated, not blindly cleared.** After undo/redo, keep
  `state.selection` iff its id still exists in the new `doc` (a node in
  `doc.nodes`, a link in `doc.links`); otherwise set it to `null`. This keeps a
  link selected while you undo a lane-count change (nice), but drops a dangling
  selection when undo removes the selected node (correct). A tiny
  `selectionValid(doc, sel)` helper, reused by both actions.
- **Dirty:** undo/redo set `dirty = true` whenever they change `doc`. This can
  *over*-report (undoing back to exactly the last-saved document still shows
  dirty), which is safe — worst case is one extra "discard?" prompt. Deriving
  dirty from a saved-snapshot marker is a real improvement but a separate change;
  tracked as OQ-1, not built here. Note this makes undo/redo a **fourth explicit
  carve-out** from the "dirty is set by document identity" rule that
  `rules/persistence.md` documents — reconcile that rule in Phase 1.

### 2.6 Non-goals

- **View is not undoable.** Pan/zoom (`setView`) never touch `doc` and never
  dirty; Cmd+Z must not "undo" a scroll. Same for `setTool` and `select`.
- **No cross-session history.** `past`/`future` live in memory only and are never
  written to `.zkai`; load/new reset them (§2.1).
- **Linear history only** — one past/future stack, no redo tree/branching.
- **No standalone selection/tool undo** — only document content.

### 2.7 Triggers, and the native-menu trap

Three entry points, all dispatching `undo` / `redo`:

1. **Keyboard** (`App.tsx` keydown effect): Cmd/Ctrl+Z = undo; Cmd/Ctrl+Shift+Z
   and Cmd/Ctrl+Y = redo. Same input-field guard as the existing handler (the
   `INPUT`/`TEXTAREA` early return at the top of `onKey`). **This path only runs
   when no native menu is installed** — i.e. `bun run dev` in a browser — because
   the handler returns early on every Cmd/Ctrl chord when `menuInstalled`. So
   Ctrl+Y is a browser-path convenience: on desktop only the two menu
   accelerators below exist (a `MenuItem` carries exactly one accelerator, and a
   second redo item is not worth a menu entry).
2. **Toolbar** buttons — disabled when `past` / `future` is empty (cheap: plain
   React re-render), next to the tool group in `src/components/Toolbar.tsx`.
3. **Native Edit menu** — **required for desktop correctness, not a bonus.** The
   Phase-4 menu makes native accelerators own every Cmd/Ctrl chord, so `App.tsx`
   returns early on chords when `menuInstalled`. Tauri's default menu builds an
   **"Edit" submenu on every platform** whose first two items are the
   **predefined** Undo and Redo (verified in `Menu::default`, tauri 2.11.5:
   `[Undo, Redo, Separator, Cut, Copy, Paste, SelectAll]`) — these drive *webview
   text* editing, not our document, and carry the standard Cmd+Z / Shift+Cmd+Z
   key equivalents on macOS. So under `tauri dev`, Cmd+Z would hit the wrong Undo
   unless we intervene.

   **Mechanism:** in `build()` (`src/editor/menu.ts`), after the File work, find
   the Edit submenu with the existing `findSubmenu(menu, "Edit")`, drop the
   predefined pair with `await edit.removeAt(0)` **twice** (Undo then Redo shift
   into position 0), and `insert` Zukai's own Undo/Redo `MenuItem`s at 0 —
   accelerators `CmdOrCtrl+Z` / `CmdOrCtrl+Shift+Z`, `action` → dispatch. Guard
   the whole block on `edit` being non-null. Note this is a *removal*, which
   `installMenu` has no precedent for (it only ever `insert`s into File) — but it
   sits inside `build()`'s existing try/catch, so a failure degrades to
   `menuInstalled = false` and hands the chords back to `App.tsx`.

   Menu items stay **always-enabled and no-op at the ends**; the toolbar carries
   the disabled affordance (OQ-4, resolved).

`menu.ts` therefore needs undo/redo callbacks alongside `FileActions` — extend
`MenuOptions` rather than reach into the reducer.

## 3. Open questions

- **OQ-1** — Dirty after undoing to the last-saved document: over-report (Phase 1)
  vs. derive `dirty` from a saved-snapshot reference set on load/save. (design-call;
  proposed: over-report now, saved-marker later — it touches `markSaved`/`load`
  and is worth its own small change.)
- **OQ-2** — Coalescing currently relies on the leading `select` at drag start
  (`onNodePointerDown`, `Canvas.tsx`) to break the run. Robust today, but a future
  drag gesture without that leading dispatch would merge with the previous one.
  Add an explicit `commitHistory`/`endGesture` action dispatched on pointer-up
  (`onPointerUp`) to make the boundary explicit? (design-call; proposed: rely on
  the `select` boundary now, note the assumption; add the explicit commit if a
  second high-frequency gesture appears.)
- **OQ-3** — RESOLVED (2026-07-24): `HISTORY_LIMIT = 100`, drop-oldest on
  overflow. Snapshots are cheap via structural sharing, so depth is bounded for
  tidiness rather than memory; Phase 1 hard-codes the constant in `state.ts`.
- **OQ-4** — RESOLVED (2026-07-24, from code): native menu Undo/Redo stay
  **always-enabled and no-op at the ends**. The original rationale ("enable/disable
  would rebuild the menu") was wrong — `MenuItem.setEnabled(enabled)` exists
  (`@tauri-apps/api/menu/menuItem.d.ts`) and is a per-item IPC call, no rebuild.
  The real reason to skip it: it would mean retaining two `MenuItem` handles
  across rebuilds and firing IPC on every `canUndo`/`canRedo` flip (i.e. on the
  first edit, and on every undo back to empty), to duplicate an affordance the
  toolbar already shows. Revisit only if the greyed-out menu state is missed.

## 4. Implementation phases

Strictly sequential; each is one plan-mode pass with a concrete exit gate.

### Phase 1 — History in the reducer

- **Scope:** `src/editor/state.ts` only. Add `past` / `future` / `coalesceKey`
  to `EditorState` and `initialState`; add the `HistoryAction` group with
  `undo` / `redo`; implement the push/replace/reset logic (§2.3) via a
  `recordHistory` helper wired into the editing branch of `reducer`, preserving
  the identity-stable no-op (§2.4); reset history in `loadDocument` /
  `newDocument` and leave it untouched in `markSaved` / `setRecents` (§2.1); add
  `selectionValid` revalidation and `linkFrom` clearing (§2.2, §2.5) and the
  `HISTORY_LIMIT = 100` cap. No UI, no Canvas change.
- **Exit gate:** `bun run build` + `bun run test` green (the whole existing suite,
  including the `setRecents` identity test), with new tests that: (a) a discrete
  edit (`addNode`) then `undo` restores the prior doc and `redo` reinstates it;
  (b) a **run of `moveNode` for one id coalesces to a single undo step**, and a
  `select` between two such runs keeps them separate (the drag-coalescing case);
  (c) two `setLinkLanes` dispatches are **two** undo steps (§2.3a); (d) a new edit
  after an undo **clears `future`**; (e) `undo`/`redo` are no-ops at the ends and
  return `state` by identity; (f) `loadDocument` / `newDocument` reset
  `past`/`future`; (g) after undoing away the selected node, `selection` is
  `null`, but undoing a lane-count change keeps the link selected.
- **Docs touched:** update `rules/persistence.md` — the "**`dirty` is set by
  document identity** … the three persistence actions are the carve-out" bullet
  is stale once undo/redo set `dirty` explicitly (§2.5). No other rule changes
  yet (the feature is not user-visible until Phase 2); note in the commit that
  the reducer contract changed.

### Phase 2 — Triggers: keyboard, toolbar, native Edit menu  (depends on Phase 1)

- **Scope:** `App.tsx` keydown for Cmd/Ctrl+Z / Shift+Z / Ctrl+Y (browser path
  only, §2.7); Undo/Redo toolbar buttons in `src/components/Toolbar.tsx` disabled
  via `past.length` / `future.length`; extend `MenuOptions` in
  `src/editor/menu.ts` with `onUndo`/`onRedo` and replace the Edit submenu's
  predefined Undo/Redo with Zukai's items per the §2.7 mechanism; pass the
  callbacks from `App.tsx`.
- **Exit gate:** `bun run build` + `bun run test` green; a `tauri dev` manual run
  — draw + drag + edit, then undo/redo via **each** of keyboard, toolbar button,
  and the Edit menu, confirming a drag undoes as one step, the Edit menu shows
  exactly one Undo/Redo pair, and it drives *document* (not webview) undo; and a
  `bun run dev` browser check that the keyboard path (including Ctrl+Y) and the
  disabled-button states work with no native menu.
- **Docs touched:** add a short `rules/` note (either a new `rules/history.md` or
  a section in an editor-state rule) covering the snapshot-history contract and
  the coalescing rule; extend the `installMenu` / `menuInstalled` chord-ownership
  bullet in `rules/persistence.md` to say Cmd+Z/Shift+Cmd+Z are now Zukai's items
  in the Edit submenu, replacing the predefined pair; update the project-memory
  roadmap (undo/redo shipped).

## 5. Review log

### Round 1 — 2026-07-24 — `VERDICT: NOT READY` (1 blocking)

Clean-room reviewer with repo access.

**Blocking, fixed:** §1's usage example ("bump lanes to 3", one Cmd+Z back to 1)
contradicted §2.3, which gives every non-`moveNode` edit `coalesceKey = null` —
the Lanes control is a ±1 stepper (`Inspector.tsx`), so 1 → 3 is two dispatches
and two undo steps, and every later line of the example was off by one. Fixed by
correcting the example to a single click and adding **§2.3a** as a recorded
decision (discrete clicks never coalesce, because this design has no time/focus
boundary to close such a gesture).

**Non-blocking, folded in:** stale `state.ts:NNN` / `App.tsx:44` line citations
replaced with `file:symbol` form per `spec-authoring.md` §5 (7 of 8 were wrong);
§2.1 vs §2.3 contradiction over whether `markSaved`/`setRecents` clear
`coalesceKey` resolved in favour of "untouched" (taking §2.3 literally would break
the `setRecents` identity assertion in `state.test.ts`); §2.4 pseudo-code now
preserves the identity-stable no-op return; undo/redo now clear `linkFrom`; §2.7
gained the concrete removal mechanism (`findSubmenu("Edit")` + `removeAt(0)`
twice — Undo/Redo verified as the first two items of `Menu::default`'s Edit
submenu in tauri 2.11.5) instead of the inexact "same move as File"; Ctrl+Y noted
as browser-path-only; the wheel-during-drag split documented as an accepted
consequence in §2.3; `bun run test` named correctly and added to Phase 2's gate;
`rules/persistence.md` reconciliation added to both phases' docs lists.

**OQs closed during review:** OQ-3 resolved (100, drop-oldest). OQ-4 resolved —
the reviewer showed its premise was wrong (`MenuItem.setEnabled` exists and does
not rebuild the menu), so the same conclusion is kept with a corrected rationale.

**Rejected:** none outright. The alternative to the blocking fix — coalescing
repeated stepper clicks — was considered and rejected on the record in §2.3a.

### Round 2 — 2026-07-24 — `VERDICT: READY` (0 blocking) — converged

Same reviewer resumed. Confirmed the blocker is resolved by tracing the §1
example through the reducer (`past = [empty, N1, N1+N2, +link, +drag]` — the
three undos and the redo land exactly as the example claims), and re-verified
each folded-in change against the code: the `setRecents` identity assertion, the
`nodePos`-guarded link preview, `HistoryAction` as a third union arm leaving
`editReducer`'s exhaustive switch narrowing to `EditAction`, the §2.4 early-out
being correctly conditioned on `coalesceKey === null` (so a no-op editing action
*mid*-gesture still resets the key), and the §2.7 menu surgery — `removeAt(0)`
twice then `insert([undo, redo], 0)` reproduces `[Undo, Redo, Separator, Cut, …]`,
and sits before `setAsAppMenu()` so a throw leaves nothing half-installed.

No new blocking issues. `status` moved `draft` → `reviewed`; the spec is cleared
for Phase 1.
