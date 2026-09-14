---
title: canvas-interaction
sources:
  - src/App.tsx
  - src/components/Canvas.tsx
  - src/components/Diagram.tsx
  - src/components/Toolbar.tsx
  - src/editor/geometry.ts
  - src/editor/state.ts
covers: >
  what the pointer and the keyboard do on the drawing surface: the five tools and
  what each claims, the five Selection arms and the one with no id, the four drags
  and the one threshold, how a click becomes a document coordinate, the grid it
  lands on, and the chrome that exists only here
max_lines: 190
generated: 2026-08-10
---

# Canvas interaction

Everything the pointer and the keyboard do to the drawing. Frontend only. The
rationale is spread across the specs that added each gesture — `zk-006` for
markings, `zk-007` for signs, `zk-011` for dragging paint, `zk-014` for bends.

One boundary: **what a click *means* is here; what it *draws* is not** —
`road-rendering.md`, `road-joints.md`, `marking-kinds.md` and `signs.md` own that.

## The five tools

`Tool` is `"select" | "node" | "link" | "marking" | "sign"`, switched by the
toolbar or by a single keystroke (`TOOL_KEYS` in `App.tsx`: `v n l m s`). The
keydown handler ignores anything aimed at an `INPUT`/`TEXTAREA`, which is what
lets the Inspector's five text fields be typed into without switching tools.

| Tool | On the background | On an existing object |
|---|---|---|
| `select` | clear the selection, begin a pan | select it, and begin its drag |
| `node` | `addNode` at the pointer | falls through to select-and-drag |
| `link` | cancel any half-drawn link | `startLink`, then `completeLink` (retypes both ends) |
| `marking` | *(nothing — the click is lost)* | on a **road**: `addMarking` |
| `sign` | `addSign` at the pointer | on a **sign**: select and drag it |

Two asymmetries are deliberate. The **marking** tool claims the event on a road
(`stopPropagation`), or the click would pan; every other tool lets it fall through.
The **sign** tool on a sign selects rather than dropping a second — the node tool's
rule, as a sign minted beneath the first would be invisible.

**Adding or removing a road retypes the nodes at it** (ramps §2.12.2). `completeLink`
and `deleteSelection`'s link and node arms hand the nodes whose roads changed to
`state.ts:retypeNodes`, reading the post-edit document: two or more distinct
neighbours (`nodeNeighbours`) make a `waypoint`, fewer an `endpoint`. A `junction`
is never touched, and a Kind-row pick holds until that node's roads next change.

## Selection: five arms, and the fifth has no id

```ts
type Selection =
  | { kind: "node";    id: NodeId }
  | { kind: "link";    id: LinkId }
  | { kind: "marking"; id: MarkingId }
  | { kind: "sign";    id: SignId }
  | { kind: "bend";    link: LinkId; index: number }   // no `id`
```

**Every id is a bare `type X = string`**, so the first four are mutually
indistinguishable to the compiler. That is the scar this whole area carries: a
`Selection` arm added without a matching arm elsewhere falls silently through a
binary test, which cost the marking arm its survival across undo and cost three
sites a correct branch. The countermeasures, all four of which must be kept:

- `state.ts:selectionValid` and `state.ts:deleteSelection` are `switch`es ending
  in `unreachable(x: never)`, so a new arm fails to build until handled;
- `Inspector.tsx` tests each arm explicitly and falls through to the link tail —
  there is **no Inspector test file**, so a missed arm renders a blank `<aside>`
  and only a `bun run dev` pass finds it;
- `Diagram.tsx:isSelected` takes its `kind` from `Selection` itself, so the union
  cannot lag — but nothing forces a new shape to *call* it, and an element that
  never lights up is no build error.

**The `bend` arm is shaped differently on purpose.** `LinkView.bends` is a
`Vec2[]`; a bend has no id and cannot cheaply be given one, since an id would be a
new model field in both mirrors, serialized into every document, to name something
whose only identity is where it sits in the route. Two consequences:

- `isSelected` narrows with `"id" in sel` and a bend uses `isBendSelected`. This is
  the one place the compiler helped rather than hindered — the fifth arm broke four
  sites at build time, which is what the `never` guards were bought for.
- **An index is not a stable handle.** The rule: a `bend` selection is only ever
  minted by the gesture that just placed or grabbed that bend, and any action that
  changes a link's bend count clears it. `addBend` replaces it, `deleteSelection`
  clears it, and `restore` drops it outright on undo/redo — because a stale index
  can still be *in range* and then names a different vertex (`rules/history.md`).

`Delete`/`Backspace` dispatch `deleteSelection`; `Escape` cancels a half-drawn link
and clears the selection (`App.tsx`).

## The four drags, and the one threshold

`Canvas.tsx` keeps the active gesture in a **ref**, not state, so a pointer-move
does not re-render on its own account. Pointer capture goes on the `<svg>`.

| `Drag` arm | Carries | Dispatches per move |
|---|---|---|
| `node` | `offX`/`offY` | `moveNode` |
| `sign` | `offX`/`offY` | `moveSign` |
| `marking` | *nothing* | `moveMarking` |
| `bend` | `offX`/`offY` | `moveBend` |
| `linkPress` | screen start | *nothing, until the threshold* |
| `pan` | view + screen start | `setView` |

**A marking carries no grab offset, and that is a decision.** A node, a sign and a
bend are dragged *by the point you took hold of*; a marking is re-projected onto its
road **absolutely**. The cost is a jump of up to half its hit strip; what it buys is
the case that matters after an import — a marking whose metres run past the drawn
end of its road is clamped into the pad, and only this brings it back.

**A node is several circles now, and the drag did not notice.** `nodeDots` marks a
node once per drawn road end (`rules/road-joints.md`); they share **one** `<g>`,
and the offset comes off `nodePos` rather than the dot pressed — either one grabs.

**Only the bend gesture has a threshold**, and it is the only one that *creates*
what it drags. A press on a road selects it immediately and records a `linkPress`;
`BEND_THRESHOLD` (4 **screen** pixels — world units would change the gesture's
meaning with zoom) must be crossed before `addBend` mints anything, or every
ordinary selecting click litters the document with zero-length bends. The
threshold-crossing move performs the insert; the drag starts on the next.

Middle-click always pans, from every handler — a guard each `…PointerDown` needs of
its own, since their `stopPropagation` means the `<svg>` never gets its chance.
Wheel is `zoomAbout` at the pointer.

## From a click to a document coordinate

Three conversions, and picking the wrong one is the recurring defect:

- **A free position** (`addNode`, `moveNode`, `addSign`, `moveSign`) is
  `screenToWorld(view, …)`, minus the drag's grab offset, then `place` (below).
- **A place on a road** (`addMarking`, `moveMarking`) goes through
  `projectOntoLink`: `nearestOnPolyline` on the **drawn** polyline gives an arc
  length and a signed lateral offset; the length becomes metres through
  `UNITS_PER_METRE` and `anchoredAlong`, and a `span` argument says what the offset
  becomes — a lane (`bandAt`), a *boundary* for a `lane_line` (`boundaryAt`), or
  **nothing** for a `bus_stop`, which is drawn at the kerb whatever `lane` says.
  That kind-awareness lives here, in the UI layer, never in the reducer.
- **A vertex of a road** (`addBend`) goes through `geometry.ts:bendInsertion`,
  which is the same idea one step harder: the pointer is on the **drawn** polyline
  and the bend belongs to the **layout** one. It transfers the arc length by the
  two totals and takes the insertion index from that single walk. The road
  therefore barely moves on insert — the bend lands *on* it, not under the
  pointer, within the half-cell `place` may round it — and the grab offset is
  captured against the **unsnapped** vertex, so neither the insert nor the start
  of the drag jumps. Details and the spike it prevents:
  `rules/road-rendering.md`.

## The grid, which every free position lands on

`GRID_PITCH` is `LANE_PX * 4` — 36 world units, the cell the dots have always
been drawn at. `geometry.ts:snap` rounds each axis to the nearest multiple, and
`Canvas.tsx:place` is its one call site: it wraps every free position before
dispatch and returns the point untouched while **Alt** is held, so an exact
position stays reachable. Six actions go through it — `addNode`, `moveNode`,
`addSign`, `moveSign`, `addBend`, `moveBend`; a **marking** deliberately does
not, riding on its road at an arc length in metres a world grid means nothing to.

**The snap never reaches the reducer.** `moveNode(pos)` keeps meaning "put it
exactly here", which is what lets an import, an undo and a test place a node
off-grid without fighting anything. `state.test.ts` asserts all six write the
position given exactly — covering one lets a snap in the other five pass.

**The dots and the pointer are one lattice, which took moving the tile.** A
`<pattern>` clips content to its tile, so a circle at the tile origin draws a
quarter dot; `geometry.ts:gridPattern` keeps it centred and pulls the **tile** back.

## Chrome: what exists only on the canvas

`Diagram.tsx` takes an optional `interaction` prop, and **everything gated on it is
absent from an exported figure by construction** — `export.tsx:diagramInner`
renders `<Diagram doc={doc} />` with no such prop, so there is no filter anyone can
forget (`rules/diagram-export.md`). What hangs off it: the five `…PointerDown`
callbacks, the fat invisible hit paths (`.marking-hit`, `.jn-hit`, `.sign-hit`,
`.bend-hit`, and `.road-hit`, round-capped where the road is flat, or a press on a
joint disc's outside corner falls through and pans — ramps §2.12.1), the selection
halos, `.link-preview`, the bend handles, **`.node-dot`**, **`.road-arrow`** —
through `selected`, so on the selected link alone — and `vector-effect` on hairlines.

Two rules keep it honest. Chrome paint lives in `src/styles.css`, **never** in
`styles/diagram.css`, which travels inside every exported file — the dot's and the
arrow's rules too, the pieces that *paint* and are chrome anyway: a bead on a cut end
says a road stops there, and no road is painted with an arrowhead (ramps §2.11.1,
road declutter §2.1). And every chrome class must be in `export.test.ts`'s `CHROME`
regex — twelve tests reuse it, all passing for leaked markup whose class is unlisted.

A marking and a sign each carry an unconditional `stopPropagation`, making them
small **dead zones for the node tool** — nudging the click is the whole remedy.

## Where each piece lives

`Canvas.tsx` owns the `<svg>`, the `Drag` union, every `…PointerDown` handler,
`projectOntoLink`, `place`, `BEND_THRESHOLD` and the grid `<pattern>`.
`Diagram.tsx` owns the `Interaction` interface, `isSelected`/`isBendSelected`,
`hairline` and `BendHandle`. `App.tsx` owns the keyboard. `Toolbar.tsx` owns the
tool buttons. The pure arithmetic is `geometry.ts` — `screenToWorld`,
`zoomAbout`, `nearestOnPolyline`, `pointAlongPolyline`, `bendInsertion`,
`bandAt`, `boundaryAt`, `anchoredAlong`, `GRID_PITCH`, `snap`, `gridPattern`,
`nodeDots` — the only part with tests. **There is no `Canvas.test.tsx`**, and
`renderToStaticMarkup` cannot see whether an element carries a callback, so the
gestures are covered by a `bun run dev` pass and nothing else.
