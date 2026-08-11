---
id: zk-014
title: link-bends
note: >
  A link is drawn as a straight chord between its two nodes and nothing can bend
  it — so this makes a bend an object a human places, after fixing the offset
  that would cut its corner, and puts placement on the grid that is already drawn.
status: draft
last_updated: 2026-08-10

phases:
  - name: "Phase 1 — The offset turns a corner"
    reviewed: null
    shipped: null
    cut: null
    by: null
  - name: "Phase 2 — A bend is an object you place, drag and delete"
    reviewed: null
    shipped: null
    cut: null
    by: null
  - name: "Phase 3 — The grid holds"
    reviewed: null
    shipped: null
    cut: null
    by: null

extends: null
supersedes: null
superseded_by: null
related: [zk-004, zk-005, zk-006]
reference: "How a diagramming tool routes a connector: you drag the line and it bends where you dragged it, keeping the segments it already had. Not a spline, not a router that avoids obstacles, and not a path editor with tangent handles — those solve a problem a schematic road does not have."
---

# Link Bends Spec

## 1. Goal

**A link is drawn as a straight chord between its two nodes, and nothing in the
app can bend it.** `LinkView.bends` is declared in both mirrors
(`src/model/types.ts:LinkView`, `src-tauri/src/model/layout.rs:LinkView`),
`src/model/document.ts:linkPolyline` reads it, the renderer draws through it, and
`src-tauri/src/model/mod.rs`'s round-trip sample saves a document carrying one —
but **no action writes it**. The reducer's vocabulary runs from `startLink` to
`setLinkLength` with nothing for the polyline in between, so the only way to bend
a road today is to hand-edit the `.zkai`.

The observable is the drawn network, in the app and in an exported figure.

End state — an offramp that leaves the motorway and then turns, instead of
cutting the figure diagonally:

```
File ▸ a motorway running west–east, an offramp down to a roundabout

  today                                    wanted

  ═══════════╤═══════════                  ═══════════╤═══════════
              ╲                                       └────────┐
               ╲                                               │
                ╲                                              │
                 ◯                                             ◯

  the ramp is a chord: one straight        the ramp leaves east and turns
  line from node to node, at whatever      south, meeting the roundabout
  angle the two node positions imply       square — two segments and a bend
```

This is the thing `CLAUDE.md` calls a **connector bend point**, and it is one of
the three items it names as the presentation layer's content. It is also what the
metro-map analogy rests on: a schematic *distorts* real geometry for clarity, and
a network of straight chords between node positions has no way to do the
distorting. Every schematic idiom that makes such a figure readable — a road that
runs orthogonally and turns once, arms that leave a junction square — needs a
vertex between the endpoints.

**On `CLAUDE.md`'s test, it earns its place twice**: it makes the drawn network
clearer, and it makes drawing faster, because the alternative today is to insert a
`waypoint` node purely to force a corner — which mints a semantic graph vertex to
buy a presentation-layer effect, exactly the confusion the two-layer split exists
to prevent.

### 1.1 Non-goals

- **Not auto-layout, and not a router.** Nothing computes where a bend should go,
  avoids obstacles, or reflows a route when a node moves. The human places every
  bend, which is the same posture §2 of `CLAUDE.md` takes to layout generally.
- **Not curves.** A bend is a vertex of a polyline. Every downstream consumer —
  `offsetPolyline`, `nearestOnPolyline`, `pointAlongPolyline`, `junctionArms`,
  `taperWedges` — is written against a polyline, and a spline would rewrite all of
  them to draw something a schematic does not use.
- **Not tangent handles or a path-editing mode.** The reference above says why:
  that is a vector-illustration idiom, and a connector is a simpler object.
- **Not multi-select, align or distribute.** Phase 3 puts placement on a grid;
  aligning several objects to each other is a larger subject and a later one.
- **No new model field, and no `SCHEMA_VERSION` move.** The field exists in both
  mirrors and has since the first commit. This spec adds actions and one
  `Selection` arm, all of which are frontend state.
- **Not bends on anything but a link.** A marking rides on its road, and a sign
  carries a bare position; neither has a route to shape.

## 2. Design

### 2.1 The field predates the corpus, so this is a new spec (decision, recorded)

`LinkView.bends` is in the initial commit, like `t_junction` was (`zk-013` §2.1),
and for the same reason no spec owns it: it arrived before this corpus existed.
§6.1's ordered test, worked step by step:

- *Step 0, is a decision changing?* Yes. What gesture bends a road, what a bend is
  as an object, and whether placement snaps are all unbuilt design.
- *Step 1, does it remove or contradict shipped work?* No. Phase 1 changes what
  `offsetPolyline` computes (§2.4), but that is a **defect its own doc comment
  names**, not a decision any spec took. Phase 3 changes what a drag writes, which
  narrows a behaviour rather than removing a feature.
- *Step 2, does an existing spec own the subject?* The candidates, and why each
  fails: `zk-004` road-rendering owns *how a link becomes a picture of a road* —
  lane bands, class, alignment — taking the polyline as given, and never asks
  where the polyline's vertices come from. `zk-005` ramps-and-tapers owns what is
  drawn *where links meet a node*. `zk-006` road-markings owns paint *on* a road.
  None owns the route, and none owns canvas interaction — there is no
  `rules/` file for it either, which is the same gap seen from the other side.
- *Step 3, a named kind under a reserved framework?* No spec reserved a routing or
  interaction framework.
- *Step 4* → new spec, `extends: null`, `supersedes: null`.

**Bends and snapping are one spec, which is a call worth recording**, because
snapping is visibly cross-cutting: it touches nodes, signs and bends alike. It is
kept here because its *subject* is the same one — where a human's pointer puts a
vertex — and because its value is realised on bends. A schematic's legibility
comes from alignment, and a road that can now turn a corner is exactly the object
that makes an unaligned corner obvious. Splitting it would put two halves of one
gesture in two documents. If placement later grows multi-select and
align/distribute, *that* is the new spec.

### 2.2 A bend is an index, not an entity, and that is the whole modelling question (decision, recorded)

`LinkView.bends` is a `Vec2[]`. A bend has no id and cannot cheaply be given one:
an id would be a new model field in both mirrors, serialized into every document,
to name something whose only identity is *where it sits in the route*.

So the fifth `Selection` arm is shaped differently from the four before it:

```ts
export type Selection =
  | { kind: "node"; id: NodeId }
  | { kind: "link"; id: LinkId }
  | { kind: "marking"; id: MarkingId }
  | { kind: "sign"; id: SignId }
  | { kind: "bend"; link: LinkId; index: number };   // no `id`
```

**Three sites break at compile time, and all three are supposed to.** This is the
dividend of the discipline `zk-006` bought after its own `Selection` arm compiled
clean and misrouted silently in three places, because ids are bare
`type X = string`:

- `src/components/Diagram.tsx:isSelected` is `sel?.kind === kind && sel.id === id`.
  A fifth arm with no `id` makes `sel.id` a type error, which forces the decision
  rather than letting a bend silently never highlight.
- The two `never`-checked switches, `src/editor/state.ts:selectionValid` and
  `src/editor/state.ts:deleteSelection`, stop compiling until each grows an arm.
  Both reach `src/editor/state.ts:unreachable`, whose doc comment says that adding
  a `Selection` arm is exactly what it exists to catch.

**An index is not a stable handle, and the rule that makes it safe is stated
rather than assumed.** Deleting bend 0 renumbers bend 1, so a selection held
across that edit points at a different bend. The invariant:

> A `bend` selection is only ever minted by the gesture that just placed or
> grabbed that bend, and **any action that changes a link's bend count clears the
> selection**. Dragging does not change the count, so a drag holds.

That is one line in each of `addBend` and `deleteSelection`, and it is cheaper and
more honest than an id. `deleteSelection` already clears, so only the insert needs
saying. OQ-2 carries the case this does not cover.

### 2.3 The handles are chrome, and cannot reach a figure (decision, recorded)

A bend needs something to grab. That something must not appear in an exported
figure, and the mechanism already exists and is load-bearing:
`src/editor/export.tsx:diagramInner` renders `<Diagram doc={doc} />` with **no**
`interaction` prop, so anything gated on `Interaction` is absent from an export by
construction rather than by a filter someone must remember. `zk-010`'s stage
preview rode on exactly this, and `hairline(interaction)` in `Diagram.tsx` is the
existing precedent for a visual that differs between canvas and file.

So bend handles are rendered only when `interaction` is present, and the gate
asserts an export of a bent document contains no handle markup at all.

### 2.4 One thing genuinely breaks, and its own doc comment says so (decision, recorded)

**This is the constraint that makes the spec three phases instead of one.**

`src/editor/geometry.ts:offsetPolyline` offsets each vertex along the **average of
its two segment normals**, at distance `d`. Its doc comment is already candid:
*"Good enough for the gentle bends a schematic uses; not a true miter offset at
sharp corners."* That has never mattered, because no document the app can produce
has a corner at all.

The correct miter distance along the bisector is `d / cos(θ/2)`, where `θ` is the
turn angle. Using `d` puts the offset vertex **short**, so the offset line cuts
the corner. With a 2-lane arterial (`LANE_PX` 9, `ROAD_MARGIN` 3, so `roadWidth`
21 and a lane region 18 wide):

| Consumer | `d` | correct at a right angle | today | short by |
|---|---|---|---|---|
| A divided road's carriageway (`SCHEMATIC_MEDIAN` 6) | 13.5 | 19.09 | 13.5 | **5.59** |
| Either edge line (`Diagram.tsx:RoadShape`) | 9 | 12.73 | 9 | **3.73** |
| The casing | 10.5 | 14.85 | 14.85 | — |

The casing is a **stroke**, so SVG's own line join miters it correctly for free.
Everything else is an offset polyline. So at a right-angle bend the asphalt turns
the corner cleanly while the edge line that should sit 1.5 units inside it sits
5.85 units inside it — a white line floating in the middle of the road, on an
ordinary undivided two-lane road. It is not a divided-road problem.

`offsetPolyline` has **five** consumers and every one of them inherits this: the
two edge lines and the lane bands and dividers (`Diagram.tsx:RoadShape`),
`drawnPolyline`, and a `lane_line` marking's spine and its double
(`geometry.ts:laneLine`).

**The fix must not change the vertex count**, and that is a cross-phase
constraint rather than an implementation taste. Phase 2 inserts a bend at the
segment index the pointer landed on, measured against the **drawn** polyline, and
applies it to the **layout** polyline. That transfer is only valid because
`offsetPolyline` preserves vertex count and order — which the shipped test asserts
(`expect(drawn).toHaveLength(spine.length)`). So the miter limit must clamp the
**distance along the same bisector**, never insert a bevel vertex.

**A shipped assertion encodes the defect, and is named here so it is not
"repaired" by weakening it.** `geometry.test.ts`'s `offsets a bent road along its
whole length` asserts `distance(spine[i], drawn[i])` is `OFFSET_2` **for every
vertex, the interior bend included** — which is the non-miter behaviour written
down as if it were the invariant. Its fixture bends by 36.87°, where the true
factor is 1.0541, so the miter fix moves that vertex from 13.5 to 14.23 and the
test fails. The replacement asserts the quantity that is actually invariant: the
**perpendicular distance from each segment** is `d`. That is true of a true miter
and false of the average-normal form, which is why it is the right assertion and
why it could not have been written before.

### 2.5 What a bend changes downstream, and what it does not

Three consumers read the polyline's *ends*, and a bend placed next to a node moves
what they see. In every case the new behaviour is correct — the road really does
leave at that angle — but it is a visible consequence, not a no-op:

- **`geometry.ts:junctionArms`** takes `dir` from the segment adjacent to the
  node, so a bend beside a junction **re-aims that arm**. The pad follows its arms
  (`zk-013`), so the junction's own outline changes with it. That is the feature
  working: a road that leaves a junction heading north should widen the pad to the
  north.
- **`geometry.ts:taperWedges`** requires a through joint to be collinear within
  `TAPER_MAX_BEND` (8°). A bend that turns a road at a waypoint therefore
  **suppresses the taper**, which is right — a taper's premise is one road
  continuing through a width step, and a road that turns 40° is not that.
- **`gorePair`** picks its two arms geometrically, so re-aiming an arm can change
  the pair. Also correct, and also worth seeing in a dev pass.

Two things need **nothing**, and are recorded so no one goes hunting: markings
already measure by arc length along the drawn polyline
(`nearestOnPolyline`, `pointAlongPolyline`), which is bend-agnostic; and
`src/editor/export.tsx:strokeAllowance` is unchanged, because a bend adds no
stroke width and `measureDiagram` frames from `getBBox`, which follows the
geometry wherever it goes.

### 2.6 The gesture: drag the road, and it bends (decision, recorded)

`src/components/Canvas.tsx:onLinkPointerDown` currently selects a link on
pointer-down under the select tool. The gesture this spec adds is the diagramming
idiom the `reference` names: **press on a road and drag, and a bend appears under
the pointer and follows it.** A press that does *not* move still selects the link,
exactly as today.

That distinction needs a **drag threshold**, which this codebase does not yet
have: today every drag begins on pointer-down. A few world units of movement
before a bend is minted is what keeps an ordinary selecting click from littering
the document with zero-length bends. The threshold is measured in **screen**
pixels, not world units, or it changes meaning with zoom.

Two alternatives, rejected and recorded:

- **A sixth `Tool`.** Every other tool creates a *kind of object*; a bend is a
  modification of one that exists. It would also mean a mode switch for what
  should be one gesture, and the toolbar is a row a reader has to learn.
- **Double-click to insert, then drag.** Two gestures where one will do, and it
  makes creating a bend and moving it feel like different operations when they are
  the same one.

### 2.7 The grid is drawn and named nowhere (decision, recorded)

`Canvas.tsx` paints a dot grid whose cell is `LANE_PX * 4` world units, written
inline in the `<pattern>` and bound to no constant. Nothing snaps to it, so it is
decoration: the eye is offered a reference the pointer does not honour.

Phase 3 names that constant and makes every canvas placement and drag land on it —
`addNode`, `moveNode`, `addSign`, `moveSign`, and the bend gestures from Phase 2.
Two rules that keep it from becoming a cage:

- **A held modifier bypasses the snap**, so an exact position is always reachable.
- **Snapping is applied in the UI layer, never in the reducer.** `moveNode(pos)`
  keeps meaning "put it exactly here", which is what lets an imported document,
  an undo, and a test place a node off-grid without fighting anything. This is the
  same split `zk-006` records for its kind-aware marking rules, and for its reason:
  a reducer that silently rewrites its argument makes the same action mean
  different things depending on which caller sent it.

**A marking is deliberately not snapped.** It rides on its road at an arc length
in metres, so a world-space grid means nothing to it, and `zk-011` chose absolute
re-projection for that drag on purpose.

### 2.8 Where the logic lives

| Piece | Where | Pure? |
|---|---|---|
| The miter offset and its limit | `src/editor/geometry.ts:offsetPolyline` | ✅ vitest |
| The segment index a click lands on | `src/editor/geometry.ts` (§2.4, OQ-1) | ✅ vitest |
| `addBend` / `moveBend`, the `Selection` arm, the delete arm | `src/editor/state.ts` | ✅ vitest |
| The drag, the threshold, the snap | `src/components/Canvas.tsx` | — `bun run dev` |
| The handles | `src/components/Diagram.tsx`, gated on `Interaction` | ✅ `renderToStaticMarkup` |
| Handle paint | `src/styles.css` — **chrome**, not `diagram.css`, since none of it reaches an export |
| The grid constant | `src/editor/geometry.ts`, consumed by `Canvas.tsx` | ✅ vitest |

**No phase touches Rust**, so `cargo test` must come out unchanged at each gate —
but *not* for the obvious reason, and the exception is live here:
`src-tauri/src/network/import.rs` reads `src/editor/geometry.ts` and
`src/components/Inspector.tsx` with `include_str!`, keyed to `TURN_ARROW_LENGTH`
and `TURN_DIRECTIONS`. Phases 1 and 3 **edit `geometry.ts`**, one of those two
files, so each asserts the `cargo test` count deliberately rather than assuming it.

## 3. Open questions

- **OQ-1** — **Does the segment index extend `PolylineHit`, or get its own
  helper?** `geometry.ts:nearestOnPolyline` walks every segment and returns
  `{ along, offset }`, discarding which segment won — which is exactly what Phase
  2 needs to know where to insert. Adding a third field is the smaller change and
  every existing consumer ignores it; the argument against is that `PolylineHit`
  is a shared type on the marking path, and widening it makes two subsystems share
  a shape only one of them uses. *(design call; proposed: extend it, and let the
  field be optional-free — a hit always came from some segment, so there is no
  absent case to model.)*
- **OQ-2** — **What clears a bend selection that undo invalidates?** §2.2's rule
  covers actions, but `undo` installs a whole `doc` from a snapshot, and a bend
  index valid in the current document may not be valid in the restored one. The
  four existing arms have the same hazard with a deleted id and survive it because
  `isSelected` simply never matches, which is a silent no-op; an out-of-range index
  is also a no-op, but a *stale-but-valid* index selects the wrong bend, which is
  not. *(design call; proposed: `undo`/`redo` clear a `bend` selection specifically,
  which is one line in the history path and is the only arm that needs it. Worth a
  reviewer's attention — it may be that clearing selection on undo wholesale is
  simpler and no worse.)*
- **OQ-3** — **What is the miter limit, and what happens past it?** A near-reversal
  sends `d / cos(θ/2)` to infinity, so the distance must be clamped. §2.4 fixes
  *how* (clamp along the bisector, never insert a vertex) but not *where*. A limit
  of 4 is the SVG default; a schematic that hairpins at all is unusual.
  *(answerable from code during review — the reachable turn angles are bounded by
  what a human can draw, so the question is what the clamp looks like at 170°, not
  what value is theoretically right.)*
- **OQ-4** — **How far is the drag threshold, and is it needed for nodes too?**
  §2.6 needs one for links. Nodes have never had one and nobody has reported
  littering, because a node drag starts on an existing object rather than creating
  one. *(design call; proposed: threshold on the link gesture only, ~4 screen
  pixels, settled in the app as every constant in this project has been.)*
- **OQ-5** — **Should a bend be deletable by dragging it onto its own neighbour?**
  The Delete key is the answer this spec ships. Some diagramming tools also
  collapse a bend dragged onto the line between its neighbours, which is
  discoverable but easy to trigger by accident. *(deferred by evidence: draw real
  figures after Phase 2 and see whether reaching for Delete is a nuisance.)*
- **OQ-6** — **Does the grid alone give octilinear routing, or is angle snapping
  wanted?** A dot grid makes horizontal and vertical easy and 45° accidental. The
  metro-map idiom this project cites is octilinear, which would mean snapping a
  bend so its two segments take one of eight directions — a different and larger
  rule than snapping a point. *(deferred by evidence, deliberately: this is the
  question Phase 3 exists to answer by drawing, and answering it in advance is how
  a schematic editor grows a routing engine nobody asked for.)*

## 4. Implementation phases

Strictly sequential; each is one plan-mode pass with a concrete exit gate.

### Phase 1 — The offset turns a corner

*Produces the observable: **no**, and the argument is that it is the one phase
that cannot follow the one that needs it.* No document the app can currently
produce has a bend, so nothing visibly changes. Shipped after Phase 2 it would
mean the first bend a human ever draws shows a white edge line floating 5.85 units
inside its own asphalt (§2.4) — the "visibly wrong in between" state a phase
boundary must never create. Shipped before, it changes nothing and breaks nothing.

- **Scope:** `src/editor/geometry.ts:offsetPolyline` becomes a true miter: at an
  interior vertex, offset along the normalized sum of the two segment normals by
  `d / (m · n)`, where `m` is that bisector and `n` either segment normal. End
  vertices are unchanged. **The vertex count and order must not change** (§2.4), so
  the miter limit clamps the distance along the same bisector rather than
  inserting a bevel. Name the limit as a constant beside `TAPER_MAX_BEND`. Nothing
  else moves: no consumer changes, no signature changes, no CSS.
- **Exit gate:** `bun run build` + `bun run test` green, `cargo test` unchanged
  and **asserted** (§2.8 — this phase edits `geometry.ts`).

  The assertion that actually tests this, in `geometry.test.ts`: **the
  perpendicular distance from each segment of the source polyline to the offset
  polyline is `d`**, at a right angle, at 36.87°, and at a shallow 10° turn. That
  is the invariant an offset has; the vertex-distance form is the one that encodes
  the defect (§2.4).

  Then three that pin the constraints: **a straight polyline is byte-identical**
  to today's output, since `m · n` is exactly 1 when both normals agree — which is
  what makes this phase invisible; **the vertex count is unchanged** at every turn
  angle including past the miter limit; and **a hairpin is clamped**, not infinite.

  **`geometry.test.ts`'s `offsets a bent road along its whole length` is rewritten,
  not deleted** (§2.4). It is the only shipped test that exercises a bent polyline,
  and its `toHaveLength` claim is load-bearing for Phase 2.

  A **mutation run**: reverting to the average normal must fail the perpendicular
  assertion and nothing else; a miter limit implemented by inserting a bevel vertex
  must fail the vertex-count assertion.
- **Close-out:** `rules/road-rendering.md` (the offset is a miter now, and why the
  casing was always right); the project-memory roadmap.

### Phase 2 — A bend is an object you place, drag and delete

*Produces the observable: **yes**, and it is the whole reason the spec exists.
Every figure whose roads must turn stops being a set of diagonal chords.*

- **Scope:** the fifth `Selection` arm (§2.2) and the three compile-time sites it
  breaks; `addBend` and `moveBend` in `src/editor/state.ts`, with `deleteSelection`
  growing a bend arm — **no `deleteBend` action**, on `zk-006`'s precedent, since
  the Delete key and the panel both go through `deleteSelection`. `addBend` clears
  nothing but mints the selection for the bend it just inserted; the count-changing
  rule of §2.2 is one line. `coalesceKeyFor` gains `moveBend:<link>:<index>`, so a
  drag is one undo step.

  `Canvas.tsx` gains the gesture of §2.6 — press-and-drag on a road inserts a bend
  at that segment index and drags it; press without movement still selects the
  link — plus a `bend` arm on `Drag`. The insertion index comes from the pointer's
  segment on the **drawn** polyline and applies to the **layout** polyline, which
  is valid only under Phase 1's preserved vertex count (§2.4). OQ-1 decides where
  that index comes from.

  `Diagram.tsx` draws a handle per bend, **gated on `interaction`** (§2.3), with
  its paint in `src/styles.css` rather than `diagram.css`.
- **Exit gate:** `bun run build` + `bun run test` green, `cargo test` unchanged.

  In `state.test.ts`: a bend round-trips through `addBend` at each valid index
  (start, middle, end) and lands in `linkPolyline` in the right order; `moveBend`
  moves exactly one vertex; `deleteSelection` on a bend removes that vertex and
  **leaves `doc.links` identical by reference**, since the semantic graph is
  untouched — the identity assertion `clearSignLinks` taught this repo to write,
  and the one no behavioural test can see. A drag is **one** undo step and the
  undo restores the pre-drag route.

  In `Diagram.test.tsx`: a bent link's `d` walks through the bend; handles appear
  **with** an `interaction` and the markup is **byte-identical to today without
  one**. In `export.test.ts`: an export of a bent document contains **no handle
  markup**, and `strokeAllowance` is unchanged (§2.5 — confirm, do not
  pre-emptively widen).

  Plus a `bun run dev` pass on the four consequences §2.5 predicts: a bend beside a
  junction re-aiming its arm and reshaping the pad; a bend at a waypoint
  suppressing a taper; a bend changing a `gorePair`; and a **divided** road turning
  a corner, which is where Phase 1 either shows or does not.
- **Close-out:** a new `rules/canvas-interaction.md` — the tools, the drag kinds,
  the gestures and what each one claims — which is the cross-file knowledge this
  phase finally makes worth extracting, and which no rule covers today (§2.1);
  `rules/road-rendering.md` (the polyline has interior vertices now);
  `rules/history.md` (the fifth coalescing key); the project-memory roadmap.

### Phase 3 — The grid holds

*Produces the observable: **yes**, indirectly but really. Alignment is most of
what separates a schematic from a sketch, and a figure whose corners land on a
common grid reads as deliberate. This is the phase most likely to be challenged in
round 0, and the honest defence is that it changes every figure the app makes
rather than adding a feature to one.*

- **Scope:** name the grid pitch as a constant in `geometry.ts` and have
  `Canvas.tsx`'s `<pattern>` consume it instead of the inline `LANE_PX * 4`
  (§2.7). A `snap(p)` helper, applied in `Canvas.tsx` at `addNode`, `moveNode`,
  `addSign`, `moveSign`, `addBend` and `moveBend` — **never in the reducer**
  (§2.7). A held modifier bypasses it. Markings are deliberately excluded.
- **Exit gate:** `bun run build` + `bun run test` green, `cargo test` unchanged and
  **asserted** (§2.8 — this phase edits `geometry.ts`).

  `snap` is pure and tested directly: it is idempotent, it is exact on a point
  already on the grid, and it rounds to nearest rather than truncating — which is
  the mutation that would make everything drift one way. In `state.test.ts`, the
  **reducer is unchanged**: `moveNode` with an off-grid position still writes that
  exact position, which is the assertion that pins §2.7's layer rule and the one a
  reducer-side implementation fails.

  Plus a `bun run dev` pass: place and drag a node, a sign and a bend; confirm each
  lands on a dot, the modifier reaches between dots, and an imported document —
  whose nodes are fitted to 500 units and land nowhere near the grid — is not
  disturbed until something is dragged.
- **Close-out:** `rules/canvas-interaction.md` (the snap and its layer rule); the
  project-memory roadmap. **OQ-6 is answered here or not at all** — draw a real
  figure and record whether the grid alone gets to an octilinear result.
