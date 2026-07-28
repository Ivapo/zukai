# Road markings

The paint a human places on a road: how a marking is anchored, how the tool
places one, how it is selected and drawn, and what removes it. Almost entirely
frontend — `Marking` and `MarkingKind` have been in the model since the first
commit, and the one field added since (`anchor`, lane arrows Phase 2) is optional
and elided at its default, so nothing here has ever moved `SCHEMA_VERSION`. The
design rationale lives in `specs/road_markings_spec.md` and, for the anchor,
`specs/lane_arrows_spec.md`; hand-maintained.

**Six of the seven kinds are drawn.** `stop_line`, `give_way_line`, `crosswalk`,
`turn_arrow` and `text` sit at a point across the road (spec Phases 1–3, plus
signs spec Phase 1 for the last); `lane_line` runs **along** it for the whole link
and is the odd one out in almost every section below. `MarkingKind::Hatching`
alone is out of scope, and paints a placeholder bar if a hand-edited document
carries one — as do the two kinds whose fresh payload is empty.

## The anchor, and the one place metres become units

`Marking` is `{ id, link, position, anchor?, lane?, kind }`. Three things about
it govern everything below:

- **`position` is metres**, and stays metres. A schematic link has no length in
  metres — it is however far apart the human dragged two dots — but the field is
  documented against Assimilator's `crossings`/`detectors` positions, and the
  alternatives (reinterpreting it as a fraction, or adding a second
  presentation-side position) either make `decoration.rs` lie or create two
  sources of truth for one quantity.
- **`anchor` absent means `start`** — which end those metres are measured from.
  `LinkEnd` is a plain defaulted enum rather than an `Option`, `LinkAlign`'s
  shape, elided by `skip_serializing_if = "LinkEnd::is_start"`, so every document
  written before the field existed still saves byte-for-byte (lane arrows §2.3.1;
  no `SCHEMA_VERSION` move).
- **`lane` absent means the whole carriageway.** Stored as an *absent* key, never
  as `undefined` — the one-representation rule `Lane.kind`/`LinkView.align`
  already follow, matching Rust's `skip_serializing_if = "Option::is_none"`.

The metre/unit boundary is exactly two functions, and no third site converts:

```
projectOntoLink (Canvas.tsx) world units → metres  position = anchoredAlong(total, along) / UNITS_PER_METRE
markingAnchor (geometry.ts)  metres → world units  along    = anchoredAlong(total, position * UNITS_PER_METRE)
```

`projectOntoLink` is what placement and dragging **share**, which is what keeps
that count at two: `placeMarking` is two lines over it, and the drag re-runs it
per pointer-move. Extracting it was the whole of lane arrows Phase 1's arithmetic.

**The frame flip lives inside those same two functions, and that is why the count
is still two.** `anchoredAlong(total, distance, anchor)` is `total - distance` for
an `end` anchor and the distance untouched for a `start` one — **its own inverse**,
so one function serves both directions and no two expressions can disagree about
which of them subtracts. Putting the flip at the drag's call site instead would
have made a third site that knows the frame, and would have re-derived the
polyline (and `carriageways(doc)`) per pointer-move to get `total`.

`total` is `polylineLength(points)`, which is the sum `pointAlongPolyline` walks
rather than a plain sum of point-to-point distances: both skip segments shorter
than `SAME_EDGE`, and that is what makes the drag's round trip exact rather than
approximate. It was private to that walk until an anchor needed to measure back
from it.

### The far end is the glyph's rim, not the node

An `end`-anchored marking measures to `rimClearance(doc, link, offsets)` past the
polyline's end, not to the end itself. The node is *inside* the junction it names,
and the pad drawn around it is opaque and painted **over** this layer — so paint
measured to the node is paint measured to somewhere it cannot be seen. Measured
on an imported `cross-4`: every arrow's head sat 17.5 units from the node against
a pad of `r = 24`, and after the rim, 36.0 — one arrow-length of clear road beyond
the rim, which is what the setback was derived to mean.

Four things about it:

- **It is the same expression the glyph's own stop bar is placed with** —
  `rayCircleExit(origin - center, dir, radius)`. That was the argument for the rim
  over the node from the start (lane arrows §2.4): the paint a human puts at a
  junction and the paint a glyph draws itself can no longer come to disagree about
  where a road meets the glyph.
- **The clearance is added to the distance, not subtracted from the total.** The
  clamp then still catches an over-long marking at the polyline's *start*, which
  is Phase 2's behaviour unchanged.
- **It comes off the arm's own carriageway.** `Arm.origin` **is** the drawn
  polyline's end point, which is what makes the ray distance and the arc-length
  walked back from that end the same number — and what gives a divided approach
  its own half's clearance, a chord rather than a diameter. An undivided arm sits
  at `(0, 0)` relative to the node and clears exactly the radius, so it is the one
  case that *cannot* catch a dropped translation. The test that does uses a
  divided road.
- **`start` takes no such term.** Nothing asked for one, and adding it would move
  the paint in every document already saved.

`junctionRadius(doc, nodeId, offsets)` is where the exclusions live, and one of
them is deliberately *not* excluded: `Diagram.tsx`'s `pad` gate skips a roundabout
because a movement arc on one would be a chord across its own island, and an
anchor has no such reason — a ring buries an approach arrow exactly as a pad does,
so a roundabout measures to `ro`. What is genuinely excluded is what has no radius
to give: a non-junction node, a `gore` (paint *between* two arms rather than a
disc around one node), and a junction with no arms. Each returns `undefined`, the
clearance is `0`, and the marking measures to the node exactly as it did before.

**Nothing tests the drag's half of it** — `Canvas.tsx` has no test file, and the
`anchor` argument is optional, so dropping it at the call site compiles and every
one of the 389 tests still passes (mutation-checked). `anchoredAlong` is unit-
tested and the gesture itself is a dev-pass check.

`markingForm(doc, marking, offsets)` is the **one call the renderer makes**, and
it answers the only question with two answers: a marking is drawn either
`across` the road at a point or `along` it for the whole link. The kind branch
lives there rather than in `Diagram.tsx` so the marking layer keeps its shape —
one call, one skip, one element.

`markingAnchor(doc, marking, offsets)` is the `across` arm, and returns the three
numbers **every point kind** is drawn from — `{ at, dir, span }`: a point on the
drawn polyline, the unit direction of travel there, and the strip of road it
paints across. `span` is one `laneBands` entry, or (for a carriageway-wide
marking) `{ offset: 0, width }` where `width` is **summed from the bands**, not
taken as `roadWidth - ROAD_MARGIN`: the second form runs the casing lip through a
needless float round trip. Per-kind point builders (`markingBar`, `markingTeeth`,
`markingZebra`, `markingArrow`) take the anchor and nothing else, which is what
keeps `MarkingShape` about drawing.

`laneLine` is the `along` arm and takes no anchor at all — see "The lane line".

**The anchor has exactly one kind-aware line, and it is a `turn_arrow`'s.** An
arrow has no carriageway-wide meaning, so a lane-less one takes the **nearside**
band rather than the lane region. It lives in the anchor rather than in
`markingArrow` so the hit target and the halo move to lane 0 with it — a halo
highlighting a strip the arrow is not painted on misreports the span at the moment
the user is looking at it.

**The anchor is not one of those kind-aware lines, and it does not flip `dir`.**
An arrow measured back from the junction still points the way the road runs —
`anchor` picks where the paint sits, never which way it faces.

**Consequences of absolute metres, stated rather than discovered:** dragging a
node shortens the road under its markings, so a **start**-anchored marking sits
proportionally further along than it did, and one whose metres now exceed the
drawn length is **clamped to the end furthest from its own anchor** by
`pointAlongPolyline` rather than drawn off it — an end-anchored one resolves to a
*negative* distance and piles up at the start. Verified in the app: shortening a
600-unit road to 350 moved a mid-road stop line to 86% along, still on asphalt in
its lane. That is the same posture the rest of `geometry.ts` takes with degenerate
input. **An `end` anchor is the half-answer to spec OQ-6** ("should a marking
follow the road when a node is dragged?"): it can now, if it says so — measured in
the app, an end-anchored stop line held 210 units from `N2` while `N2` moved 140,
with a start-anchored one beside it staying put. The clamp is what the other half
still rests on. It also gives **OQ-1** a cheaper answer than the one recorded
there: reversing a link can flip its markings' anchors instead of remapping every
`position` to `length - position`.

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

## Paint has a second author, and it is the importer

Every marking above is a human's. Importing a `network.yaml` mints them too — one
`turn_arrow` per approach lane, from the movements' own `from_lanes`
(`rules/network-yaml.md`). Three things about that are worth knowing here rather
than one format over:

- **They are ordinary markings.** No live binding, no re-derivation, no "these are
  the imported ones" flag: select, drag, repaint, re-span or delete, and nothing
  puts them back. Import seeds and lets go.
- **They arrive `anchor: "end"`**, which is the only reason that field exists.
  An imported arm is over a thousand units long and is about to be dragged into
  shape; start-anchored paint would drift off the junction on the first drag and
  pile up at the far end.
- **They are the first paint nothing clicked into place**, so the failures the
  hand path rules out by construction — a click lands in a band, so a lane always
  exists — have to be ruled out arithmetically instead. `kerb_lane` returns an
  `Option` and an out-of-range `from_lanes` index is skipped rather than clamped
  onto a lane the file never named.

`position` is `8.75 m` — `1.5 × TURN_ARROW_LENGTH`, converted. What that measures
to is the **end node**, which stands in for the junction's rim until lane arrows
Phase 5; on a divided junction the opaque `jn-pad` (drawn after this layer) covers
the arrow's head. The measurement is in `rules/network-yaml.md`.

## Dragging: the same projection, pointed at a marking that exists

Under the select tool a marking is grabbed and slid along its road
(`onMarkingPointerDown` → the fourth `Drag` arm → `moveMarking`). Four things
about it are decisions rather than mechanics:

- **A drag carries no grab offset**, unlike a node's or a sign's: it re-projects
  **absolutely**, so the paint goes wherever the pointer is. The cost is a jump of
  up to half the 12-unit hit strip on pick-up. What it buys is the case an import
  creates — a marking whose metres exceed its drawn road is clamped to the end by
  `pointAlongPolyline`, and only an absolute drag brings it back. Measured in the
  app: a stop line stored at 213.9 m on a 150-unit road, drawn piled at the end,
  came back to 11.7 m in one drag.
- **It writes `lane` as well as `position`**, so crossing a divider moves the paint
  to the lane under the pointer. The lane already falls out of the click for
  placement, and a drag that crossed a divider without changing lanes would be the
  surprising reading.
- **The `position` it writes is in the marking's own frame**, which is what
  `marking.anchor` is passed down for. Report a start-frame distance for an
  end-anchored marking and the paint mirrors about the road's midpoint and tracks
  the pointer *backwards* — a bug the drag would have shipped with the moment the
  Anchor row made the field settable.
- **The lane a drag resolves to is kind-aware, and this is the one place it is.**
  `bandAt` answers for every kind but a `lane_line`, whose `lane` names one of the
  road's `n-1` **boundaries**; `boundaryAt` answers for that one. Matching a lane
  line against the bands can name `n-1`, which `boundaryOffset` refuses and
  `markingForm` turns into *nothing rendered* — an invisible, unselectable marking
  recoverable only by undo. That branch lives in `Canvas.tsx` with the Inspector's
  other kind-aware rules, never in the reducer (see "Editing").
- **`moveMarking` returns `state` by identity on a same-place drag**, which
  `moveNode` and `moveSign` do not do. Many neighbouring pixels project to one
  `(position, lane)`, and without it the document dirties for a gesture that
  changed nothing.

## Editing: four controls, all kind-aware

The Inspector's marking panel carries a **Kind picker** (`setMarkingKind`), a
**Span control** (`setMarkingLane`), an **Anchor row** (`setMarkingAnchor`), and
one payload control per kind that has a payload — a **Directions multi-select**
for a `turn_arrow`, a **Style single-select** for a `lane_line`, a **Words field**
for a `text`. `Road` stays a readout, and so does `Position`,
which reads **"Whole link"** for a lane line: `position` is ignored for one, and a
distance in metres there would be a lie at the only place the panel could tell the
truth. It now names its frame — `81.7 m from end` — because a bare distance for
paint measured back from the junction is that same lie one field over. The Span
control is the deliberate route to `lane: undefined` that placement's side door is
not.

**The Anchor row is withheld for a `lane_line`**, on the Position readout's own
terms: that kind has no distance to anchor. And it is the **first marking control
since the Span to need an action of its own** — `anchor` is a field beside `kind`
rather than a payload inside it, which is exactly the discriminator the three
`setMarkingKind` dispatchers rest on.

**Clicking it moves the paint, deliberately.** `position` is kept verbatim, so
paint 20 m from the start becomes paint 20 m from the end. Re-basing it to
`total - position` would hold the drawing still, but only by making the stored
metres a function of the layout — the one thing keeping them in metres rules out —
and it would need the drawn polyline inside the reducer.

**`setMarkingAnchor`'s identity guard normalizes before it compares**
(`(marking.anchor ?? "start") === anchor`). A start-anchored marking carries no
key, so the bare comparison is `undefined === "start"`, and re-clicking Start
would dirty the document and push an undo snapshot for a click that changed
nothing. The same `?? "start"` decides which segment lights.

`setMarkingKind` carries the **whole tagged `MarkingKind`**, not just its `type`,
so `turn_arrow`'s directions and `lane_line`'s style need no action of their own
and the *caller* owns the default a fresh pick starts from (`MARKING_PICKER` in
`Inspector.tsx`). It never names `lane`, which is how a carriageway-wide marking
stays carriageway-wide across a repaint: spreading an object with no `lane` key
yields one with no `lane` key. **The three payload controls are that decision
paying off** — each is one more dispatcher of the same action, sending a whole
`{ type, …payload }`, and none can move the marking because the action names
nothing else. Markings Phases 3 and 4 added a control apiece and no action at
all; so did signs Phase 1's Words field. **Moving one is the canvas's**, not the
panel's — there is no Position field, and `Position` stays a readout.

**The Words field is the panel's first `<input>`, and the first control that is
not a click** — which makes it the first to touch two things every other control
was insulated from:

- **Global keys.** `App.tsx`'s keydown handler already returns early on an
  `INPUT`/`TEXTAREA` target, so typing `m` switches no tool and Backspace deletes
  no marking. Confirmed in the app rather than assumed.
- **History.** It dispatches on every keystroke, so the paint follows the typing —
  which without help would burn one of a hundred undo snapshots per character.
  `coalesceKeyFor` gives it a gesture key (`rules/history.md`), and deliberately
  **only for non-empty content**: the picker's fresh `content: ""` must stay
  outside the run, or one undo after picking Text and typing would jump back past
  the repaint instead of back to an empty marking.

It is controlled by the document, not by local state — the marking *is* the value,
and a second copy could disagree with the drawing after an undo.

**Four rules live in the controls, not in the reducer**, because each depends on
a field the action does not touch:

| Situation | The control does |
|---|---|
| kind is `lane_line` | Span offers `Centreline` + boundaries `0\|1 … n-2\|n-1` — **one fewer entry than there are lanes** |
| kind is `turn_arrow` | Span offers lanes only; no `Whole carriageway`, which an arrow cannot mean |
| `lane` is a number `≥ n-1` | Picker **withholds** `lane_line`: that lane's far side is the carriageway edge, not a boundary, so the renderer would skip it |
| one direction is left | Directions **disables** it, as the lane stepper refuses to go below one: an arrow with no branches is a bare line up the lane |

`TURN_DIRECTIONS` is listed in **road order left to right** (`u_turn`, `left`,
`slight_left`, `through`, `slight_right`, `right`) rather than the model's
declaration order, so the row reads like the arrow it describes — and the stored
array is rebuilt in that order on every toggle, so two documents that ended up
with the same arrow hold the same list whatever order it was clicked in.

`setMarkingLane` stays kind-agnostic and guards only on the link's own lane count
(as `setLaneKind` does). Encoding the boundary rule there would make the same lane
index legal or illegal depending on `kind`, which the action does not own.

Two consequences, both stated rather than fixed: repainting a carriageway-wide
marking as a `turn_arrow` **preserves the absent `lane`**, so no Span entry reads
as active until one is picked (it draws in the nearside lane meanwhile); and a
hand-edited `hatching`/`text` marking shows no active kind, and picking any
offered kind converts it. A marking whose link is missing falls back to a readout
rather than rendering a control with nothing in it.

A third, and it is the one a user meets: repainting a marking as a `lane_line`
**keeps its `lane`**, which now names a *boundary* rather than a lane — so a stop
line in lane 1 becomes a line on boundary `1|2` rather than staying where it
looked. That is the same "the action names nothing else" rule paying its cost
rather than a slip, and the Span control shows the new reading immediately.

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
| `turn_arrow` | `.marking-arrow-stem` + `.marking-arrow-head` | one shaft, one branch per direction — the only **two-element** kind |
| `lane_line` | `.marking-line` + a style token | the whole link, along a boundary — the only kind not drawn from the anchor |
| `text` | `.marking-text` | one `<text>` along the road, centred in the band — the only kind that is not a path, and the only one at an angle |
| everything else | `.marking-bar` | the bar again — a placeholder, see below |

Three rules hold across all of them but the lane line, which is longitudinal and
takes none of them:

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

### The turn arrow: one shaft, one branch per direction

A shared through/right lane is **one arrow with two branches**, not two arrows, so
every branch leaves the shaft's far end rather than carrying a shaft of its own.
Five directions are straight stubs at fixed bearings off the direction of travel —
`through` 0°, `slight_left`/`slight_right` ∓30°, `left`/`right` ∓90°, negative
being the left of travel — and `u_turn` is a 180° hook that turns back alongside
the shaft with its head pointing **at the driver**. It hooks *left*, the U-turn
side under the right-hand traffic `laneBands` already assumes.

Four things about it are decisions rather than detail:

- **It is the one kind drawn as two elements**: stems stroked, heads filled. A
  single filled outline would have to close the hook across its own chord and fill
  the half-disc inside it; a single stroked path would leave the heads hollow,
  which reads as an outline drawing — the same reason the give-way teeth are
  filled.
- **The stem's `stroke-width` is an attribute, not a rule.** It is a fraction of
  the band, so an arrow in a narrow ramp lane is a narrower arrow, and it arrives
  from `geometry.ts` exactly as a lane band's own width does. It still travels
  inside an exported file.
- **`ARROW_REACH` is the whole containment rule**, in the same spirit as
  `spanCells`: every point of every branch lands within `ARROW_REACH * width` of
  the band centre, and that is under a half. Which is also why the **hook's radius
  is derived rather than picked** — the spec proposed a quarter of the band width,
  but that puts the return leg at `2R = width/2`, the band edge, before the head is
  even added. `2R + headHalf = reach` instead, so the hook's head reaches exactly
  as far sideways as a hard stub's apex and one number bounds all six directions.
- **The proportions were decided in the app, not on paper.** The first pass —
  reach 0.42, head 0.22 long, stem 0.13 — drew as a thin line with a tick on the
  end. What reads as an arrow is a **short shaft and a chunky head**:
  `TURN_ARROW_LENGTH` 15 rather than 18, and a head 0.30 long by 0.34 wide on a
  0.16 stem, roughly twice the stem's width.

**A known limit, and it is inherent rather than a bug:** on a narrow lane three or
more directions run their heads together, and all six draw a starburst. One shaft
with one branch per direction cannot do better, the paint still stays inside the
band, and no road carries six directions in a lane. Two or three on a full-width
lane is what it is sized for.

### The lane line: the one kind that runs along the road

A `lane_line` has a start and an end where every other kind has a point, and
`Marking` has one `position` and nowhere to put an extent. The cheapest honest
reading costs nothing: **it paints its boundary for the whole link and `position`
is ignored.** No new field, and it is what a schematic wants nine times in ten —
"this line is solid *here*" is a statement about a stretch of road, and in a
schematic the stretch *is* the link. A line that has to stop partway is a link
that wants splitting at a waypoint, which the model already supports.

**`lane` names a boundary, not a lane, and the count does not match.** `n` lanes
have `n-1` boundaries, so `boundaryOffset` is the whole rule in four lines:
`lane` absent is the lane region's centre (offset `0`); `lane < 0` or
`lane >= n-1` names nothing and **draws nothing**; otherwise it is
`bands[lane+1].offset + bands[lane+1].width / 2`. That last expression is
*character-for-character* `RoadShape`'s own divider derivation, because the road
drops the divider a line replaces by **comparing the two numbers** — an
equivalent-but-different expression over `bands[lane]` agrees to all but the last
bit, which is exactly the bit that decides.

**A lane line replaces the derived line at its offset** (spec OQ-3), divider and
shoulder line alike. Overpainting is simpler but leaves a dashed line under a
solid one, showing at every dash gap. Three pieces carry it: `laneLineOffsets(doc)`
collects what each link's lines have taken, `Diagram` computes it once and hands
each `RoadShape` its own, and `boundaryTaken` is the comparison. `laneLineOffsets`
takes **no** `offsets` argument — which boundary a line sits on is a fact about
the cross-section, not about where the road was dragged.

**The centreline replaces too, on the same one rule.** On a 2-lane road the lane
region's centre *is* boundary `0|1`, so "Centreline" and "0|1" would otherwise
behave differently at the same place — one clean, one with dashes showing
through. That is also why `boundaryTaken` has a tolerance at all: a named
boundary matches exactly, and a centreline arrives as a literal `0` and meets an
offset summed from lane widths.

**This is where road spec OQ-4 and ramps OQ-6 actually landed**, and neither
needed the model field both proposed. An undivided two-way road is a
`lane_line { style: double }` with `lane` absent. Nothing is inferred: the human
says the road is two-way by painting the line, the same posture the junction
glyphs take. Nothing *derives* a centreline, which is what a field would have
been for.

Three more things about it are decisions rather than detail:

- **The style is a class token** (`marking-line-solid|dashed|double`), so
  `diagram.css` carries the dashes and the colour and an export inherits both.
  `double` is drawn as **two strokes** `LANE_LINE_GAP` apart around the boundary,
  with the `spine` — the single line down the middle — kept for the hit target
  and halo.
- **A double line is the one marking that is not white.** Yellow says opposing
  traffic, which is the whole message of a two-way centreline; white would read
  as one more lane divider drawn twice. `LANE_LINE_GAP` is **4**, not the 3 first
  written: a gap narrower than the strokes reads as one fat line with a scratch
  down it. Decided in the app, as `MARKING_PITCH` and the arrow's proportions
  were.
- **Its hit target and halo are its own** — the spine, at 8 units rather than the
  bar's 12, because a 12-unit strip down the length of a link is a dead zone for
  every click on the road under it. The **halo grows with the paint**
  (`haloWidth`), the rule `.road-halo`'s `w + 6` already follows: a double line's
  paint spans `LANE_LINE_GAP + stroke`, and a fixed halo was exactly as wide as
  it — against *yellow* paint that reads as no halo at all. Also caught in the
  app, not by an assertion.

**The `default` arm is load-bearing, not tidiness.** Three things reach it, and
only one of them is a hand-edited document: `hatching` is out of scope, while a
`turn_arrow` with no direction and a `text` with no content are what the app
itself mints when you pick either kind. All three draw the bar, which keeps a
marking **visible and selectable** — painting nothing would leave an object on
the canvas findable only by accident, and for the two empty payloads it is the
thing you then click to fill in. Its class token already says which kind it is.

Every phase that draws a kind has to leave this list deliberately, because
`Diagram.test.tsx` pins its membership: `lane_line` left in markings Phase 4, and
**non-empty** `text` in signs Phase 1 — which is also why the empty one had to
stay, rather than the entry simply being deleted.

**The hit target and halo are the anchor's transverse bar for every kind that
sits at a point**, so selection feels identical whatever is painted — and a
`stop_line`'s markup is byte-for-byte what Phase 1 emitted. For a lane-less turn
arrow that bar is lane 0's, because the anchor is what re-homed it (first
section).

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

**`markingForm` skips what the cascades cannot reach**, which is only ever an
imported or hand-edited document. `markingAnchor` skips an unknown `link`, an
undrawable polyline, a non-finite `position`, or a `lane` past the link's lanes;
`laneLine` skips the same but for `position`, which it never reads, plus its own
boundary rule. Each returns `undefined` and the renderer emits *nothing*.
Indexing `laneBands` out of range would otherwise yield `undefined` and then
`NaN` coordinates, which SVG renders as an invisible-but-corrupt path that no
`d=` assertion catches.

A lane line that is skipped **takes no divider with it** either: the road and the
line agree because `laneLineOffsets` runs the same `boundaryOffset` and finds the
same nothing. Rubbing a divider off a road for a line that was never drawn is the
failure that rule prevents.

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
site and a different matter: its `kind` parameter is **widened** rather than
narrowed, and is now typed off `Selection` itself, so the union cannot lag the
type — what stays uncovered there is forgetting to *call* it, which no signature
can catch. `state.test.ts` tests all three failures directly. The fourth arm
arrived with signs Phase 2 and cost two compile errors and no silent misroutes,
which is what this section was written to buy (`rules/signs.md`).

`deleteMarking` is deliberately **not** an action. The Inspector's Delete
dispatches `deleteSelection`, exactly as the node and link panels do and as the
Delete/Backspace key does, so a separate action would have no dispatcher.

## Text is the seventh kind, and it cost a font

`MarkingKind::Text` was out of scope for the whole of the markings spec, and not
for tidiness: an exported SVG reaches no external font, so the first glyph either
falls back to whatever the viewer has or — in the PNG path, which rasterizes
through the webview — **bakes that substitution in permanently**. Signs spec
Phase 1 paid that cost, embedding Overpass Mono as a data-URI `@font-face`
(`rules/diagram-export.md` owns the export half; export spec OQ-4, resolved). The
constraint has not been repealed — it has been *satisfied*, and it still governs
every future glyph.

What that buys the marking layer is one arm of `markingPaint`:

- **A run is drawn from the anchor and nothing else**, like every other kind.
  `markingText(anchor)` returns `{ at, angle, size }` — a baseline midpoint, a
  rotation, and the type size. The **content is not an argument**, because
  `text-anchor="middle"` centres the string and nothing about where the run goes
  depends on what it says. `textWidth(content)` is the separate function for the
  case that does care, which is a sign plate.
- **It is the one thing in the drawing set at an angle**, and it earns it: paint
  is on the road, so it turns with the road, exactly as a turn arrow does. There
  is deliberately **no upright flip** — a westbound road paints text that reads
  upside down on screen and the right way up to the driver it is aimed at.
- **Centred across the band by arithmetic, not by `dominant-baseline`**, whose
  support in a rasterized SVG is precisely the class of thing that fails silently
  in the PNG path. Glyphs sit above their baseline and `markingPoint`'s positive
  `across` is the right of travel, so the baseline drops `TEXT_SIZE * CAP_HEIGHT
  / 2`. `ADVANCE` (0.616) and `CAP_HEIGHT` (0.7) are the **face's own** metrics —
  `hmtx` and `OS/2.sCapHeight` against a 2000-unit em — pinned as literals so a
  face swap fails a test rather than quietly resizing everything.
- **Empty content draws the placeholder bar**, which is why it can join the
  picker at all: a fresh pick is a marking you can see, select, and type into.
  That is also exactly what `needsText` counts, so the font and the glyph cannot
  disagree.

Text on a **sign** is not a marking and is documented separately
(`rules/signs.md`): it carries its own canvas position instead of an anchor, sits
in the topmost layer rather than under the glyphs, and is never drawn at an angle.
The two share exactly one thing, and it is the arithmetic above — `TEXT_SIZE *
CAP_HEIGHT / 2` centres a run on its band and a label on its plate alike.

`MarkingKind::Hatching` is still out, for a different reason that has nothing to
do with fonts: it is an **area**, and the `Marking` anchor is one link at one
position. (A gore's chevrons are not `Marking`s either, for the same reason —
they live in a triangle *between* two links — and belong on `GoreShape`; markings
spec OQ-4.) It is what remains of the fall-through's original list, alongside the
two kinds whose fresh payload is empty.

## Where each piece lives

| Piece | Where | Tested by |
|---|---|---|
| `markingForm` — the one call the renderer makes; `nearestOnPolyline`, `pointAlongPolyline`, `polylineLength`, `anchoredAlong`, `markingAnchor` | `src/editor/geometry.ts` | `geometry.test.ts` (pure) |
| `rimClearance` and `junctionRim` (private), `junctionRadius` — the far end an `end` anchor measures to | `src/editor/geometry.ts` | `geometry.test.ts` (pure) |
| `markingBar`/`markingTeeth`/`markingZebra`/`markingArrow`/`markingText`, `textWidth`, `spanCells`, `polygonsPath`/`polylinesPath`, and the build constants | `src/editor/geometry.ts` | `geometry.test.ts` (pure) |
| `laneLine`/`boundaryOffset`, and `laneLineOffsets`/`boundaryTaken` — the replacement, which is the only piece the *roads* read | `src/editor/geometry.ts` | `geometry.test.ts` (pure) |
| `MarkingShape`, `markingPaint`, `haloWidth`, `needsText` (**exported** — its consumer is `export.tsx`), the marking layer, `Interaction.onMarkingPointerDown`; `RoadShape`'s `replaced` prop | `src/components/Diagram.tsx` | `Diagram.test.tsx` via `renderToStaticMarkup` |
| `.marking-bar`, `.marking-teeth`, `.marking-zebra`, `.marking-arrow-stem`, `.marking-arrow-head`, `.marking-line` and its two style modifiers, `.marking-text` — the paint, and the only marking rules that reach an export. `.marking-text` is **fill only**: the face and the size are attributes (`rules/diagram-export.md`) | `src/styles/diagram.css` | `export.test.ts` |
| `.marking-hit`, `.marking-halo`, the panel-control rules — interaction, so **not** in `diagram.css` | `src/styles.css` | `export.test.ts`'s `CHROME` regex |
| `addMarking`, `setMarkingKind`, `setMarkingLane`, `setMarkingAnchor`, `moveMarking`, the `Selection` arm, `keepMarkings` and the three cascades, `unreachable` | `src/editor/state.ts` | `state.test.ts` |
| The marking tool: `placeMarking`, `projectOntoLink` (which owns the frame flip), the two pointer handlers, the drag arm | `src/components/Canvas.tsx` | the `bun run dev` pass — SVG bubbling and the drag's frame are what is under test |
| The toolbar button and `TOOL_KEYS` entry `m` | `src/components/Toolbar.tsx`, `src/App.tsx` | — |
| The marking panel: `MarkingKindPicker`, `MarkingSpan`, `MarkingAnchorPicker`, `MarkingDirections`, `MarkingLineStyle`, `MarkingText`, `MARKING_PICKER`, `TURN_DIRECTIONS`, `LINE_STYLES`, `MARKING_ANCHORS` | `src/components/Inspector.tsx` | the `bun run dev` pass |

`strokeAllowance` (`src/editor/export.tsx`) needed **no** change and
`export.test.ts` confirms it, for every kind: every marking is painted inside the
road it belongs to, the allowance is already half the widest road, and the bar's
4-unit stroke is what the `2` floor — half the fattest non-casing stroke in
`diagram.css` — was already sized for. The teeth and the zebra are *fill* geometry,
which `getBBox` measures with no allowance at all; the arrow is a fill and a stroke
narrower than the bar's; and a lane line runs the length of the road it is painted
on, at half the bar's weight. Text is fill too, painted inside its band — the
one kind where that was worth confirming rather than assuming.

## Open, and deliberately

- **Snapping along the road (spec OQ-5) — closed for auto-placed paint, open for
  a hand drag.** An `end`-anchored marking now measures to the pad rim
  (`junctionRadius`), so an imported arrow lands one arrow-length clear of the
  glyph by construction and needs no snap at all. What is still open is the
  gesture: a human dragging a stop line "to the junction" lands where they
  dropped it, and the obvious snap target — the rim — is **inside the junction's
  own hit disc**, which renders after the marking layer: measured at `r = 23.6`
  for a 3-lane arterial against the glyph's bar at `25.6`, so roughly two units of
  clearance on the centreline and about four in an outer lane (the disc is a
  circle, so its horizontal reach shrinks off-axis). Any snap design has to reckon
  with that disc. The cheaper answer now exists and is not a snap: set the
  marking's Anchor to End, and it sits at the rim and stays there.

  **The drag measured what that disc costs, and it is a one-way door.** Dragging
  paint *into* it works — the `<svg>` holds pointer capture for the gesture, so
  the disc never sees the moves — but the marking parked there **cannot be picked
  up again**: a click on it selects the junction node, and the marking tool cannot
  place there either. Recovery is undo, or grabbing a different marking. Lane
  arrows Phase 5 moves *auto-placed* paint out from under the disc by anchoring to
  the rim; a hand-drag can still park one there.
- **Markings follow a dragged node only if they say which end to follow (spec
  OQ-6, half-answered).** `anchor: "end"` holds a marking's distance from the
  `to_node`; a start-anchored one still sits proportionally further along as the
  road shortens, and neither *rescales* `position`, which would make the stored
  metres a function of layout — the thing keeping them in metres rules out.
  Dragging the **marking** is a different verb again: it moves paint, never the
  road under it.
- **Link reversal (spec OQ-1).** Nothing reverses a link today, so
  `position`-from-`from_node` is unambiguous. A reverse action must remap every
  marking to `length - position`, or every stop line jumps to the wrong end —
  though since Phase 2 it has the cheaper option of **flipping the anchor**
  instead, which is the same claim said in one field rather than recomputed into
  every marking.
