---
status: draft
last_updated: 2026-07-26
note: Render and place road-surface markings — stop and give-way lines, crossings, lane arrows, lane lines. Paint only; signs and any painted text wait on font embedding.
implemented: []
not_implemented: ["Phase 1", "Phase 2", "Phase 3", "Phase 4"]
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

End state — an approach to a signalised junction, drawn as a diagram:

```
File ▸ a 3-lane arterial arriving at a signalised crossroads

  N1 ──L1(arterial, 3 lanes)──▶ N2 (junction, signalized_cross)

  Marking tool, click lane 0 near N2   → M1  stop_line, lane 0..2, at the stop
  Marking tool, click lane 2           → M2  turn_arrow [left], lane 2
  Marking tool, click lane 0           → M3  turn_arrow [through, right], lane 0
  Inspector ▸ Lane line on L1          → M4  lane_line { style: solid }, lane 1

  → a bar across the carriageway a few units short of the junction pad, a left
    arrow in the offside lane, a shared through/right arrow in the kerb lane,
    and a solid line between lanes 1 and 2 that says "do not change here"
```

Today that same document draws three dashed dividers and nothing else. The
signalised glyph *does* paint a bar per arm (`.jn-stopbar`, `Diagram.tsx:679`),
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
(`mod.rs:56`), so a document with no marking saves byte-identically and **no
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
`b.offset + b.width / 2` (`Diagram.tsx:480-486`) — and since lane 0 is the
nearside lane at the most *positive* offset (`geometry.ts:186-193`), divider `i`
is the boundary between lane `i` and lane `i+1`. A `lane_line` with `lane = i`
takes exactly that boundary, so it **replaces** the dashed divider already there
rather than painting a second line beside it. `lane = None` is the road's
centreline — the outermost case, discussed next.

**This discharges road spec OQ-4 / ramps OQ-6, the undivided-two-way
centreline.** Both specs concluded the fix was a presentation-side field and
deferred it here; it turns out no new field is needed at all. An undivided
two-way road gets a `lane_line { style: double }` with `lane = None`, painted
down the middle of the lane region. Nothing is inferred: the human says the road
is two-way by painting the line, which is the same "the human chose this glyph"
posture the junction glyphs take (`CLAUDE.md`, "Layout is semi-automatic").

### 2.4 Placement is a fourth tool, and the lane falls out of the click (decision, recorded)

`Tool` is `"select" | "node" | "link"` (`state.ts:29`) and gains `"marking"`.
Clicking a road with it places a marking on that link.

**The click already carries everything the marking needs**, which is what keeps
this from growing a placement dialog:

- **Where along the link** — the nearest point on the link's *drawn* polyline
  (`drawnPolyline`, `Diagram.tsx:200`, which already carries the carriageway
  offset and the alignment shift), as an arc-length from the start, divided by
  `UNITS_PER_METRE`. A new pure `nearestOnPolyline(points, p)` in `geometry.ts`
  returns `{ along, offset }` — distance from the start and **signed** lateral
  distance, in the same frame `offsetPolyline` takes.
- **Which lane** — that same signed `offset`, matched against `laneBands(lanes,
  style)` (`geometry.ts:194`). A click inside a band is that lane; a click
  outside the lane region is `lane: undefined`, the whole carriageway. So
  clicking the kerb lane puts the arrow in the kerb lane with no control to set.

**`onLinkPointerDown` has to change, and the current early-return is why.** It
reads `if (tool !== "select") return;` **without** `stopPropagation`
(`Canvas.tsx:92-96`), deliberately, so that other tools "act on the background".
For the marking tool that is exactly wrong — the click would fall through to
`onBackgroundPointerDown` and be lost. The marking tool must take the link
branch, stop propagation, and dispatch.

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

### 2.6 Selection grows a third arm

`Selection` is `{kind:"node"|"link"}` (`state.ts:32-34`) and gains
`{kind:"marking"; id: MarkingId}`. Four sites narrow on it and each needs the arm:
`selectionValid` (`state.ts:279`), `deleteSelection` (`state.ts:599`),
`isSelected` (`Diagram.tsx:417`), and the Inspector's two top-level branches
(`Inspector.tsx:58`onward). TypeScript's exhaustiveness checking finds all four
at build time; none of them is a silent fall-through.

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
| `turn_arrow` | a shaft plus one head per direction | the lane band only |
| `lane_line` | solid / dashed / double, replacing the divider | the whole link (§2.3) |

Three constraints, each of which a plausible implementation gets wrong:

- **Paint sits above the lane bands and below nothing else.** `RoadShape`'s order
  is hit → halo → casing → lane bands → edge lines → dividers → arrow
  (`Diagram.tsx:496-537`), and a marking is paint, so it draws with the lines,
  not under the surface tints.
- **A `turn_arrow` with no lane has no home.** `lane: None` means the whole
  carriageway, which is meaningless for an arrow. It draws in the nearside lane
  and the Inspector does not offer the choice — better than drawing a
  carriageway-wide arrow that means nothing.
- **The glyph's stop bars are not markings and must not be unified with them.**
  `.jn-stopbar` is drawn per arm by `signalized_cross` (`Diagram.tsx:660-687`)
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
adds no `<text>` to the drawing**, and the export assertions that pin the absence
stay green untouched. Signs, painted text, and the font problem are the next
spec, which inherits export OQ-4 as its first paragraph.

### 2.9 Where the logic lives

The split `rules/road-rendering.md` and `rules/diagram-export.md` established:

| Piece | Where | Pure? |
|---|---|---|
| `nearestOnPolyline`, `pointAlongPolyline`, `markingAnchor`, arrow/zebra/triangle point builders | `src/editor/geometry.ts` | ✅ vitest |
| `MarkingShape`, the marking elements, hit targets | `src/components/Diagram.tsx` | ✅ via `renderToStaticMarkup` |
| Marking paint | `src/styles/diagram.css` | — reaches exports free |
| `addMarking`/`deleteMarking`/`setMarkingKind`, the `Selection` arm, the delete cascades | `src/editor/state.ts` | ✅ `state.test.ts` |
| The marking tool | `src/components/Canvas.tsx`, `src/components/Toolbar.tsx` | — |
| The marking Inspector branch | `src/components/Inspector.tsx` | — |

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
  overpaint it?** §2.3 says replace, which is one line of `RoadShape` and reads
  correctly. Overpainting is simpler but leaves a dashed line under a solid one,
  visible at the dash gaps in an export. (design-call; proposed: replace.)
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
  it where a stop line belongs. (design-call; does not block Phase 1.)

## 4. Implementation phases

Strictly sequential; each is one plan-mode pass with a concrete exit gate.

### Phase 1 — A marking exists: placement, selection, lifecycle, and `stop_line`

- **Scope:** the whole pipeline for **one** kind, so every later phase is only
  geometry. `nearestOnPolyline(points, p)` → `{ along, offset }` and
  `pointAlongPolyline(points, along)` → `{ at, dir }` in `geometry.ts` (§2.4).
  `Tool` gains `"marking"` (`state.ts:29`) with a Toolbar button; `Selection`
  gains its third arm (§2.6) and the four sites that narrow on it. `addMarking`
  (minting via `nextId(…, "M")`), `deleteMarking`, and the **two delete
  cascades** of §2.5 — a deleted link and a deleted node both drop their
  markings, and `setLinkLanes` drops a marking stranded past the new lane count.
  `onLinkPointerDown` takes the marking branch and stops propagation
  (`Canvas.tsx:92`). `MarkingShape` in `Diagram.tsx` drawing `stop_line` only,
  plus its hit target and halo, gated on `interaction`. Paint in `diagram.css`.
  A marking branch in the Inspector showing its link, lane, and a Delete.
- **Exit gate:** `bun run build` + `bun run test` green. `geometry.test.ts`:
  `nearestOnPolyline` returns the exact arc-length and a **signed** offset whose
  sign matches `offsetPolyline`'s (a magnitude test passes under an inversion —
  the trap the road spec hit four times); a point past either end clamps to that
  end; `pointAlongPolyline` round-trips against it on a bent polyline.
  `state.test.ts`: placing a marking is undoable like any other edit; **deleting
  its link removes it**; **deleting its node removes it**; shrinking the lane
  count past its lane removes it; and a document that never placed one is
  byte-identical (`markings: []` elides). `Diagram.test.tsx`: a `stop_line` on
  lane 0 of a 3-lane road due east draws a transverse bar at that band's offset
  and width, pinned exactly; an empty document is still `<g class="diagram"></g>`;
  and the **`.jn-stopbar` of a signalised junction is untouched** (§2.7).
  `export.test.ts`: `strokeAllowance` unchanged (§2.10), and a marking document
  still emits no `<text>` and no `url(` in the stylesheet. Plus a `bun run dev`
  pass: place, select, and delete a marking, and delete the road under one.
- **Docs touched:** a new `rules/road-markings.md` (or a section in
  `rules/road-rendering.md` — decide in the plan); `rules/history.md` for the new
  actions; the project-memory roadmap.

### Phase 2 — Transverse paint: `give_way_line` and `crosswalk`  (depends on Phase 1)

- **Scope:** two more `MarkingKind` arms in `MarkingShape` and their point
  builders in `geometry.ts` — a row of triangles pointing back at the driver, and
  zebra stripes parallel to travel over `CROSSWALK_DEPTH` (OQ-2). Both take the
  band-or-carriageway span Phase 1 established, so neither touches placement,
  selection, or lifecycle. A kind picker in the marking Inspector branch.
- **Exit gate:** `bun run build` + `bun run test` green. `geometry.test.ts` pins
  the triangle row's count and pitch for a 3-lane carriageway and for a single
  lane, and that the zebra's stripes stay **inside** the band at every lane count
  (a stripe spilling onto the verge is the failure). `Diagram.test.tsx`: each
  kind emits its own class token and a `stop_line` document is unchanged from
  Phase 1's pins. A `bun run dev` check that a give-way line points the way
  traffic comes.

### Phase 3 — `turn_arrow`  (depends on Phase 2)

- **Scope:** the arrow vocabulary — a shaft along the lane with one head per
  `TurnDirection` (`types.ts:105-112`), so a shared through/right lane draws one
  arrow with two heads rather than two arrows. `lane: None` falls back to the
  nearside lane (§2.7). A direction multi-select in the Inspector.
- **Exit gate:** `bun run build` + `bun run test` green. `geometry.test.ts`: a
  single `through` arrow is symmetric about its lane's centre; a two-direction
  arrow shares one shaft; every head stays inside the lane band at the narrowest
  class (`ramp`, `classWidthFactor` 0.8 — `geometry.ts:120-125`); and `u_turn`
  does not degenerate. `Diagram.test.tsx`: an arrow in lane 2 of a 3-lane road
  sits at that band's offset, and one with no lane draws in lane 0. A `bun run
  dev` check on §1's approach.

### Phase 4 — `lane_line`, and the two-way centreline  (depends on Phase 3)

- **Scope:** the one longitudinal kind (§2.3) — spans the whole link, `position`
  ignored, `lane = i` **replacing** the dashed divider between lanes `i` and
  `i+1` (OQ-3), `lane = None` painting the centreline of the lane region.
  `solid` / `dashed` / `double` per `LineStyle` (`types.ts:115`). This is the one
  phase that reaches into `RoadShape`'s divider derivation
  (`Diagram.tsx:480-486`) rather than drawing beside it.
- **Exit gate:** `bun run build` + `bun run test` green. `Diagram.test.tsx`: a
  `lane_line` on lane 1 of a 4-lane road leaves **two** dashed dividers and one
  solid line, at the same offset the divider had — pinned exactly, since drawing
  both is the failure and a count-of-lines assertion catches only half of it; a
  `double` line draws two strokes symmetric about that offset; a `lane = None`
  line lands on the lane region's centre; and a document with no `lane_line`
  emits markup **unchanged** from Phase 3. `export.test.ts`: a two-way road with
  a double centreline carries it into the file. Plus a `bun run dev` pass on an
  undivided two-way road, which is what road spec OQ-4 has been waiting for.
- **Docs touched:** `rules/road-rendering.md`'s "No centreline (spec OQ-4)"
  section is now wrong — replace it. Mark road spec OQ-4 and ramps OQ-6
  **RESOLVED** in both specs, and update the project-memory roadmap.
