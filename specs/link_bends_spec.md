---
id: zk-014
title: link-bends
note: >
  A link is drawn as a straight chord between its two nodes and nothing can bend
  it — so this makes a bend an object a human places, after fixing the offset
  that would cut its corner, and puts placement on the grid that is already drawn.
status: accepted
last_updated: 2026-08-10

phases:
  - name: "Phase 1 — The offset turns a corner"
    reviewed: 2026-08-10
    shipped: 2026-08-10
    cut: null
    by: null
  - name: "Phase 2 — A bend is an object you place, drag and delete"
    reviewed: 2026-08-10
    shipped: 2026-08-10
    cut: null
    by: null
  - name: "Phase 3 — The grid holds"
    reviewed: 2026-08-10
    shipped: 2026-08-10
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
  bend — the posture `CLAUDE.md` takes under *Key Design Decisions*, "Layout is
  semi-automatic, not auto-layout".
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

**Four sites break at compile time, and all four are supposed to.** This is the
dividend of the discipline `zk-006` bought after its own `Selection` arm compiled
clean and misrouted silently in three places, because ids are bare
`type X = string`. Review compiled the proposed arm against a copy of the tree
rather than reasoning about it, and the count is four:

- `src/components/Diagram.tsx:isSelected` is `sel?.kind === kind && sel.id === id`.
  A fifth arm with no `id` makes `sel.id` a type error, which forces the decision
  rather than letting a bend silently never highlight.
- The two `never`-checked switches, `src/editor/state.ts:selectionValid` and
  `src/editor/state.ts:deleteSelection`, stop compiling until each grows an arm.
  Both reach `src/editor/state.ts:unreachable`, whose doc comment says that adding
  a `Selection` arm is exactly what it exists to catch.
- `src/components/Inspector.tsx:Inspector` — the fourth, and the one the first
  draft missed. After the `node`, `marking` and `sign` branches return, the tail
  calls `findLink(doc, selection.id)` on a selection narrowed to
  `{kind:"link"} | {kind:"bend"}`, and `.id` on that union does not compile. So
  **the panel needs a bend arm**, which Phase 2 scopes: a Bend field set naming
  the link it belongs to, with the Delete control every other selection has. The
  repo has **no test file for the Inspector**, so it is a `bun run dev` check
  rather than an automated one — `zk-007` Phase 2's precedent, which named four
  sites for the same reason and said so outright.

**An index is not a stable handle, and the rule that makes it safe is stated
rather than assumed.** Deleting bend 0 renumbers bend 1, so a selection held
across that edit points at a different bend. The invariant:

> A `bend` selection is only ever minted by the gesture that just placed or
> grabbed that bend, and **any action that changes a link's bend count clears the
> selection**. Dragging does not change the count, so a drag holds.

That is one line in each of `addBend` and `deleteSelection`, and it is cheaper and
more honest than an id. `deleteSelection` already clears, so only the insert needs
saying.

**Undo is the case the rule above does not reach, and it is not benign** (OQ-2,
resolved in review). `src/editor/state.ts:restore` installs a whole `doc` from a
snapshot and re-validates the held selection against it. The four existing arms
survive a stale id because `selectionValid` simply finds nothing and clears —
silent and correct. A stale bend *index* can still be in range, and then it names
**a different bend**, which is the one outcome no existing arm can produce. So
`undo` and `redo` clear a `bend` selection specifically. It is one line in the
history path, it is the only arm that needs it, and Phase 2 names it in scope.

### 2.3 The handles are chrome, and cannot reach a figure (decision, recorded)

A bend needs something to grab. That something must not appear in an exported
figure, and the mechanism already exists and is load-bearing:
`src/editor/export.tsx:diagramInner` renders `<Diagram doc={doc} />` with **no**
`interaction` prop, so anything gated on `Interaction` is absent from an export by
construction rather than by a filter someone must remember.
`Diagram.tsx:hairline` is the shipped precedent for a visual that differs between
canvas and file, and `RoadShape`'s hit path and halo are the precedent for chrome
that exists only on the canvas. (`zk-010`'s stage preview was designed against this
same mechanism, but that spec is `abandoned` and none of it shipped, so it is not
cited as one.)

So bend handles are rendered only when `interaction` is present. **The gate needs
one more step than "assert no handle markup"**: `export.test.ts` matches chrome
with a `CHROME` regex, and an assertion that reuses it unchanged passes for a
handle whose class it never listed. The class goes into `CHROME` as part of the
phase.

### 2.4 A corner is drawn by two mechanisms and neither has ever run (decision, recorded)

**This is the constraint that makes the spec three phases instead of one**, and
the first draft got it half right: it found the offset bug and asserted the paint
was fine. Review measured the stylesheet and it is not.

Every road element is a **stroked polyline**, so a corner's appearance is decided
twice over — by where `offsetPolyline` puts each element's centreline, and by how
SVG joins that element's own stroke at the vertex. Both are wrong today, in
opposite directions, and both are invisible because **no document the app can
produce has an interior vertex at all.**

**The offset.** `src/editor/geometry.ts:offsetPolyline` steps each vertex along
the **average of its two segment normals** at distance `d`. Its doc comment is
already candid: *"Good enough for the gentle bends a schematic uses; not a true
miter offset at sharp corners."* The correct distance along that bisector is
`d / cos(φ/2)` for a turn of `φ`, so using `d` puts every offset vertex short and
the line cuts the corner.

**The join.** `src/styles/diagram.css:.road-casing` sets `stroke-linejoin: round`,
while `.road-edge`, `.road-divider` and `.lane-band` **declare no join at all** and
so take SVG's default, `miter`. The asphalt and the paint on it are set to round
and mitre the same corner. That property is as dead as `bends` is — a join fires
only at an interior vertex — so it has never been seen to disagree with anything.

Worked at a right-angle bend on a 2-lane arterial (`LANE_PX` 9, `ROAD_MARGIN` 3 →
`roadWidth` 21, casing half-width 10.5, `RoadShape`'s `edgeInset` = `w/2 − 1.5` =
9, and a divided carriageway at `w/2 + SCHEMATIC_MEDIAN/2` = 13.5). All distances
are from the vertex along the bisector:

| | today | offset fixed, join left alone | both fixed |
|---|---|---|---|
| Outer asphalt edge | 10.5 (round arc) | 10.5 | **14.85** (miter) |
| Inner asphalt edge | 14.85 | 14.85 | 14.85 |
| Edge line, either side | 9 | **12.73** | 12.73 |
| **Outer**: paint vs asphalt | 1.5 inside ✓ | **2.23 outside ✗** | 2.12 inside ✓ |
| **Inner**: paint vs asphalt | **5.85 inside ✗** | 2.12 inside ✓ | 2.12 inside ✓ |

So the real defect is on the **inside** of the turn — 5.85 units of asphalt
overhanging a white line that should sit 1.5 from its edge — and the outside
happens to look right today by accident, because rounding the casing at 10.5 and
under-offsetting the paint to 9 leave a plausible 1.5 between them. **Fixing the
offset alone inverts it**: the paint lands 2.23 units *outside* the rounded
asphalt, a white line hanging off the corner into bare paper. That is a new
artefact, and it is why Phase 1 changes the stylesheet too.

`offsetPolyline` has **five** consumers and every one inherits the first bug: the
two edge lines, the lane bands and the dividers (`Diagram.tsx:RoadShape`),
`geometry.ts:drawnPolyline`, and a `lane_line` marking's spine and its double
(`geometry.ts:laneLine`). Only `.road-casing` carries the second.

**The two limits must be the same number, which is what makes 4 the answer rather
than a taste** (OQ-3). SVG bevels a join once `miterLength / strokeWidth` exceeds
`stroke-miterlimit`, and that ratio is `1 / sin(ι/2)` for an included angle `ι` —
identical to this section's `1 / cos(φ/2)`, since `ι = 180° − φ`. So clamping the
offset factor at SVG's default limit of **4** makes the paint and the asphalt
change behaviour at the same angle, 28.96°.

**The fix must not change the vertex count**, and that is a cross-phase constraint
rather than an implementation taste. Phase 2 inserts a bend at the segment index
the pointer landed on, measured against the **drawn** polyline, and applies it to
the **layout** polyline; that transfer is valid only because `offsetPolyline`
preserves vertex count and order, which the shipped test asserts
(`expect(drawn).toHaveLength(spine.length)`). So past the limit the offset clamps
its **distance along the same bisector** and never inserts a bevel vertex — where
SVG, past its own limit, does bevel. The two therefore diverge below 28.96°, which
is accepted: a hairpin that sharp is not a road this project draws, and the
alternative costs the index correspondence Phase 2 is built on.

**Two degeneracies have no bisector at all, and the clamp does not cover them.**
At an exact 180° reversal `n₁ + n₂ = 0`, and the `Math.hypot(…) || 1` guard **in
`offsetPolyline`'s own interior-vertex branch** — not `segmentNormals`', which
guards segment length — yields `m = (0,0)`, so `d / (m · n₁)` is `Infinity` and the
emitted path carries `NaN`. A zero-length segment gives that segment a `(0,0)`
normal, so `m · n₁ ≠ m · n₂` and "either normal" stops being interchangeable.
Phase 1 therefore states a **direction** fallback as well as a distance clamp, and
Phase 3 is what makes an exact reversal reachable — snapping a dragged bend back
onto its own segment.

**A shipped assertion encodes the offset defect, and is named here so it is not
"repaired" by weakening it.** `geometry.test.ts`'s `offsets a bent road along its
whole length` asserts `distance(spine[i], drawn[i])` is `OFFSET_2` **for every
vertex, the interior bend included** — the average-normal behaviour written down
as if it were the invariant. Its fixture turns 36.87°, where the true factor is
1.0541, so the fix moves that vertex from 13.5 to 14.23 and the test fails. The
replacement asserts what is actually invariant: the perpendicular distance from
each segment's **infinite line** is `d`. The word matters — a clamped
point-to-*segment* distance reports 12.73 at a right-angle corner and would fail a
correct implementation.

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
have: today every drag begins on pointer-down. A few pixels of movement before a
bend is minted is what keeps an ordinary selecting click from littering the
document with zero-length bends. The threshold is measured in **screen** pixels,
not world units, or it changes meaning with zoom.

**The pointer is on the drawn polyline; the bend belongs to the layout one, and
the first draft left that gap open** (decision, recorded). §2.4 argues carefully
that the *segment index* transfers between the two frames and says nothing about
the *point*, which review caught: on a divided road the two are `lateralShift`
apart — 13.5 units for a default two-lane pair, 9 for an aligned one — so storing
the raw pointer position steps the whole road sideways the instant the bend is
minted. The resolution needs no new arithmetic, only the right two helpers:

> **On insert, the bend goes on the road, not under the pointer.** Take the
> pointer's arc length along the **drawn** polyline
> (`geometry.ts:nearestOnPolyline`), convert it to the **layout** polyline's frame
> — `along / polylineLength(drawn) × polylineLength(layout)`, the same conversion
> `Canvas.tsx:projectOntoLink` already does for metres, since
> `geometry.ts:pointAlongPolyline` takes an absolute length rather than a fraction
> — and place the bend there. The road does not move at all on insert, which is the
> correct feel: pressing a road and pulling it should bend it, not shift it.
>
> **The index comes from that same walk, and taking it from anywhere else is a
> defect** — the round-2 fix above introduced exactly that and review caught it.
> The two frames put an interior vertex at *different fractions* of arc length,
> because offsetting lengthens the outer segment and shortens the inner one
> asymmetrically. On layout `A(0,0) → B(50,0) → C(50,150)` at `d` 13.5, the drawn
> polyline is `(0,13.5) → (36.5,13.5) → (36.5,150)`, so the bend sits at fraction
> **0.211** drawn against **0.250** layout. A press at drawn length 40 is on drawn
> segment **1**, while the transfer resolves to layout length 46.24 — a point on
> layout segment **0**. Splice that point at index 1 and the route becomes
> `(0,0) → (50,0) → (46.24,0) → (50,150)`: the road runs east past the corner,
> doubles back 3.76 units, and leaves. A spike, not a moved road, in a band about
> 6.75 drawn units either side of every existing bend — wider than a handle's own
> hit radius.
>
> So `pointAlongPolyline` returns the segment it landed on, and the insert uses
> that. One walk, one answer, and the two cannot disagree by construction. **It
> must be the polyline's own segment index, not the position in that function's
> local `segments` array**, which `continue`s past zero-length segments — a link
> carrying a duplicate bend would otherwise splice one place off.
>
> **Then the drag carries a grab offset**, exactly as a node and a sign do — the
> `offX`/`offY` on `Canvas.tsx:Drag`, whose doc comment already explains that a
> node is "dragged *by* the point you took hold of". The offset is captured at
> insert, so there is no jump at the moment the drag begins either.

**Phase 3 narrows the "does not move at all" claim by up to half a grid cell**,
since it snaps `addBend` too. That is harmless — the insert is immediately
followed by the drag in the same gesture, so nothing is ever seen at the
unsnapped position — but the invariant is exact only for Phases 1–2 and the
qualifier belongs here rather than being discovered later.

Grabbing an **existing** bend takes the same path with the insert step skipped,
and the handle is drawn at the *drawn* polyline's vertex so that what you grab is
what you see. This is why Phase 2 scopes an `Interaction` callback and a
`Canvas.tsx` handler for the handle and not merely a rendered dot: without one, a
bend cannot be re-selected after release and so cannot be deleted in the app.

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
| The miter offset, its clamp and its fallback | `src/editor/geometry.ts:offsetPolyline` | ✅ vitest |
| The casing's line join | `src/styles/diagram.css:.road-casing` | ✅ `export.test.ts:embeddedCss` — this one **does** reach a figure |
| The segment index an insert lands on | `src/editor/geometry.ts` (§2.6, OQ-1) | ✅ vitest |
| `addBend` / `moveBend`, the `Selection` arm, the delete arm, the undo clear | `src/editor/state.ts` | ✅ vitest |
| The drag, the threshold, the frame transfer, the snap | `src/components/Canvas.tsx` | — `bun run dev` |
| The handles | `src/components/Diagram.tsx`, gated on `Interaction` | ✅ `renderToStaticMarkup` |
| Their grab callback | same, but **`renderToStaticMarkup` cannot see a prop** — `bun run dev` |
| The panel's bend arm | `src/components/Inspector.tsx` | — **no test file exists**; `bun run dev` |
| Handle paint | `src/styles.css` — **chrome**, not `diagram.css`, since none of it reaches an export |
| The grid constant and the dot's placement | `src/editor/geometry.ts`, consumed by `Canvas.tsx` | ✅ vitest |

**No phase touches Rust**, so `cargo test` must come out unchanged at each gate —
but *not* for the obvious reason, and the exception is live here:
`src-tauri/src/network/import.rs` reads `src/editor/geometry.ts` and
`src/components/Inspector.tsx` with `include_str!`, keyed to `TURN_ARROW_LENGTH`
and `TURN_DIRECTIONS`. **All three phases edit one of those two files** — Phases 1
and 3 `geometry.ts`, Phase 2 both — so each asserts the `cargo test` count
deliberately rather than assuming it. Neither parse can be perturbed by anything
planned here, which is a reason to state the assertion, not to skip it.

**Phase 1 is the one phase whose edit reaches an exported figure through the
stylesheet**, since `diagram.css` travels inside every export. That is why the
join is tested through `export.test.ts` rather than treated as canvas chrome.

## 3. Open questions

- **OQ-1** — **Does the segment index extend `PolylinePoint`, or get its own
  helper?** **The question moved in review and the movement is the point**: the
  draft asked about `nearestOnPolyline`'s `PolylineHit`, on the assumption that the
  insertion index is the **drawn** polyline's segment. It is not — §2.6 shows the
  two frames disagree — so the index Phase 2 needs comes out of
  `geometry.ts:pointAlongPolyline`, which walks the **layout** polyline and already
  knows which segment consumed the remaining length before discarding it. Adding a
  field to `PolylinePoint` is the smaller change; the argument against is that it
  is a shared type on the marking path, and widening it makes two subsystems share
  a shape only one uses.

  Two traps recorded so neither is re-derived. **The index must be the polyline's
  own**, not the position in that function's local `segments` array, which
  `continue`s past zero-length segments. And **the first draft's argument for a
  non-optional field was refuted**: "a hit always came from some segment" is false —
  both walkers skip degenerate segments, and `nearestOnPolyline` returns its seed
  `{along: 0, offset: 0}` when every segment is degenerate, while
  `pointAlongPolyline` returns `undefined`. *(design call; proposed: extend
  `PolylinePoint`, non-optional — `undefined` already models the no-walk case there,
  which is the difference from `PolylineHit` that made the draft's claim false.)*
- **OQ-2 — RESOLVED in review: `undo`/`redo` clear a `bend` selection.** ~~What
  clears a bend selection that undo invalidates?~~ Answered in §2.2, and it had to
  be: `selectionValid` is a `never`-checked switch, so Phase 2 cannot compile
  without deciding it. A stale-but-in-range index selects a *different* bend, which
  is the one failure no existing arm can produce, so the narrow fix beats clearing
  the selection wholesale. Phase 2 names the line in scope.
- **OQ-3 — RESOLVED in review: the limit is 4, and it is not a taste.** ~~What is
  the miter limit, and what happens past it?~~ SVG bevels once
  `miterLength / strokeWidth` exceeds `stroke-miterlimit`, and that ratio is
  `1 / sin(ι/2)` — the same quantity as §2.4's `1 / cos(φ/2)`. So clamping the
  offset factor at SVG's **default of 4** makes the paint and the asphalt change
  behaviour at the same angle, 28.96°, which no independently chosen number would.
  Past it the two differ in *kind* — the offset clamps, SVG bevels — and that is
  accepted in §2.4 for the reason given there. Phase 1 names the constant and sets
  `stroke-miterlimit` explicitly beside the join, so the number is written once.
  *(was: answerable from code. Answered from the SVG stroke rules and the
  stylesheet, which is what §4 asks of a code-answerable question.)*
- **OQ-4** — **How far is the drag threshold, and is it needed for nodes too?**
  §2.6 needs one for links. Nodes have never had one and nobody has reported
  littering, because a node drag starts on an existing object rather than creating
  one. *(design call; proposed: threshold on the link gesture only, ~4 screen
  pixels, settled in the app as every constant in this project has been. Phase 2's
  dev pass is what checks it, since there is no `Canvas.test.tsx` and an
  implementation that mints on pointer-down would otherwise pass the whole gate.)*
- **OQ-5** — **Should a bend be deletable by dragging it onto its own neighbour?**
  The Delete key is the answer this spec ships. Some diagramming tools also
  collapse a bend dragged onto the line between its neighbours, which is
  discoverable but easy to trigger by accident. *(deferred by evidence: draw real
  figures after Phase 2 and see whether reaching for Delete is a nuisance.)*
- **OQ-6 — RESOLVED by drawing in Phase 3: the grid alone gets there, and no
  angle snapping is wanted.** ~~Does the grid alone give octilinear routing?~~
  §1's own figure — a motorway west–east and an offramp turning south into a
  roundabout — came out on the first attempt as `M 432 180 L 648 180 L 648 540`,
  a square corner, because both endpoints were already on the lattice and the
  bend went at the intersection of one endpoint's row with the other's column.
  That is the whole idiom: the grid makes an orthogonal corner **reachable and
  exactly repeatable**, and a human chooses it rather than having it imposed.
  What the grid deliberately does not do is snap an *angle* — a bend between two
  dots sharing neither a row nor a column takes whatever angle they imply (26.57°
  was measured on one). Snapping the angle instead would move the vertex off the
  lattice to honour a direction, which is a router's job and the non-goal §1.1
  names. *(was: deferred by evidence. Answered by drawing, which is what the
  phase existed to do.)*

## 4. Implementation phases

Strictly sequential; each is one plan-mode pass with a concrete exit gate.

**The sizing was challenged in review and confirmed, which is recorded so a later
round does not re-open it.** Phase 2 is large — a `Selection` arm, two actions, a
delete arm, a coalescing key, a canvas gesture with a threshold, a rendered handle
and a panel arm — but two shipped phases in this repo are the same shape and each
landed as one pass: `zk-007` Phase 2 ("a sign exists: place, select, drag,
delete") and `zk-006` Phase 1. The seam that looks available is the handle, and it
is rejected for the reason §2.6 gives: a bend that can be created but not grabbed
cannot be deleted in the app. Phase 1 is small for a phase, and earns separation on
the "visibly wrong in between" argument rather than on size.

### Phase 1 — The offset turns a corner

*Produces the observable: **no**, and the argument is that it is the one phase
that cannot follow the one that needs it.* No document the app can currently
produce has an interior vertex, so neither the offset nor the join has ever run
and nothing visibly changes. Shipped after Phase 2, the first bend anyone draws
shows 5.85 units of asphalt overhanging its own edge line on the inside of the
turn (§2.4) — the "visibly wrong in between" state a phase boundary must never
create. Shipped before, it changes nothing and breaks nothing.

- **Scope, and it is both halves of §2.4's corner.**

  1. `src/editor/geometry.ts:offsetPolyline` becomes a true miter: at an interior
     vertex, step along the normalized sum of the two segment normals by
     `d / (m · n₁)`, where `m` is that bisector and `n₁` the **first** segment's
     normal — named rather than "either", because a zero-length segment makes them
     differ (§2.4). End vertices are unchanged.
  2. **The clamp and the fallback are different mechanisms and both are needed.**
     The *distance* clamps at a factor of 4, a constant named beside
     `TAPER_MAX_BEND` (OQ-3). The *direction* needs its own fallback where there is
     no bisector: when `n₁ + n₂` is near zero — an exact reversal — use `n₁`, so
     the vertex is offset by `d` along one segment's normal rather than emitting
     `NaN` (§2.4). That is **not** today's behaviour, which offsets such a vertex
     by nothing at all; it is finite and sane, which is the whole requirement. The
     "near zero" threshold is the implementer's, and safely so — the factor-4
     clamp already covers every angle that is not an exact reversal.
     **The vertex count and order must not change** (§2.4), so the clamp never
     inserts a bevel vertex.
  3. `src/styles/diagram.css:.road-casing` changes `stroke-linejoin: round` to
     `miter` with an explicit `stroke-miterlimit: 4`, so the asphalt and the paint
     on it agree at a corner and the limit is written once (§2.4, OQ-3).
     `stroke-linecap: round` is untouched — that is about a road's ends, and
     `.road-casing--butt` depends on it.

  Nothing else moves: no consumer changes and no signature changes.
- **Exit gate:** `bun run build` + `bun run test` green, `cargo test` unchanged
  and **asserted** (§2.8 — this phase edits `geometry.ts`).

  The assertion that actually tests this, in `geometry.test.ts`: **the
  perpendicular distance from each segment's infinite line to the offset polyline
  is `d`**, at a right angle, at 36.87°, and at a shallow 10° turn. The word
  *infinite* is load-bearing — a clamped point-to-segment distance reports 12.73 at
  a right angle and fails a correct implementation (§2.4).

  Then the constraints. **This phase is invisible because every polyline the app
  can currently produce is 2-point** — that, not a float identity, is the claim to
  assert: a 2-point polyline is byte-identical, and a *collinear* multi-point one
  is `toBeCloseTo` rather than exact, because `m · n₁` lands 1 ± 1 ULP on a
  diagonal and `polylinePath` does no rounding. Then: **the vertex count is
  unchanged** at every turn angle including past the limit; **a reversal is finite,
  not `NaN`**; and **a hairpin is clamped at 4**.

  **`geometry.test.ts`'s `offsets a bent road along its whole length` is rewritten,
  not deleted** (§2.4). It is the only shipped test that exercises a bent polyline,
  and its `toHaveLength` claim is load-bearing for Phase 2.

  In `export.test.ts`, the join is asserted **positively** —
  `expect(embeddedCss(svg)).toContain("stroke-linejoin: miter")`, using the helper
  that file already has. "The existing paint assertions still hold" is not a gate
  for this: they cannot fail if the CSS edit is simply skipped, which is the
  vacuous-gate shape this project mutation-tests for. `diagram.css` travels inside
  every exported file (`export.tsx` imports it `?raw`), so the stylesheet edit
  reaches the figure and is not a canvas concern.

  A **mutation run**: reverting to the average normal must fail the perpendicular
  assertion and nothing else; a limit implemented by inserting a bevel vertex must
  fail the vertex-count assertion; and dropping the reversal fallback must fail the
  `NaN` assertion.
- **Close-out:** `rules/road-rendering.md` — **regenerated within its cap, not
  appended to**: it is at 250/250 today, so the offset and the join go in by
  trading prose, and the cap moves only if the rule genuinely gains a mechanism
  (`zk-013` Phase 2's precedent). `rules/road-joints.md` (243/245) describes joints
  whose inputs can now bend and may want a line. The project-memory roadmap.

### Phase 2 — A bend is an object you place, drag and delete

*Produces the observable: **yes**, and it is the whole reason the spec exists.
Every figure whose roads must turn stops being a set of diagonal chords.*

- **Scope:** the fifth `Selection` arm (§2.2) and the **four** compile-time sites
  it breaks, the Inspector's bend arm included; `addBend` and `moveBend` in
  `src/editor/state.ts`, with `deleteSelection` growing a bend arm — **no
  `deleteBend` action**, on `zk-006`'s precedent, since the Delete key and the
  panel both go through `deleteSelection`. `addBend` mints the `LinkView` if the
  link has none — `bends` is optional, and while `state.ts:completeLink` and import
  both always write a view, a hand-edited or normalized document need not carry
  one — and mints the selection for the bend it just inserted;
  the count-changing rule of §2.2 is one line. `restore` clears a `bend` selection
  on undo and redo (§2.2, OQ-2).

  **`coalesceKeyFor` gives `addBend` and `moveBend` the same key**,
  `bendDrag:<link>:<index>` — the ninth key, and the fourth drag. The obvious
  reading, keying only `moveBend`, does **not** give one undo step: `addBend` would
  carry a `null` key and push its own snapshot, so the first `moveBend` pushes a
  second, and one undo lands on the bend-inserted-but-unmoved document. The insert
  opens the run instead.

  `Canvas.tsx` gains the gesture of §2.6 — press-and-drag on a road inserts a bend
  and drags it, press without movement still selects the link, with the threshold
  in screen pixels (OQ-4) — plus a `bend` arm on `Drag` carrying `offX`/`offY`. The
  inserted **point and index both come from §2.6's single walk of the layout
  polyline**, never from the raw pointer and never from the drawn polyline's own
  segment — the two frames disagree once a link already has a bend, and splicing at
  the drawn index puts a spike in the road (§2.6). That transfer is valid only
  under Phase 1's preserved vertex count (§2.4). OQ-1 is what carries the index
  back out of `pointAlongPolyline`.

  `Diagram.tsx` draws a handle per bend at the **drawn** polyline's vertex,
  **gated on `interaction`** (§2.3), with an `Interaction` callback so it can be
  grabbed — a rendered dot alone leaves a bend unselectable after release and so
  undeletable. Its paint goes in `src/styles.css`, not `diagram.css`.
- **Exit gate:** `bun run build` + `bun run test` green, `cargo test` unchanged and
  **asserted** — this phase edits `Inspector.tsx` *and* `geometry.ts`, both
  `include_str!`-coupled (§2.8).

  In `geometry.test.ts`, **the assertion that catches §2.6's spike**, and it has to
  be written against the *second* bend because the first cannot fail: on the
  worked fixture `A(0,0) → B(50,0) → C(50,150)` at `d` 13.5, a press at drawn arc
  length 40 resolves to layout segment **0**, not the drawn segment 1 — so the
  helper that yields the insertion index reports 0 there. Phase 2's other gate
  items all feed `addBend` an index directly and none of them can see this; the
  dev pass cannot either, since its divided-road case is a *first* bend, where the
  two frames agree by construction.

  In `state.test.ts`: a bend round-trips through `addBend` at each valid index
  (start, middle, end) and lands in `linkPolyline` in the right order; **a second
  bend inserted before an existing one leaves a route with no reversal** — every
  segment's direction has a non-negative dot with the one before it, which is the
  behavioural form of the same spike. (On the axis-aligned fixture the correct
  route's dots are exactly 1 and 0; a non-axis-aligned one wants a small epsilon.)
  `addBend` on a link with no `LinkView` mints one; `moveBend` moves exactly one
  vertex;
  `deleteSelection` on a bend removes that vertex and **leaves `doc.links`
  identical by reference**, since the semantic graph is untouched — the identity
  assertion `clearSignLinks` taught this repo to write, and the one no behavioural
  test can see. A press-drag-release is **one** undo step —
  `expect(dragged.past).toHaveLength(start.past.length + 1)`, the shipped idiom —
  and that undo restores the pre-drag route. Undo with a bend selected clears the
  selection.

  In `Diagram.test.tsx`: a bent link's `d` walks through the bend; handles appear
  **with** an `interaction` and, without one, the markup **does not match the
  handle's class** — the repo has no snapshot testing, so `not.toMatch` is the
  expressible form, not "byte-identical".

  In `export.test.ts`: **the handle's class is added to that file's `CHROME`
  regex**, and an export of a bent document does not match it. Reusing `CHROME`
  unchanged makes the assertion pass for a handle that leaks straight into the
  figure, which is the vacuous-gate failure this project mutation-tests for.
  `strokeAllowance` is unchanged (§2.5 — confirm, do not pre-emptively widen).

  A `bun run dev` pass covering **both** the mechanisms with no test surface and
  the consequences §2.5 predicts. The mechanisms: a click with no movement selects
  the link and adds **no** bend, while a few pixels of movement mints one (OQ-4 —
  an implementation minting on pointer-down, which is what every other drag in
  `Canvas.tsx` does today, passes every automated assertion above); **grabbing an
  already-placed bend, moving it, and deleting it**, since `renderToStaticMarkup`
  can see a rendered handle but not whether it carries a callback, so a handle with
  no grab passes everything above; and the Inspector's bend arm, which has no test
  file at all. The consequences: a bend
  beside a junction re-aiming its arm and reshaping the pad; a bend at a waypoint
  suppressing a taper; a bend changing a `gorePair`; and a **divided** road turning
  a corner, which is where Phase 1 and §2.6's frame transfer either show or do not.
- **Close-out:** a new `rules/canvas-interaction.md` — the tools, the drag kinds,
  the gestures and what each one claims — which is the cross-file knowledge this
  phase finally makes worth extracting, and which no rule covers today (§2.1);
  `rules/road-rendering.md` (the polyline has interior vertices now);
  `rules/history.md` — the **ninth** coalescing key and the fourth drag, and
  **regenerated within its cap**, which is 160/160 today (§2.8's close-out rule,
  `zk-013` Phase 2's precedent); the project-memory roadmap.

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
  (§2.7). **Alt bypasses it**, named here rather than left to the implementer.
  Markings are deliberately excluded.

  **The drawn dots are not on the lattice the snap would use**, which review
  measured and which would make the whole phase read as broken. The `<pattern>`
  places its `<circle>` at `cx`/`cy` `0.5` **screen** pixels inside a cell anchored
  at `(view.tx, view.ty)`, so a dot sits at world `36i + 0.5/k` while
  `round(p / 36) * 36` lands on `36i` — half a screen pixel off a dot of radius
  0.9, at every zoom.

  **Move the tile, not the dot**, and this is worth stating because the obvious fix
  is wrong: a `<pattern>` clips its content to its own tile (`overflow` defaults to
  hidden), so putting the circle at the tile origin renders **a quarter of a dot** —
  the other three quadrants do not arrive from the neighbouring tiles, which draw
  their own. Instead keep the circle centred in the tile and shift
  `patternTransform` back by half a cell, which puts the whole dot on the lattice
  the snap uses. (Today's `(0.5, 0.5)` is already slightly clipped, which is why
  this is easy to miss.)
- **Exit gate:** `bun run build` + `bun run test` green, `cargo test` unchanged and
  **asserted** (§2.8 — this phase edits `geometry.ts`).

  `snap` is pure and tested directly: it is idempotent, it is exact on a point
  already on the grid, and it rounds to nearest rather than truncating — which is
  the mutation that would make everything drift one way.

  In `state.test.ts`, the **reducer is unchanged**, and the assertion covers **all
  four** placement actions, not just one: `addNode`, `moveNode`, `addSign` and
  `moveSign` each still write the exact off-grid position they are given. Covering
  `moveNode` alone lets a reducer-side snap in any of the other three pass, which
  is precisely the layer violation §2.7 exists to forbid.

  Plus a `bun run dev` pass: place and drag a node, a sign and a bend; confirm each
  lands **on a dot** — checkable now that the dot is on the lattice — that Alt
  reaches between dots, and that an imported document, whose nodes are fitted to
  500 units and land nowhere near the grid, is not disturbed until something is
  dragged.
- **Close-out:** `rules/canvas-interaction.md` (the snap and its layer rule); the
  project-memory roadmap. **OQ-6 is answered here or not at all** — draw a real
  figure and record whether the grid alone gets to an octilinear result.
