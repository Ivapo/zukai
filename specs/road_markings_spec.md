---
status: reviewed
last_updated: 2026-07-25
note: Render and place road-surface markings — stop and give-way lines, crossings, lane arrows, lane lines. Paint only; signs and any painted text wait on font embedding.
implemented: ["Phase 1"]
not_implemented: ["Phase 2", "Phase 3", "Phase 4"]
related: [specs/road_rendering_spec.md, specs/ramps_and_tapers_spec.md, specs/diagram_export_spec.md]
reference: "Road-atlas marking convention — a transverse bar where traffic stops, a triangle line where it gives way, a zebra where people cross, destination arrows in the lane they belong to, and a longitudinal line whose style says whether you may cross it. Not to-scale marking dimensions (that is Assimilator's business, and it has no markings anyway), and not signage, which is textual."
---

# Road Markings Spec

## 1. Goal

`specs/road_rendering_spec.md` made a link look like a road and
`specs/ramps_and_tapers_spec.md` made the joins between roads look like roads.
Both stopped short of the paint that tells a reader what the road *means*: which
lane goes where, where traffic stops, where people cross.

`Marking` has been in the model since the first commit and **nothing has ever
read it.** `decoration.rs:14` defines it, `types.ts:128` mirrors it,
`emptyDocument` seeds it (`document.ts:37`) and `normalizeDocument` restores it
(`document.ts:71`) — and a repo-wide search for the type finds no action, no
reducer case, no Inspector control, and no element. There is no way to make one
and nothing would draw it if there were.

End state — an approach to a signalised junction, drawn as a diagram. **Every
marking is born a `stop_line` on the lane the click landed in** (§2.4); the Kind
picker and the Span control (both Phase 2) are what turn it into anything else,
so the `[Pn]` tag on each line is the phase that enables that step:

```
File ▸ a 3-lane arterial arriving at a signalised crossroads

  N1 ──L1(arterial, 3 lanes)──▶ N2 (junction, signalized_cross)

  Marking tool, click lane 0 near N2            → M1 stop_line, lane 0      [P1]
    Inspector ▸ Span ▸ Whole carriageway        → M1 stop_line, lane None   [P2]
  Marking tool, click lane 2
    Inspector ▸ Kind ▸ Turn arrow ▸ [left]      → M2 turn_arrow, lane 2     [P3]
  Marking tool, click lane 0
    Inspector ▸ Kind ▸ Turn arrow ▸ [thru,rght] → M3 turn_arrow, lane 0     [P3]
  Marking tool, click lane 1
    Inspector ▸ Kind ▸ Lane line ▸ solid        → M4 lane_line{solid}, ln 1 [P4]

  → a bar across the carriageway a few units short of the junction pad, a left
    arrow in the offside lane, a shared through/right arrow in the kerb lane,
    and a solid line on the lane-1/lane-2 boundary that says "do not change
    here"
```

Today that same document draws three dashed dividers and nothing else. The
signalised glyph *does* paint a bar per arm (`.jn-stopbar`, `Diagram.tsx:712`),
but that bar is part of the **symbol** — it is what makes the glyph read as
"signals" — and it is drawn from the junction outward, not from anything the
human placed. The two are different objects and §2.7 keeps them that way.

## 2. Design

### 2.1 What is already in the model, and exactly how much of it fits

`MarkingKind` (`decoration.rs:32`, mirrored at `types.ts:118`) is internally
tagged by `type` and carries seven variants. The scope question this spec has to
answer first is which of them the `Marking` *anchor* can actually express:

| Kind | Anchor it needs | In scope |
|---|---|---|
| `stop_line` | a point across the carriageway | ✅ Phase 1 |
| `give_way_line` | a point across the carriageway | ✅ Phase 2 |
| `crosswalk` | a point, with a width of its own | ✅ Phase 2 |
| `turn_arrow { directions }` | a point in one lane | ✅ Phase 3 |
| `lane_line { style }` | a **run** along the link | ✅ Phase 4, by §2.3 |
| `hatching` | an **area**, usually between two links | ❌ §2.10 |
| `text { content }` | a point, plus a font | ❌ §2.8 |

`Marking` is `{ id, link, position, lane, kind }` (`decoration.rs:14`):
`position` is a distance along `link` in **metres**, and `lane` is an optional
`LaneIdx` — `None` meaning the whole carriageway. `MarkingId` is a transparent
string newtype (`ids.rs:67`), so `nextId(ids, "M")` (`document.ts:125`) mints one
exactly as nodes and links get theirs.

`Document.markings` is `#[serde(default, skip_serializing_if = "Vec::is_empty")]`
(`mod.rs:67`), so a document with no marking saves byte-identically and **no
`SCHEMA_VERSION` bump is needed anywhere in this spec** — nothing here adds a
field or an enum variant. (Contrast the gore, which cost a bump for one variant;
`rules/document-model.md` has the rule.)

### 2.2 `position` is metres, the schematic has none, and metres still win (decision, recorded)

This is the spec's central tension and it is worth settling before anything is
drawn. `Marking.position` is documented as "distance along the link from its
start, metres (as with Assimilator's `crossings`/`detectors` positions)". A
schematic link has no length in metres — it is however far apart the human
dragged two dots. `UNITS_PER_METRE` is `LANE_PX / DEFAULT_LANE_WIDTH` = `9/3.5`
(`geometry.ts:109`), so the 120-unit links every test fixture uses are **46.7 m**
of road, and a stop line "40 m along" would land at 103 units — almost at the far
end of a link the human meant to be a couple of hundred metres of motorway.

Three options, and the choice is not close:

- **Keep metres and convert with `UNITS_PER_METRE`.** The number stays meaningful
  to the one external consumer that has an opinion, and the conversion is the one
  every drawn width already goes through.
- Reinterpret `position` as a fraction of the drawn polyline. Cheap to draw,
  but it silently redefines a documented field whose whole point is the
  Assimilator parallel, and `decoration.rs` would then be lying.
- Add a second, presentation-side position. A new field in `layout` is free
  (§2.1), but it is two sources of truth for one quantity, and the first
  disagreement between them is unfixable.

**Metres win, and the placement gesture is what makes that painless:** the user
never types a distance. Clicking a road computes the world distance along the
drawn polyline and **divides by `UNITS_PER_METRE`** to store it, so the
round-trip is exact and the stored number is the honest reading of where the
marking sits on a road drawn at this scale. The consequence, stated rather than
discovered: **dragging a node shortens the road under its markings**, and a
marking whose metres now exceed the drawn length is **clamped to the end** rather
than drawn off it. That is the same posture the rest of `geometry.ts` takes with
degenerate input — `rayCircleExit` returns `0` outside its circle, `taperEdge`
returns its hypotenuse unmoved — and it keeps "ordinally faithful, not to scale"
(road spec §2.2) true of positions as well as widths.

### 2.3 A marking is a point; `lane_line` is a run (decision, recorded)

Five of the seven kinds sit at a point. `lane_line` does not — a longitudinal
line has a start and an end, and `Marking` has one `position` and nowhere to put
an extent. The table in §2.1 marks it in scope anyway, because the cheapest
honest reading costs nothing:

**A `lane_line` marking paints its boundary for the whole link, and `position` is
ignored.** No new field, no `SCHEMA_VERSION` question, and it is what a schematic
wants nine times in ten: "this line is solid *here*" is a statement about a
stretch of road, and in a schematic the stretch *is* the link. A marking that
needs to start and stop partway is a link that wants splitting at a waypoint,
which the model already supports and the renderer already draws through
(`graph.rs:31-33`).

**Which boundary `lane` names has to be pinned, because guessing it inverts the
drawing.** `RoadShape` derives its dividers as `bands.slice(1)`, each at
`b.offset + b.width / 2` (`Diagram.tsx:505-511`) — and since lane 0 is the
nearside lane at the most *positive* offset (`geometry.ts:184-204`), divider `i`
is the boundary between lane `i` and lane `i+1`. A `lane_line` with `lane = i`
takes exactly that boundary, so it **replaces** the dashed divider already there
rather than painting a second line beside it.

**`lane` on a `lane_line` therefore names a boundary, not a lane, and the count
does not match.** `bands.slice(1)` yields `n-1` dividers for `n` lanes, so valid
indices run `0 … n-2`. **`lane = n-1` — the offside-most lane — names no
boundary**: that lane's far side is the carriageway edge line, which is not a
divider and is not a `lane_line`'s to take. One click in three on a 3-lane road
lands there, so the rule has to be total:

- **The renderer skips a `lane_line` whose `lane` is `≥ n-1`** — it draws
  nothing, leaving both edge lines and every dashed divider intact. That is
  §2.5's posture applied to geometry: a line that silently moves to a different
  boundary is worse than one that is not drawn, because the drawing still looks
  deliberate.
- **No in-app gesture can produce one.** The Span control (§2.4, Phase 2) is
  kind-aware: for a `lane_line` it offers `Centreline` plus boundaries `0 … n-2`,
  not lanes. And **the Kind picker does not offer `lane_line` while the marking's
  `lane` is `≥ n-1`** — the user sets a valid boundary first. Nothing is re-homed
  behind their back.
- So the skipped case survives only in a hand-edited or shrunk-lane document,
  which is exactly the degenerate input §2.5's last paragraph governs.

`lane = None` is the road's centreline — the outermost case, discussed next.

**This discharges road spec OQ-4 / ramps OQ-6, the undivided-two-way
centreline** — though the two concluded different things, and the difference
matters. Road spec OQ-4 is already `RESOLVED — no centreline`, on the grounds
that the fix is a **model** field, out of scope there. Ramps OQ-6 re-read that
and proposed a **presentation** field instead (`LinkView.centreline`), leaving
open only which spec carried it. This spec needs **neither**: an undivided
two-way road gets a `lane_line { style: double }` with `lane = None`, painted
down the middle of the lane region, and the existing `Marking` anchor already
expresses it. Nothing is inferred: the human says the road is two-way by
painting the line, which is the same "the human chose this glyph" posture the
junction glyphs take (`CLAUDE.md`, "Layout is semi-automatic"). Phase 4 amends
road OQ-4 and resolves ramps OQ-6 accordingly.

### 2.4 Placement is a fourth tool, and the lane falls out of the click (decision, recorded)

`Tool` is `"select" | "node" | "link"` (`state.ts:29`) and gains `"marking"`.
Clicking a road with it places a marking on that link. **The placed marking is
always a `stop_line`** — one kind is all Phase 1 draws, and Phase 2's Kind picker
is what turns it into another. `addMarking` takes no kind argument.

**The click already carries everything the marking needs**, which is what keeps
this from growing a placement dialog:

- **Where along the link** — the nearest point on the link's *drawn* polyline
  (`drawnPolyline`, `Diagram.tsx:221`, which already carries the carriageway
  offset and the alignment shift), as an arc-length from the start, divided by
  `UNITS_PER_METRE`. A new pure `nearestOnPolyline(points, p)` in `geometry.ts`
  returns `{ along, offset }` — distance from the start and **signed** lateral
  distance, in the same frame `offsetPolyline` takes.
- **Which lane** — that same signed `offset`, matched against `laneBands(lanes,
  style)` (`geometry.ts:194`). A click inside a band is that lane; a click
  outside the lane region — the casing lip, or the fat invisible hit path
  (`road-hit`, `strokeWidth={w + 8}`, `Diagram.tsx:531`) — is `lane: undefined`,
  the whole carriageway. So clicking the kerb lane puts the marking in the kerb
  lane with no control to set.

**That fallback is a side door, not the way to a carriageway-wide marking.** A
bar across the whole carriageway is the *common* stop line, and asking for it by
clicking the 1.5-unit casing lip is not a gesture anyone finds. The deliberate
route is the **Span control** in the marking Inspector branch — `Whole
carriageway` plus one entry per lane — which lands in **Phase 2** alongside the
Kind picker, since they are the same panel. Phase 1 therefore ships with
`lane: undefined` reachable only by that side door, and its exit gate builds the
carriageway-wide case in a fixture rather than claiming it is placeable.

**`drawnPolyline` and `lateralShift` move from `Diagram.tsx` to `geometry.ts`**
as part of Phase 1. They are module-private today, and `Canvas.tsx` needs the
first one to place a marking on the polyline the road is actually drawn along.
Duplicating the derivation is precisely what `drawnPolyline`'s own doc comment
forbids — "they compose by addition, and **this is the only site that knows
it**" — so the fix is to move the one site, not add a second. Both are already
pure over `(doc, link, offsets)` and depend only on `document.ts` exports
(`linkPolyline`, `linkStyle`, `linkAlign`) and `geometry.ts`'s own
(`alignmentShift`, `offsetPolyline`); `document.ts` imports nothing but
`./types`, and `geometry.ts` already imports from it, so the move carries no
cycle. `Canvas.tsx` builds the third argument with `carriageways(doc)`
(`geometry.ts:634`), already exported. `rules/road-rendering.md`'s "Where each
piece lives" table lists both functions in the `Diagram.tsx` row and is updated
in the same pass.

**`onLinkPointerDown` has to change, and the current early-return is why.** It
reads `if (tool !== "select") return;` **without** `stopPropagation`
(`Canvas.tsx:92-96`), deliberately, so that other tools "act on the background".
For the marking tool that is exactly wrong — the click would fall through to
`onBackgroundPointerDown` and be lost. The marking tool must take the link
branch, stop propagation, and dispatch.

**`onMarkingPointerDown` branches on the tool itself, and SVG bubbling is why it
has to.** Markings are their own layer, drawn after every road (§2.7), so a
marking's hit target is **not a descendant** of any `road` group — and SVG events
bubble to ancestors only. `onLinkPointerDown` therefore *cannot* fire from a
click on a marking, and "let the click fall through to the road" is not
available: not stopping propagation sends the event to the `<svg>`'s
`onBackgroundPointerDown` instead, which under any non-node/non-link tool falls
into the select tail and **clears the selection and starts a pan**
(`Canvas.tsx:54-56`). `pointer-events: none` is no better — it would make
markings unselectable under every tool, since CSS cannot see the tool.

So the behaviour is written in the handler, not inherited from the tree:
`Canvas`'s `onMarkingPointerDown` stops propagation and then, if
`tool === "marking"`, dispatches `addMarking` against **that marking's own
`link`** — clicking near an existing marking places another on the same road,
because a tool that refuses to place a second marking near the first is the more
surprising behaviour. Under `select` it selects the marking. Under any other tool
it does nothing, and **`onBackgroundPointerDown` is left exactly as it is**: the
marking tool clicking empty canvas clears the selection and pans, the same as the
select tool, since there is no road to place anything on.

**The cost of that unconditional `stopPropagation`, stated so it is a trade and
not a surprise: a marking is a small dead zone for the node tool.** A node-tool
click over a road falls through to the background and adds a node today, exactly
because `onLinkPointerDown` declines to stop propagation ("let other tools act on
the background", `Canvas.tsx:93`) — and `onMarkingPointerDown` takes the opposite
posture, so a node cannot be dropped on top of an existing marking. Worth it: the
alternative is the pan bug above, the target is a few units wide, and nudging the
click is the whole remedy.

### 2.5 A marking outlives its link unless something says otherwise (constraint, recorded)

`deleteSelection` (`state.ts:599-645`) removes a link, its `layout.links` entry,
and — for a node — every incident link and the junction record. It knows nothing
about `doc.markings`, because there has never been one to know about.

Left alone, deleting a road leaves its markings behind: **invisible** (nothing
draws a marking whose link is gone), **saved** (`markings` is serialized
whatever it references), and **permanent** (nothing ever collects them). The
file grows a ghost per deleted road and no assertion in the suite notices.

So the link arm and the node arm of `deleteSelection` both filter `doc.markings`,
and Phase 1's gate tests it directly rather than trusting it.

**The same class of bug sits on `setLinkLanes`** (`state.ts:483`), which is
already scarred by it: the road spec's §2.5 note records that the lane stepper
used to destroy a lane's `kind` two controls above. Shrinking a 4-lane link to 2
strands any marking on lane 2 or 3. A stranded marking is **dropped**, not
clamped to the surviving lanes — a turn arrow that silently moves to a different
lane is worse than one that goes away, because the drawing still looks
deliberate.

**A marking the cascades cannot reach is skipped, not crashed on.** They cover
every edit made in the app, but `normalizeDocument` (`document.ts:57`) validates
nothing, so an imported or hand-edited file can still carry a marking whose
`link` names no link, or whose `lane` is past the link's lane count. Indexing
`laneBands` out of range yields `undefined` and then `NaN` coordinates, which SVG
renders as an invisible-but-corrupt path. **The renderer skips both cases** — no
element, no throw — which is the floor posture the codebase already takes with
degenerate input, stated at `laneBands`' own empty-array guard ("only a
hand-edited or imported document can get here — which is why it needs a floor
rather than an assertion").

### 2.6 Selection grows a third arm, and nothing warns you

`Selection` is `{kind:"node"|"link"}` (`state.ts:32-34`) and gains
`{kind:"marking"; id: MarkingId}`. Four sites narrow on it and each needs the
arm: `selectionValid` (`state.ts:279`), `deleteSelection` (`state.ts:599`),
`isSelected` (`Diagram.tsx:442`), and the Inspector's top-level branches
(`Inspector.tsx:59` onward).

**None of the four is exhaustiveness-checked, and adding the arm compiles
clean.** This is the trap of the phase, so it is worth being exact about why the
compiler is no help: every id is a bare `type X = string` (`types.ts:12-22`), so
`MarkingId`, `LinkId` and `NodeId` are *the same type*, and all four sites narrow
with a binary `if`/ternary whose `else` is an implicit fall-through, not a
discriminated `switch`. Three concrete failures result, every one of them
silent:

- `selectionValid` (`state.ts:281-283`) is a ternary — a marking selection takes
  the `findLink` branch, resolves `undefined`, and the selection is **dropped
  after every undo/redo**.
- `Inspector` (`Inspector.tsx:59`) branches on `"node"` and lets link be the
  fall-through — a selected marking runs `findLink` on a marking id, misses, and
  renders the **blank `<aside>`** of `Inspector.tsx:104`. Not a wrong panel: no
  panel at all, with nothing to say why.
- `deleteSelection` (`state.ts:603`) tests `kind === "link"` first, so a marking
  falls into the **node** arm — which filters nothing out but still returns a
  freshly built `doc`, **dirtying the document and pushing an undo snapshot while
  deleting nothing**.

So each site gets an explicit `kind === "marking"` arm, and `selectionValid` and
`deleteSelection` are converted to a `switch` with a `never`-typed default, so a
*fourth* selection kind does not repeat this. `isSelected` is a separate matter:
its `kind` parameter is its own `"node" | "link"` union (`Diagram.tsx:442`),
widened rather than narrowed. Phase 1's exit gate tests all three failures
directly, because none of them shows up as a build error.

A marking gets a hit target and a halo like any other selectable thing, gated on
`interaction` so an export carries neither (`rules/diagram-export.md`, "the
absent `interaction` prop is the whole of export mode").

### 2.7 What each kind paints, and what it must not

Every marking is drawn from the same three numbers — a point on the drawn
polyline, the unit direction along it, and the band it belongs to — so the
per-kind work is small:

| Kind | Drawn as | Spans |
|---|---|---|
| `stop_line` | one solid transverse bar | the lane band, or the lane region |
| `give_way_line` | a row of solid triangles pointing at the driver | as above |
| `crosswalk` | zebra stripes parallel to travel | as above, with its own depth |
| `turn_arrow` | a shaft plus one branch per direction | the lane band only |
| `lane_line` | solid / dashed / double, replacing the divider | the whole link (§2.3) |

**The arrow vocabulary, pinned, because "one head per direction" cannot draw a
U-turn.** `TurnDirection` has **six** variants (`decoration.rs:61-74`), not the
three the §1 example uses. An arrow is one shaft up the lane's centre plus one
**branch** per direction, every branch leaving the shaft's far end and ending in
a triangular head. Five branches are straight stubs at a fixed bearing off the
travel direction; the sixth is not:

| Direction | Branch |
|---|---|
| `through` | 0° — collinear with the shaft, head at its end |
| `slight_left` / `slight_right` | ±30° stub |
| `left` / `right` | ±90° stub |
| `u_turn` | a 180° hook — a semicircular arc of radius ¼ the band width, turning back alongside the shaft, its head pointing **at the driver** |

So a shared through/right lane draws one shaft with two branches, and a U-turn
lane draws a shaft with a hook rather than a head on a stub. Every branch is
clipped to stay inside the band, which is what bounds the hook's radius.

Three constraints, each of which a plausible implementation gets wrong:

- **A marking is its own layer, not a child of the road it paints.** `RoadShape`
  draws hit → halo → casing → lane bands → edge lines → dividers → arrow
  (`Diagram.tsx:521-562`), and a marking is paint, so it belongs above the
  surface tints — but nesting it inside `RoadShape`'s `<g>` is wrong twice over:
  that group carries `onPointerDown → onLinkPointerDown` (`Diagram.tsx:524-526`),
  so a nested marking's clicks would route to link selection, and a road drawn
  *after* its neighbour would paint over the neighbour's markings. So
  `MarkingShape`s render as a **sibling layer in `Diagram`, after every road and
  taper and before the link preview and the nodes**. Above all asphalt; below the
  junction glyphs, because a pad is the intersection's own surface and paint
  placed under one is genuinely covered.
- **A `turn_arrow` with no lane has no home.** `lane: None` means the whole
  carriageway, which is meaningless for an arrow. It draws in the nearside lane,
  and the Span control (§2.4) does not offer `Whole carriageway` while the kind is
  `turn_arrow` — better than drawing a carriageway-wide arrow that means nothing.
- **The glyph's stop bars are not markings and must not be unified with them.**
  `.jn-stopbar` is drawn per arm by `signalized_cross` (`Diagram.tsx:693-723`)
  and says "this junction has signals"; a `stop_line` marking is paint a human
  placed. A document can carry both, and that is not a duplicate — it is a
  signalised junction whose approach also has a painted bar. Any attempt to
  suppress one from the other couples the glyph to the decoration list.

### 2.8 No text, and the reason is a hard line (decision, recorded)

`MarkingKind::Text` and the whole of `Sign` are **out of scope**, and not for
tidiness. The diagram renders zero `<text>` today, and
`rules/diagram-export.md`'s standing constraint says why that matters: an
exported SVG reaches no external font, so the first glyph either falls back to
whatever the viewer has — or, in the PNG path, **bakes that substitution in
permanently**, because `rasterizePng` renders through the webview. Fixing it
means embedding a font as a data-URI `@font-face` inside `diagram.css`, which is
its own piece of work with its own size and licensing questions (export spec
OQ-4).

Every kind this spec does render is pure geometry. That is the cut: **this spec
adds no `<text>` to the drawing**. Note that nothing pins that absence today —
`export.test.ts` asserts `not.toContain("url(")` in five places but says nothing
about `<text>` — so Phase 1 **adds** the assertion rather than keeping an existing
one green. Signs, painted text, and the font problem are the next spec, which
inherits export OQ-4 as its first paragraph.

### 2.9 Where the logic lives

The split `rules/road-rendering.md` and `rules/diagram-export.md` established:

| Piece | Where | Pure? |
|---|---|---|
| `nearestOnPolyline`, `pointAlongPolyline`, `markingAnchor`, arrow/zebra/triangle point builders | `src/editor/geometry.ts` | ✅ vitest |
| `drawnPolyline`, `lateralShift` — **moved in** from `Diagram.tsx` (§2.4) | `src/editor/geometry.ts` | ✅ vitest |
| `MarkingShape`, the marking layer, hit targets | `src/components/Diagram.tsx` | ✅ via `renderToStaticMarkup` |
| `Interaction.onMarkingPointerDown` — the new callback (`Diagram.tsx:48-54`) | `src/components/Diagram.tsx` | — |
| Marking paint | `src/styles/diagram.css` | — reaches exports free |
| `addMarking`/`deleteMarking`/`setMarkingKind`/`setMarkingLane`, the `Selection` arm, the delete cascades | `src/editor/state.ts` | ✅ `state.test.ts` |
| The marking tool | `src/components/Canvas.tsx`, `src/components/Toolbar.tsx` | — |
| Its keyboard shortcut — `TOOL_KEYS` is `{v, n, l}` (`App.tsx:22`) and gains `m` | `src/App.tsx` | — |
| The marking Inspector branch | `src/components/Inspector.tsx` | — |

Three of those rows are plumbing a reader would otherwise discover at
implementation time: selecting a marking needs a **new `Interaction` callback**
(the interface has exactly five members today and none of them fits);
`drawnPolyline` is **module-private** and has to move before `Canvas.tsx` can
place anything on it (§2.4); and the marking tool needs a **`TOOL_KEYS` entry**,
since every existing tool has one and a button-only tool would be the odd one.

**No Rust at all.** `decoration.rs` and its TypeScript mirror already carry every
type this spec renders, so unlike the last two specs there is no mirror
discipline to observe and no `cargo` gate beyond the pre-commit hook's.

### 2.10 Non-goals

- **Not `MarkingKind::Hatching`, and the reason corrects a sibling spec.** Ramps
  §2.5 deferred the gore's chevrons here, on the stated grounds that "those are
  `Marking`s". **They are not** — a `Marking` is anchored to *one link at one
  position*, and a gore's chevrons live in a triangle *between two links at a
  node*, which that anchor cannot express. The gore's chevrons are presentation
  on the gore glyph and belong with `GoreShape` (`Diagram.tsx`), not here; see
  **OQ-4**. `hatching` as a link-anchored area (a painted island in a widening
  carriageway) is a real thing, but it is an extent like `lane_line` without
  `lane_line`'s "the whole link" escape, so it waits.
- **Not signs, not painted text** — §2.8.
- **Not to-scale marking dimensions.** Bar widths and arrow sizes are schematic
  build constants in the manner of `TAPER_LENGTH` (`geometry.ts:252`).
- **Not movements or signal plans.** Which lanes a turn arrow is *entitled* to
  point is `Movement` data, unrendered and unvalidated; a turn arrow here is
  paint the human drew, and nothing cross-checks it against the junction. That
  is the junction-semantics spec.
- **Not marking-aware export changes.** `strokeAllowance` (`export.tsx:69`) is
  expected to need none: every marking is inside the road it is painted on, and
  the allowance is already half the widest road. Phase 1 **confirms** this rather
  than pre-emptively widening it — the same expected-no-change check ramps §2.7
  recorded, which held.

## 3. Open questions

- **OQ-1** — **Does a marking need to survive a link reversal?** Nothing reverses
  a link today, so `position`-from-`from_node` is unambiguous. If a reverse
  action ever lands it must remap every marking to `length - position`, or every
  stop line jumps to the wrong end. (answerable-from-code: no such action exists
  in `state.ts:85-101`; recorded so it is not discovered by a user.)
- **OQ-2** — **`crosswalk` depth.** A zebra has a real extent along the road, and
  §2.3 rules extents out for everything but `lane_line`. Proposed: a schematic
  build constant (`CROSSWALK_DEPTH`, ~12 units — a lane and a third), centred on
  `position`, on the same footing as `TAPER_LENGTH`. (design-call.)
- **OQ-3** — **Should `lane_line` suppress the dashed divider it replaces, or
  overpaint it?** **RESOLVED (review round 1) — replace.** It is one line of
  `RoadShape`'s divider derivation and reads correctly; overpainting is simpler
  but leaves a dashed line under a solid one, visible at the dash gaps in an
  export. §2.3 and Phase 4 already assume this. (design-call, taken.)
- **OQ-4** — **Where do the gore's chevrons actually go?** §2.10 establishes they
  are not `Marking`s. They are a small addition to `GoreShape` needing no model
  change — a fan of chevrons along the gore's axis of symmetry. Fold into this
  spec as a fifth phase, or make it a one-off follow-up to the ramps spec?
  (design-call; proposed: a follow-up, since it shares nothing with the marking
  pipeline but the word "paint".)
- **OQ-5** — **Should the marking tool snap along the road?** Free placement is
  simplest, but a stop line a human meant to put "at the junction" will sit a few
  units short of it and look sloppy. A snap to the junction pad's rim — the
  `rayCircleExit` distance Phase 1 of the ramps spec already computes — would put
  it where a stop line belongs. **The snap target is inside a dead zone, which is
  the catch:** nodes render after the marking layer (§2.7) and a junction's hit
  disc is `r = outerR + 2` (`Diagram.tsx:668`), so a click within about `rp + 2`
  of a junction selects and drags the glyph instead of placing a marking. For
  §1's 3-lane arterial that is 23.6 units against the glyph's own `.jn-stopbar`
  at `rp + 4` — placeable, with roughly two units of clearance, and no more. Any
  snap-to-rim design has to reckon with that disc. (design-call; does not block
  Phase 1, but Phase 1's `bun run dev` pass is where the clearance first shows.)
- **OQ-6** — **Should a marking follow the road when a node is dragged?** §2.2
  settles what happens to the *stored* number (nothing — metres are absolute, and
  a marking past the drawn end clamps to it), but not whether that is what a user
  expects. Shortening a road by 30% leaves a stop line proportionally further
  along it. The alternative — rescaling every marking's `position` on a drag —
  makes the stored metres a function of layout, which §2.2 rejected. (design-call;
  proposed: leave it, and revisit only if it reads badly in the Phase 1 `bun run
  dev` pass. Does not block any phase.)

## 4. Implementation phases

Strictly sequential; each is one plan-mode pass with a concrete exit gate.

### Phase 1 — A marking exists: placement, selection, lifecycle, and `stop_line`

- **Scope:** the whole pipeline for **one** kind, so every later phase is only
  geometry. The Inspector's marking branch is **read-only here** — its editing
  controls are Phase 2, which keeps this phase to the pipeline.
  - *Geometry:* `nearestOnPolyline(points, p)` → `{ along, offset }` and
    `pointAlongPolyline(points, along)` → `{ at, dir }` in `geometry.ts` (§2.4);
    **move** `drawnPolyline` and `lateralShift` in from `Diagram.tsx` (§2.4).
  - *State:* `Tool` gains `"marking"` (`state.ts:29`); `Selection` gains its third
    arm and the four sites of §2.6, two of them converted to a `never`-checked
    `switch`. `addMarking` (minting via `nextId(…, "M")`, always a `stop_line`),
    `deleteMarking`, and the **three cascades** of §2.5 — a deleted link and a
    deleted node both drop their markings, and `setLinkLanes` drops a marking
    stranded past the new lane count.
  - *Canvas:* `onLinkPointerDown` takes the marking branch and stops propagation
    (`Canvas.tsx:92`); the new `onMarkingPointerDown` branches on the tool per
    §2.4, since a marking's click cannot reach the road it sits on;
    `onBackgroundPointerDown` is left untouched. A Toolbar button and a
    `TOOL_KEYS` entry (`App.tsx:22`).
  - *Drawing:* `MarkingShape` and the marking layer in `Diagram.tsx` (§2.7's
    sibling-layer rule) drawing `stop_line` only, plus its hit target, halo and
    the new `Interaction.onMarkingPointerDown`, gated on `interaction`; the
    skip-degenerate guards of §2.5. Paint in `diagram.css`. An Inspector branch
    showing the marking's link, lane and kind, plus a Delete.
- **Exit gate:** `bun run build` + `bun run test` green.
  - `geometry.test.ts`: `nearestOnPolyline` returns the exact arc-length and a
    **signed** offset whose sign matches `offsetPolyline`'s (a magnitude test
    passes under an inversion — the trap the road spec hit four times); a point
    past either end clamps to that end; `pointAlongPolyline` round-trips against
    it on a bent polyline; and the moved `drawnPolyline` still composes both
    lateral terms for an aligned link of a divided road.
  - `state.test.ts`: placing a marking is undoable like any other edit;
    **deleting its link removes it**; **deleting its node removes it**; shrinking
    the lane count past its lane removes it; a document that never placed one
    still has `doc.markings === []` (the byte-level elision is Rust serde's
    `skip_serializing_if`, already covered by the persistence tests). Plus the
    three §2.6 silent failures, none of which is a build error: a **marking
    selection survives undo/redo** (`selectionValid`), **deleting a selected
    marking removes exactly it** and leaves nodes and links untouched, and
    **deleting a marking that is already gone does not dirty the document** or
    push a snapshot.
  - `Diagram.test.tsx`: a `stop_line` on lane 0 of a 3-lane road due east draws a
    transverse bar at that band's offset and width, pinned exactly; one with
    `lane: undefined` (built in the fixture — §2.4 defers the Span control to
    Phase 2) spans the whole lane region; a marking on a missing link and one
    with an out-of-range lane each emit **nothing** (§2.5); an empty document is
    still `<g class="diagram"></g>`; and the **`.jn-stopbar` of a signalised
    junction is untouched** (§2.7).
  - `export.test.ts`: `strokeAllowance` unchanged (§2.10), and a marking document
    emits no `<text>` (a new assertion — §2.8) and no `url(` in the stylesheet.
  - A `bun run dev` pass: place, select and delete a marking, and delete the road
    under one. Then the two §2.4 bubbling cases, which no unit test covers:
    clicking an **existing marking** with the marking tool places another on the
    same road (it must not clear the selection or start a pan), and clicking it
    with the select tool selects it.
- **Docs touched:** a new `rules/road-markings.md` (or a section in
  `rules/road-rendering.md` — decide in the plan); `rules/road-rendering.md`'s
  "Where each piece lives" table, whose `Diagram.tsx` row still lists
  `drawnPolyline`/`lateralShift` (§2.4); `rules/history.md` for the new actions;
  the project-memory roadmap.
- **Shipped 2026-07-25.** Two decisions the phase settled, both taken at plan
  time and both deviations from the letter of the scope above:
  - **The rule doc is a new `rules/road-markings.md`**, cross-linked from
    `rules/road-rendering.md` (which is already 400 lines about how a link
    becomes a road, and has three more phases of markings still to absorb). The
    line between the two files is *who chose it*: road rendering is derived from
    the model, a marking is a decoration a human placed.
  - **`deleteMarking` was not shipped.** Nothing would dispatch it — the
    Inspector's Delete fires `deleteSelection`, exactly as the node and link
    panels do and as Delete/Backspace does, and `deleteSelection`'s new marking
    arm covers every route. An action with no dispatcher is dead code.

  Three things worth carrying forward that the spec did not predict:
  - **`unreachable(x: never): never` rather than `const _never: never = sel`** —
    `tsconfig.json` sets `noUnusedLocals`, so §2.6's "`never`-typed default" has
    to consume its argument.
  - **`.marking-halo` is butt-capped**, not round like `.road-halo`. The rule is
    the same both times (a halo matches the shape it highlights), but round caps
    balloon a lane-wide bar past its own lane — caught in the `bun run dev` pass,
    not by any assertion.
  - **OQ-5's arithmetic confirmed in the app**: for §1's 3-lane arterial the
    junction hit disc measures `r = 23.6` against the glyph's own bar at `25.6`.
    Two units of clearance on the centreline, about four in an outer lane — the
    disc is a circle, so its horizontal reach shrinks off-axis. OQ-6 was checked
    too and needs nothing: shortening a 600-unit road to 350 left a mid-road stop
    line at 86% along, still on asphalt in its lane.

### Phase 2 — The Inspector earns its keep: kind, span, and the transverse pair  (depends on Phase 1)

- **Scope:** the marking Inspector branch becomes editable, and two more kinds
  land behind it. Neither half touches placement, selection or lifecycle.
  - *Inspector:* a **Kind picker** (`setMarkingKind`) and a **Span control**
    (`setMarkingLane`) — `Whole carriageway` plus one entry per lane — which is
    the deliberate route to `lane: undefined` that §2.4 defers here. Both are
    kind-aware per §2.3 and §2.7: `turn_arrow` is not offered `Whole
    carriageway`, `lane_line` lists boundaries `0 … n-2` rather than lanes, and
    the Kind picker withholds `lane_line` while `lane ≥ n-1`. Those last two
    constrain a kind that does not draw until Phase 4; the control is written
    once, here, rather than retrofitted.
  - *Drawing:* two more `MarkingKind` arms in `MarkingShape` and their point
    builders in `geometry.ts` — a row of triangles pointing back at the driver,
    and zebra stripes parallel to travel over `CROSSWALK_DEPTH` (OQ-2). Both take
    the band-or-carriageway span Phase 1 established.
- **Exit gate:** `bun run build` + `bun run test` green. `geometry.test.ts` pins
  the triangle row's count and pitch for a 3-lane carriageway and for a single
  lane, and that the zebra's stripes stay **inside** the band at every lane count
  (a stripe spilling onto the verge is the failure). `state.test.ts`:
  `setMarkingLane` to `undefined` and back is undoable and leaves `position`
  untouched; `setMarkingKind` preserves `lane`. `Diagram.test.tsx`: each kind
  emits its own class token and a `stop_line` document is unchanged from Phase
  1's pins. A `bun run dev` check that a give-way line points the way traffic
  comes, and that the Span control turns §1's M1 into a carriageway-wide bar.

### Phase 3 — `turn_arrow`  (depends on Phase 2)

- **Scope:** the arrow vocabulary of §2.7 — one shaft up the lane's centre plus
  one **branch** per `TurnDirection` (all six — `types.ts:105-112`,
  `decoration.rs:61-74`), so a shared through/right lane draws one arrow with two
  branches rather than two arrows. Five branches are straight stubs at the fixed
  bearings §2.7 tabulates; `u_turn` is the hooked one. `lane: None` falls back to
  the nearside lane (§2.7). A direction multi-select in the Inspector.
- **Exit gate:** `bun run build` + `bun run test` green. `geometry.test.ts`: a
  single `through` arrow is symmetric about its lane's centre; a two-direction
  arrow shares one shaft (the two branch point-sets have the shaft's far end in
  common); each of the six directions puts its head at the tabulated bearing,
  within a degree; every branch stays inside the lane band at the narrowest class
  (`ramp`, `classWidthFactor` 0.8 — `geometry.ts:120-125`); and a `u_turn`'s head
  points within a degree of the **reverse** of travel with its hook inside the
  band — the concrete form of "does not degenerate". `Diagram.test.tsx`: an arrow
  in lane 2 of a 3-lane road sits at that band's offset, and one with no lane
  draws in lane 0. A `bun run dev` check on §1's approach.

### Phase 4 — `lane_line`, and the two-way centreline  (depends on Phase 3)

- **Scope:** the one longitudinal kind (§2.3) — spans the whole link, `position`
  ignored, `lane = i` **replacing** the dashed divider between lanes `i` and
  `i+1` (OQ-3), `lane = None` painting the centreline of the lane region, and
  `lane ≥ n-1` **drawing nothing** (§2.3's boundary rule; Phase 2's controls
  already keep it unreachable in-app). `solid` / `dashed` / `double` per
  `LineStyle` (`types.ts:115`). This is the one phase that reaches into
  `RoadShape`'s divider derivation (`Diagram.tsx:505-511`) rather than drawing
  beside it.
- **Exit gate:** `bun run build` + `bun run test` green. `Diagram.test.tsx`: a
  `lane_line` on lane 1 of a 4-lane road leaves **two** dashed dividers and one
  solid line, at the same offset the divider had — pinned exactly, since drawing
  both is the failure and a count-of-lines assertion catches only half of it; a
  `double` line draws two strokes symmetric about that offset; a `lane = None`
  line lands on the lane region's centre; **a `lane_line` on the last lane of a
  3-lane road emits no extra line and leaves both dashed dividers and both edge
  lines intact**; and a document with no `lane_line` emits markup **unchanged**
  from Phase 3. `export.test.ts`: a two-way road with a double centreline carries
  it into the file. Plus a `bun run dev` pass on an undivided two-way road, which
  is what road spec OQ-4 has been waiting for.
- **Docs touched:** `rules/road-rendering.md`'s "No centreline (spec OQ-4)"
  section is now wrong — replace it. In `road_rendering_spec.md`, OQ-4 is already
  `RESOLVED — no centreline` with a *different* answer ("the fix is a model
  field"), so **amend** it — the resolution stands for that spec, and a note
  records that the eventual fix needed no field at all; its §2.5 line-styles
  table row (`Centreline | … | to be decided — OQ-4`) is settled in the same
  pass. Mark ramps **OQ-6 RESOLVED** (neither the `graph` field it rejected nor
  the `LinkView` field it proposed). Update the project-memory roadmap.

## 5. Review log

### Round 1 — 2026-07-25 — `VERDICT: NOT READY` (4 blocking)

Clean-room reviewer with repo access, per `spec-authoring.md` §7. Every
`file:symbol` citation and every key assumption was re-checked against the source
(and independently re-verified by the author before adjudication).

**Blocking, all four accepted and folded in:**

1. **§1's usage example contradicted §2.4/§2.7, and `lane: None` had no
   discoverable gesture.** The example placed a carriageway-wide bar by clicking
   lane 0, which §2.4's band-matching cannot produce, and no phase added a lane
   control — leaving the *most common* stop line reachable only by clicking the
   1.5-unit casing lip. Fixed: §1 rewritten and phase-annotated; `addMarking`
   pinned to `stop_line`; a **Span control** added to Phase 2's Inspector as the
   deliberate route, with §2.4 recording the click fallback as a side door.
2. **§2.6's "TypeScript's exhaustiveness checking finds all four at build time"
   was false — the best catch of the round.** All ids are bare `type X = string`
   (`types.ts:12-22`) and all four sites narrow with a binary `if`/ternary, so
   the new arm compiles clean and misroutes silently: `selectionValid` drops the
   selection on undo/redo, `Inspector` renders the link panel, and
   `deleteSelection` takes the **node** arm and dirties the document with an undo
   snapshot while deleting nothing. §2.6 rewritten to state the trap; two sites
   convert to a `never`-checked `switch`; Phase 1's gate tests all three.
3. **A `lane_line` on the offside-most lane named a divider that does not
   exist.** `bands.slice(1)` gives `n-1` dividers, so `lane = n-1` has no
   boundary — one click in three on a 3-lane road. §2.3 gained a total rule: the
   renderer skips it, and Phase 2's kind-aware controls make it unreachable
   in-app; Phase 4's gate pins the skip.
4. **Phase 3's "`u_turn` does not degenerate" was unverifiable and the shape
   undefined.** "One head per direction" cannot express a U-turn, and
   `TurnDirection` has six variants the spec never enumerated. §2.7 gained a
   branch-bearing table (`through` 0°, slight ±30°, hard ±90°, `u_turn` a 180°
   hook) and Phase 3's gate became a per-direction bearing assertion.

**Non-blocking, all accepted:** stale `Diagram.tsx` line numbers (the whole file
was cited at the pre-gore commit — re-swept to HEAD); `mod.rs:56` → `:67`; §2.8's
claim that `<text>` assertions exist (they don't — Phase 1 adds one); §2.3's
misreport of road spec OQ-4 (it concluded a *model* field; only ramps OQ-6
proposed a presentation one) and Phase 4's close-out recast as an **amendment** to
an already-`RESOLVED` OQ; §2.9's three missing plumbing rows (the new
`Interaction` callback, `drawnPolyline`'s module-privacy — resolved by moving it
and `lateralShift` to `geometry.ts`, and `App.tsx`'s `TOOL_KEYS`); §2.7's
self-contradictory z-order and unspecified nesting (settled: a sibling layer,
because `RoadShape`'s `<g>` carries `onLinkPointerDown`); no stated handling for
hand-edited documents (§2.5 gained a skip-don't-crash paragraph); the
"byte-identical" gate clause restated as the TS-checkable assertion it is; OQ-3
marked `RESOLVED`; and Phase 1's size, relieved by moving the Inspector's editing
controls into Phase 2 (no renumbering — still four phases). One new **OQ-6** was
recorded on whether markings should follow a dragged node.

**Rejected:** none.

### Round 2 — 2026-07-25 — `VERDICT: NOT READY` (1 blocking, newly introduced)

Same reviewer, resumed. All four round-1 blockers confirmed resolved and
re-verified against HEAD. One new blocker, introduced by round 1's own fixes:

1. **§2.4's "clicking an existing marking places a new one" was impossible under
   §2.7's sibling-layer rule** — both were added in the same round and conflict.
   A marking's hit target is not a descendant of any `road` group and SVG events
   bubble to ancestors only, so `onLinkPointerDown` can never fire from it; not
   stopping propagation instead reaches `onBackgroundPointerDown`, whose select
   tail (`Canvas.tsx:54-56`) **clears the selection and starts a pan**, and
   `pointer-events: none` would make markings unselectable under every tool.
   Accepted: §2.4 now writes the behaviour into `onMarkingPointerDown` as a
   tool-branch against the marking's own `link`, states that
   `onBackgroundPointerDown` is left untouched, and Phase 1's scope and `bun run
   dev` gate both cover it.

**Non-blocking, all accepted:** §2.7 said "Four constraints" over three bullets
(count corrected — no bullet was lost); §2.4's dependency list for the
`drawnPolyline` move omitted `linkStyle`/`linkAlign` and the `carriageways(doc)`
argument `Canvas.tsx` needs (added; the no-cycle conclusion was independently
confirmed and stands); `export.test.ts`'s `url(` assertions number five, not
four. The reviewer also corrected §2.6's own description of the `Inspector`
failure — it renders the **blank** `<aside>` of `Inspector.tsx:104`, not a
populated link panel — which is folded in, since §2.6's whole point is being
exact about what fails silently.

**Rejected:** none. The Phase 1/2 rebalance and the §2.3 boundary rule were
confirmed sound, including the `setLinkLanes` shrink path that leaves a
`lane_line` on a now-nonexistent boundary and lands it in the skip.

### Round 3 — 2026-07-25 — `VERDICT: READY` (converged)

Same reviewer, resumed. Round 2's blocker confirmed resolved: the reviewer
re-derived the diagnosis against `Canvas.tsx:54-56`, confirmed
`onMarkingPointerDown(e, marking)` already carries everything the branch needs
(`marking.link`, plus §2.4's `drawnPolyline`/`carriageways`/`nearestOnPolyline`/
`laneBands`), and confirmed §2.4 now *derives* the handler contract from §2.7's
layer rule rather than contradicting it. The three round-2 corrections verified
at HEAD. **Zero blocking findings.**

Two non-blocking notes were raised for the record and both folded in, since each
records a real consequence a reader would otherwise hit at run time:

- The unconditional `stopPropagation` makes a marking a small **dead zone for the
  node tool** — `onLinkPointerDown` deliberately does not stop propagation
  (`Canvas.tsx:93`) and this handler does, so a node cannot be dropped on an
  existing marking. §2.4 now states the trade.
- **The junction hit disc sits above the marking layer** (`jn-hit`, `r = outerR +
  2`, `Diagram.tsx:668`), so clicks within about `rp + 2` of a junction drag the
  glyph instead of placing paint. This matters most to **OQ-5**, whose proposed
  snap target lands inside that disc; OQ-5 now says so, with the §1 clearance
  worked out.

Converged in three rounds. `status` moves `draft` → `reviewed`; the spec is
cleared for implementation, Phase 1 first.
