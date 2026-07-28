---
status: implemented (Phases 1–4 shipped 2026-07-25, reviewed in 3 rounds; Phase 5 reopened, reviewed in 3 scoped rounds and shipped 2026-07-28)
last_updated: 2026-07-28
note: Render and place road-surface markings — stop and give-way lines, crossings, lane arrows, lane lines. Paint only; signs and any painted text wait on font embedding. Reopened 2026-07-28 for the two-headed arrow (§2.11, Phase 5), now shipped.
implemented: ["Phase 1", "Phase 2", "Phase 3", "Phase 4", "Phase 5"]
not_implemented: []
related: [specs/road_rendering_spec.md, specs/ramps_and_tapers_spec.md, specs/diagram_export_spec.md, specs/lane_arrows_spec.md]
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

### 2.11 The two-headed arrow (added 2026-07-28, reopening — Phase 5)

Everything above this line shipped on 2026-07-25 and is left as it shipped
(`spec-authoring.md §6.1`). This section is the reopening, and it adds one thing
§2.7's table cannot express: **an arrow with a head at each end**, for a lane
carrying traffic both ways.

The case that makes it worth having is the **two-way left-turn lane** — the
shared centre lane, entered from both directions, marked with a left-turn head at
each end. A plain two-way single-track lane is the same glyph with `through` at
both ends.

**Nothing can import it, and that is structural rather than a gap.** Assimilator
has no per-lane direction at all: `LinkConfig` is `from_node` → `to_node`
(`crates/config/src/network.rs:779-785`), and its own `median_gap` doc defines a
two-way road as a **bidirectional *pair* of links**. So a lane there is
one-directional by construction, and this joins `Lane.kind` in the category
`import.rs:172` already names — "schematic-only, so nothing in the file can
supply it". `lane_arrows_spec.md` Phase 3 paints from `from_lanes` and will never
paint one of these.

#### It is a field, not a variant, and that is a `SCHEMA_VERSION` decision

`MarkingKind::TurnArrow` gains an optional `back?: TurnDirection[]` — the
directions painted at the *upstream* end, pointing upstream. Absent means today's
single-headed arrow, byte-identical for every existing document.

**In Rust it is a `Vec`, not an `Option<Vec>`, and that collapses a question
rather than dodging it.** With `#[serde(default, skip_serializing_if =
"Vec::is_empty")]`, **empty and absent are the same document** — so emptying the
back control (which the panel below permits, and which is the whole route back to
a single-headed arrow) leaves a file byte-identical to one that never had a rear
head, and no code has to decide what `Some(vec![])` means. `Marking::anchor`'s
shape exactly: a defaulted value with a `skip_serializing_if` predicate, not an
`Option` (`decoration.rs:27`). The TypeScript mirror stays `back?:
TurnDirection[]`, since absent is what the key's elision produces — the same
Rust-defaulted/TS-optional pairing `anchor` already carries
(`src/model/types.ts:114`).

**The rejected alternative is the expensive one.** Adding `back_left` and friends
to `TurnDirection` (`decoration.rs:95-111`) is a **new variant of an existing
enum**, which `model/mod.rs:29-42` is explicit costs a `SCHEMA_VERSION` bump — an
older build fails to deserialize the whole document. A new optional *field* on an
existing struct variant costs nothing, because nothing derives
`deny_unknown_fields`. Same feature, opposite cost, decided entirely by where the
change lands in the type. `Marking.anchor` (`lane_arrows_spec.md` §2.3.1) is the
precedent.

#### The trap: `back`'s directions are in the oncoming driver's frame

`markingArrow` builds every branch from `fork = TURN_ARROW_LENGTH / 2 - reach`
and `at(across, along)` (`geometry.ts:1509-1579`), so a second head is a
reflection of code that already exists — `fork → -fork`, with `dl` negated.

**But `across` reflects too.** A back branch labelled `left` is left *for the
driver it faces*, which is the opposite side of the road. Reflect `along` only,
and a two-way left-turn lane draws with both heads swinging the same way — a
drawing that looks entirely plausible and is wrong. That is the same silent-mirror
failure class as `lane_arrows_spec.md` §2.5.1's lane numbering, and it earns the
same treatment: **one explicit frame flip**, applied once, rather than two sign
changes distributed through `stub()` and `hook()`.

**Flipping both terms is a point reflection, and that is why it is exactly one
change.** `markingPoint` is affine — `P = at + n·across + d·along`
(`geometry.ts:1357`) — so `at(across, along) → at(-across, -along)` is a 180°
rotation about the **band centre at the marking's position**, which carries
`stub()`, `hook()` and `head()` into the oncoming driver's frame wholesale, all
six directions included. The rear hook then hooks left *for the driver it faces*
with its head pointing back at them, which is what a U-turn on the opposing
approach looks like. Note the centre of that rotation is the band centre —
`markingPoint(anchor, anchor.span.offset, 0)` — **not `anchor.at`**, which sits on
the drawn polyline; they differ for every lane whose band offset is not zero, and
a test written about the wrong one fails a correct implementation.

The shaft also shortens — **conditionally**. Today it runs `-L/2 → fork`; it runs
`-fork → fork`, symmetric, **iff at least one back branch is actually drawn**.
That is what makes the reflection exact when there is something to reflect, and
what keeps every existing arrow untouched when there is not: an arrow with no
`back`, with `back: []`, or with a `back` naming only directions the model does
not know (`geometry.ts:1565-1571` already skips those) keeps today's shaft. The
condition is "a branch was built", not "the array is non-empty", so the two
degenerate cases need no arm of their own.

#### The second trap: two controls, one payload, and the one that wipes the other

"No new action" is the right call and it has a cost that has to be written down,
because the compiler does not catch it. `setMarkingKind` replaces the whole tagged
kind — `markings.map(m => m.id === id ? { ...m, kind } : m)` (`state.ts:893-907`),
no merge — and the shipped forward control builds its payload as a **fresh
literal**, `{ type: "turn_arrow", directions: next }` (`Inspector.tsx:580-581`).
So a second control that does the same thing means **toggling a forward direction
silently deletes the rear heads**, and toggling a rear one deletes nothing only by
luck of which array is required.

The asymmetry is what hides it: `directions` is required, so TypeScript forces the
*new* control to carry it, while `back?` is optional, so nothing forces the *old*
control to carry `back`. This is the silent-data-loss class §2.5 already records
for `setLinkLanes` and `Lane.kind`, arriving by a different door.

So **both controls spread the marking's current kind rather than rebuilding it** —
`{ ...marking.kind, directions: next }` and `{ ...marking.kind, back: next }` —
which is the same "spreading an object with no `lane` key yields one with no
`lane` key" reasoning `setMarkingKind`'s own doc comment already runs on `lane`,
applied one level in. The Kind picker keeps rebuilding from `MARKING_PICKER`,
because repainting a marking *is* meant to reset the payload.

**And that merge is a named pure function in `state.ts`, not two spreads written
twice in the panel — because otherwise nothing can test it.** The defect is not in
the reducer: `setMarkingKind` faithfully stores whatever payload it is handed, so
a `state.test.ts` case constructs its own payload and passes whether or not the
panel was ever amended (`state.test.ts:815-838` is that test, and it would not
move). The bug lives in what `Inspector.tsx:580-581` *builds*, and this repo
cannot reach that: `vitest.config.ts` runs `environment: "node"` on the stated
grounds that "the units under test are pure TS", there is no `Inspector.test.tsx`,
and `Diagram.test.tsx` renders through `renderToStaticMarkup`, which fires no
`onClick`. An invariant guarded only by a panel habit is guarded by nothing.

So `turnArrowKind(current, patch)` — the marking's current kind plus the one array
being changed, returning the whole tagged kind with the other array preserved —
lives beside the action it feeds, both controls call it, and the assertion sits
next to the payload test it belongs with. That places the rule at the level the
danger is at: losing `back` is document data loss, not a panel slip. Adding a
harness for the panel instead would be a dependency, a `vitest` environment change
and a testing posture, none of which is this phase's subject.

**And the back control has no last-one-standing guard, unlike the forward one.**
`disabled={on && directions.length === 1}` (`Inspector.tsx:591`) exists because an
arrow with no branches is a bare shaft that reads as a lane line. That rationale
does not transfer: emptying `back` leaves the forward arrow whole, and it is the
**only route back to a single-headed arrow** — without it a user who adds a rear
head can only escape by re-picking Turn arrow in the Kind picker, which resets the
forward directions too. Emptying it is therefore a supported gesture, and by the
`Vec`/`skip_serializing_if` decision above it returns the document byte-identical
to one that never had a rear head.

A `back`-only arrow (`directions: []` with a `back`) is **not** reachable through
the panel, since the forward guard still holds. `markingArrow` returns `undefined`
on zero *forward* branches (`geometry.ts:1572`) and the caller falls back to the
placeholder bar, so a hand-edited document that holds one lands in §2.5's
skip-don't-crash posture unchanged. Nothing new is needed for it; it is recorded
so the absence is deliberate.

## 3. Open questions

- **OQ-1** — **Does a marking need to survive a link reversal?** Nothing reverses
  a link today, so `position`-from-`from_node` is unambiguous. If a reverse
  action ever lands it must remap every marking to `length - position`, or every
  stop line jumps to the wrong end. (answerable-from-code: no such action exists
  in `state.ts:85-101`; recorded so it is not discovered by a user.)
- **OQ-2** — **`crosswalk` depth.** **RESOLVED (Phase 2) — `CROSSWALK_DEPTH = 12`,
  as proposed**: a schematic build constant on the same footing as
  `TAPER_LENGTH`, centred on `position`. Phase 2 generalised the centring into a
  rule — *every* transverse kind is centred on `position`, a bar trivially so —
  and added two constants beside it: `GIVE_WAY_DEPTH = 5` and a shared
  `MARKING_PITCH = LANE_PX / 3` that both tiled kinds lay out on. (design-call,
  taken.)
- **OQ-3** — **Should `lane_line` suppress the dashed divider it replaces, or
  overpaint it?** **RESOLVED (review round 1) — replace.** It is one line of
  `RoadShape`'s divider derivation and reads correctly; overpainting is simpler
  but leaves a dashed line under a solid one, visible at the dash gaps in an
  export. §2.3 and Phase 4 already assume this. (design-call, taken.)
  **Extended in Phase 4:** the `lane = None` centreline replaces too, on the same
  rule — on a 2-lane road the lane region's centre *is* boundary `0|1`, so the
  two Span entries that land there would otherwise behave differently. The rule
  as shipped is "a lane line takes over whatever derived line sits at its
  offset", divider and shoulder line alike.
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
  **Half-answered elsewhere (2026-07-28):** `lane_arrows_spec.md` §2.3.1 adds
  `Marking.anchor` so *auto-placed* paint measures from the junction end, and its
  Phase 5 moves that anchor to the rim proper. Neither gives a **human** a snap —
  dragged paint still lands where it was dropped — so this stays open in its
  general form. That spec's own OQ-5 records the dead zone above, still unfixed.
- **OQ-6** — **Should a marking follow the road when a node is dragged?** §2.2
  settles what happens to the *stored* number (nothing — metres are absolute, and
  a marking past the drawn end clamps to it), but not whether that is what a user
  expects. Shortening a road by 30% leaves a stop line proportionally further
  along it. The alternative — rescaling every marking's `position` on a drag —
  makes the stored metres a function of layout, which §2.2 rejected. (design-call;
  proposed: leave it, and revisit only if it reads badly in the Phase 1 `bun run
  dev` pass. Does not block any phase.)
  **Answered elsewhere (2026-07-28):** it did not read badly by hand — the
  pressure came from `lane_arrows_spec.md` §2.3 instead, where *imported* paint
  is minted on 1285-unit arms nobody has schematised yet, so every arrow needs
  re-dragging the moment a node moves. `Marking.anchor` is the fix, and it takes
  neither option here: metres stay absolute (§2.2 holds) and the **end** they are
  measured from becomes selectable.

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
- **Shipped 2026-07-25.** Three decisions the phase settled, none of them pinned
  by the scope above:
  - **A kind with no geometry yet paints the Phase 1 bar.** The picker offers all
    five in-scope kinds — §2.3's "withholds `lane_line` while `lane ≥ n-1`" rule
    requires `lane_line` to be *offerable* — so a marking can hold a kind Phases
    3–4 have not drawn. It falls back to the transverse bar rather than painting
    nothing, which would leave an object on the canvas findable only by accident;
    its class token already says which kind it is, and `Diagram.test.tsx` pins the
    fallback so Phase 4 has to change it deliberately. The hit target and halo are
    that same bar for **every** kind, which is also what keeps a `stop_line`'s
    markup byte-identical to Phase 1's.
  - **`setMarkingKind` carries the whole tagged `MarkingKind`**, not just its
    `type`. Phases 3–4's payloads (`directions`, `style`) then need no second
    action, and the *caller* owns the default a fresh pick starts from
    (`MARKING_PICKER`, `Inspector.tsx`). It never names `lane`, which is how
    "preserves `lane`" holds for the absent case too — spreading an object with no
    `lane` key yields one with no `lane` key.
  - **Containment is a property of the tiling, not a clamp.** `spanCells` derives
    the cell *count* from the span and lets the pitch follow, so the cells tile it
    exactly and no shape taking a fraction of its own cell can reach the verge, at
    any lane count or road class. One shared `MARKING_PITCH` for both kinds, so
    they read as the same hand.

  Two things worth carrying forward that the spec did not predict:
  - **`MARKING_PITCH` is `LANE_PX / 3`, not a half, and the app is what decided
    it.** Two teeth to a lane read as two arrows rather than as a row, which is the
    one thing a give-way line has to say. Three per lane, nine across a 3-lane
    carriageway — and the same rhythm gives a legible zebra.
  - **`.seg`'s `flex: 1` is `flex: 1 1 0%`**, so a `flex-basis` rule for either new
    control has to *out-specify* it rather than merely follow it in the file. The
    panel also needed `text-transform: none`: these are the first segment labels
    that are a phrase rather than a word, and title-casing "Give-way line" reads as
    a heading rather than as a choice.

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
- **Shipped 2026-07-25.** Three decisions the phase settled, none of them pinned
  by the scope above:
  - **The hook's radius is derived, not §2.7's quarter of the band width.** A
    quarter puts the return leg at `2R = width/2` — exactly the band edge, before
    the head's half-width is even added — and §2.7's own last sentence makes
    containment the thing that bounds the radius. So `2R + headHalf = reach`: a
    U-turn's head reaches exactly as far sideways as a hard stub's apex, and **one
    number, `ARROW_REACH`, bounds all six directions** at every lane count and
    class. The same posture as Phase 2's `spanCells` — containment is a property
    of the construction, not a clamp each direction has to remember.
  - **The arrow is the one kind drawn as two elements**, stroked stems and filled
    heads. A single *filled* path would close the hook across its own chord and
    fill the half-disc inside it; a single *stroked* path would leave the heads
    hollow, which reads as an outline drawing — §2.7's own reason for filling the
    give-way teeth. Its `stroke-width` is an **attribute** rather than a rule in
    `diagram.css`, because it is a fraction of the band, as `.lane-band`'s own
    width already is.
  - **§2.7's "it draws in the nearside lane" lives in `markingAnchor`** — its one
    kind-aware line — rather than in the arrow builder, so a lane-less arrow's hit
    target and halo move to lane 0 with the paint. A halo highlighting a strip the
    arrow is not painted on misreports the span at the moment the user is looking
    at it.

  Two things worth carrying forward that the spec did not predict:
  - **The proportions were decided in the app, exactly as `MARKING_PITCH` was.**
    The first pass drew as a thin line with a tick on the end. What reads as an
    arrow is a **short shaft and a chunky head**: `TURN_ARROW_LENGTH` 15 rather
    than 18, and a head 0.30 of the band long by 0.34 wide on a 0.16 stem.
  - **Three or more directions run their heads together in a narrow lane**, and
    all six draw a starburst. That is inherent to one shaft with one branch per
    direction rather than a bug — the paint still stays inside the band, and no
    road carries six directions in a lane. Recorded rather than engineered around.

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
- **Shipped 2026-07-25.** Three decisions the phase settled, none of them pinned
  by the scope above:
  - **A centreline replaces the divider it lands on, exactly as a named boundary
    does.** OQ-3 settled the `lane = i` case; the `lane = None` case was left
    unstated, and on a 2-lane road — the flagship undivided two-way road — the
    lane region's centre *is* boundary `0|1`. Two Span entries at the same place
    behaving differently (one clean, one with dashes showing through) is the
    failure OQ-3 named, so it is **one rule**: a lane line takes over whatever
    derived line sits at its offset. That is also why `boundaryTaken` compares
    within a tolerance rather than by index — a named boundary matches exactly, a
    centreline arrives as a literal `0` and meets an offset summed from widths.
  - **`boundaryOffset` is `RoadShape`'s divider expression character for
    character**, not an equivalent one over `bands[lane]`. The road drops the
    divider by *comparing the two numbers*, and the two forms agree to all but
    the last bit — which is the bit that decides. The whole boundary rule
    (§2.3's `lane ≥ n-1` skip, the centreline, a negative lane) is those four
    lines, so `laneLine` and `laneLineOffsets` cannot come to disagree about a
    line that is not drawn.
  - **A `double` line is the one marking that is not white.** Yellow is the
    road-atlas signal for opposing traffic, which is the whole message of a
    two-way centreline; white would read as one more divider drawn twice. The
    Style control is Phase 2's "`setMarkingKind` carries the whole tagged
    `MarkingKind`" paying off a third time — a fourth panel control, still no new
    action.

  Three things worth carrying forward that the spec did not predict:
  - **The gap and the halo were both decided in the app**, as `MARKING_PITCH` and
    the arrow's proportions were. `LANE_LINE_GAP` is **4**, not the 3 first
    written: a gap narrower than the strokes reads as one fat line with a scratch
    down it. And a *fixed* halo was exactly as wide as a double line's paint,
    which against yellow reads as no halo at all — so `haloWidth` grows with the
    spread, the rule `.road-halo`'s `w + 6` already followed.
  - **`markingForm` is the renderer's one call**, returning `across` or `along`.
    Without it `Diagram`'s marking layer would branch on the kind and
    `MarkingShape` would carry two optional props for one object.
  - **Repainting a marking as a `lane_line` keeps its `lane`, which now means a
    boundary** — a stop line in lane 1 becomes a line on boundary `1|2`. Inherent
    to an action that names nothing but the kind; the Span control shows the new
    reading immediately. Recorded rather than engineered around.

### Phase 5 — The two-headed arrow  (added 2026-07-28; reviewed 2026-07-28)

Added by reopening (`spec-authoring.md §6.1`). Phases 1–4 are untouched and this
depends on all of them. It passed its own scoped review round (§7's phase-level
gate) in three rounds on 2026-07-28 and **is cleared to implement**.

- **Scope:** §2.11 — `MarkingKind::TurnArrow` gains `back?: TurnDirection[]`.
  - `decoration.rs` / `src/model/types.ts` — the field, as a defaulted `Vec` with
    `skip_serializing_if = "Vec::is_empty"` on the Rust side and `back?:` on the
    TypeScript one (§2.11). **No `SCHEMA_VERSION` move**, asserted rather than
    assumed. Adding a field to the struct variant makes the compiler walk the four
    sites that name it — `import.rs:300`, `:370`, `:614` and `mod.rs:216` — which
    gain `..` or a value; mechanical, but they are the phase's Rust surface.
  - `geometry.ts` — `markingArrow` (`:1509`) grows the second head: the shaft
    becomes symmetric (`-fork → fork`) **iff a back branch is drawn**, and back
    branches are built through **one frame flip** negating both `along` and
    `across`, not per-branch sign changes. `stub()` and `hook()` keep their bodies
    across that flip — they capture `at` today (`:1541`, `:1551`), so the flip is
    a frame they are parameterised by rather than an edit to either.
  - `Diagram.tsx` — the call site (`:597`) passes the second array. Named because
    an optional parameter left unpassed **builds and tests green while drawing
    nothing**, and only the `bun run dev` step would catch it. Back branches join
    the existing `TurnArrow.branches`, so the renderer needs nothing else: it
    already maps over them (`:605-613`).
  - `Inspector.tsx` — a second direction multi-select, shown only for
    `turn_arrow`, on the existing one's shape. `setMarkingKind` carries the whole
    tagged `MarkingKind`, so this is a fifth panel control and **no new action** —
    the same payoff Phase 4 recorded. Two amendments §2.11's second trap requires,
    neither optional: **both** controls build their payload through the new
    `turnArrowKind` instead of a fresh literal, or the forward one wipes `back`;
    and the back control ships **without** the `directions.length === 1` guard
    (`:591`), since emptying it is the only route back to a single-headed arrow. It
    reuses `TURN_DIRECTIONS` rather than declaring a second table —
    `import.rs:723-737` greps this file for `const TURN_DIRECTIONS` and asserts six
    entries, matching first.
  - `state.ts` — `turnArrowKind(current, patch)`, the exported pure merge both
    controls call (§2.11). **Still no new action**: it builds a payload for
    `setMarkingKind`, it does not join the `Action` union or the reducer. It exists
    so the invariant is testable at all — see the gate.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green.
  - `geometry.test.ts`: a `back: ["left"]` arrow puts its rear head on the
    **opposite side of the band** from a forward `["left"]` — the assertion that
    catches the §2.11 frame trap, and the one a reflection of `along` alone fails.
    A two-way left-turn lane (`directions: ["left"], back: ["left"]`) is symmetric
    under a 180° rotation about the **band centre at the marking's position**
    (`markingPoint(anchor, anchor.span.offset, 0)`, *not* `anchor.at` — §2.11), an
    assertion a reflection of `across` alone fails instead, so the pair pins both
    halves of the flip. A `back` u-turn hook stays inside the band, as Phase 3's
    containment rule requires of all six directions. And the shaft is symmetric
    only when a back branch is drawn: `back: []` and a `back` naming nothing the
    model knows both leave the Phase 3 footprint exactly.
  - `decoration.rs`'s own test module: the three `Marking.anchor` tests
    (`:188-224`) get their `back` counterparts — a round trip with the field, a
    marking without it writing **no key**, and a file lacking it loading as a
    single-headed arrow. That module rather than `mod.rs`'s document-level round
    trip, since it is the precedent §2.11 invokes and the one that pins the
    *elision*.
  - **Every existing arrow test in the TypeScript suite still passes untouched** —
    the assertion that absent-means-today is real. Scoped to that suite
    deliberately: the four Rust sites above are compiler-forced edits, so "untouched"
    could not be literally true there and a gate that claimed it would be unmeetable.
  - `state.test.ts`: `turnArrowKind` given a `directions` patch on an arrow that
    has `back` returns both arrays, and the reverse; patching to an empty `back`
    yields a kind that saves as single-headed. Asserted against **the function the
    panel calls**, which is the whole reason §2.11 makes it one: a test that
    dispatched a hand-built `setMarkingKind` payload would pass identically whether
    or not the panel was amended, since the reducer is not where the wipe happens.
    The §2.11 wipe is invisible to the compiler and to every existing test, so this
    is the one assertion standing between it and a shipped bug — and it has to be
    aimed at a layer this repo can actually reach (`environment: "node"`, no DOM
    harness, `renderToStaticMarkup` fires no `onClick`).
  - A `bun run dev` pass: paint a two-way left-turn lane and confirm it reads as
    one marking rather than two arrows fighting; **toggle a forward direction on
    it** and confirm the rear head survives; then **empty the back control again**
    and confirm the arrow returns to single-headed, which is the gesture §2.11's
    missing guard exists to allow. The middle gesture is the one no unit test
    reaches: `turnArrowKind`'s test proves the merge is correct, and nothing proves
    both call sites use it.
- **Docs touched:** `rules/road-markings.md` (the arrow gains a second head and
  the frame flip that keeps it honest); `TURN_ARROW_LENGTH`'s doc comment
  (`geometry.ts:1417-1424`), whose "its footprint along the road does not depend
  on which directions are chosen" stops being true the moment a rear branch
  shortens the shaft; this spec's frontmatter to `implemented`; and the
  project-memory roadmap.
- **Shipped 2026-07-28.** 370 vitest (up 9), 58 `cargo test` (up 3), no
  `SCHEMA_VERSION` move (still 2). Three decisions the phase settled, none of
  them pinned by the scope above:
  - **One component serves both ends, `field` naming the array.** The scope says
    "a second direction multi-select … on the existing one's shape", which reads
    as a copy; a copy would have been two places to forget `turnArrowKind` in
    rather than one. `MarkingDirections` takes the whole `kind` plus
    `field: "directions" | "back"`, and the two differ in exactly one expression
    — the guard, which is now `field === "directions" && on && length === 1`.
    That also makes the missing guard *visible* at the place it is missing from,
    instead of being an absence in a duplicated block.
  - **`turnArrowKind` drops the key rather than storing `back: []`.** §2.11
    settles that empty and absent are the same *document*, which is a claim about
    the bytes Rust writes; in memory they are still two objects, and this repo has
    a standing rule for that (`setMarkingLane` destructures the key away,
    `setLaneKind` for `general`, `setLinkAlign` for `centre`). Rebuilding the
    literal is what makes it cheap and is safe **here** where it is not in the
    panel, because this function owns the variant's *whole* payload — both arrays.
  - **The label is `Oncoming`, not `Back`.** The panel names what the drawing
    means rather than the field it writes — `Paint` for `kind`, `Span` for `lane`,
    `Words` for `content` — and an existing precedent settles a taste question for
    free.

  Three things worth carrying forward that the spec did not predict:
  - **`Diagram.test.tsx` can catch the unpassed optional parameter after all**,
    and it was worth one test: the gate assumed only the dev pass could see it.
    A two-headed arrow emits two head polygons where a single-headed one emits
    one, so the markup tells. Dropping `marking.kind.back` at the call site now
    fails one assertion instead of none.
  - **Mutation-testing the frame flip confirmed the paired assertions, in exactly
    the split review predicted.** Reflecting `along` alone fails **both**
    (opposite-side *and* the rotation); reflecting `across` alone fails **only**
    the rotation. Writing the rotation about `anchor.at` rather than the band
    centre was run too, and fails a correct implementation — so the trap §2.11
    names is live in the test, not just in prose.
  - **The one hazard the suite still cannot see was confirmed by mutation, not
    assumed.** Reverting the forward control to a fresh literal passes all 370
    tests. `turnArrowKind`'s test proves the merge; nothing proves both call sites
    use it, which is precisely why the dev pass walks the middle gesture — and it
    caught nothing only because the call site was already right.

  The dev pass ran on Vite at **port 1425** again (1420 still held by `Muyu`),
  driven through Playwright as lane arrows Phase 1 established. All three
  gestures passed: a two-way left-turn lane reads as one marking rather than two
  arrows fighting (an "S" of two left heads, each swinging to the opposite side);
  toggling `Through` on it left `back: ["left"]` untouched and drew three heads;
  and emptying Oncoming returned it to a single-headed arrow with the forward
  directions intact. Note the canvas zoom is anchored at the **origin**, not the
  viewport centre, so a zoomed-in screenshot needs a pan afterwards.

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

### Reopened — 2026-07-28 — Phase 5 added, **review pending**

The first use of `spec-authoring.md` §6.1. All four phases had shipped and the
spec was `implemented`; a two-headed turn arrow is squarely this spec's subject
(§2.7's vocabulary, Phase 3's geometry), so it is added here as **Phase 5**
rather than given a spec of its own. Nothing above §2.11 was renumbered,
rewritten, or removed, and Rounds 1–3 stand as they were.

`status` moves `implemented` → `partial`. **Phase 5 has not been reviewed**, and
under §7's phase-level gate that blocks it independently of the document's
status — the next entry here should be `Round 1 — Phase 5 only`, judging that
phase alone.

Why the addition was worth the reopening rather than a deferral: the alternative
model — new `TurnDirection` variants — costs a `SCHEMA_VERSION` bump, and the
cheap route is only obvious while the reasoning for `Marking.anchor`'s
field-not-variant decision is fresh. Recorded now so it is not re-derived
expensively later.

### Round 1 — Phase 5 only — 2026-07-28 — `VERDICT: NOT READY` (2 blocking)

The first scoped round under `spec-authoring.md` §7's phase-level gate. Fresh
clean-room reviewer with repo access, told that Phases 1–4, §§2.1–2.10 and Rounds
1–3 are settled and that every finding must concern §2.11 or Phase 5. **Fifteen
findings, all fifteen accepted; none rejected, none deferred.**

Three stale citations in §2.11/Phase 5 were corrected *before* the round, so the
reviewer would verify accurate pointers rather than spend a capped round on them:
`geometry.ts:1215-1283` → `:1509-1579` (it named `markingAnchor`, ~294 lines off),
`decoration.rs:61-74` → `:95-111`, and a bare `types.ts` → `src/model/types.ts`.
§6.1 permits this only because they sit in the sections the new phase touches; the
stale citations in §§2.1–2.10 were left as they shipped.

**Blocking, both accepted:**

1. **The shipped forward-direction control would silently wipe `back`.**
   `setMarkingKind` replaces the whole tagged kind with no merge
   (`state.ts:893-907`) and `MarkingDirections` builds a fresh literal
   (`Inspector.tsx:580-581`) — so painting a two-way left-turn lane and then
   toggling any *forward* direction destroys the rear head. The asymmetry is what
   hides it: `directions` is required so the compiler forces the **new** control to
   carry it, while `back?` is optional so nothing forces the **old** control to
   carry `back`. Same silent-data-loss class as §2.5's `setLinkLanes`/`Lane.kind`,
   by a different door. §2.11 gained the "second trap" subsection; both controls
   now merge rather than rebuild.
2. **No stated route back to a single-headed arrow.** `disabled={on &&
   directions.length === 1}` (`Inspector.tsx:591`) is deliberate for the forward
   control, but copied onto the back one it traps a user who adds a rear head —
   the only escape being a Kind repaint, which resets the forward directions too.
   Resolved toward an **emptiable** back control: that guard's rationale (a
   branchless shaft reads as a lane line) does not transfer, since emptying `back`
   leaves the forward arrow whole.

That second call cascaded through three non-blocking findings as a set, which is
why it was worth settling rather than deferring: it made `back: []` reachable
in-app, which decided the **Rust representation** (a defaulted `Vec` with
`skip_serializing_if = "Vec::is_empty"`, so empty and absent are the same document
and `Some(vec![])` never exists), which in turn let the **shaft rule** be stated as
"symmetric iff a branch was *built*" — covering `back: []` and a hand-edited `back`
of unknown names with no arm of its own.

**Non-blocking, all accepted:** the renderer call site (`Diagram.tsx:597`) absent
from scope, where an unpassed optional parameter builds and tests green while
drawing nothing; "every existing arrow test untouched" being literally false on
the Rust side (four compiler-forced sites — `import.rs:300`, `:370`, `:614`,
`mod.rs:216` — so the clause is now scoped to the TypeScript suite); the serde gate
naming `mod.rs` rather than `decoration.rs`'s own module, where the `Marking.anchor`
precedent it invokes actually lives; `import.rs:123` → `:172`; "`stub()`/`hook()`
reused unchanged" overstating what closures capturing `at` can do; the 180°
symmetry assertion naming `anchor.at` rather than the **band centre**, which would
fail a correct implementation on any lane whose band offset is not zero; the
"must be shown to fail" clause being a mutation check no test can express (dropped
— the gate now pairs two concrete assertions and says which half each catches); the
unspecified `back`-only arrow; `import.rs:723-737`'s cross-file grep of
`const TURN_DIRECTIONS`; `TURN_ARROW_LENGTH`'s doc comment, whose "adding a branch
never moves the arrow" stops being true; and the roadmap missing from Docs touched.

**Rejected:** none.

### Round 2 — Phase 5 only — 2026-07-28 — `VERDICT: NOT READY` (1 blocking, newly introduced)

Same reviewer, resumed. Both round-1 blockers confirmed resolved and re-verified
at HEAD, along with every corrected pointer. The reviewer independently re-derived
the paired-assertion claim and confirmed it pins both halves of the frame flip: a
reflection of `along` alone puts the rear `left` head at `across = -reach` (fails
opposite-side), and a reflection of `across` alone puts it at `(+reach, +fork)`
(passes opposite-side, fails the rotation).

One new blocker, introduced by round 1's own fix — the best catch of the loop:

1. **The gate item guarding blocker 1 tested the wrong layer, and this repo cannot
   test the right one.** The wipe does not live in the reducer — `setMarkingKind`
   faithfully stores whatever payload it is handed, as §2.11 says itself — so a
   `state.test.ts` case constructs its own payload and passes identically whether
   or not the panel was ever amended (`state.test.ts:815-838` is that test, and it
   would not move). The defect lives in what `Inspector.tsx:580-581` **builds**,
   and nothing here reaches that: `vitest.config.ts:8` is `environment: "node"` on
   the stated grounds that the units under test are pure TS, there is no
   `Inspector.test.tsx`, and `Diagram.test.tsx` renders through
   `renderToStaticMarkup`, which fires no `onClick`. The phase would have shipped a
   gate that certified a guard while being unable to observe it.

Accepted, with the first of the three remedies offered: the merge becomes an
exported pure `turnArrowKind(current, patch)` in `state.ts` that both controls
call. A `bun run dev` restatement does not survive a refactor, and adding a DOM
harness is a dependency plus a `vitest` environment change plus a testing posture
— a decision a two-headed-arrow phase has no business carrying. `state.ts` rather
than `Inspector.tsx` because losing `back` is **document data loss** rather than a
panel slip, so the rule belongs at that level, and because the assertion then sits
beside the payload test it extends. Still no new action: it feeds `setMarkingKind`
and joins neither the `Action` union nor the reducer.

**Rejected:** none.

### Round 3 — Phase 5 only — 2026-07-28 — `VERDICT: READY` (converged)

Same reviewer, resumed. The round-2 blocker confirmed resolved: every leg of the
new §2.11 block re-verified at HEAD, `turnArrowKind` confirmed reachable from
`environment: "node"` with no DOM, and the placement checked for a module edge —
`Inspector.tsx:36` already imports from `../editor/state` and `state.ts` does not
import the panel, so there is no cycle. The reviewer also confirmed the two
`include_str!` cross-file tests (`import.rs:353-354`) read `geometry.ts` and
`Inspector.tsx` only, so nothing greps `state.ts`. **Zero blocking findings.**

One non-blocking note, folded in: the `bun run dev` pass exercised painting and
emptying but not **toggling a forward direction on an arrow that has `back`** —
the one gesture that would catch a call site left unmigrated. `turnArrowKind`'s
unit test proves the merge is correct; nothing proves both call sites use it. The
dev pass now walks all three.

Converged in three rounds — the cap, reached rather than exceeded. Phase 5's status
line moves to `reviewed`; it is cleared for implementation.
