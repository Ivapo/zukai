# Road markings

The paint a human places on a road: how a marking is anchored, how the tool
places one, how it is selected and drawn, and what removes it. Frontend only —
`Marking` and `MarkingKind` have been in the model since the first commit, so
nothing here crosses IPC, reaches disk, or moves `SCHEMA_VERSION`. The design
rationale lives in `specs/road_markings_spec.md`; hand-maintained.

**Three kinds are drawn today** (spec Phases 1–2): `stop_line`, `give_way_line`
and `crosswalk`. `turn_arrow` is Phase 3 and `lane_line` Phase 4 — both are
already **pickable**, and paint a placeholder bar until then (see "What each kind
paints"). `MarkingKind::Hatching` and `Text` are out of scope entirely (the last
two sections).

## The anchor, and the one place metres become units

`Marking` is `{ id, link, position, lane?, kind }`. Two things about it govern
everything below:

- **`position` is metres**, and stays metres. A schematic link has no length in
  metres — it is however far apart the human dragged two dots — but the field is
  documented against Assimilator's `crossings`/`detectors` positions, and the
  alternatives (reinterpreting it as a fraction, or adding a second
  presentation-side position) either make `decoration.rs` lie or create two
  sources of truth for one quantity.
- **`lane` absent means the whole carriageway.** Stored as an *absent* key, never
  as `undefined` — the one-representation rule `Lane.kind`/`LinkView.align`
  already follow, matching Rust's `skip_serializing_if = "Option::is_none"`.

The metre/unit boundary is exactly two functions, and no third site converts:

```
placeMarking (Canvas.tsx)   world units → metres   position = along / UNITS_PER_METRE
markingAnchor (geometry.ts) metres → world units   along    = position * UNITS_PER_METRE
```

`markingAnchor(doc, marking, offsets)` returns the three numbers **every** kind is
drawn from — `{ at, dir, span }`: a point on the drawn polyline, the unit
direction of travel there, and the strip of road it paints across. `span` is one
`laneBands` entry, or (for a carriageway-wide marking) `{ offset: 0, width }`
where `width` is **summed from the bands**, not taken as `roadWidth -
ROAD_MARGIN`: the second form runs the casing lip through a needless float round
trip. Per-kind point builders (`markingBar`, `markingTeeth`, `markingZebra`) take
the anchor and nothing else, which is what keeps `MarkingShape` about drawing.

**Consequences of absolute metres, stated rather than discovered:** dragging a
node shortens the road under its markings, so a marking sits proportionally
further along than it did, and one whose metres now exceed the drawn length is
**clamped to the end** by `pointAlongPolyline` rather than drawn off it. Verified
in the app: shortening a 600-unit road to 350 moved a mid-road stop line to 86%
along, still on asphalt in its lane. That is the same posture the rest of
`geometry.ts` takes with degenerate input (spec OQ-6, left as-is).

## Placement: the click carries everything, so there is no dialog

`Tool` gains `"marking"` (toolbar button, `TOOL_KEYS` entry `m`). Clicking a road
with it places a marking, and **the placed marking is always a `stop_line`** —
`addMarking` takes no kind argument; the Kind picker (Phase 2) is what turns it
into anything else.

`placeMarking` derives both remaining fields from the one click:

- **how far along** — `nearestOnPolyline(drawnPolyline(...), worldPoint(e))`. The
  *drawn* polyline, which already carries the carriageway offset and the
  alignment shift, so a marking cannot land on a road's notional centreline while
  the asphalt is somewhere else.
- **which lane** — that same call's **signed** `offset`, matched against
  `laneBands`. A click inside a band is that lane; a click outside every band —
  the 1.5-unit casing lip, or the `w + 8` invisible hit path — is `lane:
  undefined`.

**That last fallback is a side door, not the route to a carriageway-wide
marking.** A bar across the whole carriageway is the *common* stop line, and
asking for it by hitting the casing lip is not a gesture anyone finds; the
deliberate route is Phase 2's Span control. Until then it is reachable only in a
fixture.

`nearestOnPolyline` returns a **signed** offset in `offsetPolyline`'s frame, and
that sign is the whole of which lane was clicked — lane 0 is nearside at the most
*positive* offset, so a magnitude would put every click in the nearside half. A
point past either end clamps to that end, which falls out of clamping the
projection parameter to `[0, 1]` rather than being a case of its own.

## Editing: two controls, both kind-aware

The Inspector's marking panel carries a **Kind picker** (`setMarkingKind`) and a
**Span control** (`setMarkingLane`); `Road` and `Position` stay readouts. The Span
control is the deliberate route to `lane: undefined` that placement's side door
is not.

`setMarkingKind` carries the **whole tagged `MarkingKind`**, not just its `type`,
so `turn_arrow`'s directions and `lane_line`'s style need no action of their own
and the *caller* owns the default a fresh pick starts from (`MARKING_PICKER` in
`Inspector.tsx`). It never names `lane`, which is how a carriageway-wide marking
stays carriageway-wide across a repaint: spreading an object with no `lane` key
yields one with no `lane` key.

**Three rules live in the controls, not in the reducer**, because each depends on
a field the action does not touch:

| Situation | The control does |
|---|---|
| kind is `lane_line` | Span offers `Centreline` + boundaries `0\|1 … n-2\|n-1` — **one fewer entry than there are lanes** |
| kind is `turn_arrow` | Span offers lanes only; no `Whole carriageway`, which an arrow cannot mean |
| `lane` is a number `≥ n-1` | Picker **withholds** `lane_line`: that lane's far side is the carriageway edge, not a boundary, so the renderer would skip it |

`setMarkingLane` stays kind-agnostic and guards only on the link's own lane count
(as `setLaneKind` does). Encoding the boundary rule there would make the same lane
index legal or illegal depending on `kind`, which the action does not own.

Two consequences, both stated rather than fixed: repainting a carriageway-wide
marking as a `turn_arrow` **preserves the absent `lane`**, so no Span entry reads
as active until one is picked (Phase 3 draws it in the nearside lane meanwhile);
and a hand-edited `hatching`/`text` marking shows no active kind, and picking any
offered kind converts it. A marking whose link is missing falls back to a readout
rather than rendering a control with nothing in it.

## The pointer handlers, which are written and not inherited

Three rules, and each one is a consequence of the layer rule below rather than a
preference:

- **`onLinkPointerDown` takes the marking branch first, and stops propagation.**
  It deliberately does *not* for the node and link tools — "let other tools act
  on the background" — but the marking tool acts on the **road**, so letting the
  click fall through to `onBackgroundPointerDown` would lose it and pan instead.
- **`onMarkingPointerDown` stops propagation unconditionally, then branches on
  the tool.** A marking's hit target is not a descendant of any road group and
  SVG events bubble only to ancestors, so `onLinkPointerDown` can never fire from
  one; and *not* stopping propagation sends the event to the `<svg>`, whose
  select tail **clears the selection and starts a pan**. `pointer-events: none`
  is no better — CSS cannot see the tool, so markings would be unselectable under
  every tool. Under `marking` it places another on **that marking's own link**
  (a tool that refuses to place a second marking near the first is the more
  surprising behaviour); under `select` it selects it; otherwise nothing.
- **`onBackgroundPointerDown` and `onNodePointerDown` are untouched.** The marking
  tool clicking empty canvas clears the selection and pans, exactly as the select
  tool does — there is no road to place anything on.

**The cost, which is a trade and not a bug: a marking is a small dead zone for
the node tool.** A node-tool click over a road falls through to the background
and adds a node; over a marking it does not. Confirmed in the app. The target is
a few units wide and nudging the click is the whole remedy.

## The marking layer is a sibling, never a child of the road

`MarkingShape`s render in `Diagram` **after every road and taper, before the link
preview and the nodes** — above all asphalt, below the junction glyphs, because a
pad is the intersection's own surface and paint placed under one is genuinely
covered.

Nesting a marking inside `RoadShape`'s `<g>` is wrong **twice over**, and either
half alone is enough to rule it out:

- that group carries `onPointerDown → onLinkPointerDown`, so a nested marking's
  clicks would route to link selection; and
- a road drawn *after* its neighbour would paint over the neighbour's markings.

The kind's class token comes from the model — `kind.type.replace(/_/g, "-")`, so
`stop_line` → `.marking-stop-line` — rather than from a table that could fall out
of step as Phases 3–4 add kinds.

### What each kind paints

| Kind | Element | Shape |
|---|---|---|
| `stop_line` | `.marking-bar` | one stroked bar across the span |
| `give_way_line` | `.marking-teeth` | a row of filled triangles, apexes **upstream** |
| `crosswalk` | `.marking-zebra` | filled stripes **along** the road, `CROSSWALK_DEPTH` deep |
| everything else | `.marking-bar` | the bar again — a placeholder, see below |

Three rules hold across all of them:

- **Every transverse kind is centred on `position`.** A bar has no depth and so is
  trivially centred; a give-way row and a zebra placed where a stop line sits
  cover the same stretch of road.
- **The teeth point at the driver**, who arrives from *behind* the marking — so
  apexes sit upstream and bases downstream. Drawn the other way they read as
  arrowheads telling traffic to keep going, and no assertion on a magnitude or a
  count sees it. `geometry.test.ts` pins the apex against the bases directly.
- **Containment is a property of the tiling, not a clamp.** `spanCells` derives
  the cell *count* from the span (`round(width / MARKING_PITCH)`, floored at one)
  and lets the pitch follow, so cells tile the span exactly — no partial cell at
  either end, and therefore no paint on the verge at any lane count or road class.
  Each shape then takes a fraction of its own cell. `MARKING_PITCH` is
  `LANE_PX / 3`: **one** rhythm for both kinds, so they read as the same hand, and
  a third rather than a half because two teeth to a lane read as two arrows rather
  than as a row (decided in the app, not on paper).

**The `default` arm is load-bearing, not tidiness.** `turn_arrow` and `lane_line`
are pickable before they have geometry (Phases 3–4), and `hatching`/`text` are out
of scope but reachable in a hand-edited file. All draw the bar, which keeps a
marking **visible and selectable** while its own shape is still to come — painting
nothing would leave an object on the canvas findable only by accident. Its class
token already says which kind it is, and `Diagram.test.tsx` pins the fallback so
Phase 4 has to change it deliberately.

**The hit target and halo are the anchor's transverse bar for every kind**, so
selection feels identical whatever is painted — and a `stop_line`'s markup is
byte-for-byte what Phase 1 emitted. Phase 4's `lane_line` runs *along* the road
and is the one kind that will need its own.

**The bar takes no `vector-effect`**, unlike the glyph's `.jn-stopbar` and the
roads' edge lines. Those are a *symbol* and *hairlines* respectively and want to
hold their weight as the canvas zooms; a marking is 4 world units of paint on a
road and scales with it — which also leaves the marking layer byte-identical
between canvas and export.

**`.marking-halo` is butt-capped**, where `.road-halo` is round. The rule is the
same both times — a halo matches the shape it highlights — but here round caps
balloon past the lane the marking spans, over the divider into the next lane and
past the edge line onto the verge, misreporting the span at the moment the user
is looking at it.

### The glyph's stop bars are not markings

`.jn-stopbar` is drawn per arm by `signalized_cross` and says "this junction has
signals"; a `stop_line` marking is paint a human placed. **A document can carry
both, and that is not a duplicate** — it is a signalised junction whose approach
also has a painted bar. Any attempt to suppress one from the other couples the
glyph to the decoration list. `Diagram.test.tsx` pins the glyph's bars as
unchanged by a marking for exactly that reason.

Worth knowing where they land: for a 3-lane arterial the glyph's bar sits at
`rp + 4 = 25.6` from the node and the junction's **hit disc** at `rp + 2 = 23.6`,
so a marking placed near the pad reads as a second bar a few units outside the
first. The disc is also why a click much closer than that drags the glyph instead
of placing paint — see the last section.

## What removes a marking

`normalizeDocument` validates nothing, so the defences are in two layers.

**Cascades in `state.ts` cover every edit the app can make.** All three route
through `keepMarkings(markings, keep)`, which returns **the same array** when
nothing is dropped — the identity matters, because a document with no marking
must share the array with its history snapshots:

| Edit | Dropped |
|---|---|
| `deleteSelection` on a **link** | every marking on that link |
| `deleteSelection` on a **node** | every marking on the links the node took with it |
| `setLinkLanes` shrinking a link | markings on that link whose `lane >= n` |

A stranded marking is **dropped, not clamped** to a surviving lane: a turn arrow
that silently moved lane is worse than one that goes away, because the drawing
still looks deliberate. Same scar as the lane `kind` this control used to destroy
(`rules/road-rendering.md`, "the control that used to destroy it"). Without any
of this a deleted road leaves markings that are invisible, saved, and permanent —
a ghost per deleted road that no assertion notices.

**`markingAnchor` skips what the cascades cannot reach**, which is only ever an
imported or hand-edited document: an unknown `link`, an undrawable polyline, a
non-finite `position`, or a `lane` past the link's lanes. Each returns
`undefined` and the renderer emits *nothing*. Indexing `laneBands` out of range
would otherwise yield `undefined` and then `NaN` coordinates, which SVG renders
as an invisible-but-corrupt path that no `d=` assertion catches.

## The third `Selection` arm, and why the compiler is no help

`Selection` gains `{ kind: "marking"; id: MarkingId }`, and **adding it compiles
clean** — that is the trap. Every id is a bare `type X = string`
(`src/model/types.ts`), so `MarkingId`, `LinkId` and `NodeId` are *the same
type*, and the four sites that narrow on `Selection` all did so with a binary
`if`/ternary whose `else` was an implicit fall-through. Three silent failures
resulted, none of them a build error:

| Site | What the miss did |
|---|---|
| `selectionValid` (`state.ts`) | took the `findLink` branch, resolved `undefined` — selection **dropped after every undo/redo** |
| `deleteSelection` (`state.ts`) | fell into the **node** arm — **dirtied the document and pushed an undo snapshot while deleting nothing** |
| `Inspector` (`Inspector.tsx`) | ran `findLink` on a marking id, missed, rendered the **blank `<aside>`** — not a wrong panel, *no* panel |

So `selectionValid` and `deleteSelection` are `switch`es with
`default: return unreachable(sel)`, where `unreachable(x: never): never` makes a
fourth arm a compile error. **A function, not `const _: never = sel`** —
`tsconfig.json` sets `noUnusedLocals`. `isSelected` (`Diagram.tsx`) is the fourth
site and a different matter: its `kind` parameter is its own union, **widened**
rather than narrowed. `state.test.ts` tests all three failures directly.

`deleteMarking` is deliberately **not** an action. The Inspector's Delete
dispatches `deleteSelection`, exactly as the node and link panels do and as the
Delete/Backspace key does, so a separate action would have no dispatcher.

## No text, and it is a hard line

`MarkingKind::Text` and the whole of `Sign` are out of scope, and not for
tidiness. **The drawing renders zero `<text>`**, because an exported SVG reaches
no external font: the first glyph either falls back to whatever the viewer has
or — in the PNG path, which rasterizes through the webview — **bakes that
substitution in permanently**. Fixing it means embedding a font as a data-URI
`@font-face` inside `diagram.css`, with its own size and licensing questions
(`rules/diagram-export.md`, export spec OQ-4). Every kind this subsystem renders
is pure geometry, and `export.test.ts` now asserts the absence directly — nothing
pinned it before.

`MarkingKind::Hatching` is out for a different reason: it is an **area**, and the
`Marking` anchor is one link at one position. (A gore's chevrons are not
`Marking`s either, for the same reason — they live in a triangle *between* two
links — and belong on `GoreShape`; spec OQ-4.)

## Where each piece lives

| Piece | Where | Tested by |
|---|---|---|
| `nearestOnPolyline`, `pointAlongPolyline`, `markingAnchor` | `src/editor/geometry.ts` | `geometry.test.ts` (pure) |
| `markingBar`/`markingTeeth`/`markingZebra`, `spanCells`, `polygonsPath`, and the three build constants | `src/editor/geometry.ts` | `geometry.test.ts` (pure) |
| `MarkingShape`, `markingPaint`, the marking layer, `Interaction.onMarkingPointerDown` | `src/components/Diagram.tsx` | `Diagram.test.tsx` via `renderToStaticMarkup` |
| `.marking-bar`, `.marking-teeth`, `.marking-zebra` — the paint, and the only marking rules that reach an export | `src/styles/diagram.css` | `export.test.ts` |
| `.marking-hit`, `.marking-halo`, the two panel-control rules — interaction, so **not** in `diagram.css` | `src/styles.css` | `export.test.ts`'s `CHROME` regex |
| `addMarking`, `setMarkingKind`, `setMarkingLane`, the `Selection` arm, `keepMarkings` and the three cascades, `unreachable` | `src/editor/state.ts` | `state.test.ts` |
| The marking tool: `placeMarking`, the two pointer handlers | `src/components/Canvas.tsx` | the `bun run dev` pass — SVG bubbling is what is under test |
| The toolbar button and `TOOL_KEYS` entry `m` | `src/components/Toolbar.tsx`, `src/App.tsx` | — |
| The marking panel: `MarkingKindPicker`, `MarkingSpan`, `MARKING_PICKER` | `src/components/Inspector.tsx` | the `bun run dev` pass |

`strokeAllowance` (`src/editor/export.tsx`) needed **no** change and
`export.test.ts` confirms it, for the tiled kinds as well as the bar: every
marking is painted inside the road it belongs to, the allowance is already half
the widest road, and the bar's 4-unit stroke is what the `2` floor — half the
fattest non-casing stroke in `diagram.css` — was already sized for. The teeth and
the zebra are *fill* geometry, which `getBBox` measures with no allowance at all.

## Open, and deliberately

- **Snapping along the road (spec OQ-5).** A stop line a human meant to put "at
  the junction" sits a few units short of it. The obvious snap target — the pad
  rim — is **inside the junction's own hit disc**, which renders after the marking
  layer: measured at `r = 23.6` for a 3-lane arterial against the glyph's bar at
  `25.6`, so roughly two units of clearance on the centreline and about four in
  an outer lane (the disc is a circle, so its horizontal reach shrinks off-axis).
  Any snap design has to reckon with that disc.
- **Markings do not follow a dragged node (spec OQ-6)** — see the first section.
  Rescaling `position` on a drag would make the stored metres a function of
  layout, which is what keeping metres rules out.
- **Link reversal (spec OQ-1).** Nothing reverses a link today, so
  `position`-from-`from_node` is unambiguous. A reverse action must remap every
  marking to `length - position`, or every stop line jumps to the wrong end.
