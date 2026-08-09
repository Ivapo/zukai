---
title: road-markings
sources:
  - src/App.tsx
  - src/components/Canvas.tsx
  - src/components/Inspector.tsx
  - src/components/Toolbar.tsx
  - src/editor/geometry.ts
  - src/editor/state.ts
  - src/model/types.ts
  - src/styles.css
  - src-tauri/src/model/decoration.rs
covers: >
  the marking as an object a human owns: the anchor and the one metre/unit
  boundary, the rim an end anchor measures to, placement from the click, the
  importer as second author, dragging, the kind-aware controls, what removes a
  marking, and the third Selection arm
max_lines: 250
generated: 2026-08-09
---

# Road markings

The marking as an **object a human owns**: where it sits, how it got there, how
it moves and is edited, and what deletes it. What each kind *paints* is
`rules/marking-kinds.md`, which starts from the anchor this rule defines.
Almost entirely frontend — `Marking` and `MarkingKind` have been in the model since
the first commit, and the two fields added since (`Marking.anchor`,
`TurnArrow.back`) are optional and elided at their defaults, so nothing here has
ever moved `SCHEMA_VERSION`. **That is the pattern, not a coincidence:** a new
optional *field* costs no bump where a new enum *variant* would, which is why the
second head is a field and not a pair of `TurnDirection`s. Rationale:
`specs/road_markings_spec.md`; for the anchor, `specs/lane_arrows_spec.md`.

## The anchor, and the one place metres become units

`Marking` is `{ id, link, position, anchor?, lane?, kind }`.

- **`position` is metres**, and stays metres. A schematic link has no length in
  metres, but the field is documented against Assimilator's `crossings` positions,
  and the alternatives (a fraction, or a second presentation-side position) either
  make `decoration.rs` lie or create two sources of truth.
- **`anchor` absent means `start`** — which end those metres are measured from. A
  plain defaulted enum rather than an `Option`, `LinkAlign`'s shape.
- **`lane` absent means the whole carriageway**, stored as an *absent* key.

The metre/unit boundary is exactly two functions, and no third site converts:
`projectOntoLink` (`Canvas.tsx`) turns world units into metres, `markingAnchor`
(`geometry.ts`) turns metres back. `projectOntoLink` is what placement and
dragging **share**, which is what keeps that count at two.

**The frame flip lives inside those same two functions.** `anchoredAlong(total,
distance, anchor)` is `total - distance` for an `end` anchor and untouched for a
`start` one — **its own inverse**, so no two expressions can disagree about which
subtracts. At the drag's call site it would be a third site that knows the frame,
re-deriving the polyline per pointer-move for `total`. `total` is
`polylineLength`, skipping sub-`SAME_EDGE` segments exactly as
`pointAlongPolyline` does — what makes the drag's round trip exact.

### The far end is the glyph's rim, not the node

An `end`-anchored marking measures to `rimClearance(doc, link, offsets)` past the
polyline's end. The node is *inside* the junction it names, and the pad around it
is opaque and painted **over** this layer — so paint measured to the node is paint
measured where it cannot be seen. Measured on an imported `cross-4`: every arrow's
head sat 17.5 units from the node against a pad of `r = 24`; after the rim, 36.0 —
one arrow-length of clear road beyond it, which is what the setback means. How the
rim is derived, and the two other things that measure to it, is
`rules/road-joints.md`. Four consequences are this rule's:

- **It is the same expression the glyph's own stop bar uses**, so paint a human
  places and paint a glyph draws cannot disagree about where the road meets it.
- **The clearance is added to the distance, not subtracted from the total**, so
  the clamp still catches an over-long marking at the polyline's *start*.
- **It comes off the arm's own carriageway.** `Arm.origin` **is** the drawn
  polyline's end point, so the ray distance and the arc-length walked back are the
  same number, and a divided approach gets its own half's clearance. An undivided
  arm sits at `(0, 0)` and clears exactly the radius — the one case that *cannot*
  catch a dropped translation, so the test that does uses a divided road.
- **`start` takes no such term**: nothing asked for one, and adding it would move
  the paint in every document already saved.

`junctionRadius` excludes what has no radius to give: a non-junction node, a
`gore`, a junction with no arms. **A roundabout is deliberately *not* excluded**,
though the obvious list to reach for excludes it — that list came from a `pad`
gate written for the drawn movement arcs, whose reason (an arc on a roundabout is
a chord across its own island) an anchor never had; a ring buries an approach
arrow exactly as a pad does. **A list copied from another feature's gate carries
that feature's reasons**; check them before inheriting.

**Nothing tests the drag's half of it** — `Canvas.tsx` has no test file and the
`anchor` argument is optional, so dropping it at the call site compiles and the
whole suite passes (mutation-checked). The gesture is a dev-pass check.

**Consequences of absolute metres, stated rather than discovered:** dragging a
node shortens the road under its markings, so a **start**-anchored marking sits
proportionally further along, and one whose metres exceed the drawn length is
**clamped to the end furthest from its own anchor** — an end-anchored one resolves
to a *negative* distance and piles up at the start. Verified in the app:
shortening a 600-unit road to 350 moved a mid-road stop line to 86% along, still
on asphalt in its lane. **An `end` anchor is the half-answer to OQ-6** ("should a
marking follow the road when a node is dragged?"): it can now, if it says so. It
also gives **OQ-1** a cheaper answer — reversing a link can flip its markings'
anchors instead of remapping every `position`.

## Placement: the click carries everything, so there is no dialog

`Tool` gains `"marking"` (toolbar button, `TOOL_KEYS` entry `m`), and **a placed
marking is always a `stop_line`** — `addMarking` takes no kind argument. Both
remaining fields come from the one click: **how far along**, from
`nearestOnPolyline` over the *drawn* polyline, which already carries the
carriageway offset and the alignment shift; and **which lane**, from that same
call's **signed** `offset` matched against `laneBands`. Lane 0 is nearside at the
most *positive* offset, so a magnitude would put every click in the nearside half.
A click outside every band — the casing lip, or the invisible hit path — is
`lane: undefined`, and **that fallback is a side door, not the route to a
carriageway-wide marking**, which is what the Span control is for.

## Paint has a second author, and it is the importer

Importing a `network.yaml` mints one `turn_arrow` per approach lane from the
movements' `from_lanes` (`rules/network-yaml.md`). Three things matter:

- **They are ordinary markings.** No live binding, no re-derivation, no flag:
  select, drag, repaint, re-span or delete, and nothing puts them back.
- **They arrive `anchor: "end"`**, which is the only reason that field exists. An
  imported arm is over a thousand units long and about to be dragged into shape;
  start-anchored paint would drift off the junction on the first drag.
- **They are the first paint nothing clicked into place**, so failures the hand
  path rules out by construction have to be ruled out arithmetically instead:
  `kerb_lane` returns an `Option` and an out-of-range index is skipped rather than
  clamped onto a lane the file never named.

`position` is `8.75 m` (`1.5 × TURN_ARROW_LENGTH`, converted), measured to the rim.

## Dragging: the same projection, pointed at a marking that exists

Under the select tool a marking is grabbed and slid along its road
(`onMarkingPointerDown` → the fourth `Drag` arm → `moveMarking`). Five decisions:

- **A drag carries no grab offset**, unlike a node's or a sign's: it re-projects
  **absolutely**. The cost is a jump of up to half the 12-unit hit strip on
  pick-up. What it buys is the case an import creates — a marking whose metres
  exceed its drawn road is clamped to the end, and only an absolute drag brings it
  back. Measured: a stop line stored at 213.9 m on a 150-unit road came back to
  11.7 m in one drag.
- **It writes `lane` as well as `position`**, so crossing a divider moves the
  paint; a drag that crossed one without changing lanes would be the surprise.
- **The `position` it writes is in the marking's own frame**, which is what
  `marking.anchor` is passed down for. Report a start-frame distance for an
  end-anchored marking and the paint mirrors about the road's midpoint and tracks
  the pointer *backwards*.
- **The lane a drag resolves to is kind-aware, and this is the one place it is.**
  `bandAt` answers for every kind but a `lane_line`, whose `lane` names one of
  `n-1` **boundaries**; `boundaryAt` answers for that one. Matching a lane line
  against the bands can name `n-1`, which draws *nothing* — invisible,
  unselectable, recoverable only by undo (`rules/marking-kinds.md`). The branch
  lives in `Canvas.tsx`, never the reducer.
- **`moveMarking` returns `state` by identity on a same-place drag**, which
  `moveNode` and `moveSign` do not: many neighbouring pixels project to one
  `(position, lane)`, and without it the document dirties for nothing.

## Editing: seven controls, all kind-aware

Three that every marking has — the kind picker, labelled **Paint**
(`setMarkingKind`), a **Span** control (`setMarkingLane`), an **Anchor** row
(`setMarkingAnchor`) — and **four payload controls**, one per kind with a payload:
**Directions** for a `turn_arrow`, **Oncoming** beside it (the same component
reading `back`), **Style** for a `lane_line`, **Words** for a `text`.

`Road` and `Position` stay readouts. `Position` reads **"Whole link"** for a lane
line and names its frame otherwise (`81.7 m from end`), because a bare distance
for paint measured back from the junction is a lie at the only place the panel
could tell the truth. **The Anchor row is withheld for a `lane_line`** likewise.

**Clicking the anchor moves the paint, deliberately.** `position` is kept
verbatim, so paint 20 m from the start becomes paint 20 m from the end. Re-basing
it would make the stored metres a function of the layout. Its identity guard
**normalizes before comparing** (`(marking.anchor ?? "start") === anchor`), or
re-clicking Start dirties the document for a click that changed nothing.

`setMarkingKind` carries the **whole tagged `MarkingKind`**, so payloads need no
action of their own and the *caller* owns the default a fresh pick starts from. It
never names `lane`, which is how a carriageway-wide marking stays that way across
a repaint. **The four payload controls are that decision paying off** — each is
one more dispatcher of the same action, and none can move the marking.

**Four rules live in the controls, not the reducer**, because each depends on a
field the action does not touch: a `lane_line`'s Span offers `Centreline` plus
`n-1` boundaries; a `turn_arrow`'s offers lanes only; the picker **withholds**
`lane_line` while `lane ≥ n-1`; and Directions disables the last one standing,
because an arrow with no branches is a bare line up the lane. **Oncoming carries
no such guard**, deliberately — emptying it leaves the forward arrow whole and is
the **only route back to a single-headed arrow**.

**Both ends build their payload through `turnArrowKind`, never a fresh literal —
the phase's one silent hazard.** `setMarkingKind` replaces the whole tagged kind
with **no merge**, so a forward control rebuilding `{ type, directions }` would
delete the rear heads on every toggle. The asymmetry hides it: `directions` is
required, so the compiler forces the *back* control to carry it, while `back` is
optional and nothing forces the *forward* one. `turnArrowKind` is exported, pure,
and **not an action** — a named function rather than two spreads in the panel
because otherwise nothing could test it: this repo reaches no layer closer to the
panel (`environment: "node"`, no `Inspector.test.tsx`, `renderToStaticMarkup`
fires no `onClick`). It lives in `state.ts` because losing `back` is **document
data loss**. **What still guards nothing: that both call sites use it** —
reverting one to a literal passes the entire suite.

`TURN_DIRECTIONS` (`Inspector.tsx`) is in **road order left to right** and the
stored array is rebuilt in that order on every toggle, so two documents with the
same arrow hold the same list. `setMarkingLane` stays kind-agnostic, guarding only
on the lane count. Two consequences stated rather than fixed: repainting a
carriageway-wide marking as a `turn_arrow` preserves the absent `lane`, so no Span
entry reads active until one is picked; and repainting as a `lane_line` **keeps
its `lane`**, now naming a *boundary* — lane 1 becomes boundary `1|2`.

**The Words field is the panel's first `<input>`.** `App.tsx`'s keydown handler
already returns early on an `INPUT` target, so typing `m` switches no tool. It
dispatches per keystroke, and `coalesceKeyFor` gives it a gesture key **only for
non-empty content** — the picker's fresh `content: ""` must stay outside the run,
or one undo after picking Text and typing jumps past the repaint. Controlled by
the document, not local state.

## The pointer handlers, which are written and not inherited

- **`onLinkPointerDown` takes the marking branch first, and stops propagation.**
  It deliberately does not for the node and link tools, but the marking tool acts
  on the **road**, so letting the click fall through would lose it and pan.
- **`onMarkingPointerDown` stops propagation unconditionally, then branches on the
  tool.** A marking's hit target is not a descendant of any road group, so
  `onLinkPointerDown` can never fire from one; and not stopping propagation sends
  the event to the `<svg>`, whose select tail clears the selection and pans.
  `pointer-events: none` is no better — CSS cannot see the tool. Under `marking`
  it places another on that marking's own link; under `select` it selects it.
- **The cost is a trade, not a bug: a marking is a small dead zone for the node
  tool.** Nudging the click is the whole remedy.

## What removes a marking

`normalizeDocument` validates nothing, so the defences are in two layers.
**Cascades in `state.ts` cover every edit the app can make** — deleting a link,
deleting a node (every marking on the links it took), and `setLinkLanes` shrinking
a link (markings whose `lane >= n`). All three route through `keepMarkings`, which
returns **the same array** when nothing is dropped, because a document with no
marking must share the array with its history snapshots. What the cascades cannot
reach, the renderer skips instead (`rules/marking-kinds.md`). A stranded marking
is **dropped, not clamped** to a surviving lane: a turn arrow that silently moved
lane is worse than one that goes away, because the drawing still looks deliberate.
Without this a deleted road leaves markings invisible, saved and permanent.

## The third `Selection` arm, and why the compiler is no help

`Selection` gains `{ kind: "marking"; id: MarkingId }`, and **adding it compiles
clean** — that is the trap. Every id is a bare `type X = string`, so `MarkingId`,
`LinkId` and `NodeId` are *the same type*, and the sites that narrow on
`Selection` all did so with a binary test. Three silent failures resulted:
`selectionValid` took the `findLink` branch, so the selection was **dropped after
every undo**; `deleteSelection` fell into the **node** arm, **dirtying the
document while deleting nothing**; and the Inspector rendered the **blank
`<aside>`** — not a wrong panel, *no* panel.

So both reducer sites are `switch`es with `default: return unreachable(sel)`,
where `unreachable(x: never): never` makes a fourth arm a compile error — **a
function, not `const _: never = sel`**, because `tsconfig.json` sets
`noUnusedLocals`. `isSelected` (`Diagram.tsx`) is widened rather than narrowed and
typed off `Selection` itself, so the union cannot lag; what stays uncovered is
forgetting to *call* it. The fourth arm arrived with signs Phase 2 and cost two
compile errors and no silent misroutes — what this bought.

`deleteMarking` is deliberately **not** an action: the Inspector's Delete
dispatches `deleteSelection`, so a separate action would have no dispatcher.

## Where each piece lives

`geometry.ts` owns this rule's pure half — `markingAnchor`, `nearestOnPolyline`,
`pointAlongPolyline`, `polylineLength`, `anchoredAlong`, `rimClearance` and
`bandAt`/`boundaryAt` — under `geometry.test.ts`; the radii it clears are
`rules/road-joints.md`'s, the per-kind builders `rules/marking-kinds.md`'s. `state.ts` holds the five
actions (`addMarking`, `moveMarking`, `setMarkingKind`, `setMarkingLane`,
`setMarkingAnchor`) plus `turnArrowKind`, `keepMarkings`, the cascades and
`unreachable`. `Canvas.tsx` holds `placeMarking`, `projectOntoLink` (which owns
the frame flip), the two pointer handlers and the drag arm — dev-pass tested,
since SVG bubbling and the drag's frame are what is under test. The panel and
`TURN_DIRECTIONS` are `Inspector.tsx`; the tool button `Toolbar.tsx`, the key
`App.tsx`, the selection chrome `styles.css`.

## Open, and deliberately

**Snapping along the road (OQ-5) — closed for auto-placed paint, open for a hand
drag.** An `end`-anchored marking measures to the rim, so an imported arrow lands
one arrow-length clear by construction. What is open is the gesture: a human
dragging a stop line "to the junction" lands where they dropped it, and the
obvious snap target — the rim — is **inside the junction's own hit disc**, which
renders after this layer. Measured at `r = 23.6` for a 3-lane arterial against the
glyph's bar at `25.6`: roughly two units of clearance on the centreline, four in
an outer lane. The disc is a **one-way door** — a drag can push paint under it,
and a click there selects the junction rather than the paint.
