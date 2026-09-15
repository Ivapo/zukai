---
id: zk-005
title: ramps-and-tapers
status: accepted
last_updated: 2026-09-14
note: >
  Draw the transitions between roads — lane-count tapers, ramp gores, and
  junction interiors that follow a divided road's carriageways. Per-link
  alignment (Phases 2 and 9) was shipped and then replaced by a side stated on
  the node. Read §0 before §2.3 or §2.11.3.

phases:
  - name: "Phase 1 — Arms carry their position (road spec OQ-6)"
    reviewed: 2026-07-25
    shipped: 2026-07-25
    cut: null
    by: null
  - name: "Phase 2 — Link alignment"
    reviewed: 2026-07-25
    shipped: 2026-07-25
    cut: 2026-09-14
    by: zk-005
  - name: "Phase 3 — Tapers"
    reviewed: 2026-07-25
    shipped: 2026-07-25
    cut: null
    by: null
  - name: "Phase 4 — Gores"
    reviewed: 2026-07-25
    shipped: 2026-07-25
    cut: null
    by: null
  - name: "Phase 5 — The gore says which way to go round it"
    reviewed: 2026-08-10
    shipped: 2026-08-10
    cut: null
    by: null
  - name: "Phase 6 — The node dot sits on the road"
    reviewed: 2026-08-11
    shipped: 2026-08-11
    cut: null
    by: null
  - name: "Phase 7 — A figure carries no node dots"
    reviewed: 2026-08-11
    shipped: 2026-08-11
    cut: null
    by: null
  - name: "Phase 8 — A gore's arms stop bulging over the roads they part"
    reviewed: 2026-08-14
    shipped: 2026-08-14
    cut: null
    by: null
  - name: "Phase 9 — The panel says which side the lanes hang on"
    reviewed: 2026-08-14
    shipped: 2026-08-14
    cut: 2026-09-14
    by: zk-005
  - name: "Phase 10 — Where two roads meet, neither paints over the other"
    reviewed: 2026-09-14
    shipped: 2026-09-14
    cut: null
    by: null
  - name: "Phase 11 — A node that joins two roads is a waypoint"
    reviewed: 2026-09-14
    shipped: 2026-09-14
    cut: null
    by: null
  - name: "Phase 12 — A node's dot shows while it is being edited"
    reviewed: 2026-09-14
    shipped: 2026-09-14
    cut: null
    by: null
  - name: "Phase 13 — A joint draws one dot per road through it"
    reviewed: 2026-09-14
    shipped: 2026-09-14
    cut: null
    by: null
  - name: "Phase 14 — The joint says which side the lanes change on"
    reviewed: 2026-09-14
    shipped: 2026-09-14
    cut: null
    by: null

extends: null
supersedes: null
superseded_by: null
related: [zk-004, zk-003]
reference: "Motorway diagram convention as road atlases and variable-message signage use it — tapered lane drops, chevroned gore areas at a diverge, a continuous outer edge through a lane change. Not to-scale interchange geometry (that is Assimilator's job). The chevrons inside a gore are presentation on the gore glyph, not `Marking`s — corrected 2026-08-10, see §2.9."
---

# Ramps and Tapers Spec

## 0. Closing note — per-link alignment is cut (2026-09-14)

**Everything else in this spec stands**: the arms carrying their position, tapers,
gores and their chevrons, the dots, flat ends and joint discs, and waypoints. What
went is **per-link alignment**. Phase 2's `LinkView.align` and Phase 9's Lane region
readout both shipped, and both were **removed on 2026-09-14** by Phase 14 of this
same spec (§2.13.5). Read §2.3 and §2.11.3 as the record of a design that was built,
used, and replaced.

**Why.** A lane change happens at one place, but alignment made two links state it.
They could disagree, and three things followed, all measured in §2.13:
- a waypoint between two aligned roads drew as two nodes;
- one aligned link alone drew a half-lane step;
- 2 → 3 → 2 on a straight road had no combination of values that drew it.

Phase 9's readout made one link's setting legible. It could not make the pair agree.

**What replaced it.** `NodeView.lane_change` (`nearside` / `offside`, absent means
both) is set in the node panel's "Lanes change on" row. Every road's lateral shift
is **walked** from the head of its chain of through pairs (`geometry.ts:lateralShifts`,
§2.13.3), so a side affects only the roads downstream of it.

**The removal is a departure from §6.1 step 1**, which makes a removal its own phase.
It rode inside the phase that replaced it, so the drawing never lacked a way to state
a side. §2.13.5 records the reasoning.

**An old file's `align` key is ignored**, and the road draws centred. There is no
migration arm and no `SCHEMA_VERSION` move (OQ-12).

## 1. Goal

`specs/road_rendering_spec.md` made each road look like a road. This spec makes
the **joins between them** look like roads — which is most of what a motorway
schematic actually is.

The road spec listed this as its own successor (§2.7: "**Not ramps and tapers.**
An onramp merging into a mainline needs geometry this spec doesn't build; it is
the natural next spec and depends on this one") and left two debts behind it,
recorded as OQ-6 and OQ-4. The first is not merely inherited here — it is a
**precondition**: a gore cannot be drawn from a junction centre that the
carriageways have already moved away from (§2.2).

End state — the classic motorway exit, drawn as a diagram rather than as three
overlapping strokes:

> **CORRECTED 2026-09-14 — the side is stated on N2, not on L1 and L2; see §0.**
> The example's "L1, L2 aligned to their offside edge" was per-link alignment, which
> Phase 14 removed. The same drawing now comes from N2 stating `nearside`. L1 stays
> on its nodes, and the walk moves L2 half a lane so their offside edges meet.

```
File ▸ a 4-lane motorway dropping a lane at an exit

  N1 ──L1(motorway, 4 lanes)──▶ N2 ──L2(motorway, 3 lanes)──▶ N3
                                │
                                └──L3(ramp, 1 lane)──▶ N4

  L1, L2   aligned to their offside edge  → the outer edge runs straight
                                             through N2; the lane is dropped
                                             on the nearside, over a taper,
                                             not as a step at a point
  N2       glyph: gore                     → no junction pad; a hatched gore
                                             between L2's nearside edge and
                                             L3's offside edge, nose at the
                                             point where the two edges meet
  L3       ramp class, 1 lane              → leaves from the nearside, its
                                             asphalt continuous with L1's
                                             dropped lane
```

Today that same document draws as: L1 a uniform 39-unit stroke whose **round end
cap** (`diagram.css:52`) bulges 19.5 units past N2 into L2's territory; L2 a
uniform 30-unit stroke centred on the same polyline, so the road **steps
symmetrically** — 4.5 units vanishing from each side at a point, on the offside
as much as the nearside; and L3 a 10.2-unit stroke (a 1-lane *ramp*:
`classWidthFactor("ramp") = 0.8`, `geometry.ts:97-102`) starting at N2 with its
own round cap, lying on top of both. There is no taper, no gore, and nothing
marks which side the lane went.

## 2. Design

### 2.1 What is missing is drawing, and one presentation field (decision, recorded)

As in the road spec, most of this is **already expressed in the model and
ignored by the renderer** — `graph.rs:31-33` defines a waypoint as "a
non-intersection point where the road continues but changes (e.g. a lane count
change between two links)", which is precisely a lane drop, and `Link.lanes`
already differs across it.

| What the picture needs | Where it already is | Rendered? |
|---|---|---|
| A lane-count change along a road | two links at a `Waypoint` (`graph.rs:31-33`) | ❌ drawn as a symmetric step |
| Which lanes a ramp takes | `Movement.from_lanes` / `to_lanes` (`graph.rs`, `Movement`) | ❌ movements are unrendered entirely |
| The ramp's own class | `LinkStyle::Ramp` (`layout.rs`, `LinkStyle`) | ✅ since road spec Phase 2 |
| Where an arm actually meets a junction | `carriageways(doc)` (`geometry.ts:246`) | ⚠️ known to the roads, thrown away by `Arm` (`Diagram.tsx:192-195`) |

**One thing is genuinely not in the model: which side a lane is added or dropped
on.** Nothing distinguishes "4 lanes becomes 3 by losing the nearside lane" from
"…by losing the offside lane" — `Link` carries an ordered `lanes` array and no
statement about how two links' lanes correspond across a shared node. That is
what §2.3 adds, and it is deliberately a **presentation** field, not a graph one
(§2.3's "decision, recorded").

So the scope is: **one new `LinkView` field, two new `JunctionGlyph` variants,
and otherwise rendering.** No new semantic-graph concept, so nothing here
changes what a future Assimilator export would have to carry.

### 2.2 Arms have to know where they are, not just which way they point (decision, recorded)

`Arm` (`Diagram.tsx:192-195`) is `{ dir, width }`. `junctionArms`
(`Diagram.tsx:203`) builds it from the **drawn** polyline — `drawnPolyline`
(`:180`) applies the carriageway offset first, so `dir` already follows a
divided road — and then throws the lateral position away, keeping only the
direction. Every interior detail is therefore drawn from the node centre: the
stop bars at `Diagram.tsx:447` onward step out along `a.dir * (rp + 4)`, and the
pad radius (`:410`) is `(maxW * 0.62 + 3) * scale`, a function of arm *widths*
only.

That is road spec OQ-6, and on a divided road it already shows: the carriageways
step off the centreline and the stop bars do not follow. **A gore makes it fatal
rather than cosmetic** — the gore's whole geometry is the space *between* two
arms' edges, so an arm that does not know its own lateral position cannot
produce one. Hence Phase 1, before anything else.

The fix is smaller than it looks, and the reason is worth recording so an
implementer does not re-derive it from signs: **the arm's lateral position is
already sitting in the drawn polyline.** `junctionArms` computes
`[n0, n1] = touchesStart ? [poly[0], poly[1]] : [poly.at(-1), poly.at(-2)]`
(`Diagram.tsx:217`), and `n0` **is** the drawn end of the carriageway — the node
position plus the offset already applied in the link's own frame. So:

```ts
interface Arm {
  /** Unit direction away from the node, along the drawn carriageway. */
  dir: Vec2;
  /** Where that carriageway actually meets the node, in world units. */
  origin: Vec2;      // = n0, today discarded
  width: number;
}
```

No sign reasoning, no re-deriving `DRIVE_SIDE`, no second call to
`carriageways`. `origin` is `n0`, which the function already has in hand. This
matters because the road spec's review needed four rounds largely on offset-sign
traps (its §2.4, "Both offsets are positive"); taking the position from the
geometry instead of recomputing it avoids that class of bug entirely.

**The pad radius must then cover displaced arms too — as a floor, not a
replacement.** With arms off-centre, `maxW * 0.62 + 3` can leave a carriageway
hanging outside the pad it is supposed to meet. But that expression is *larger*
than a centred arm's reach for every road (`0.62 w + 3 > w / 2` for all
`w > 0`), so swapping one for the other would shrink the pad of every undivided
junction in every existing document and drag every stop bar in with it. The
reach is a **floor** on the radius the code already computes:

```ts
const reach = arms.length
  ? Math.max(...arms.map((a) => distance(a.origin, center) + a.width / 2))
  : 0;
const rp = Math.max((maxW * 0.62 + 3) * scale, reach);
const ro = Math.max(Math.max(20, maxW * 1.35) * scale, reach);
```

Two details this pins, because either guessed the other way is user-visible:

- **`scale` multiplies the base term only.** `JunctionView.scale` — the
  Inspector's Size control (`Inspector.tsx:238`) — goes on resizing the glyph,
  while the reach stays a hard floor in world units, so shrinking a junction can
  no longer pull its pad off the carriageways it exists to join. A *scaled*
  reach term would reintroduce at small sizes exactly the defect this phase
  removes. The corollary, stated so it is not later mistaken for a bug: **Size
  now clamps.** Below roughly half scale the floor binds even on an *undivided*
  junction — a 1-lane arterial pad goes `5.22 → 6` at Size 0.5 — so the control
  stops shrinking a pad past the road it serves. A pad narrower than its own
  approach is not a smaller junction, it is a broken one. It is also why Phase
  1's no-change pin is written at the **default** Size.
- **The roundabout ring takes the same floor.** `ro` (`Diagram.tsx:412`) has the
  identical displaced-arm problem; fixing the pad and not the ring would be an
  omission with no reason behind it.

**`origin` is world-space; the glyph's interior is not.** `JunctionGlyphShape`
renders inside `transform="translate(center.x center.y)"` (`Diagram.tsx:421`),
so `origin` enters that group as `origin - centre`. The stop bars then need one
small piece of maths, because "just beyond the pad" is measured from the *node*
today and must be measured from the *arm* now:

```ts
/** Distance from `p` along unit `d` to leave the circle of radius `r` about the
 *  glyph origin; `0` when `p` is already outside it. */
export function rayCircleExit(p: Vec2, d: Vec2, r: number): number
```

A stop bar sits at `(origin - centre) + dir * (rayCircleExit(...) + 4)`. For an
undivided junction `origin === centre`, `rayCircleExit` returns exactly `r`, and
the expression collapses to today's `dir * (rp + 4)` — which is what makes Phase
1's no-visual-change gate provable rather than approximate. The reach floor
guarantees every arm origin is *inside* the pad, so the outside-the-circle
branch is defensive only.

### 2.3 Alignment is presentation, and belongs on `LinkView` (decision, recorded)

> **CORRECTED 2026-09-14 — the side is presentation, and belongs on `NodeView`; see
> §2.13.1 and §0.** This section was right that the side is presentation and must be
> an input, and wrong about which object carries it. Two links sharing an edge are
> two statements of one fact. `LinkAlign`, `alignmentShift` and `LinkView.align` are
> gone. The sign pins below survive, as the walk's table in §2.13.3.

A link is drawn centred on its polyline: `RoadShape` (`Diagram.tsx:251`) offsets
its edges symmetrically by `±edgeInset` about `points`. For a lane drop to read
correctly, two links of different widths meeting at a node must share an **edge**,
not a centre.

```ts
/** Which of a link's own edges stays put on its polyline. */
export type LinkAlign = "centre" | "nearside" | "offside";   // default "centre"
```

added to `LinkView` (`types.ts:179`, `layout.rs` `LinkView`), and applied as a
lateral shift in `geometry.ts`:

```ts
export function alignmentShift(
  lanes: Lane[], style: LinkStyle, align: LinkAlign,
): number   // 0 for "centre"; ±(roadWidth - ROAD_MARGIN)/2 otherwise
```

Four things settle this shape:

- **It is presentation, not topology.** Assimilator's links carry real
  polylines, from which alignment is a *consequence*, not an input; putting a
  field in `graph` would be a Zukai-native concept in the layer whose whole
  promise is that it "maps 1:1 to and from Assimilator's `network.yaml`"
  (`graph.rs:1-9`). `LinkView` already holds exactly this kind of thing —
  `style` and `bends`, both drawing-only.
- **It composes by addition, in one place.** `drawnPolyline` (`Diagram.tsx:180`)
  is already the single site that shifts a link laterally before anything is
  drawn from it, and the shift it applies is a plain number in the link's own
  polyline frame. Alignment is another such number, so
  `d = carriagewayOffset + alignmentShift`. Nothing else needs to learn about
  alignment — the roads, the junction arms, and (through Phase 1) the junction
  interiors all inherit it, exactly as they inherited `classWidthFactor`.
- **It scales the lane region, not the road width.** `ROAD_MARGIN` is the casing
  lip, not a lane (road spec §2.3), so aligning to an edge means aligning the
  **lane region's** edge: the shift is `(roadWidth - ROAD_MARGIN) / 2`, not
  `roadWidth / 2`. Using the full width leaves a half-lip step at every joint —
  0.6 units, small enough to look like an antialiasing artefact and never be
  diagnosed.
- **No `SCHEMA_VERSION` bump.** The field is `#[serde(default)]` on the Rust
  side, so an older `.zkai` loads with `centre`; and nothing in the model derives
  `deny_unknown_fields` (verified: no occurrence in `src-tauri/`), so a *newer*
  file's extra field is ignored rather than fatal by an older build.
  `persist.rs:42` only rejects a file whose `schema_version` is **greater** than
  this build's. **This is not true of Phase 4's new enum variants** — see §2.6.
  Keeping an unaligned document's YAML byte-identical needs a predicate, not the
  `Vec::is_empty` trick `bends` uses (`layout.rs:72`): `LinkAlign` is a plain
  enum, so it is `#[serde(default, skip_serializing_if = "LinkAlign::is_centre")]`
  with a one-line `is_centre` helper beside it.

**Which side is "nearside" is already settled, and this spec pins the sign** —
refusing to state it is how a draft walks into the trap it is warning about.
Lane 0 is the nearside (kerb) lane and `laneBands` returns it with the most
**positive** offset (`geometry.ts:163-170`); under `DRIVE_SIDE = 1` a positive
`offsetPolyline` distance draws to the visual right of travel, which for a road
running due east is `+y` (`geometry.ts:205` derives this: SVG's y axis points
down). So an eastbound road's nearside lane-region edge is at
`+(roadWidth − ROAD_MARGIN)/2` and its offside edge at the negation.

Holding an edge *on the polyline* means shifting the road by whatever brings
that edge to zero, so the sign follows with no further reasoning:

```ts
alignmentShift(lanes, style, "centre")   //  0
alignmentShift(lanes, style, "offside")  // +(roadWidth − ROAD_MARGIN) / 2
alignmentShift(lanes, style, "nearside") // −(roadWidth − ROAD_MARGIN) / 2
```

An `offside`-aligned eastbound road therefore puts its offside edge on `y = 0`
and its whole lane region at **positive** `y` — it hangs to the nearside of its
own polyline — and `nearside` mirrors it. **Phase 2's gate asserts that drawn
`y`, not a magnitude**, since a magnitude test passes under an inversion, which
is the trap the road spec hit four times.

**One consequence, named rather than discovered:** `carriageways`
(`geometry.ts:246`) knows nothing about alignment, and a divided pair's two
twins measure `d` in opposite frames (its "every offset returned is positive"
note). So aligning *one* twin moves that carriageway relative to the median
instead of relative to the road — the pair's halves close up or spread apart.
That is the honest result of "compose by addition", and the schematic reading is
right (an aligned carriageway *has* moved), but it means alignment is a
per-carriageway control on a divided road, not a per-road one.

### 2.4 A taper is a wedge at the joint, not a variable-width link (decision, recorded)

The obvious model — "a link whose width changes along its length" — is the wrong
one, and expensively so. `Link.lanes` is a single array, so a tapering link has
no answer to "how many lanes is it"; and `RoadShape` draws its casing as a
**stroked path** (`<path class="road-casing" strokeWidth={w}>`), which cannot
vary along its length. Making it vary means drawing every road as a filled
polygon instead — a rewrite that would invalidate every existing width assertion
(`Diagram.test.tsx`'s pinned `stroke-width="39"`, `export.test.ts`'s
`strokeAllowance`) to serve a case that is entirely local to one node.

So: **both links keep their uniform width, and the transition is one added
polygon per side of the joint.**

```
        offside edge — continuous through the joint
    ────────────────────────────────────────────────────
     L1: 4 lanes          │  L2: 3 lanes
    ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
                          │╲
    ──────────────────────┘ ╲___  ← the wedge: asphalt, plus a
                       N2  ◄──────┘  solid edge line on the hypotenuse
                            TAPER_LENGTH
```

**The rule is per side, it compares signed offsets in one frame, and it applies
only where the road continues straight through** — not lane counts, not "which
link is the narrow one", and *not* world points.

**First, the joint must be collinear within a tolerance.** `segmentNormals`
(`geometry.ts:316-325`) rotates with the link, so "the nearside edge" points a
different way for each link the moment the two turn a corner: at
N1(0,0) → N2(120,0) → N3(120,120), two **identical** 4-lane links put their
nearside casing edges at `(120, 19.5)` and `(100.5, 0)`. A rule comparing world
points would read that mismatch as a width step and wedge a plain corner. But a
taper's whole premise is *one road continuing through a width step*, so a joint
whose two directions differ by more than `TAPER_MAX_BEND` draws no wedge at all.

**`TAPER_MAX_BEND` is 8°, and the value is derived rather than picked.** Butt
caps (below) are what bounds it: at a bend of θ two butt-capped casings leave a
notch on the *outside* of the bend of depth `(roadWidth / 2) · tan(θ / 2)`, which
for a 4-lane road at 8° is ≈1.36 units — the same order as the ≈1.33-unit round-
cap overhang the butt cap removes, so the trade is never a loss, and it falls to
zero as the joint straightens. A larger tolerance inverts that trade (15° would
give ≈2.6), and a schematic lane drop is drawn nearly straight anyway.

**Within that tolerance the two links share a frame**, so the comparison is of
**signed lateral offsets**. `drawnPolyline` already produces exactly that number:
`d = carriagewayOffset + alignmentShift`, in the link's own polyline frame. **It
is the bend tolerance, not the reversed-twin exclusion, that makes the two frames
agree in sign** — a hairpin (`L1: N1→N2`, `L2: N2→N3` with N3 placed back beside
N1) is not a twin, since the node pairs differ, yet its frames oppose. The twin
test excludes anti-parallel *carriageways*; the 8° guard excludes anti-parallel
*geometry*. Both are preconditions, and neither substitutes for the other.

Each link therefore contributes two values, `d + roadWidth/2` on the nearside and
`d − roadWidth/2` on the offside. Then, **independently on each side**:

- **Equal ⇒ nothing to draw.** (Aligning both links to that side is exactly what
  makes them equal, which is why alignment is Phase 2 and not bundled in here.)
- **Otherwise the *inset* link is the one nearer the road's other side** — the
  smaller value on the nearside, the larger on the offside — and the wedge is the
  triangle between the two edges, running `TAPER_LENGTH` along the inset link's
  direction, away from the joint. There is no tie to break: a tie *is* equality,
  which is the case above.

The world points `taperWedge` takes are then derived from the winning offsets in
the usual way; the offsets decide, the points only draw.

That rule is what keeps the geometry purely **additive**: a wedge only ever
paints asphalt into space the inset link left empty, and never has to erase
asphalt a uniform stroke already laid down. Every case falls out of it with no
further judgement:

| Joint (per side) | Inset link | Wedge runs |
|---|---|---|
| Lane drop, both `offside`-aligned (§1's L1→L2) | the downstream narrow one | **forward** — the dropped lane closes over `TAPER_LENGTH` past N2, which is how a real lane drop reads |
| Lane addition, both `offside`-aligned | the upstream narrow one | **backward** — the new lane opens *before* the node (**OQ-1**) |
| Either, both `centre`-aligned | the narrow one, on **both** sides | one wedge per side, each closing half the difference — the honest drawing of an unaligned lane change |
| The two links aligned to *different* sides | possibly a different link on each side | one wedge each way; the road jinks sideways and the picture says so |

**Applicability**, stated so an implementer does not guess:

- Only at a node with **exactly two incident links** forming a through joint —
  one ends there, one starts there. Three or more is a junction or a gore, not a
  taper, matching the road spec's habit of leaving the ambiguous case alone
  (`carriageways`, "three links on one node pair stay on the centreline").
- Only when the two directions agree within `TAPER_MAX_BEND` (above). A corner
  is a corner.
- **Never between the two carriageways of a divided road.** That test is
  satisfied by a divided pair at *either* of its nodes — `divided()`
  (`Diagram.test.tsx:365`) builds exactly `N1→N2` and `N2→N1`, so a pair whose
  two directions carry different lane counts would otherwise get a wedge
  stretched between two **anti-parallel** carriageways. Exclude the pair
  `carriageways` already recognises: if the two links are each other's reversed
  twin (`a.from_node === b.to_node && a.to_node === b.from_node`), it is not a
  through joint. A consequence worth naming — a **divided** road's lane drop has
  four incident links at the node and so never tapers. That is a non-goal
  (§2.8), not an oversight.
- The wedge is bounded by the **casing** edges (`roadWidth/2`), because a wedge
  is asphalt; its own edge line is inset `1.5` from the hypotenuse, mirroring
  `RoadShape`'s `edgeInset = w / 2 - 1.5` (`Diagram.tsx:251` onward). Using the
  lane-region edge instead is a silent 1.5-unit error in every pinned corner.

`taperWedge` therefore takes two edge points and a direction and returns a
triangle — **three** corners, not four:

```ts
/**
 * The asphalt wedge closing a width step at a through joint, on one side.
 * Every argument is already in drawing space, so this function has no frame,
 * no offset sign, and nothing to re-derive.
 */
export function taperWedge(
  outerEdge: Vec2,   // where the OUTSET link's casing edge meets the joint
  insetEdge: Vec2,   // where the INSET link's casing edge meets the joint
  insetDir: Vec2,    // unit vector from the joint along the inset link
  length: number,    // TAPER_LENGTH
): [Vec2, Vec2, Vec2]
```

Taking points rather than links is deliberate: the arithmetic that turns a link
into two edge points already exists and is already tested (`drawnPolyline`,
`offsetPolyline`), and the road spec's review burned four rounds on offset-sign
traps — passing the answer in beats re-deriving it. It also makes a joint whose
two links meet at an **angle** unambiguous with no extra rule, since the wedge
always runs along the inset link.

**The round end cap has to go at a tapered joint.** `.road-casing` carries
`stroke-linecap: round` (`diagram.css:52`), so the outset link paints a
half-disc of radius `roadWidth/2` past the node — and that disc bulges *outside*
the wedge's hypotenuse: for §1's 4→3 joint, by up to ~1.3 world units (about an
edge line's width) over the first ~13 units past N2. No added polygon can remove
it, and it would read as asphalt spilling past a freshly painted taper line. So
a joint that produces a wedge gives **both** its links' casings a butt cap via a
modifier class. Three consequences, stated rather than discovered:

- `stroke-linecap` is a property of a whole path, so a link butt-capped at its
  tapered end is butt-capped at its **other** end too. Where that end meets a
  junction the pad covers it; where it is a free endpoint the road now ends flat
  rather than domed — the better schematic reading anyway, and the same bulge §1
  lists as a present-day defect.
- Only a joint that actually draws a wedge gets the class, so a document with no
  width step emits exactly the markup it does today (Phase 3's gate).
- At a joint that is both stepped **and** slightly bent, the two butt ends leave
  a notch on the outside of the bend that the round caps used to fill. That is
  what sizes `TAPER_MAX_BEND` above, and why 8° rather than 15°: at the tolerance
  limit the notch is no deeper than the overhang the cap change removes.

> **CORRECTED 2026-09-14 — every casing is butt-capped now, and the modifier class
> is gone; see §2.12.1.** True when written, and what it produced still holds: no
> round asphalt bulges past a wedge. Phase 10 reached it by a wider rule. The
> round cap left *every* road, since the later road's cap painted over the earlier
> road's lines at every joint. The round shape a bend needs became a joint disc
> drawn under all roads, which a tapered joint is denied for exactly the bulge
> above. So the second consequence no longer holds: a joint of equal width now
> carries a `road-joint` disc.

`TAPER_LENGTH` is a world-unit build constant in the manner of
`SCHEMATIC_MEDIAN` (`geometry.ts:218`), not a converted model quantity: nothing
in the model carries a taper length, and a real one (~50 m) would be ~129 world
units, longer than most whole links in a schematic. **OQ-2** proposes 24.

### 2.5 The gore is a triangle between two arms' edges (decision, recorded)

At a diverge, the ramp and the mainline separate, and the paint between them is
the gore. Its geometry is the one genuinely new piece of 2-D maths in this spec,
and it is small.

**Which two arms — since it cannot be read off the traffic.** `junctionArms`
orients *every* incident link so `dir` points away from the node
(`Diagram.tsx:217-224`), whichever way its traffic runs, so an `Arm` — even with
Phase 1's `origin` — carries no incoming/outgoing information at all. It does
not need to: the two arms of a gore are **the pair with the smallest angle
between their directions**, which is the diverging pair at a diverge and the
converging pair at a merge, with no direction of travel consulted either time.
Ties break on link id so the drawing is deterministic. A node with fewer than
two arms draws no gore; a node with more than three is not rejected — the
closest pair still wins, which is the same "the human chose this glyph" posture
`CLAUDE.md` takes.

Then:

1. Take that pair's **inner edges** — for each, a ray from `arm.origin` (§2.2)
   in direction `arm.dir`, offset laterally by that link's own
   `(roadWidth - ROAD_MARGIN) / 2` toward the other arm.
2. Intersect the two rays. That point is the **nose**. Two rays in general
   position intersect; the cases that do not (parallel, or intersecting
   *behind* both origins) fall back to the node position, which is the
   degenerate-but-drawable answer.
3. The gore is the triangle from the nose along both edges for `GORE_LENGTH`,
   closed by a straight base.

Filled with the shoulder hatch (`#road-hatch`, already emitted conditionally by
`HatchPattern` in `Diagram.tsx` — road spec §2.5), and bounded by a solid edge
line on each side. **Reusing the pattern means the `<defs>` emission condition
has to widen**: it is currently `hasShoulder(doc)`, and must become "a shoulder
lane **or** a gore glyph exists", or a document with a gore and no shoulder
references a pattern that was never emitted. That failure is invisible in the
markup assertions and shows only as an unpainted triangle, so Phase 4's gate
tests it directly.

A gore is drawn by a new glyph rather than by detecting the topology, for the
reason `CLAUDE.md` gives ("Layout is semi-automatic"): a three-arm node is a
crossroads, a T-junction, a diverge, or a merge depending on what the human
means by it, and the existing `JunctionGlyph` list is exactly the vocabulary for
saying which. **One variant, `gore`, covers both diverge and merge** — the
geometry is identical, and the closest-pair rule above picks the right two arms
in both cases without ever asking which way traffic goes.

**Not the chevrons.** A real gore carries painted chevrons or a "keep left"
arrow. Those are `Marking`s, and `Marking`/`Sign` rendering is the decorations
spec's whole subject (road spec §2.7). The gore here is surface and edge lines
only.

> **CORRECTED 2026-08-10 — the chevrons are not `Marking`s; see §2.9.** The
> deferral was right and its destination was wrong, which `road_markings_spec.md`
> §2.10 established on 2026-07-25 and this spec never recorded: a `Marking` is
> anchored to **one link at one position**, and a gore's chevrons live in a
> triangle **between two links at a node**, which that anchor cannot express. They
> are presentation on the gore glyph and come home here, as Phase 5. The rest of
> this paragraph stands — Phase 4 *did* ship surface and edge lines only.

### 2.6 Adding an enum variant is not as free as adding a field (constraint, recorded)

§2.3 establishes that a new **field** costs no `SCHEMA_VERSION` bump. A new
**variant** of an existing enum is different in one direction, and it is worth
stating because the difference is invisible until someone opens a file in an
older build:

| Change | Old build reads new file | New build reads old file |
|---|---|---|
| New optional field (`LinkView.align`) | ignored — no `deny_unknown_fields` anywhere in `src-tauri/` | `#[serde(default)]` → `centre` |
| New enum variant (`JunctionGlyph::Gore`) | **serde error on the whole document** | fine |

`persist.rs:42` cannot help: it only rejects files declaring a *newer*
`schema_version`, so a `glyph: gore` written under `schema_version: 1` reaches an
old build as a raw deserialize failure with no useful message.

**Resolved in review (OQ-3): Phase 4 bumps `SCHEMA_VERSION` to 2.** Zukai is
`0.1.0` with no released builds and no migration path written
(`persist.rs:35-36`: "No older versions exist yet, so there is no migration
path"), so simply accepting the breakage would also have been defensible — but
the cost of the bump is two constants that must move together
(`src-tauri/src/model/mod.rs:31` and `src/model/types.ts:220`), and the payoff is
that `persist.rs`'s existing probe turns a raw serde error into the sentence it
was written to produce. A future `load_document` may then want a real migration
arm; nothing in this spec needs one, since a v1 file is a valid v2 file.

### 2.7 Where the logic lives

The split the road spec and export spec established
(`rules/road-rendering.md`, `rules/diagram-export.md`):

| Piece | Where | Pure? |
|---|---|---|
| `alignmentShift`, `LinkAlign`, `TAPER_LENGTH`, `TAPER_MAX_BEND`, `GORE_LENGTH` | `src/editor/geometry.ts` | ✅ vitest |
| `rayCircleExit` (the stop-bar distance, Phase 1) | `src/editor/geometry.ts` | ✅ vitest |
| `taperWedge(...)`, `gore(...)` — polygon points | `src/editor/geometry.ts` | ✅ vitest |
| `rayIntersection` (the gore nose) | `src/editor/geometry.ts` | ✅ vitest |
| `Arm.origin`, the wedge and gore elements, the `gore` glyph, the butt-cap class | `src/components/Diagram.tsx` | ✅ via `renderToStaticMarkup` |
| Taper/gore paint, `.road-casing--butt` | `src/styles/diagram.css` | — reaches exports free |
| `LinkView.align` mirror | `src/model/types.ts` **and** `src-tauri/src/model/layout.rs` | ✅ Rust round-trip test |
| `setLinkAlign` — action, reducer case, undo behaviour | `src/editor/state.ts` (beside `setLinkStyle`, `:97`/`:326`/`:542`) | ✅ `state.test.ts` |
| The alignment control | `src/components/Inspector.tsx` | — |

**This spec does touch Rust**, unlike the road spec — one field on `LinkView` —
so `rules/document-model.md`'s "Rust↔TypeScript mirror discipline" applies and
`cargo fmt --check` / `cargo clippy --all-targets -- -D warnings` are live in
Phase 2's gate.

The cross-spec obligation looks like `strokeAllowance` (`export.tsx:69`) again —
the bug class the export spec's review round 1 caught and the road spec
inherited — but **checking it says no change is needed, and that is recorded
here so Phase 3 does not go hunting a bug that is not there.** `measureDiagram`
frames the drawing from `getBBox`, which excludes *stroke width* but includes
fill geometry; that exclusion is the entire reason `strokeAllowance` exists and
why it is `roadWidth / 2`. A wedge or gore is a filled `<polygon>` inside the
measured `<g>`, so its extent is already in the box. Phases 3 and 4 therefore
**confirm** the frame still covers the new shapes, with "`strokeAllowance`
unchanged" as the expected outcome rather than the suspicious one.

### 2.8 Non-goals

- **Not movements or signal plans.** `Movement` stays unrendered; which lanes a
  ramp actually takes is the junction-semantics spec.
- **Not markings or signs** — *gore chevrons no longer included: **CORRECTED
  2026-08-10**, they are presentation on the glyph rather than `Marking`s, and
  §2.9 brings them back into this spec. Markings and signs proper are still out.*
- **Not variable lane width along a link** — §2.4 rejects it explicitly.
- **Not a taper on a divided road.** A divided road's lane drop puts four links
  on the node, which is not a through joint (§2.4), so it draws as it does today.
  The fix belongs with a wider pass over carriageway pairing, not here.
- **Not weaving sections or collector-distributor roads.** A weave is two gores
  plus an auxiliary lane; it should fall out of this spec's pieces, and if it
  does not, that is its own spec.
- **Not auto-layout** (`CLAUDE.md`) — the human still places the ramp and picks
  the glyph.
- **Not to-scale.** `TAPER_LENGTH`/`GORE_LENGTH` are schematic constants, like
  `SCHEMATIC_MEDIAN`.
- **Not the undivided-two-way centreline** — road spec OQ-4, re-deferred; see
  OQ-6 below for where it should actually land and why. (It landed in the
  markings spec, 2026-07-25, as paint rather than as either proposed field.)

### 2.9 The gore says which way to go round it (added 2026-08-10, reopening — Phase 5)

Everything above shipped on 2026-07-25 and is left as it shipped
(`/Users/ivapo/.claude/skills/spec-driven-dev/spec-authoring.md` §6.1). This
section is the reopening, and it adds the one thing §2.5 deferred to the wrong
place: **the paint inside the triangle.**

Phase 4 drew the gore as a hatched triangle with two edge lines, and the hatch is
borrowed — it is `#road-hatch`, the *shoulder* pattern, reused because it already
existed and costing §2.5 a widened `<defs>` emission condition to get at. A
shoulder hatch says "this strip is not a running lane". A gore says something
stronger and more specific: **go round this, and here is the side you are on.**
That is what chevrons say and hatching cannot.

#### 2.9.1 The trap: the glyph does not know which way traffic goes, and chevrons must

§2.5 made a virtue of direction-blindness, and was right to: the arm pair is "the
pair with the smallest angle between their directions … with no direction of
travel consulted either time", and **one `gore` variant covers both diverge and
merge** because the geometry is identical. Chevrons break that symmetry, and this
is the whole design problem.

`gore(...)` returns `[nose, fa, fb]` — the nose where the two inner edges meet,
near the node, and the base `GORE_LENGTH` out. Which end the driver arrives from
is **opposite in the two cases**:

| Case | Traffic | Approaches the gore from | Chevrons point |
|---|---|---|---|
| Diverge | arrives on the third arm, splits | the **nose** end | at the nose |
| Merge | arrives on both legs, joins | the **base** end | at the base |

Draw one orientation for both and half of all gores point the wrong way — a
drawing that looks entirely deliberate and states the opposite of what it means.
That is the same silent-mirror class this corpus keeps catching: the give-way
teeth (`road_markings_spec.md` §2.7), the lane numbering
(`lane_arrows_spec.md` §2.5.1), and the rear head's frame (markings §2.11). It
gets the same treatment — **one derivation, named, tested against both cases.**

**The derivation costs no new field.** `Arm.dir` is geometric and points outward
whatever the traffic does, which is why §2.5 could not consult it. But the link
itself carries the answer: for each of the pair, the node is either the link's
`from_node` (traffic **leaves** — outbound) or its `to_node` (traffic **arrives**
— inbound). Both outbound is a diverge; both inbound is a merge. Nothing is added
to the model, no control appears, and §2.5's arm-*picking* rule is untouched —
direction is consulted only to orient the paint, after the pair is already chosen.

**The mixed case is a floor, not an error.** One arm in and one out is a gore the
human built by hand out of two links that do not diverge or converge, and an
imported fragment can hold one too. It draws the **diverge** orientation, on the
same posture §2.5 takes for a node with more than three arms — "the closest pair
still wins" — and for the same reason: a drawing that still looks deliberate beats
one that silently loses its paint.

#### 2.9.2 The chevrons replace the hatch, and that is the phase's one visual change

A real gore carries **one** treatment. Chevrons laid over hatching read as a
mistake, and this repo has already settled the general form of that question:
markings OQ-3 chose *replace* over *overpaint* for a lane line, on the grounds
that overpainting leaves the old mark showing through the gaps. The same argument
holds here and the gaps are larger.

So `GoreShape` paints chevrons where it painted `#road-hatch`, and two
consequences follow that a reader would otherwise meet at implementation time:

- **§2.5's widened `<defs>` condition becomes dead and narrows back.** Phase 4
  widened `Diagram.tsx:hasShoulder` — which it renamed `needsHatch` for exactly
  this reason — to fire for a gore glyph, so the borrowed pattern existed.
  With the borrowing gone it is a shoulder test again, and the rename should
  arguably go back with it. *(It did — Phase 5's as-built note.)* **Phase 4's gate test inverts**: "a document with a
  gore and no shoulder lane emits the `<pattern>`" becomes "emits none". That is a
  shipped assertion changing meaning, so it is named here rather than discovered —
  and `.jn-gore-hatch`, asserted twice in `Diagram.test.tsx`, goes with it.
- **Every existing gore changes appearance.** There is no way to add the paint a
  gore wants without that, and it is the point of the phase rather than a cost of
  it.

#### 2.9.3 Count is derived, pitch follows, and containment is constructional

The gore is a triangle, so a chevron's span is the triangle's local width at its
station along the axis — narrow at the nose, widest at the base. The fan is laid
out the way `geometry.ts:spanCells` lays out give-way teeth: **take the count from
the length and let the pitch follow**, so the chevrons tile the axis exactly with
no partial one at either end. Containment is then a property of the construction
rather than a clamp each chevron has to remember — a chevron on the wrong side of
an edge line is the failure this rules out, and it is the same failure
`ARROW_REACH` rules out for a turn arrow. One consequence for the gate, stated so
the assertion is written right the first time: a chevron's wing tips land
**exactly on** the triangle's edges by construction, so the containment test is
inclusive with a tolerance (`≤ … + 1e-9`), as the markings suite already writes it
— a strict inside test fails a correct implementation.

Every dimension is a schematic build constant in the manner of `GORE_LENGTH` and
`TAPER_LENGTH` (§2.8), settled in the app. They scale with the glyph's `scale`,
as `GORE_LENGTH` already does, and carry **no `vector-effect`** — paint scales
with the drawing it is on, which is what makes a canvas and an export
byte-identical in what they paint (`rules/marking-kinds.md`).

**No model change, no `SCHEMA_VERSION` move, no Rust, no new action and no new
control.** The chevrons are derived entirely from the gore's own geometry and the
directions of the two links it already found.

### 2.10 The node dot sits on the road, not in the median (added 2026-08-11, reopening — Phase 6)

This section is the second reopening
(`/Users/ivapo/.claude/skills/spec-driven-dev/spec-authoring.md` §6.1), and it
takes up **OQ-4**, which Phase 1 opened and left.

`Diagram.tsx:NodeShape` draws one dot at `nodePos`. On a divided road that
position is the **shared centreline**: `carriageways` steps each carriageway out
from it by `carriagewayOffset`, so the dot lands on neither. A reader of the
figure sees a mark between two roads and reads it as an object *in* the median —
an island, a sign, a gantry leg — rather than as the end of the road. It appears
wherever a divided road **ends or passes through a non-junction node** (a
junction draws a glyph and no dot at all), and `.node-dot` lives in
`diagram.css`, so it travels into every exported file.

**The median is not the only place the dot comes off the road.** Phase 2 shipped
`LinkAlign`, and `lateralShift` is `carriagewayOffset + alignmentShift`, so an
`offside`- or `nearside`-aligned **undivided** link is drawn stepped off its own
polyline by half its lane region — and its node's dot stays behind on the
centreline exactly as a divided road's does. `Arm.origin`'s own doc comment still
says "the node position for an undivided road", which Phase 2 falsified and
nobody corrected. It is one defect with two sources, and §2.10.2's rule addresses
the shift rather than the divide, so it fixes both.

#### 2.10.1 OQ-4 asked "a dot per carriageway, or nothing at all", and the answer is a dot per carriageway

Three reasons, and the first is the one that settles it:

- **The dot is not only paint — it is the node's only hit target.** The `<g>`
  around it carries `onNodePointerDown`, so "nothing at all" does not draw less;
  it makes a divided road's endpoint unselectable and undraggable. That is not a
  drawing decision, it is the removal of a gesture, and it would have to buy the
  gesture back with a hit target somewhere else. A dot per carriageway keeps the
  target where the pointer already reaches for it.
- **A dot on the carriageway says what the median dot was trying to say.** The
  road ends *here*, and on a divided road it ends twice.
- **It costs no new derivation.** `Arm.origin` is exactly this position and has
  been since Phase 1 — "where that carriageway actually meets the node". §2.2
  built it, `junctionArms` returns it, and `junctionArms`'s own doc comment
  already names this defect as open.

`nodePos` does **not** move, and that is the two-layer split holding: the node is
at the centreline, and only its *mark* moves onto the roads. Dragging either dot
dispatches the same `moveNode` with the same node position it does today.

"Per carriageway" is OQ-4's own wording and it is what the answer *means*; §2.10.2
sharpens it to **per drawn road end**, which is the same thing everywhere except
at a joint where one carriageway's two halves are drawn to two places.

#### 2.10.2 One dot per drawn road end, which is not one dot per arm

> **CORRECTED 2026-09-14 — a node draws one dot per road through it; see §2.13.4.**
> True when written, and it held until a waypoint whose two roads end at different
> points was reported as two nodes. Phase 13 reverses four claims below:
> - **"One dot per drawn road end"** is now one dot per through pair, at the narrower
>   arm's origin, plus one per remaining arm.
> - **The divided lane drop draws two dots, not four**: each carriageway is one pair.
> - **"No angle, no mean, no ordering"** no longer describes the rule. The second
>   pass of `throughPairs` sorts by angle. What it keeps is the property:
>   - the result does not depend on `doc.links` order, since the sort key is the turn
>     and then the ids;
>   - a pair is topological, so this is still not the clustering ruled out below.
> - **The aligned jink draws one dot**, at the arriving arm's origin, since the widths
>   are equal.
>
> The tolerance paragraphs still hold. `SAME_POINT` now answers to `jointDiscs`, which
> still merges arm origins, and to the whole-result merge in `nodeDots`.

An arm is per *link*, so counting arms over-counts wherever two arms are drawn to
the same place. Write each arm's **displacement** `v = origin − nodePos` and the
shapes this reaches come out like this:

| Node | Arms | Displacements | Dots |
|---|---|---|---|
| Undivided endpoint, centre-aligned | 1 | one, exactly `0` | 1 |
| Undivided waypoint, centre-aligned | 2 | two, both exactly `0` | 1 |
| Divided endpoint | 2 | two, opposed | 2 |
| Divided waypoint, straight through | 4 | two coincident pairs | 2 |
| Divided waypoint with a lane drop | 4 | two pairs, same-way, `4.5` apart | **4** |

So the rule is **one dot per distinct arm origin**, and "distinct" means distinct
as a position — nothing about sides, angles or averages. The last row is the one
worth stating out loud, because it is where an earlier draft of this section went
wrong twice over.

**The last row draws four dots, deliberately.** A carriageway's step from the
centreline is `w / 2 + separation / 2`, so dropping one lane moves it by exactly
half a lane — measured at `±22.5` and `±18` on a 4→3 divided waypoint, a gap of
`4.5`. Those genuinely are two road ends at two places, and the drawing already
shows the step between them; two overlapping dots is what that looks like. The
alternative was to merge them and draw one dot at the mean, and it was tried:
review measured (round 2, 2026-08-11) that **any** rule clever enough to know
those two belong together is a clustering rule, that "same side" is not
transitive, and that greedy clustering over a three-arm fan changes the **number
of dots drawn** under a permutation of `doc.links` — two identical drawings
drawing differently, and redrawing one link changing the picture. A rule that
reads only "is this the same point" cannot do that, so it is the rule.

**The tolerance is float slack and not a design parameter**, which is the whole
of what that distinction buys. Two arms drawn to the same place *are* the same
place: rows 2 and 4 are exact — `drawnPolyline` returns the layout polyline
unmodified when the shift is `0` (row 2 compares the node's own `pos` object with
itself), and a straight divided waypoint offsets both links by the same `d` along
the same segment delta. Measured (2026-08-11, over 400 straight divided splits):
a centre waypoint's two arms return the *same object*, **314 of the 400** split
pairs are **bitwise** identical, and the rest part by a slack whose worst
observed value is **2.84e-14** — an instance and not a bound, since the slack
grows with distance from the world origin (≈1.6e-10 at 1e6 units out).

So the epsilon absorbs that and nothing else, and it is `1e-6` world units. The
margin is measured on both sides: the nearest **genuinely distinct** pair of
lateral shifts the UI can produce is `0.45` units apart — enumerating every lane
count against every class factor gives 37 distinct shifts, and `32.85` against
`33.3` is the closest two — while the `4.5` this must never merge is six orders
above it. Breakeven against the slack would need a drawing about 10¹⁰ units from
the origin, on a 36-unit grid. It is a guard against the last bits of a `hypot`,
never a decision.

**It gets its own name rather than reusing `SAME_EDGE`,** which is already `1e-6`
in this file and already documented as exactly this kind of guard. The magnitude
being precedented is the point — no new *quantity* enters `geometry.ts` — but the
two answer different questions (are two lane edges at one lateral offset; are two
road ends at one point), and a shared constant is how tuning one silently retunes
the other. Same lesson as `geometry_length` against `polylineLength` (`zk-012`).

**No angle, no mean, no ordering, no new quantity.** The result is a set of
positions, so it does not depend on `junctionArms`' iteration order or on
`doc.links` order — which is the property the clustering draft could not have,
and the reason this one is smaller. Exactly: **by construction** for the pairs
that are bitwise equal, and **by quantisation** for the rest, which is the
paragraph below.

**The one thing that could take that property back, stated rather than left to be
found:** comparing within an epsilon is not transitive, so a *chain* of origins
each within `1e-6` of the next but spanning more than `1e-6` end to end would
again make the count depend on which one is kept first. It cannot be built. Two
origins are separated either by float slack — worst measured `2.84e-14`, eight
orders below the epsilon — or by a design quantity, and the smallest design
quantity the UI can produce is the `0.45` above. Reaching a sub-`1e-6` step
therefore needs two lanes whose widths differ by about `1e-7` **metres**, which
the Inspector's stepper cannot express, `network.yaml` has no reason to carry, and
a `.zkai` could hold only by being edited by hand to that purpose; a chain needs
two such coincidences at once. This is a smaller claim than the clustering
draft's and it is the whole of what the epsilon risks: not "an odd document draws
oddly", but "a document nobody can author draws one dot differently".

**A dot per arm would also be order-independent, and it is still wrong**: rows 2
and 4 would draw two circles where one is wanted, and row 2 — the ordinary
undivided waypoint — would stop being byte-identical for a difference no reader
can see.

**The undivided aligned "jink" gets two dots, and that is the fix rather than a
cost.** §2.4's table already supports two links meeting at a waypoint with
different `align` values — "the road jinks sideways and the picture says so" —
and their origins differ, so each drawn road end takes its own dot. Today both
are represented by one dot on a centreline neither road touches.

**A degenerate first segment lands its dot on the node, and that is right by
construction.** `offsetPolyline`'s endpoint branches take the first and last
segment normals without the interior branch's degenerate guard, and
`segmentNormals` answers `(0, 0)` for a zero-length segment — so a bend snapped
onto its own node (reachable since `zk-014`) leaves a divided arm's origin *on*
the node. The dot follows the drawn road end wherever it is, including there, so
this needs no case: it is `offsetPolyline`'s pre-existing behaviour showing
through, not a rule of this one.

#### 2.10.3 A node with no links keeps its dot at the node, and this is the default rather than the edge case

An arms-derived rule returns nothing for a node no link touches — an **invisible
and unclickable** node, which makes the node tool look broken. And this is not a
rare document: every node is link-less for the interval between being placed and
being connected, which is every first click of every drawing. The fallback to
`nodePos` is therefore the ordinary path through the function, and the gate tests
it as one.

#### 2.10.4 The dots share one group, so the hit target and the halo follow them

Both circles go inside the existing `<g>`, which keeps `onNodePointerDown` on one
element and leaves the drag exactly as it is. `Canvas.tsx:onNodePointerDown`
already takes its grab offset from `nodePos` rather than from the drawn dot, so
either dot drags the node correctly with nothing changed there. The halo draws
**per dot** for the same reason the dot does: a selection ring around one
carriageway and not the other reads as half a selection. The halo is chrome —
`.node-halo` is in `styles.css`, not `diagram.css` — so it stays out of exports
by construction either way (`rules/canvas-interaction.md`).

The radius still comes from the node type (endpoint 6, waypoint 4), unchanged and
per dot.

**The group's `transform` stays on `nodePos` and each dot enters as a
displacement**, which is what makes the centre-aligned undivided case come out
byte-identical rather than merely identical-looking: a displacement of `0` must
emit **no** `cx`/`cy` at all, since React renders `cx={0}` as `cx="0"` and today's
markup carries neither attribute. `undefined` where the number is zero is the
whole mechanism, and it is named here because the natural spelling fails the
gate's identity assertion for a reason that has nothing to do with the geometry.

`junctionArms` keeps its name. It reads every link touching a node and filters on
nothing, so it already answers this question — but the name now understates it,
and the correction belongs in its doc comment rather than in a rename that would
ripple through four rules and two specs for no behaviour. The cost is one loop
over the links per node, which is what the junction layer already pays for every
junction, on a document that holds a fragment of a network.

**No model change, no `SCHEMA_VERSION` move, no Rust, no new action and no new
control.** This is drawing, derived from geometry the app already computes for
every node it draws a glyph at.

### 2.11 What a printed figure got wrong (added 2026-08-11, third reopening — Phases 7–9)

This section is the third reopening
(`/Users/ivapo/.claude/skills/spec-driven-dev/spec-authoring.md` §6.1), and unlike
the first two it starts from **a figure rather than from a reading of the code.**
Phase 6 shipped; §1's motorway exit was then built through the reducer, exported
through `measureDiagram`/`diagramSvg`, and printed. Three things in that file are
wrong. A fourth looked wrong and was not, which is recorded here because the
mistake is instructive and reachable by any user.

**Phase 7 shipped 2026-08-11 (reviewed in three rounds the same day). Phase 8
shipped 2026-08-14 (reviewed in two rounds the same day). Phase 9 is neither**: it
is its own episode under §7.0 and takes its own scoped round before it can be
planned.

**The one that was not a defect, recorded first so nobody re-opens it.** In the
first print the offramp was drawn **straight across the mainline**, and the gore
sat on paper below the road. That is not a rendering fault: the mainline was
aligned `offside`, so its lane region hangs *below* its polyline (§2.3's pinned
sign), and the ramp was sent down the same side — so the ramp left the road's far
edge and had to cross it. The identical document with the mainline aligned
`nearside` draws §1's picture exactly, gore and all. **Ramps OQ-8 is therefore
confirmed rather than reopened**: the chevrons read correctly at figure scale, and
what looked like collapsed paint was the overlap. What the episode *does* prove
belongs to OQ-5, and §2.11.3 takes it.

#### 2.11.1 A node's dot is an editing mark, not figure content (Phase 7 — answers OQ-10)

Every free road end in the printed figure carries a filled bead: `.node-endpoint
.node-dot`, paper-filled with a dark stroke, radius 6 and so 12 units across. A schematic shows a
*fragment* of a network, so its roads run off the edge of the frame — and a bead
on the cut end states the opposite, that the road stops there. There were four in
one figure.

**So the dot becomes chrome**, on the gate that already keeps every other editing
affordance out of a file: `Diagram.tsx` takes an optional `interaction`, and
`export.tsx:diagramInner` renders without it, so nothing needs a filter anyone can
forget (`rules/canvas-interaction.md`). `.node-dot` moves `styles/diagram.css` →
`styles.css` with it, which is the same move and the reason the halo was never in
a figure.

- **This answers OQ-10, and it answers it for the endpoint rather than the
  waypoint.** That question asked whether a *waypoint* dot belongs in a figure.
  Phase 6's dev pass then found that a waypoint's dot is already invisible in one —
  `.node-waypoint .node-dot` is `fill: var(--asphalt); stroke: none`, so on the
  road it cannot be seen. The endpoint's is the one that prints, and it is the one
  OQ-10 did not ask about. Deleting the whole class of mark from figures answers
  both at once and needs no rule about which node types print.
- **It does not undo Phase 6, it relocates what Phase 6 built.** The dots still sit
  on the carriageways, still share one group, and are still the node's hit target —
  on the canvas, which is the only place a hit target means anything. What changes
  is that a figure stops carrying them.
- **The junction glyph is untouched.** A pad, a ring, a gore and a diamond are what
  the roads *do* at that node, so they are figure content. A dot is where the human
  clicks.
- **A document of nothing but unconnected endpoint or waypoint nodes then exports
  as a blank sheet**, since `measureDiagram` frames from `getBBox` and there is no
  geometry left to frame — after the change `NodeShape`'s only two children, the
  halo and the dot, are both interaction-gated, so such a node emits an empty
  `<g>` and nothing else. **Scoped to those two types deliberately**: an
  unconnected *junction* still draws, because `geometry.ts:armWidth` answers
  `MIN_ROAD_WIDTH` (12) for a node with no arms — the case its doc comment exists
  for — so `geometry.ts:padRadius` gives `(12 * 0.62 + 3) * scale`, a **10.44-unit
  pad at the default Size**, and the sheet is not blank. Named rather than
  discovered: a figure of no roads is a figure of nothing, and `diagramSvg`
  already renders a `null` bounds as a small blank page rather than failing.
- **Every export's frame also tightens, and that is a second visible change.**
  `getBBox` excludes stroke width but includes fill, so at a free end the dot's own
  fill was the extremum — up to 6 units of it, the radius, since the same exclusion
  drops its 2-unit stroke. Removing it shrinks the
  measured box and the paper with it wherever a free end was extreme. No clipping
  follows: `export.tsx:frame` uses `EXPORT_PAD + strokeAllowance`, and
  `strokeAllowance` **equals** the widest link's round-cap overhang (`roadWidth /
  2`) rather than exceeding it, so the 24-unit `EXPORT_PAD` is the whole of the
  slack — with more to spare for every narrower link. No test pins a `viewBox` for
  a document with endpoints.

**Five shipped assertions are affected, not three, and only two of them invert** —
named here so they are edited rather than met at implementation time. Cited by test
name rather than by line, because the whole point of the paragraph is that these
tests are about to be edited:

| Test | What Phase 7 does to it |
|---|---|
| `export.test.ts` "contains the drawing and none of the canvas chrome" | **inverts** — asserts the dot is present in a figure |
| `Diagram.test.tsx` "emits its own `<g class="diagram">` root around the drawing" | **inverts** — same claim, canvas-free render |
| `Diagram.test.tsx` "emits a centred undivided node exactly as it did before the dots moved" | **passes an `interaction`** — Phase 6's identity case, a canvas fact |
| `Diagram.test.tsx` "marks a divided road's endpoint on both carriageways, from one group" | **passes an `interaction`** — Phase 6's, likewise |
| `Diagram.test.tsx` "draws above the roads, the paint and the junction glyphs alike" | **passes an `interaction`**, or goes vacuously green — below |

**The identity claim survives that and must**: with an `interaction`, a centred
undivided node still emits its group character for character apart from the
`vector-effect` that `hairline` already adds.

**The fifth is the one worth the phase's attention, because it does not fail — it
goes quiet.** That sign paint-order test pins its layer with
`expect(plate).toBeGreaterThan(svg.indexOf("node-dot"))`, in export mode. With no
dot in the markup `indexOf` returns `-1`, every plate index beats it, and a shipped
ordering assertion dies **green**. It renders with an `interaction`, so it goes on
asserting what it was written for. The general rule it teaches is the phase's, not
this test's: **an `indexOf`-keyed ordering assertion must first assert its needle is
present**, or the day the needle leaves the markup the assertion starts passing for
nothing. That is `export.test.ts:CHROME`'s own vacuity lesson arriving from the
opposite direction.

#### 2.11.2 A gore's arms give up their round caps (Phase 8)

At the diverge the ramp's casing ends in a **round cap**, so a half-disc of asphalt
of its own half-width bulges back over the mainline and breaks the mainline's edge
line where the two part. It is the same defect §2.4 already solved one node type
along: a taper gives **both** its links a butt cap, because an outset link's round
cap paints past the joint and no added polygon can remove it.

A gore never got that treatment, and the geometry says it should: the gore's legs
are *literal continuations of the two roads' own edge lines* (Phase 4's as-built
note), so a cap that crosses a leg crosses an edge line that is drawn to be
continuous. The fix is the modifier class that exists — `.road-casing--butt`, on
the arms of a `gore` glyph — not a new mechanism.

> **CORRECTED 2026-09-14 — the modifier class is gone, and the rule is wider; see
> §2.12.1.** True when written, and what it produced still holds: no round cap
> crosses a gore's edge lines. Phase 10 butt-capped every casing, so the gore's
> arms need no rule of their own. A gore node is a `junction`, so it also gets no
> joint disc. Keying to the glyph rather than to `gorePair`, argued below, is
> therefore now moot rather than wrong.

**Every arm of the glyph, not the two the gore chose** (decided in review round 1,
2026-08-14, on a measurement). The tempting reading is that this is about the pair
`gorePair` picks, since they are the two the triangle is built from. It is not, and
§1's own exit is the counter-example: the unchosen arm there is the **approach**,
which is the *widest* road at the node and so carries the largest cap of the three.

Measured on the shipped `exit()` fixture, whose node is at `(120, 0)`:

| Arm | Role | Origin | Half-width | Chosen? |
|---|---|---|---|---|
| L1, 4-lane motorway | approach (inbound) | `(120, 18)` | **19.5** | **no** |
| L2, 3-lane motorway | mainline on (outbound) | `(120, 13.5)` | 15 | yes |
| L3, 1-lane ramp | ramp off (outbound) | `(120, 0)` | 5.1 | yes |

L1's round cap is a half-disc of radius 19.5 about `(120, 18)`, so at the node it
reaches `y = 37.5`. L2's nearside casing edge is at `28.5` and its **edge line** at
`27`. The cap therefore paints up to 9 units past the mainline's own asphalt and
10.5 past the line that bounds it, over a run of `sqrt(19.5² − 10.5²) ≈ 16.4` units
in `x`. **Almost none of it is covered**, and the qualifier is measured rather than
hedged (review round 2): at its shallowest the ramp's casing does reach back to
`x ≈ 132.9`, taking about 3.6 of those units, but by `y ≈ 30` the lune has ended at
`132.5` while the ramp has not yet started at `135.9` — and the **gore triangle
begins at its nose, `x ≈ 142.3`, downstream of the whole lune**. So most of it is
asphalt on bare paper, outside the mainline's edge line, at exactly the place this
phase exists to clean up — and the chosen-pair reading leaves it there.

The rule is therefore **the glyph, not the pair, and not the arm count**: every
link incident to a node whose `JunctionView.glyph` is `gore` takes the cap. Three
dividends fall out, and they are why this reading is also the smaller one:

- **It needs no `gorePair` call.** The `butt` set is built in `Diagram.tsx:tapers`,
  which runs *before* the node layer, while `gorePair` is called inside
  `GoreShape`, which runs after. A chosen-pair rule would have to recompute the
  pair at the top of `Diagram`; a glyph rule is a lookup in `doc.layout.junctions`.
- **It has no degenerate cases.** `gorePair` returns `undefined` below two arms,
  and a gore with two, four or more arms picks a pair whose membership is not
  obvious; "every arm" answers all of those the same way.
- **It matches the taper precedent exactly.** §2.4 gives the cap to **both** links
  of a wedge joint — every link there, not a selected subset.

**A one-arm gore flattens that road's caps and draws no gore**, which is the rule
working rather than a case to special-case: `gorePair` answers `undefined` below two
arms so `GoreShape` renders nothing, while the glyph-keyed rule still caps the one
link at both ends. §2.4 already calls a flat free end the better schematic reading,
and the shipped `draws from two arms and nothing at all from one` asserts only the
*absence* of `jn-gore`/`jn-pad`, so it stays green. Named here rather than met.

**What this does not claim.** It does not move where the ramp starts. A ramp still
leaves from its shared node, so with the alignment chosen correctly (§2.11.3) its
asphalt still begins inside the mainline's; the butt cap removes the *bulge past*
that, which is what breaks the line. Starting a ramp at the gore's nose instead is
a larger change to what a link's drawn end means, and it is not proposed here.

#### 2.11.3 The panel says which side a road's lanes hang on (Phase 9 — OQ-5, taken)

> **CORRECTED 2026-09-14 — the readout and the Alignment row are gone; see §2.13.5.**
> The side is now set on the node, where both roads it moves are adjacent on the
> canvas. A wrong pick shows as a lane opening on the wrong side, at the node where
> it was picked. A readout of a number no control on the link panel sets would
> repeat `associated_link`'s lesson, so it was not kept against the walked shift.
> `alignmentReading` went with it. The travel-frame argument below still holds for
> the node row's words, `nearside` and `offside`.

OQ-5 asked whether alignment could be **derived** rather than set, and proposed
keeping it explicit, "revisit[ing] if setting it twice per exit becomes tedious in
practice". The figure says the cost is not tedium. The wrong pick does not make a
slightly worse drawing; it draws a ramp through a motorway, and it does so while
every assertion in the suite passes, because each road is individually correct.

**The decision is to keep it manual and make the state legible** (taken by the user
on the evidence, 2026-08-11). Deriving it was the alternative and is declined for
the reason OQ-5 already recorded: a derived side flips when a node is dragged past
the mainline, so the drawing would change under a gesture that means nothing.

So the Inspector's Alignment control gains a **readout of what the setting does to
this road**, in the drawing's own terms rather than in the enum's: which side of
its own polyline the lane region sits on, and how far off it.
`alignmentShift` (in `geometry.ts`) already returns exactly that
number and its sign is pinned (§2.3), so the readout is derived from the same
function the renderer uses — via `lateralShift` → `drawnPolyline` — and cannot
drift from it.

##### The frame is the road's own travel direction, not the screen (decision, recorded)

**Settled by the user, review round 1, 2026-08-14**, because the two are different
features and the spec had asked for both at once. The readout says:

```
Alignment    [ centre ][ nearside ][*offside*]
Lanes        right of travel, 18 off the line

Alignment    [*centre*][ nearside ][ offside ]
Lanes        on the line
```

**`centre` is its own sentence rather than the same one with a zero in it** —
`side: "on"` cannot fill the template ("on of travel, 0 off the line"), so the
panel branches on it. Both rows are given because the one that reads oddly is the
one an implementer would otherwise invent.

**The magnitude prints to two decimals with trailing zeros trimmed** — `18`,
`14.4`, `12.15` — and **not** `toFixed(0)`, which is what the bend `Position`
readout uses. The precedent is borrowed for the *units*, not for the precision,
and the two quantities differ: a bend position is a placed coordinate that
`zk-014` Phase 3 snaps to a 36-unit grid, while a lane region's half-span is
fractional by construction (a 4-lane ramp is `14.4`, a 3-lane local `12.15`).
Rounding those to `14` and `12` would print a number the drawing does not use.

`right`/`left` **of travel**, plus the magnitude in canvas units — never `below`/
`above`, and never the enum's own `nearside`/`offside`, which name the *setting*
and would appear in the readout attached to the opposite referent ("offside → lanes
hang nearside") for a reader to untangle. Three things decide it:

- **`alignmentShift` is direction-blind** — its parameters are
  `(lanes, style, align)` and it never sees a polyline, so it cannot answer a
  screen-frame question at all. A `below`/`above` readout needs the drawn
  direction, which is geometry this phase would otherwise not touch, and the "no
  geometry, no new action" claim below would stop being true.
- **A bent road has no single `below`.** Since `zk-014` a link carries `bends`, and
  its segments face different ways; `right of travel` is one answer for the whole
  road, which is the property a readout needs.
- **The picture already states the travel direction** — `RoadShape` draws an arrow
  head at the link's far end — so the reader converts `right of travel` to a side
  of the screen by looking, which is the step the frame is for.

> **CORRECTED 2026-09-14 — the arrow is at the midpoint, and only on the canvas's
> selected link; see `road_declutter_spec.md` §2.1.** True when written; commit
> `67f9018` (2026-09-11) moved the arrow halfway along the road, and zk-017 Phase 1
> made it chrome: no exported figure carries one, and the canvas draws it on the
> selected link alone. The argument above still holds, because this readout is shown only for a
> selected link — which is exactly where the arrow now is — but "the picture"
> means the canvas, not a figure.

**The magnitude is canvas units and is named as such**, on the precedent the panel
already sets for the one other quantity of this kind: the bend `Position` readout
(`Inspector.tsx`, the `selection.kind === "bend"` arm) carries a comment declaring
exactly that, because "this is a position in the drawing, which is the one quantity
in this panel that is not a claim about the world. A link's Length is the claim;
this is the picture." Alignment is the picture too.

##### The derivation is a pure function, because the panel is the one untested surface

`alignmentReading(lanes, style, align)` goes in `geometry.ts` beside
`alignmentShift`, returning `{ side: "left" | "right" | "on"; offset: number }`;
the Inspector renders it and decides nothing. This is not tidiness — **this repo
has no `Inspector.test.tsx` and that is a standing property, recorded in three
rules** (`rules/canvas-interaction.md`, `rules/signs.md`, `rules/road-markings.md`,
each naming the panel as a `bun run dev` check). A readout computed inline is
therefore a readout no test can read, and this phase's whole point is that the
mirror it states must not itself be mirrored. Extracting it is the corpus's own
precedent — `turnArrowKind` was lifted out of the panel for exactly this reason —
and it keeps all three rules true rather than falsifying them.

**This phase's output is a panel, so it owes the explicit argument `CLAUDE.md`
demands.** It produces no picture. It exists because the picture it prevents is
panel A — and the general rule it follows is the one the corpus already keeps
finding: a silent mirror is worth a control that states its direction. The
alternative that *would* produce a picture — drawing the overlap as an error state
on the canvas — is a validation layer this project does not have and should not
grow for one case.

### 2.12 What the canvas got wrong (added 2026-09-14, fourth reopening — Phases 10–12)

This section is the fourth reopening
(`/Users/ivapo/.claude/skills/spec-driven-dev/spec-authoring.md` §6.1). Like the third,
it starts from a picture rather than from the code: the repo owner reported that
waypoints and junctions "look very odd", suspected that alignment moves the node,
and asked for node dots to show only where something is being edited, as the
direction arrow now does (`specs/road_declutter_spec.md` §2.1). The cases were
rendered on 2026-09-14 through `Diagram` with an `interaction`, in headless
Chromium, together with prototypes of each fix below.

**What was not a defect comes first, so nobody re-opens it: alignment moves no
node.** `nodePos` stays where the human put it. §2.3 holds one *edge* of the lane
region on the polyline, so an aligned road's node sits on that road's edge rather
than its centre. The dot follows the drawn road end, not the node (§2.10), so it
steps across with the road. What reads as a moved node is that dot, plus the two
defects in §2.12.1.

#### 2.12.1 Where two roads meet, the later road's asphalt covers the earlier road's lines (Phase 10)

`Diagram.tsx:RoadShape` draws each link as one group, casing first and lines on
top, in `doc.links` order, and `.road-casing` has `stroke-linecap: round`. So at
every node where two links meet, the later link's round cap is drawn **over** the
earlier link's painted lines. That cap is a half-disc of radius `roadWidth / 2`.

- **At a straight, centred waypoint.** Measured on two 3-lane links: the casing is
  30 wide, so the cap's radius is 15. It covers the earlier road's edge lines (at
  ±13.5) for `√(15² − 13.5²)` ≈ 6.5 units before the node, and its dividers (at
  ±4.5) for ≈ 14.3. The result is a dark bead breaking every line on the road. It
  needs no alignment and no width change: it is present at every centred waypoint
  in every document.
- **At a junction the pad normally hides it, until an arm's origin moves.** A T
  whose through road is aligned `offside` puts the centred stem's origin on the
  through road's edge. The stem's round cap then stands clear of every road as a
  knob, radius 10.5 on a 2-lane stem.

**Three fixes were prototyped, and two of them fail:**
- **Butt caps on every casing, alone.** This cures the straight joint and the knob.
  But it opens a notch on the outside of any road that turns at a node, `(w/2)·tan(θ/2)`
  by §2.4's own formula: 4.0 units at 30° and 15 at 90° on a 3-lane road.
- **Every road's asphalt drawn before any road's lines.** This was the first draft's
  answer, and review round 1 rejected it on a built copy. Roads overlap away from
  nodes too, and there the later road's asphalt covering the earlier one's lines is
  the correct picture:
  - `examples/motorway-ramp.zkai`'s ramp crosses the mainline's shoulder on its way
    to the gore nose. Reordered, the mainline's hatch, shoulder line, divider and edge
    line all paint across the ramp.
  - At `examples/roundabout.zkai`'s corners, each arm's edge line runs across the
    neighbouring arm into the ring.

  A global paint order is the wrong tool for a defect that lives at a joint.
- **Butt caps on every casing, with the join filled from underneath, only at a
  joint.** This is the decision below. It cures the straight joint, both bends and
  the knob. It also leaves every overlap away from a joint exactly as it draws
  today, since no element changes its place in the document.

**Decision (recorded): a road's asphalt ends flat, and the round shape a joint needs
is drawn under every road, only where no glyph and no wedge already owns the joint.**
It takes three changes.

1. **Every casing is butt-capped.** `.road-casing--butt`, and the `butt` set that
   `Diagram.tsx:tapers` builds for it, both go. Nothing moves in the document: each
   road stays one group, drawn in `doc.links` order, as today.
2. **A joint disc, first in the drawing, where a joint has no owner.** A node
   qualifies when all three hold:
   - it is not a `junction`;
   - `tapers` drew no wedge at it;
   - its incident links reach **at least two distinct other nodes**.

   Such a node gets one filled asphalt circle per distinct arm origin (distinct under
   `geometry.ts:SAME_POINT`), with radius half that arm's width, or the widest arm's
   where origins coincide.
   - The discs are emitted **before the first road**, so no disc can cover any
     road's paint.
   - At a straight joint a disc lies wholly inside both casings and cannot be seen.
   - At a bend it fills exactly the outside corner that the round cap used to fill,
     and that the butt caps would otherwise leave as a notch.
3. **The canvas marks follow the new ends.** Both rules are chrome, in `styles.css`.
   - **`.road-hit` takes round caps.** It has none today, so at a bend the disc's
     outside corner lies beyond both links' butt hit strokes. Review round 1
     measured it on a built copy: `elementFromPoint` there returns the disc, which
     has no handler, so the press falls through to the background, clears the
     selection and pans. Today that corner is the later link's round casing cap,
     inside its own group, so the press selects that link. A round hit cap, radius
     `(w + 8) / 2`, covers the disc (radius `w / 2`) and gives that behaviour back.
   - **`.road-halo` takes butt caps**, so a selected road's halo ends flat with the
     road. Otherwise it would dome half a halo past a flat free end.
     `.marking-halo`'s comment names the rule "a halo matches the shape it
     highlights"; it stays true, and its "because the road does" is updated to say
     the road is flat.

**Distinct neighbours, not incident links, is what separates a joint from an end.** A
divided road's free end has two incident links, a reversed twin pair (road spec §2.4
pairs on exactly that), and both reach the same one node. So it gets no disc, and
ends flat on both carriageways. Phase 11 types a node with the same predicate, which
is why the phase builds it as a helper rather than inline.

**Consequences, named rather than discovered:**
- **Every free end is flat.** This was already true of every link touching a taper
  or a gore, because a cap is a whole-path property. §2.4 called the flat end "the
  better schematic reading anyway", and §2.11.1 supplies the reason: a fragment's
  roads run off the frame, and a dome, like a bead, says the road stops there. Now it
  is uniform.
- **The landing figures, exactly.** No node in the three examples qualifies for a
  disc (measured: every non-junction node reaches one distinct neighbour). So in
  their drawing markup the only change is `road-casing--butt` leaving
  `examples/motorway-ramp.zkai`'s three gore arms. What does change is the embedded
  stylesheet, which draws the arm ends of `examples/roundabout.zkai` and
  `examples/signalized-cross.zkai` flat. `motorway-ramp`'s ends were flat already.
- **A junction's arms end flat under the pad, ring or gore**, so the knob goes. The
  gore's arms were already butt-capped (Phase 8), so its rule is subsumed rather than
  removed.
- **A tapered joint gets no disc.** A disc of the wide road bulges outside the
  wedge's hypotenuse, by up to ~1.2 units on §1's 4→3 joint: the same bulge §2.4
  removed the cap for. The notch at a stepped joint bent by at most `TAPER_MAX_BEND`
  stays exactly as §2.4 sized it.
- **A divided road bent at a waypoint still shows a half-disc in its median**, since
  each carriageway's disc sits at its own arm origin rather than at the corner of its
  offset lines. That is today's round cap unchanged, and it is a non-goal here.
- **At a bend the later road's casing still covers a sliver of the earlier road's
  lines on the inside of the turn**, and the outside edge lines still stop short over
  the disc. Both are smaller than today, where a whole round cap overpainted them. A
  mitred join across two links would be its own reopening, and a non-goal here.
- **`export.tsx:strokeAllowance` stays as it is.** Its doc comment stops naming a
  round cap, but must not claim that nothing overhangs: a butt end on a road that is
  not axis-aligned still puts its corners up to `w / 2` sideways past the polyline
  end, which `getBBox` does not count (review round 1).

#### 2.12.2 A node that joins two roads is a waypoint (Phase 11)

`state.ts:addNode` creates every node as an `endpoint`, and nothing but the
Inspector's Kind row ever changes that. But `graph.rs` defines `NodeKind::Endpoint`
as "a dangling road end", and a node joining two roads is not one. A node left an
`endpoint` there is therefore a false statement in the saved document.

`NodeKind::Waypoint` is "a non-intersection point where the road continues but
changes (e.g. a lane count change)". A join where nothing changes is not exactly that
either. It is still the right kind, because it is the only non-junction kind that is
not a dangling end, and what a road does at a joint (a width step, an alignment
change) can change at any later edit without the kind needing to. On the canvas it also paints the endpoint's paper
bead in the middle of a road, which is part of what the report described.

**Decision (recorded): the reducer re-derives a node's kind at the nodes whose roads
an action changes, and only between those two kinds.** The rule:
- an `endpoint` whose incident links reach **at least two** distinct other nodes
  becomes a `waypoint`;
- a `waypoint` reaching **at most one** becomes an `endpoint`;
- a `junction` is never touched.

The sites are `state.ts:completeLink` (both of the new link's nodes) and the two
`state.ts:deleteSelection` arms that remove links: the link arm (both of that link's
nodes) and the node arm (the far node of every link it drops).

- **Both directions**, because a waypoint with one neighbour is an endpoint by the
  model's own definition. Deleting a road would otherwise leave behind the stale
  statement this phase exists to stop.
- **Never to `junction` at three neighbours.** Becoming a junction mints a `Junction`
  record and a glyph (`state.ts:setNodeKind`): a claim about control, and a pad in
  the figure. That stays the human's call.
- **Distinct neighbours**, for §2.12.1's reason: drawing a divided road's reversed
  twin at a free end makes the end of a divided road, not a joint.
- **A human's pick holds until the roads at that node change.** Set a two-neighbour
  node back to `endpoint` and it stays one until a link is added or removed there.
  Recorded, not a defect: the rule re-derives on an edit to the roads, never on
  every render.
- **Import and load are untouched.** A `network.yaml`'s kinds are Assimilator's
  statement and a `.zkai`'s are the human's. Neither passes through these actions.
- **No model change, no new action, no Rust, and the same undo step** as the edit
  that caused it.
- **The retyping helper returns its input's `nodes` array by reference when it
  changes no kind.** An action that did not already rebuild `doc.nodes` therefore
  still leaves it identical: `completeLink` between two fresh nodes does. The node
  arm of `deleteSelection` always rebuilds `doc.nodes`, since it removes a node.

**Which phase produces the picture:** none of a figure, since a figure carries no node
dots (§2.11.1). This phase's output is the canvas (a through node stops drawing a
paper bead on the road) and the saved file's own truth about its nodes. It is
argued for on both counts, and it was asked for on the canvas's.

#### 2.12.3 A node's dot shows while it is being edited (Phase 12)

**The constraint the request runs into:** §2.10.1 kept a dot on every road end
because the dot *is* the node's hit target, and road declutter §2.1 repeated that
argument. Not drawing it removes the drag, not a mark.

**Decision (recorded): the dot stays in the markup and stays the hit target, and only
its visibility changes.** `Diagram.tsx:NodeShape` renders every dot exactly as
today whenever there is an `interaction`, and adds an `is-shown` token to the node's
group when the dot should be visible. `styles.css` paints the dot of a group without
that token at `opacity: 0`, and `:hover` reveals it under the pointer.
- **Measured on 2026-09-14 in Playwright Chromium and WebKit** (WebKit being the
  engine behind the desktop app's WKWebView): an SVG circle at `opacity: 0` inside a
  group carrying `onpointerdown` still receives the press, is what `elementFromPoint`
  returns, and `:hover` turns its computed opacity to 1.

A node's dot is shown when any of these holds:
- **the node is selected**, or it is `linkFrom` (the link tool's first click). Its
  halo already highlights both.
- **the selected link starts or ends at it**, on the `link` arm of `Selection` only,
  as the direction arrow is (road declutter §2.1). A selected bend or marking shows
  none.
- **no link touches it.** Otherwise a node just placed is invisible, which is
  §2.10.3's broken node tool again.
- **the link tool is active.** A link is drawn by clicking nodes, and you connect
  what you can see. `Diagram.tsx:Interaction` gains a boolean for it, `revealNodes`, set by
  `Canvas.tsx:Canvas` from the tool, so `Diagram` learns a fact rather than the tool
  vocabulary.

Unchanged:
- **A junction** draws a glyph and no dot.
- **An export** passes no `interaction`, so it carries no dot, token or rule, and
  `is-shown` joins `export.test.ts`'s `CHROME`.

**Which phase produces the picture:** the canvas only, argued as §2.11.1 argued the
dot itself: it is where the human clicks, and a canvas with a bead on every road end
does not look like the figure it exports.

### 2.13 A lane change is stated at the joint, not on each road (added 2026-09-14, fifth reopening — Phases 13–14)

This section is the fifth reopening
(`/Users/ivapo/.claude/skills/spec-driven-dev/spec-authoring.md` §6.1). Like the two
before it, it starts from a picture. The repo owner drew a 1-lane road becoming a
2-lane road at a waypoint and set one link's alignment, because that is how §2.3 says
to show the new lane is on the left. The waypoint then drew as two nodes. Their point
was that a waypoint is meant to be one place where the road's geometry changes, which
is also what `graph.rs`'s `NodeKind::Waypoint` says.

The cases were rendered on 2026-09-14 in the demo, in WebKit, from hand-written
documents. Every alignment combination for the sequences below was also enumerated
against §2.3's shift. A prototype of the design below was then rendered through
`Diagram` in a throwaway worktree. The numbers are for default 9-unit lanes.

**What §2.3 cannot draw, measured:**
- **One aligned link is not enough.** With `L1` centred and `L2` aligned either way,
  the edge that should run straight steps by half a lane (4.5) at the waypoint. Only
  aligning *both* links to the same edge draws the change on one side. So the one
  fact "the lane is added on the left" has to be written twice, on two objects that
  are not the place it happens.
- **The waypoint splits.** `geometry.ts:nodeDots` draws one dot per distinct arm
  origin. Aligned links end at different points — a 1-lane road's lane-region centre
  is 4.5 off the line, a 2-lane road's 9 — so the one node draws two dots 4.5 apart.
  §2.10.2 foresaw this for a divided lane drop ("four dots") and accepted it. On an
  undivided road it reads as two nodes, and the report is the evidence that it does.
- **Some changes cannot be drawn on a straight road at all.** Alignment holds an edge
  for a link's whole length, so it commits the link at both of its ends. Enumerating
  all 27 combinations for a lane added on the left and then dropped on the right:
  - **1 → 2 → 1 has exactly one:** `offside`, `centre`, `nearside`. It draws
    correctly (rendered), but no one of those three values names the side at either
    joint, and both waypoints still split.
  - **2 → 3 → 2 and 3 → 4 → 3 have none.** Each road must sit half a lane (4.5)
    further over than the one before it. `alignmentShift` (in `geometry.ts`) offered a
    2-lane road only 0 or ±9 and a 3-lane road only 0 or ±13.5, and no triple of
    those lands all three. Rendered, the best tries draw a step or a jink.

  The only way out is to drag the last nodes off the line by a lane, which is off
  the grid.

**What was not a defect, so nobody re-opens it:** a divided road's lane change
already holds the median edge, because `geometry.ts:carriagewayOffset` steps each
carriageway out by half *its own* width plus half the median. That stays.

#### 2.13.1 The side belongs to the joint (decision, recorded)

**Decision (recorded): a node states which side the lanes change on, and no link
states an alignment.** `NodeView` gains `lane_change`, which is `nearside` or
`offside`, and absent means both sides, which is today's centred drawing.

- **It is a fact about one place.** §2.1 was right that nothing in the model says
  which side a lane goes, and right that it is presentation. It was wrong about which
  object carries it: two links that share an edge are two statements of one fact,
  and they can disagree.
- **Presentation, in `layout.rs`,** for §2.3's first reason unchanged: Assimilator's
  links carry real polylines, from which the side is a consequence.
- **On any node, a junction included.** §1's own lane drop happens *at a gore*, which
  is a junction. The gore node is where the side of that drop is said.
- **Additive: no `SCHEMA_VERSION` move** (§2.6's table). An older build ignores the
  key and draws the change on both sides.
- **The words are the travel frame's**, as the Lane kinds panel's `NEARSIDE` tag
  already uses them: under `DRIVE_SIDE = 1`, `offside` is left of travel.

#### 2.13.2 Which links continue each other (decision, recorded)

A side only means something between a road arriving at a node and the road it goes on
as. So the walk in §2.13.3, and the dots in §2.13.4, both need the **through pairs**
at each node: an arriving link, and the leaving link that continues it. A new pure
function in `geometry.ts`, `throughPairs(doc)`, returns them for the whole document as a
map from each arriving link id to the id of the link that continues it.

At node `N`, a **candidate** is a pair `(a, b)` where:
- `a` arrives at `N` and `b` leaves it, neither being a self-loop;
- `a.from_node !== b.to_node`. This excludes a reversed twin and any U-turn, and it is
  the test `Diagram.tsx:tapers` already applies.

Pairs are then taken in two passes:
1. **Unambiguous:** a candidate whose `a` and `b` belong to no other candidate at `N`
   is a pair, at any angle. A plain waypoint is this case, and so is each carriageway
   of a divided waypoint: its twin is excluded above, so it has one continuation.
2. **By straightness:** the rest are sorted and taken greedily. Each link is used once,
   and a candidate turning more than `TAPER_MAX_BEND` is never taken.
   - **The sort key, in order:** the turn, smallest first, compared as the dot product
     of the two unit travel directions, largest first; then the arriving link's id;
     then the leaving link's id. Ids compare as strings with `<`. The key never reads
     a position in `doc.links`, which is what makes the result order-free.
   - At a gore diverge this pairs the mainline with its continuation, not the ramp.
   - At a crossroads it pairs each straight-through.
   - Where one arriving link has two leaving candidates inside `TAPER_MAX_BEND`, the
     straighter wins. Where they turn by exactly the same angle, the smaller leaving id
     wins.
   - At a fan whose roads all turn by more than `TAPER_MAX_BEND`, it pairs nothing.

**Directions come from `document.ts:linkPolyline`**, never from the drawn polyline:
the drawn polyline depends on the shifts this feeds. A link's direction at `N` is its
nearest segment to `N` of non-zero length. A bend dragged onto its own node, reachable
since `zk-014` (§2.10.2), makes the adjacent segment zero-length, so it is skipped. A
link with no non-zero segment has no direction and is no candidate in the second pass.
The first pass reads no direction at all.

The result must not depend on `doc.links`' order, which is the property §2.10.2
pinned for the dots.

#### 2.13.3 Each road is walked from its upstream end (decision, recorded)

A road's lateral shift stops being a property of each link. It is derived by walking
each chain of through pairs from its head, carrying the edge the joint names.

In each link's own polyline frame, positive is nearside (§2.3). A link shifted by `d`
has its lane-region edges at `d + h` (nearside) and `d − h` (offside), where
`h = (roadWidth − ROAD_MARGIN) / 2`. Let `c` be the link's value in
`geometry.ts:carriageways` — 0 unless it is one carriageway of a divided road.

- **The head** — a link that no pair continues into — keeps `d = c`.
- **At a carriageway, the walk restarts.** Across a pair `(a, b)` where either link's
  `c` is non-zero, `d_b = c_b`, whatever `N` states.
- **Otherwise, across a pair `(a, b)` at `N`,** both `c`s are 0 and `d_b` follows from
  what `N` states:

| `N`'s `lane_change` | What carries through | `d_b` |
|---|---|---|
| absent | the road's centre | `d_a` |
| `nearside` | the offside edge | `d_a − h_a + h_b` |
| `offside` | the nearside edge | `d_a + h_a − h_b` |

**Signs, pinned on the report's own road**, eastbound so nearside is `+y`, with
default lanes:
- **1 → 2, `offside` at `N2`:** `d_2 = 0 + 4.5 − 9 = −4.5`. `L2`'s nearside edge is at
  `+4.5`, on `L1`'s, and the new lane opens at `−y`, above the road and left of travel.
- **1 → 2 → 1, `offside` at `N2`, `nearside` at `N3`:** `d_3 = −4.5 − 9 + 4.5 = −9`.
  `L3`'s lane region is `[−13.5, −4.5]`, one lane over from `L1`'s `[−4.5, 4.5]`,
  with its offside edge on `L2`'s. All four nodes stay on `y = 0`.
- **2 → 3 → 2, the same sides:** `d = 0, −4.5, −9`. This is the change §2.13 shows
  alignment cannot draw.

The prototype drew the first two exactly so. The third is the same table.

Five things this shape settles:
- **A document that states no side draws exactly as today, bit for bit.** Every
  undivided link is a head at `0` or reached by the absent row from one, so its `d` is
  exactly `0`. Every carriageway is a head at `c` or reached by the restart, so its `d`
  is exactly `c`. No arithmetic touches either value.
- **The upstream road stays put and the downstream road moves.** The head is the one
  place a road can be said to start, and it is local to direction: a side affects only
  what follows it. Centring the whole chain instead would move a road's start whenever
  a waypoint far downstream changed.
- **The walk crosses junctions**, through their through pairs. Stopping at a junction
  would put a jog in the road at the first junction after every lane change. And the
  gore of §1 is itself a junction, so stopping there would lose the headline case.
  **OQ-13**, resolved by the repo owner: carry through.
- **A divided road ignores `lane_change`, and the walk restarts at it.** "A
  carriageway" means exactly what `carriageways` draws as one: a non-zero `c`. A link
  with a reversed twin and a third link on the same node pair is drawn centred, and is
  treated as undivided here too.
  - **Why ignore the side:** median-side changes on a divided road were prototyped.
    Holding the kerb edge through a 2 → 3 lane change on each carriageway runs the
    two 3-lane carriageways 12 units into each other (`2 × 9 − SCHEMATIC_MEDIAN`). A
    divided road's only drawable change is at the kerb, which is what `carriageways`
    already draws. §2.8's divided non-goal stands.
  - **Why restart rather than carry:** an undivided road with a side stated upstream
    can continue into one carriageway of a divided road. Carrying its offset in would
    shift that carriageway and not its twin. The restart puts every carriageway where
    `carriageways` puts it.
- **A cycle still terminates.** A chain with no head is walked from its link with the
  smallest id, not the first in `doc.links`, so the drawing does not depend on the
  order links were drawn in. The joint that closes the cycle is not enforced, and draws
  a step if the sides around it disagree.

**Consequences, named rather than discovered:**
- **A road can end up beside its own nodes.** After a change on the left and a drop
  on the right, the last road sits half a lane clear of the line its nodes are on.
  Its dots, and so its hit targets, follow the road (§2.10), and a drag still moves the
  node and keeps its side, so nothing is lost. It does look different from a road
  centred on its nodes.
- **A drag must not drop the side.** `state.ts:moveNode` writes the node's view as
  `{ pos }` today, which would erase a `lane_change` stored beside it. It has to keep
  the rest of the view.
- **A single link can no longer be offset from its own line.** Nothing in the report
  needs it, and a road's position is its nodes' to give. An aligned lone road was only
  ever a sub-grid nudge.
- **Tapers need no change.** `geometry.ts:taperWedges` compares signed offsets, which
  is exactly what the walk produces. A stated side gives one wedge on that side, and
  an absent one gives a wedge on each.
- **Every consumer of the drawn polyline follows for free** — roads, arms, pads, gores,
  markings, bays and the canvas projections — *if* each is handed the walked record.
  That is Phase 14's one wiring obligation.

#### 2.13.4 A joint draws one dot per road through it (decision, recorded — Phase 13)

**Decision (recorded): `nodeDots` draws one dot per through pair, at the narrower
arm's origin, and one per remaining arm at its own origin, as today.**
- **Narrower, because its origin is on both roads.** Where an edge carries through, or
  where two roads share a centre, the narrower lane region lies inside the wider one.
  So the narrower road's centre is on asphalt on both sides of the joint.
- **Equal widths take the arriving arm's origin.** The rule reads only the pair, never
  which of its arms `junctionArms` lists first, so the dot cannot follow `doc.links`'
  order. Under §2.13.3 the two origins coincide anyway. Before it, alignment can put
  them apart: a 2-lane pair aligned `offside` then `nearside` has origins at `+9` and
  `−9`.
- **Emitted in `junctionArms` order.** A pair's dot takes the place of whichever of
  its two arms comes first there, and a remaining arm takes its own place.
- **The `SAME_POINT` merge applies to the whole result, as today.** Dots from two
  different pairs, or from a pair and a remaining arm, that land within `SAME_POINT`
  are one dot. So a centred crossroads drawn at a waypoint still draws one.
- **What it changes:** the 1 → 2 waypoint draws one dot, and a divided lane drop draws
  two where §2.10.2 drew four. A centred straight waypoint already drew one.

Phase 13 ships this ahead of Phase 14, while per-link alignment still exists. Until
Phase 14 ships, a pair whose two links are aligned differently does not satisfy the
containment above, and its dot can sit at the edge of the wider road. That lasts one
phase, and it is no worse than the two dots it replaces.

#### 2.13.5 Per-link alignment goes (decision, recorded — Phase 14)

Two mechanisms for one fact is what this reopening exists to end, so Phase 14 removes
per-link alignment in the same pass that adds the joint's side. Keeping both for a
phase would mean a transitional composition written only to be deleted.

What goes:
- `LinkView.align`, `LinkAlign` and `LinkAlign::is_centre` from both mirrors;
- `linkAlign` in `document.ts`, and `alignmentShift` and `alignmentReading` in `geometry.ts`;
- `setLinkAlign` in `state.ts`, the Inspector's Alignment row, and its Lane region readout.

That removes two shipped phases' observables, which is §6.1's step 1. **Phase 2 and
Phase 9 take `cut` and `by: zk-005` when Phase 14 ships**, with a `## 0.` closing note.

**This departs from the letter of step 1**, which says a removal is never a phase.
The removal rides inside the phase that replaces it, rather than standing as a phase of
its own. That is deliberate. The cut dates and the closing note still record what was
removed and why, which is what the rule protects, and a removal phase standing alone
would leave the drawing with no way to state a side for a phase.
- **Phase 9's readout is not kept against the walked shift.** It existed because a
  per-link control mirrored silently: each road was individually right while the pair
  drew a ramp through a motorway (§2.11.3). A readout of a number no control on that
  panel sets is `associated_link`'s lesson (signs spec).
- **What replaces both:** the side is set on the node, whose two roads are adjacent on
  the canvas, so a wrong pick shows as a lane opening on the wrong side, where the pick
  was made.

**An old file's `align` key is ignored, and the road draws centred.** Nothing derives
`deny_unknown_fields` (`persist.rs:migrate`'s own comment says so), which is the road
class's removal precedent: a view that carried only `align` saves as `L1: {}`. Whether
to fold aligned pairs into a node's side on load was **OQ-12**, resolved: no.

## 3. Open questions

- **OQ-1** — **Taper direction for a lane addition.** §2.4 opens the new lane
  *before* the node, because that keeps the wedge additive. Is that the right
  schematic reading, or should an addition open after the node and a drop close
  after it (which needs the wedge to subtract from an already-drawn stroke)?
  (design-call; proposed: keep the additive rule, since the alternative forces
  §2.4's rejected polygon rewrite.)
- **OQ-2 — RESOLVED (Phases 3 and 4): both proposals stand.** `TAPER_LENGTH = 24`
  and `GORE_LENGTH = 36`, each checked against a real drawing before pinning: a
  lane closing over two-and-a-half lane widths reads as a taper rather than a
  chamfer, and at a 35° ramp the gore's base comes out about 2.4 lane widths,
  which reads as an area rather than a wedge. The gore's length is additionally
  multiplied by the glyph's Size (Phase 4's shipped note), which is the only
  control a pad-less glyph has.
- **OQ-3 — RESOLVED (review round 1): yes, Phase 4 bumps `SCHEMA_VERSION` to 2.**
  A new `JunctionGlyph` variant makes a document unreadable by an older build,
  and the version probe cannot produce a useful message unless the version moves
  (§2.6). The cost is two constants that must change together
  (`src-tauri/src/model/mod.rs:31`, `src/model/types.ts:220`); the payoff is that
  `persist.rs:42` turns a raw serde failure into the sentence it was written for.
  No migration arm is needed — a v1 document is a valid v2 document. Landed in
  §2.6 and Phase 4's scope; **no longer blocks Phase 4**.
- **OQ-4 — RESOLVED 2026-08-11 by Phase 6, as §2.10 proposed: a dot per drawn road
  end.** ~~Node dots on a divided road.~~ The road spec's Phase 3 note
  recorded that an endpoint/waypoint dot sits *in the median* of a divided road
  rather than on either carriageway (`src/components/Diagram.tsx:NodeShape`,
  which draws at `nodePos`). Phase 1 gave arms an `origin`, which made "one dot
  per carriageway" cheap; the question left open was whether it is *right*, or
  whether a divided road's endpoint should show nothing at all. §2.10.1 takes the
  dot per carriageway, and the argument that settles it is not aesthetic: the dot
  is the node's only hit target, so "nothing at all" removes the drag rather than
  removing a mark. ~~Open until Phase 6 ships.~~ **Shipped, and the drawing
  confirms the reading §2.10.2 claimed: the four-dot row reads as one road end per
  carriageway.** What it also exposes is OQ-10's question in a sharper form — see
  there.
- **OQ-5 — RESOLVED 2026-08-14 by Phase 9, as §2.11.3 proposed: kept explicit, with
  the state made legible.** ~~Could alignment be derived instead of set?~~ The revisit
  condition this question set was *tedium*, and the printed figure produced a
  different and better reason to look again: the wrong pick draws **a ramp through
  a motorway** (§2.11's panel A) while every assertion passes, because each road is
  individually correct. Deriving it was weighed on that evidence and declined — for
  this question's own recorded cost, a side that flips when a node is dragged past
  the mainline. The Inspector states which side the lane region sits on instead.
  ~~Open until Phase 9 ships.~~ **Shipped, and the dev pass confirms the frame
  decision was the load-bearing one**: an eastbound and a westbound road both set
  `offside` both read `right of travel, 18 off the line`, with the asphalt below its
  polyline on the first and above it on the second. A screen-frame readout says the
  same word twice there and is wrong once. The original text follows.
  At a joint with a
  ramp leaving on one side, the side the lane is dropped on is arguably readable
  from the ramp's own direction. That would remove a control, at the cost of a
  heuristic the road spec's §2.4 was careful to reject for pairing, and of a
  taper that flips when a node is dragged past the mainline. (design-call;
  proposed: keep it explicit, and revisit if setting it twice per exit becomes
  tedious in practice.)

  > **CORRECTED 2026-09-14 — answered again, differently, by Phase 14 (§2.13).**
  > The side is still explicit and still not derived from a ramp's direction. It is
  > no longer set per link, though: it is stated once, on the node, and each road's
  > shift is walked from it. The readout this entry credits is removed (§2.13.5).
- **OQ-6** — **Where does the undivided-two-way centreline actually belong?**
  Road spec OQ-4 concluded "the fix is a model field" and recorded it *for this
  spec*. Re-reading it here suggests that conclusion was half right: a
  `Link.oneway` in `graph` would be a Zukai-native field in the layer that
  promises a 1:1 Assimilator mapping (`graph.rs:1-9`), and Assimilator has no
  such concept — its links are directional by construction. As a **presentation**
  field (`LinkView.centreline`, or a `LinkAlign`-adjacent hint) it costs nothing
  and breaks no promise. Which makes it a decorations-spec item, not a ramps one:
  a centreline is a painted line. (answerable-from-code — the analysis above is
  the answer; what is open is only which spec carries it. Does not block any
  phase here.)
  **RESOLVED 2026-07-25 by `specs/road_markings_spec.md` Phase 4 — and it needed
  neither field.** Not the `graph` one this OQ rejected, and not the `LinkView`
  one it proposed: an undivided two-way road is a `lane_line { style: double }`
  marking with `lane: None`, which the `Marking` anchor has expressed since the
  first commit. The last sentence above was the load-bearing one — a centreline
  *is* a painted line, so it is paint a human places rather than a property a
  road carries. Nothing infers it, which is what a field would have been for.
- **OQ-7 — RESOLVED 2026-08-10 by `specs/junction_glyphs_spec.md`, and not the
  way this question framed it.** The proposal below was taken (leave it; name the
  thing precisely), and it was handed on twice more — junction semantics OQ-5
  re-deferred it explicitly. The pass that finally took it did **not** give
  `t_junction` the branch this question imagined. It made **every** pad follow its
  arms, so a three-arm node draws as a T with nobody picking anything (Phase 1),
  and then **removed the variant** as a control that could no longer change a pixel
  (Phase 2). Worth reading as a case where three specs' worth of deferral was
  right: the branch was never the answer, and building it in Phase 4 here would
  have shipped work the correct fix deletes. The original text follows.
  Phase 4 took the proposal below: this spec's glyph work was the gore, and
  `t_junction` still falls through to the plain pad. Nothing in Phase 4 made it
  worse, and the branch it would need is the same one the gore now sits beside.
  **`t_junction` renders identically to `generic` today.**
  `JunctionGlyphShape` branches on `roundabout` (`Diagram.tsx:436-445`),
  `signalized_cross` (`:447`) and `priority_cross` (`:472`); every other glyph,
  `t_junction` included, falls through to the plain pad at `:444`. It is a pre-existing gap, adjacent to
  Phase 4's glyph work and not caused by it. Fold a T-junction rendering into
  Phase 4, or leave it for the junction-semantics spec? (design-call; proposed:
  leave it — this spec's glyph work is the gore, and scope discipline says name
  the thing precisely.)
- **OQ-8 — does the hatch survive under the chevrons at figure scale?**
  **RESOLVED (review round 1) — replace, decided now rather than in the dev
  pass.** The round observed that "settle it in the dev pass" understated the
  keep-branch: keeping the hatch would un-invert the `<pattern>` gate clause, keep
  `needsHatch` widened, and keep the pinned `url()` reference — several gate items,
  not the "one polygon" this OQ first claimed, and overturning a reviewed scope
  mid-implementation is a scope edit that clears `reviewed` anyway (§7). So the
  decision is taken here, on markings OQ-3's replace-don't-overpaint rule. The
  scale worry stays real and stays recorded: a whole-network figure prints a gore
  small, where a solid hatch reads as "not road" after individual chevrons have
  collapsed into noise. The Phase 5 dev pass still prints one gore at figure
  scale — as **confirmation**: if it reads badly there, that is a reopening with
  its own round, never a quiet mid-phase revert. (design-call, taken.)
- **OQ-9 — should a `gore` whose two arms disagree be drawn at all?** §2.9.1
  floors the mixed in/out case to the diverge orientation so the drawing stays
  deliberate. The alternative is to draw the triangle with **no** chevrons — still
  a gore, visibly declining to claim a direction — which is arguably the more
  honest schematic and is one branch either way. It matters more than it looks:
  an imported fragment can hold this case, and `endpoint` arms make it reachable
  without anyone drawing anything odd on purpose. (design-call; proposed: the
  floor, matching §2.5's "the closest pair still wins". Worth a round-0 challenge.)
- **OQ-10 — does a waypoint dot belong in an exported figure at all?** (added
  2026-08-11 with §2.10, and deliberately **not** folded into Phase 6.) A
  waypoint marks where two links meet in series without a junction. Before
  `zk-014` that was also the only way to bend a road, so the dot marked something
  a reader could see the point of; now a bend is a presentation vertex and a
  waypoint's remaining job is a *semantic* split — a lane count changing, an
  alignment changing — each of which the road already shows by getting wider or
  stepping over. So the dot may now be marking nothing the figure needs, and
  `.node-dot` is in `diagram.css`, which means it ships in every export. The
  alternative is to make a waypoint dot chrome, on the `interaction` gate that
  keeps handles out of exports by construction. Phase 6 moves the dot to the road
  without answering this, because moving it and deleting it are independent
  decisions and the first one is right either way. (design-call; proposed: leave
  it, and look at a real figure once Phase 6 has drawn one.)
  **RESOLVED 2026-08-11 by Phase 7, and answered wider than it asked: no node dot
  of any type reaches a figure**, because a dot is where the human clicks rather
  than something the road does. The printed figure is what settled it — a bead on a
  road that runs off the frame states that the road stops there, and there were
  four. ~~Open until Phase 7 ships.~~ **Shipped**, and the figure confirms it: the
  same exit exports with four fewer beads and nothing else moved. The sharpening
  that preceded it follows, and it is why the answer is not about waypoints.
  **Sharpened 2026-08-11 by Phase 6 shipping.** A waypoint's dot is
  `fill: var(--asphalt); stroke: none`, so now that it sits *on* the road it is
  invisible — the figure already does not carry it, and the median mark that made
  it look otherwise was the defect Phase 6 removed. So the question is no longer
  whether to delete a mark a reader can see; it is whether an invisible circle in
  `diagram.css` should be chrome in `styles.css` instead, which is a smaller change
  than this OQ was drafted against. An **endpoint** dot is a different question:
  it is paper-coloured with a dark stroke and reads clearly on the asphalt.
- **OQ-11 — should the node tool reveal every node too, as the link tool does?**
  (added 2026-09-14 with §2.12.3.) The node tool's press on an existing node selects
  and drags it rather than dropping a second node, so seeing every node while placing
  one would stop a node landing on top of another by accident. (design-call; blocks
  nothing — proposed: no. Hover reveals the node under the pointer, which is exactly
  the one a press would take, and placing a node is not connecting one. Revisit if
  stacked nodes turn up in practice.)
- **OQ-12 — RESOLVED 2026-09-14 by the repo owner: no migration arm.** An old file's
  `align` is ignored and the road draws centred, as proposed. ~~Should loading fold an
  old file's aligned links into a node's side?~~ The original text follows.
  (added 2026-09-14 with §2.13.5.) Where a node has exactly one through pair and both
  of its links carry the same non-centre `align`, the side is recoverable: both
  `nearside` means the offside changed, and both `offside` means the nearside did.
  That is an arm in `persist.rs:migrate`, which would have to find through pairs in
  Rust. Every other combination, a lone aligned link included, has no side to recover
  and draws centred either way. (design-call; blocks Phase 14's scope — proposed: no
  arm. No release has been cut (`git tag` is empty), and no example, `.zkai` fixture or
  golden carries `align` (measured). It appears only in test code: three `layout.rs`
  tests, `model/mod.rs`'s round-trip fixture and its road-class test, and the TypeScript
  test fixtures. The documents that hold one are the repo owner's own drafts, where
  re-stating a side at the waypoint is one click. `CLAUDE.md` rules out a field kept only to survive a round
  trip, and an arm kept only to carry an old one is that rule's neighbour.)
- **OQ-13 — RESOLVED 2026-09-14 by the repo owner: the walk carries through a
  junction**, as proposed. ~~Should the walk stop at a junction?~~ The original text
  follows. (added 2026-09-14 with §2.13.3.)
  §2.13.3 walks through a junction's through pairs, so a side stated upstream moves the
  straight road beyond the junction too. The alternative restarts every road at every
  junction, which draws each junction arm centred on its node, at the price of a jog at
  the first junction after any lane change. The gore would then need a special case,
  because §1's lane drop is stated there. (design-call; blocks Phase 14 — proposed:
  walk through, for the reasons in §2.13.3. Worth a round-0 challenge: at a signalised
  crossroads the far arm stepping half a lane over is the one place this reads as a
  decision rather than as the road.)

## 4. Implementation phases

Strictly sequential; each is one plan-mode pass with a concrete exit gate.

### Phase 1 — Arms carry their position (road spec OQ-6)

- **Scope:** `Arm` (`Diagram.tsx:192-195`) gains `origin: Vec2`, taken from the
  `n0` that `junctionArms` (`:203`) already computes at `:217` and discards — no
  second call to `carriageways`, no sign derivation (§2.2). `rayCircleExit` in
  `geometry.ts`. `JunctionGlyphShape` (`:392`) draws its interior from
  `arm.origin` rather than the node centre, remembering that the group is
  already translated to `center` (`:421`) so `origin` enters as
  `origin - centre`:
  - each stop bar (`:447` onward) starts from its own carriageway, at
    `(origin - centre) + dir * (rayCircleExit(origin - centre, dir, rp) + 4)`
    — which collapses to today's `dir * (rp + 4)` when `origin === centre`;
  - the pad radius (`:410`) and the roundabout ring (`:412`) each take the reach
    **floor** of §2.2 — `Math.max(<today's expression> * scale, reach)`, a floor
    and not a replacement, with `reach` unscaled.

  Frontend only; no model change, no CSS.
- **Exit gate:** `bun run build` + `bun run test` green. `geometry.test.ts`:
  `rayCircleExit` returns exactly `r` for a ray starting at the circle centre
  (the identity the no-change proof rests on), a finite `t` for an off-centre
  interior start, and `0` for a start already outside. `Diagram.test.tsx`: on an
  **undivided** signalized junction **at the default Size** every stop bar *and*
  the pad radius are exactly what they are today — pin the current `x1/y1/x2/y2`
  and `r`, which is the no-visual-change proof and the reason the reach is a
  floor rather than a new formula. (Written at the default Size deliberately:
  §2.2's clamp means a reduced Size *does* move an undivided pad, by design.)
  On a **divided** approach (`divided()`, `Diagram.test.tsx:365`)
  each stop bar sits on its own carriageway rather than on the centreline,
  asserted by comparing the bar's midpoint to the drawn casing's `y`; and the pad
  of a junction with a divided approach reaches at least to that carriageway's
  outer edge. Plus a `bun run dev` check on a signalized junction with one
  divided approach, **at the default Size and at a reduced one** — the scaling
  asymmetry is the whole point of the floor.
- **Docs touched:** `rules/road-rendering.md`'s "Accepted limitation (spec OQ-6)"
  paragraph is now half wrong — the interiors follow, the node dots (OQ-4) still
  do not. Update it in the same pass.

### Phase 2 — Link alignment  (depends on Phase 1)

- **Scope:** `LinkAlign` and `alignmentShift(lanes, style, align)` in
  `geometry.ts` per §2.3 — `0` for `centre`, `+(roadWidth − ROAD_MARGIN)/2` for
  `offside`, the negation for `nearside`; the lane region's half-span, **not**
  `roadWidth / 2`. `align?: LinkAlign` on `LinkView` in **both**
  `src/model/types.ts:179` and `src-tauri/src/model/layout.rs:65`
  (`#[serde(default, skip_serializing_if = "LinkAlign::is_centre")]` plus the
  `is_centre` helper — `bends`' `Vec::is_empty` trick does not apply to a plain
  enum, §2.3 — so an unaligned document's YAML is byte-unchanged).
  `drawnPolyline` (`Diagram.tsx:180`) composes it with the carriageway offset by
  addition, the one site (§2.3). A `setLinkAlign` action, `editReducer` case and
  helper in `src/editor/state.ts`, mirroring `setLinkStyle` (`:97`, `:326`,
  `:542`), and an Inspector control beside Road class (`Inspector.tsx:137`). No
  `SCHEMA_VERSION` bump (§2.3).
- **Exit gate:** `bun run build` + `bun run test` green, **plus `cargo test`,
  `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`** (this is
  the first phase to touch Rust). A `geometry.test.ts` case that
  `alignmentShift` is `0` for `centre` and `±(roadWidth − ROAD_MARGIN)/2`
  otherwise, and that the two non-centre values are exact negations. A
  `Diagram.test.tsx` **sign** assertion, stated in the direction §2.3 derives —
  a 4-lane link drawn due east and aligned `offside` puts its offside edge on
  `y = 0` and its whole lane region at **positive** `y`, with `nearside` the
  mirror — since a magnitude test passes under an inversion, which is the trap
  the road spec hit repeatedly. A case that alignment and a carriageway offset
  **compose** rather than one winning. A `state.test.ts` case that `setLinkAlign`
  is undoable like any other document edit. A Rust round-trip test that a
  `LinkView` with `align` survives save/load, that a file without the field loads
  as `centre`, and that a `centre` link serializes with no `align` key at all.
- **Docs touched:** `rules/document-model.md` (a new mirrored field),
  `rules/road-rendering.md` (`drawnPolyline` now carries two lateral terms),
  `rules/history.md` if the new action needs naming there.

### Phase 3 — Tapers  (depends on Phase 2)

- **Scope:** `taperWedge(outerEdge, insetEdge, insetDir, length)` in
  `geometry.ts` returning the three corners per §2.4, plus `TAPER_LENGTH` and
  `TAPER_MAX_BEND`. `Diagram.tsx` finds through joints — nodes with exactly two
  incident links, one ending and one starting, **excluding a reversed-twin
  pair**, and **collinear within `TAPER_MAX_BEND`** (§2.4) — and then, **per side
  independently**, compares the two links' **signed lateral offsets**
  (`d ± roadWidth/2` in the shared frame, *not* world points, §2.4); where they
  differ it emits `<polygon class="road-taper">` running along the **inset**
  link, plus a solid edge line inset `1.5` from the hypotenuse. Both links at a
  joint that draws a wedge get a butt-cap modifier class on their casing (§2.4).
  Paint in `diagram.css`. `strokeAllowance` (`export.tsx:69`) is expected to need
  **no** change (§2.7) — confirm rather than pre-emptively widen.
- **Exit gate:** `bun run build` + `bun run test` green, with `geometry.test.ts`
  cases pinning the wedge's **three** corners for a 4→3 lane drop aligned
  `offside` (closing over `TAPER_LENGTH` **past** the node) and for the 3→4
  addition (opening **before** it, OQ-1's recorded direction); equal casing-edge
  **offsets** on a side produce **no** wedge there even when the lane counts
  differ (two classes can agree on width); a `centre`-aligned joint produces two mirrored
  wedges; and the corners sit on the casing edge, not the lane-region edge (the
  1.5-unit trap). `Diagram.test.tsx`: a three-link node produces no wedge at all
  (§2.4's explicit non-guess); **the two carriageways of `divided()` with
  unequal lane counts produce no wedge** (the anti-parallel trap, §2.4); **a
  right-angled two-link joint of *equal* width produces no wedge and no butt cap**
  — the `N1(0,0) → N2(120,0) → N3(120,120)` corner of §2.4, which a collinear
  fixture cannot catch and which the signed-offset comparison plus
  `TAPER_MAX_BEND` exist to exclude; a
  tapered joint's two links carry the butt-cap class and an untapered document's
  links do not; and a default two-link document with equal lane counts emits
  markup **unchanged** from today. An `export.test.ts` case that a tapered
  document's frame covers the wedge — with `strokeAllowance` untouched. Plus a
  `bun run dev` pass on §1's L1/L2 joint, checking specifically that no asphalt
  shows outside the new taper line at the node.
- **Docs touched:** `rules/road-rendering.md` gains the taper rule; the
  `strokeAllowance` note in `rules/diagram-export.md` gains the wedge.
- **Shipped 2026-07-25.** As specified, with three notes for Phase 4:
  - **`TAPER_LENGTH = 24` is pinned** (OQ-2's proposal, checked against the
    drawing: a lane closing over two-and-a-half lane widths reads as a taper).
    `GORE_LENGTH` is still open.
  - **The equality test is a tolerance, not `===`** — `SAME_EDGE = 1e-6`. The
    pairs that should agree do agree *exactly* today (measured across every class
    and lane count: two `offside`-aligned roads, and a 5-lane ramp against a
    4-lane arterial, which both draw 39). The tolerance is there because nothing
    guarantees that of arbitrary lane widths, and because the alternative to a
    missed wedge is a zero-area polygon plus two butt caps for a step no one can
    see.
  - **The inset link keeps its own edge line under the wedge**, so a lane drop
    draws as a closing wedge bounded by the taper line above and that edge line
    below. That is the additive rule working as specified and it reads correctly;
    it is noted only because it is the one place the picture carries a line the
    §2.4 sketch does not show.

### Phase 4 — Gores  (depends on Phase 3)

- **Scope:** `rayIntersection` and `gore(...)` in `geometry.ts` per §2.5, and
  `GORE_LENGTH`. The arm pair is chosen by **smallest angle between directions**,
  ties broken on link id (§2.5) — not by direction of travel, which `Arm` does
  not carry. A `gore` variant on `JunctionGlyph` in **both**
  `src/model/types.ts:166` and `src-tauri/src/model/layout.rs`, added to the
  Inspector's `GLYPHS` list (`Inspector.tsx:31-37`, rendered by the `<Field>` at
  `:222`). `JunctionGlyphShape` draws no pad for it — a hatched triangle and two
  solid edge lines instead. **Widen `hasShoulder(doc)` to also fire for a gore
  glyph**, or the pattern the gore references is never emitted (§2.5). Bump
  `SCHEMA_VERSION` to 2 in `src-tauri/src/model/mod.rs:31` **and**
  `src/model/types.ts:220` together (OQ-3, resolved) — and with it the fixture in
  `persist.rs`'s `rejects_a_newer_schema_version` (`:120-137`), which writes
  `schema_version: 2` and must become `3`. Left alone it stops testing anything:
  the probe would pass and the parse succeed, since every other `Document` field
  is `#[serde(default)]` (`mod.rs:42-60`), so `expect_err` fails.
- **Exit gate:** `bun run build` + `bun run test` green, plus `cargo test` /
  `fmt` / `clippy`. `geometry.test.ts`: the nose of two symmetric diverging rays
  lands on the axis of symmetry; two **parallel** arms fall back to the node
  rather than producing `Infinity`/`NaN` (the degenerate case §2.5 names); arms
  that meet only *behind* their origins likewise; and the closest-pair rule picks
  the ramp-plus-downstream-mainline pair at a diverge **and** the
  ramp-plus-upstream-mainline pair at a merge, from the same three-arm geometry.
  `Diagram.test.tsx`: a gore node emits no `jn-pad`; a gore on a two-arm node
  still draws and on a one-arm node draws nothing (§2.5's stated bounds); a
  document with a gore **and no shoulder lane** emits the `<pattern>` (the §2.5
  trap — it renders as an unpainted triangle, which no markup assertion catches
  unless written for it); the empty-document markup is still exactly
  `<g class="diagram"></g>`. `export.test.ts`: a gore document's only `url()` is
  still the in-document `url(#road-hatch)` and the embedded stylesheet still has
  no `url(`/`<`/`&`. A Rust test that a v1 file still loads under
  `SCHEMA_VERSION = 2` and that a saved document declares `schema_version: 2`.
  Plus a `bun run dev` pass drawing §1's exit in full, and an export of it.
- **Docs touched:** `rules/road-rendering.md` (the gore, and the widened
  `<defs>` condition — which `rules/diagram-export.md` also references); add this
  spec to `CLAUDE.md`'s spec list; update the project-memory roadmap.
- **Shipped 2026-07-25.** As specified. `GORE_LENGTH = 36` is pinned (OQ-2's
  proposal, checked against the drawing at a 35° ramp: the base comes out about
  2.4 lane widths, which reads as an area). Three decisions the spec did not
  force, recorded because each is visible in the picture:
  - **Two polygons, not one.** §2.5 says "filled with the shoulder hatch", but
    the pattern is transparent by design — a shoulder band takes its asphalt from
    the casing underneath it, and a gore has no casing under its *base*, where
    the two roads have long since separated. So `.jn-gore` paints the surface and
    `.jn-gore-hatch` overlays it; a hatch-only polygon would float on bare paper.
  - **The edge lines take no inset**, unlike `taperEdge`'s 1.5. The gore is
    bounded by the lane region, and `(roadWidth − ROAD_MARGIN)/2` is *exactly*
    `RoadShape`'s `edgeInset` — the same number — so the legs are literal
    continuations of the two roads' own edge lines. Insetting them would jog
    visibly at the nose. (The consequence is that the legs paint over lines that
    are already there, which is the correct picture and not a redundancy to
    remove: a gore whose arm is shorter than `GORE_LENGTH` still needs them.)
  - **`GORE_LENGTH` scales with the glyph's Size**, unlike `TAPER_LENGTH`, which
    belongs to no glyph. A pad-less gore would otherwise leave the Inspector's
    Size control inert, and lengthening cannot misalign anything: the legs stay
    on the roads' edge lines and only the base slides, so the nose does not move.

  Also worth naming for whoever reads §1 next: **a gore node draws no taper**,
  because three incident links is not a through joint (§2.4). That is right, not
  a gap — §1's dropped lane leaves *as* the ramp, and the gore is what closes the
  picture. `Arm` gained an `id` for `gorePair`'s tie-break, and `hasShoulder`
  became `needsHatch`.

### Phase 5 — The gore says which way to go round it  (added 2026-08-10)

Added by reopening (`/Users/ivapo/.claude/skills/spec-driven-dev/spec-authoring.md`
§6.1). Phases 1–4 are untouched and this depends on Phase 4. It passed its own
scoped review round (§7's phase-level gate) in two rounds on 2026-08-10 and **is
cleared to implement**.

- **Scope:** §2.9 — the gore paints chevrons that say which way traffic goes round
  it. **TypeScript only** — no model change, no Rust, no `SCHEMA_VERSION` move, no
  new action, no new control, and `GORE_LENGTH` does not move.
  - `geometry.ts` — `goreChevrons(nose, fa, fb, toward)` returning one polyline
    per chevron, laid out along the triangle's axis of symmetry. The count comes
    from the axis length and the pitch follows (§2.9.3), as `spanCells` does for
    the tiled marking kinds, so the fan tiles the axis exactly and containment is
    constructional rather than clamped. Its build constants — pitch, the chevron's
    included angle, its stroke — sit beside `GORE_LENGTH` and are settled in the
    app.
  - `geometry.ts` — `goreFlow(...)` (naming to be settled in implementation), the
    one derivation of §2.9.1: given the chosen pair, each arm carrying its own
    in/out bit, both outbound is a diverge, both inbound a merge, anything else
    the diverge floor. It takes
    the `from_node`/`to_node` the model already carries and adds no field. **Pure,
    so `geometry.test.ts` can put both cases and the mixed one through it.**
    The plumbing, named because `GoreShape`'s current props cannot compute it:
    `geometry.ts:junctionArms` already evaluates `link.from_node === nodeId` per
    arm (its `touchesStart`) and throws it away — it carries that bit onto the
    derived `Arm`/`GoreArm` structs, which are render-side and not the model, the
    same road `origin` travelled in Phase 1. "No new field" scopes to the model.
  - `Diagram.tsx` — `GoreShape` swaps its `.jn-gore-hatch` polygon for a
    `.jn-gore-chevrons` path, keeping `.jn-gore` (the surface) and the edge-line
    path exactly as they are: §2.5's two-layer reasoning still holds, since a
    chevron on bare paper needs the surface under it just as the hatch did.
    `needsHatch` narrows back to a shoulder test (§2.9.2).
  - `diagram.css` — the chevron paint, **no `vector-effect`**, so canvas and
    export paint identically.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green, with
  `cargo test` **unchanged** — no Rust is touched, so a moved count means
  something escaped the scope.
  - `geometry.test.ts`, and this is the phase: **the chevrons of a diverge point
    at the nose and those of a merge point at the base**, off the same three-arm
    geometry Phase 4's closest-pair test already uses, so one fixture pins both.
    That is the §2.9.1 trap, and it is the assertion a single fixed orientation
    passes half of. The mixed in/out case takes the diverge floor (or OQ-9's other
    answer, if review takes it) rather than throwing.
  - **Every chevron is inside the triangle**, at every gore angle and every
    `scale` — the containment rule §2.9.3 makes constructional, asserted the way
    markings assert it for the tiled kinds. A chevron outside an edge line is the
    failure this rules out.
  - **The count is derived, not fixed**: a longer gore carries more chevrons at
    the same pitch, which is what distinguishes the §2.9.3 rule from a magic
    number and what a hard-coded three would pass without.
  - **Phase 4's hatch assertions change, and are named rather than discovered**
    (§2.9.2): the `<pattern>`-with-a-gore-and-no-shoulder test inverts. Of the two
    `.jn-gore-hatch` assertions in `Diagram.test.tsx`, only the first renames to
    `.jn-gore-chevrons`; the second asserts the hatch polygon carries the *same
    points* as the surface polygon, which has no chevron analog — it is
    **rewritten**, to "the surface polygon still sits under the paint". What must
    hold unedited: `.jn-gore`'s surface corners (which is what Phase 4 actually
    pinned, via `corners()`) and the `road-edge jn-gore-edge` path — the chevrons
    are paint *inside* a triangle neither of those may move.
  - `export.test.ts`: the gore-without-shoulder export **stops emitting the
    pattern entirely** — the pinned `url()` list loses its one entry *and* the
    `<pattern id="road-hatch"` presence assertion inverts, so the test's
    "references the hatch and nothing else" framing is rewritten, not adjusted.
    The same expected-change check Phase 4 ran in the other direction.
  - A `bun run dev` pass: build a diverge and a merge from the same three links
    and confirm the chevrons reverse between them; then print one gore at **figure
    scale**, confirming OQ-8's taken decision still reads — a bad read there is a
    reopening with its own round (OQ-8), not a mid-phase revert.
- **Docs touched:** `rules/road-joints.md`, which documents the gore as a hatched
  triangle; **`rules/diagram-export.md`**, whose "a gore reaches the same pattern,
  so the `<defs>` gate is `needsHatch(doc)`, not `hasShoulder(doc)`" this phase
  falsifies clause by clause; **`rules/road-rendering.md`**, whose "anything new
  referencing the pattern must widen that predicate, as a gore already did" loses
  its example; this spec's §2.5 and §2.8 already carry their dated `CORRECTED`
  notes (2026-08-10, written when the phase was drafted, since the ownership claim
  was already false before this phase existed); `road_markings_spec.md` **OQ-4**,
  which asked where the chevrons go and is answered by this phase landing; and the
  project-memory roadmap. **Not** touched: `rules/marking-kinds.md`, since a
  chevron is deliberately not a `Marking`.
- **Shipped 2026-08-10.** As specified: TypeScript only, 405 vitest (up 9) and
  `cargo test` unchanged at 68. `needsHatch` narrowed **and** took its old name
  `hasShoulder` back (§2.9.2's "arguably", taken — the body is a shoulder test
  again and the name should say so). OQ-9 taken as proposed: a mixed in/out pair
  draws the diverge floor. Five things the spec did not force, each visible in the
  picture or reached only through it:
  - **§2.9.3's "included angle" shipped as a *fraction*, `GORE_CHEVRON_LEAN`, not
    an angle** — and this is the phase's one real design change. A wing has to
    stay visibly clear of the edge it lands on, and the edge's own angle is
    whatever splay the two roads leave, so an absolute angle fails in **both**
    directions: too shallow for a narrow gore and the wings merge into the edge
    lines (measured in the app at 60°: three variants drew as no chevrons at all),
    and *any* fixed angle is eventually shallower than the edge of a wide one,
    which puts the tip past its own wings and **turns the chevron round**. That
    second failure is §2.9.1's silent mirror arriving by the back door, so the
    direction assertion was widened from one splay to five to pin it.
  - **A cell with no room for a tip draws nothing**, so a cell and a chevron are
    not the same thing. Clamping the tip to the corner instead — the obvious
    reading, and what shipped first — folds both wings *onto* the two edge lines,
    which draws the gore's outline a second time. It passes every containment
    assertion and looks like a doubled edge.
  - **A third degenerate gore exists and only the drawing finds it.** §2.5 names
    the two `gore` handles by falling back to the node; a *parallel* pair leaves a
    triangle with an axis but **no width**, so every chevron collapses to a single
    point — and `stroke-linecap: round` paints a point as a **dot**. The dev pass
    hit it on a document with a stray duplicate link, not the maths.
  - **`diagram.css` may not spell the property that holds a stroke at constant
    screen width**, comments included — the signs spec's lesson about
    `font-family`, rediscovered by seven export assertions failing at once on a
    comment saying the chevrons deliberately carry no such thing.
  - **OQ-8 confirmed, not reopened.** One gore printed at figure scale still reads
    as an area with a direction rather than as noise; the chevrons blur toward a
    texture that still leans the right way.

  The pitch is `LANE_PX` and the lean `0.65`, both settled in the app as every
  constant in this corpus has been. Four mutations were run rather than trusting a
  green first pass — a fixed orientation, an absolute lean, a clamped cell and a
  hard-coded count — and each failed exactly one test, a different one.

### Phase 6 — The node dot sits on the road  (added 2026-08-11)

Added by the second reopening
(`/Users/ivapo/.claude/skills/spec-driven-dev/spec-authoring.md` §6.1). Phases
1–5 are untouched. It depends on Phase 1, which built the `Arm.origin` it reads,
and on Phase 2, whose `LinkAlign` is half of what it fixes (§2.10). It passed its
own scoped review (§7's phase-level gate) in three rounds on 2026-08-11 and **is
cleared to implement**.

*Produces the observable: **yes**, and it is the only thing the phase does — a
mark moves in every figure where a divided or aligned road meets a node that is
not a junction.*

- **Scope:** §2.10 — a node's dot is drawn on each of its carriageways instead of
  once on the centreline between them. **TypeScript only** — no model change, no
  Rust, no `SCHEMA_VERSION` move, no new action, no new control, no new build
  constant, and `nodePos` does not move (§2.10.1).
  - `geometry.ts` — `nodeDots(doc, nodeId, offsets): Vec2[]`, the phase's one new
    function and pure, so `geometry.test.ts` can put every row of §2.10.2's table
    through it. It returns the arms' **distinct origins** — distinct as positions,
    within a `1e-6` float-slack epsilon that is a guard and not a design
    parameter, carried as its **own** named constant rather than borrowing
    `SAME_EDGE`'s (§2.10.2) — in `junctionArms`' order, with no angle, mean or
    grouping anywhere in it. It **falls back to a single dot at `nodePos` when the
    node has no arms**
    (§2.10.3), and returns `[]` when the node has no layout entry at all — which
    is the hand-edited case the node layer already guards with `if (!p) return
    null`.
  - `geometry.ts` — two doc comments this phase falsifies: `junctionArms` loses
    its "the node *dots* still draw at the node position … (ramps spec OQ-4,
    open)" paragraph and gains the note that it reads every node type rather than
    only a junction (§2.10.4); and `Arm.origin`'s "the node position for an
    undivided road", which **Phase 2 already falsified** via `alignmentShift` and
    which §2.10 depends on being read correctly.
  - `Diagram.tsx` — `NodeShape` takes the dot positions rather than one `pos`,
    and maps its `<circle>` (and the halo's) over them inside the **same** group,
    which is what leaves `onNodePointerDown` and the drag untouched. The group's
    `transform` stays on `nodePos` and a zero displacement emits **no** `cx`/`cy`
    (§2.10.4) — the mechanism the identity assertion below turns on. The junction
    branch of the node layer is not touched at all: a junction draws a glyph, and
    §2.10 is about the two types that draw a dot.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green, with
  `cargo test` **unchanged at 69** — no Rust is touched, so a moved count means
  something escaped the scope. Report the vitest count against the 473 that
  `zk-014` Phase 3 left.
  - `geometry.test.ts`, one assertion per row of §2.10.2's table: a **centre
    endpoint** and a **centre waypoint** each return exactly one dot, at the node;
    a **divided endpoint** returns two, each equal to its own carriageway's end as
    `drawnPolyline` reports it — read from the drawn polyline, never re-derived
    from `carriagewayOffset`, or the test asserts the implementation against a
    copy of itself; a **straight divided waypoint** returns two.
  - **The lane-drop divided waypoint returns four**, at the measured `±22.5` and
    `±18` — §2.10.2's deliberate row, and the test that pins the epsilon as float
    slack rather than a design tolerance. Any implementation that merges those two
    into one dot has taken a decision this phase rejects, and this row is the only
    one that can see it.
  - **A divided road split unevenly at a waypoint still returns two**, the only
    assertion the epsilon itself answers to — and **the fixture has to be measured
    rather than picked**, because most splits are bitwise equal and pass under
    exact equality (314 of 400 scanned). The recipe that parts: `N1 (0, 0)` to
    `N3 (97, 233)` with the waypoint at `f = 0.95`, measured at `2.84e-14`. The
    property to check before trusting any substitute is that an **exact-equality
    dedupe returns three** there; a third of a 45° diagonal, the obvious choice,
    measures exactly `0` and tests nothing.
  - **A three-arm fan returns the same three dots for every permutation of
    `doc.links`**, which is the assertion round 2 was owed: three
    `offside`-aligned links off one endpoint node at unequal angles, run through
    all six orders. **Compare as a set** — sorted, or by membership — because the
    scope returns them in `junctionArms`' order, so permuting the links legitimately
    permutes the array and a `toEqual` on it fails a correct implementation. A
    clustering implementation gives 2, 1, 2, 2, 1, 2 dots — measured — so this is
    the one assertion separating "a set of positions" from every rule that groups.
  - **A node with a link but no layout entry returns `[]`**, and **the aligned
    undivided endpoint returns one dot off the node** — the jink's own half of
    §2.10's two-source claim, asserted in its own right rather than only as the
    exclusion that scopes the identity test.
  - **A link-less node returns exactly one dot, at the node** (§2.10.3) — the
    path every node takes between being placed and being connected.
  - **A centre-aligned undivided document's markup is unchanged, character for
    character.** `Diagram.test.tsx` and `export.test.ts` assert only that
    `node-dot` is *present*; what this phase adds is the identity, because
    §2.10.2's collapse is worth nothing unless it is exact. Scoped to
    centre-aligned deliberately: an aligned link's dot **moves**, which §2.10 says
    is the same defect and not a side effect, and is asserted as a change rather
    than smuggled under an identity claim that would be false.
  - **A divided endpoint emits two `.node-dot` circles inside one `<g>`**, which
    is the picture, and the one group is what keeps the gesture.
  - Three mutations, one per rule, since each has a plausible absent form the
    other assertions tolerate: **widen the epsilon to a design-sized tolerance**
    (`LANE_PX / 2`) and confirm the lane-drop row fails alone; **drop the dedupe
    entirely** (one dot per arm) and confirm the two centre rows and the identity
    assertion fail; **drop the link-less fallback** and confirm only the link-less
    test fails.
  - A `bun run dev` pass, on the two things no assertion above can see: place a
    node with the node tool on an empty canvas and confirm it is **visible and
    draggable before any road exists** (§2.10.3's default path), then drag a
    divided road's endpoint **by each of its two dots** and confirm both grab the
    same node and the road follows. Then look at §2.10.2's deliberate four-dot
    row — a divided waypoint with a lane drop, where two dots overlap `4.5` apart
    on each side — and confirm it reads as one road end rather than as two, which
    is the claim that section makes and the only part of the rule settled by
    looking. If it reads badly, that is a reopening with its own round and not a
    mid-phase revert.
- **Docs touched:** `rules/road-joints.md`, whose "**Still open (ramps OQ-4)**"
  paragraph this phase answers outright; **`rules/canvas-interaction.md`**, since
  the node's hit target is now several circles rather than one and that file owns
  what the pointer picks up — it sits at **exactly** its `max_lines: 190`, so the
  edit trades prose rather than adding, on `zk-014` Phase 3's precedent; this
  spec's **OQ-4**, which becomes resolved when the phase ships; and the
  project-memory roadmap, whose "what remains" list carries the median dot as its
  first entry. **Not** touched: `rules/road-rendering.md` (the carriageway offsets
  and the alignment shift it documents are read, not changed) and
  `rules/diagram-export.md` (no new class, no new `<defs>`, no gate —
  `measureDiagram` frames from `getBBox()` over the whole group, so a moved dot is
  measured with no change).
- **Shipped 2026-08-11.** As specified: TypeScript only, 484 vitest (up 11 from
  `zk-014` Phase 3's 473) and `cargo test` unchanged at 69. `nodeDots` and
  `SAME_POINT` in `geometry.ts`; `NodeShape` maps its circles over the dots inside
  the one group it already had. §2.10.2's four-dot row was confirmed in the app at
  the measured `±22.5`/`±18`. Four things the spec did not force, each found by
  building or by looking:
  - **The gate's own epsilon mutation is a no-op at the value it names.**
    `LANE_PX / 2` is `4.5` and the lane-drop gap **is** `4.5`, so a strict `<`
    leaves the row passing and the mutation survives — measured, 484 green. Run at
    `LANE_PX` it fails the lane-drop row *and* the permutation row, which is the
    intended demonstration. Worth carrying: a mutation sized from the same quantity
    as the fixture can land exactly on the comparison's boundary and report
    "covered" for a rule nothing tested.
  - **The identity assertion has to be written against a *waypoint*, not an
    endpoint.** An endpoint has one arm, so it emits one circle however the dots
    are collapsed; the dedupe-dropping mutation left the first draft of that test
    green. §2.10.2's row 2 is the ordinary undivided **waypoint**, and it is the
    only markup row where per-arm and per-place differ. Fixed before committing,
    and the mutation then failed it as the gate predicted.
  - **§2.10.2's own uneven-split recipe does not part.** `N3 (97, 233)` at
    `f = 0.95` comes out **bitwise equal** on both sides here (exact dedupe: 2), so
    it would have tested nothing. A scan of 240 candidates found 34 that do; the
    fixture shipped is `N3 (137, 233)` at `f = 0.85`, parting by `2.842e-14` — the
    magnitude review measured — with the exact-equality count asserted **in the
    test**, so the fixture cannot quietly stop exercising the tolerance.
  - **A waypoint's dot is asphalt-on-asphalt, so moving it onto the road makes it
    invisible** — `.node-waypoint .node-dot` is `fill: var(--asphalt); stroke:
    none`. This is the fix working rather than a regression: an undivided
    waypoint's dot has always been invisible for exactly this reason, and it was
    *visible* on a divided road only by sitting on paper in the median, which is
    the defect. It still takes pointer events, so the drag is unaffected. It also
    makes **OQ-10** sharper than when it was written: for a waypoint the question
    is no longer "should the figure carry this dot" but "the figure already does
    not, so should the model of it say so".

### Phase 7 — A figure carries no node dots  (added 2026-08-11)

Added by the third reopening, from a printed figure rather than from a reading
(§2.11). Phases 1–6 are untouched. It depends on Phase 6, whose dots it relocates
rather than removes. It passed its own scoped review (§7's phase-level gate) in
three rounds on 2026-08-11 and **is cleared to implement**.

*Produces the observable: **yes**. Four beads leave the printed figure, and every
figure with a road that runs off the frame is affected.*

- **Scope:** §2.11.1 — the node dot becomes chrome. **TypeScript and CSS only** —
  no model change, no Rust, no `SCHEMA_VERSION` move, no new action, no new
  control, and no geometry at all: `nodeDots` is not touched.
  - `Diagram.tsx` — `NodeShape`'s circles render only when `interaction` is
    present, on the gate every other affordance already uses. The group, its
    `transform` and `onNodePointerDown` are unchanged, so the canvas is
    byte-identical and the drag is untouched.
  - `styles/diagram.css` → `styles.css` — the four `.node-dot` rules move, so the
    class stops travelling inside every exported file. `.node-halo` is already
    there and shows the shape of the move.
  - `export.test.ts`'s `CHROME` regex gains `node-dot`, which is what makes the
    **ten** assertions that reuse it police the new class rather than pass around
    it. (Ten, measured: `grep -c "not.toMatch(CHROME)"`. `rules/canvas-interaction.md`
    says nine and is stale; this phase edits that file anyway.)
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green, `cargo
  test` **unchanged at 69**. Report vitest against the 484 Phase 6 left.
  - **Five shipped assertions are edited rather than met by surprise** (§2.11.1),
    and the count is the gate item — §2.11.1's table names all five. The two
    "contains the drawing…"/"emits its own `<g>` root…" cases **invert**; Phase 6's
    identity and two-dots cases **pass an `interaction`**, since they assert canvas
    facts; and the sign paint-order case passes one too, or it goes **vacuously
    green** on `indexOf` returning `-1`.
  - **That paint-order assertion is also made non-vacuous**, by asserting its
    needle is present before comparing indices. Without that, the same failure
    returns the next time a class leaves the figure.
  - **The identity claim survives the move**: with an `interaction`, a centred
    undivided node still emits its group character for character apart from
    `vector-effect`. Asserted, because the collapse Phase 6 proved is what this
    phase must not quietly break.
  - **An exported figure matches `CHROME` nowhere**, with `node-dot` now in it —
    and the assertion is checked for vacuity by confirming the canvas markup *does*
    match it. A regex that catches nothing passes every file.
  - **A nodes-only document's `diagramInner` carries no geometry** — only empty
    `<g class="node …">` groups. Stated in that form because **this suite has no
    DOM**: `vitest.config.ts` sets `environment: "node"`, so `measureDiagram`'s
    `getBBox` cannot run here and every existing framing test hand-passes bounds.
    Asserting the blank sheet by passing `null` bounds by hand would assert
    `diagramSvg` and pass identically **before** this phase, which is the gate
    passing for the wrong reason. The blank sheet itself is confirmed in the dev
    pass, where there is a DOM.
  - A `bun run dev` pass: the canvas still shows every dot, a node is still
    selectable and draggable, an export of the same document carries none, and a
    document of two unconnected endpoints exports as a blank sheet.
- **Docs touched:** `rules/canvas-interaction.md` (the chrome list gains the dot,
  and the "a node's halo is chrome while its dot is not" clause this phase
  falsifies — it sits at exactly **190/190**, so trade rather than add);
  `rules/road-joints.md`'s node-dot section, which sits at exactly **264/264** and
  takes the same constraint; **`rules/diagram-export.md`**, whose rule "a rule that
  paints belongs in `diagram.css`; a rule that serves interaction stays in
  `styles.css`" this phase **bends rather than illustrates** — `.node-dot` paints
  and is leaving, so the line becomes "paints something a figure carries";
  `src/styles/diagram.css`'s own comment about "the paper-filled endpoint dots"
  floating on a light page, which stops being true of any export; this spec's
  **OQ-10**, which becomes resolved; and the project-memory roadmap.
- **Shipped 2026-08-11.** As specified: TypeScript and CSS only, 486 vitest (up 2
  from Phase 6's 484) and `cargo test` unchanged at 69. `NodeShape`'s circle map
  takes `{interaction && …}`, the four `.node-dot` rules move to `styles.css`, and
  `export.test.ts:CHROME` gains the token. Four things the spec did not force:
  - **The `CHROME` token is what makes the CSS move mandatory rather than tidy**,
    and it was not obvious until it was run: the regex is matched against the
    **whole** file, embedded stylesheet included, so four rules left behind in
    `diagram.css` fail all ten assertions. The two halves of this phase police each
    other, which no one designed.
  - **The mutations measure what each half is worth.** Dropping the gate fails
    **13** tests with the token listed and **4** without it — so the four named
    assertions catch the leak on their own and the token is what widens the net to
    every export test. Leaving the CSS behind fails exactly the ten. The third
    mutation, dropping the token alone, is **green**: its value is entirely
    prospective, which is the honest reading of a chrome-list entry.
  - **The dev pass could assert the blank sheet after all, in the browser.** The
    gate moved it out of vitest for want of a DOM (§2.11.1) — but a Playwright pass
    on the Vite server can `import('/src/editor/export.tsx')` and run the real
    `measureDiagram`, which returns `null` for two unconnected endpoints and frames
    the same `viewBox="-26 -26 52 52"` an empty document gets. Worth reusing: the
    dev pass is a place to run the *real* path, not only to look at it.
  - **The `.diagram-bg` comment was half true and stayed half true.** It named the
    endpoint dots *and* the roundabout island as what would float on a light page;
    only the dots left, so the sheet keeps its reason.

### Phase 8 — A gore's arms stop bulging over the roads they part  (added 2026-08-11)

Added by the third reopening (§2.11.2). Depends on Phase 4, which drew the gore.
It passed its own scoped review (§7's phase-level gate) in two rounds on
2026-08-14 and **is cleared to implement**.

*Produces the observable: **yes** — the mainline's edge line runs unbroken past
the point where the ramp leaves it.*

- **Scope:** §2.11.2 — **every** link incident to a node whose glyph is `gore`
  takes `.road-casing--butt`, the modifier a tapered joint already applies, so no
  round cap paints back over the road it just left. **TypeScript only**: Phase 3
  built the class, `export.test.ts` already pins it in the embedded stylesheet, and
  nothing in `diagram.css` changes.
  - `Diagram.tsx:tapers` is the one site. It already returns
    `{ wedges, butt: Set<LinkId> }`, and `Diagram` already spends it as
    `butt={butt.has(link.id)}` on `RoadShape` — so the phase adds gore links to
    that set and touches no other plumbing.
  - The predicate is the node layer's own, **and it is two tests, not one**:
    `node.type === "junction" && doc.layout.junctions[id]?.glyph === "gore"`. The
    glyph alone is weaker than the render path, since a node can keep a stale
    junction view — only through a hand-edited `.zkai`, because `state.ts`'s
    `setNodeKind` deletes it when a node stops being a junction, but the drawing
    tests both and so does this.
  - **The gore check goes before `tapers`' `if (incident.length !== 2) continue`**,
    which is the first statement of the loop this phase extends. A gore node has
    three incident links, so a check placed after that early return would fire only
    on two-link gores. The exit gate's count catches it on the first run.
  - `tapers` runs **before** the node layer, which is why §2.11.2's rule is keyed to
    the glyph rather than to `gorePair` — that function is called inside
    `GoreShape`, downstream of here.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green, **486
  vitest** and **`cargo test` 69** as Phase 7 left them, moving only by the tests
  this phase adds.
  - **All three arms of §1's exit carry the class**, asserted on the shipped
    `Diagram.test.tsx:exit()` fixture — three matches, not two. That count is the
    phase: two is the chosen-pair implementation §2.11.2 rejects, and it is the one
    wrong answer that looks right.
  - **The predicate is the glyph, not the arm count**, and one shipped test already
    proves it: `draws no wedge where three links meet` puts three links on a
    **waypoint** and asserts no `road-casing--butt`. It must stay green untouched.
    An implementation keyed to "three incident links" fails it.
  - A document with no gore emits markup **unchanged**, which keeps the change
    local; the four existing `not.toContain("road-casing--butt")` cases cover it
    and none of them inverts (verified in review round 1).
  - **The other end of each arm goes flat too, and that is named rather than
    discovered**: `stroke-linecap` is a whole-path property, so a gore arm running
    to a free endpoint stops being domed there as well — §2.4 recorded the same
    consequence for a taper, and calls the flat end the better schematic reading.
    Assert it on `export.test.ts:gored()`, whose `N1` is exactly that free end.
  - A `bun run dev` pass on §1's exit: the mainline's edge line is continuous
    where the ramp leaves, at both a shallow and a steep splay.
- **Docs touched:** `rules/road-joints.md` (the cap rule now has two owners, the
  taper and the gore) — it sits at exactly **268/268**, so trade prose rather than
  add; and the project-memory roadmap.
- **Shipped 2026-08-14.** As specified: TypeScript only, one predicate in
  `Diagram.tsx:tapers`, 488 vitest (up 2 from Phase 7's 486) and `cargo test`
  unchanged at 69. The gate's count landed as written — `0 → 3` on `exit()`. Four
  things worth carrying forward:
  - **The three mutations separate cleanly, one assertion each.** Capping
    `incident.slice(0, 2)` — the chosen-pair implementation in its cheapest form —
    fails the new count test **and only it**, at 2. Removing the block fails both
    new tests. Keying to `incident.length === 3` fails the shipped `draws no wedge
    where three links meet` and nothing else, which is precisely the load the review
    predicted that test would carry.
  - **The `node.type === "junction"` half of the predicate has no test behind it,
    and that is honest rather than a gap.** Dropping it is **green** across all 488,
    because `setNodeKind` deletes the junction view and only a hand-edited `.zkai`
    can strand one. It is kept for the reason review gave — the render path tests
    both — and recorded here as unpinned rather than left to look covered.
  - **The dev pass is a before/after pair, and the before is what made the case.**
    Rendered through the real `diagramSvg` at tight bounds on the diverge, with the
    mainline aligned `nearside` (§2.11's "the one that was not a defect"). Before:
    the approach's cap swallows the mainline's lower edge line at the joint and the
    ramp's own cap paints a dark bead on the node. After: the edge line runs
    unbroken through, at both a shallow and a steep splay. Rendering the *mutation*
    is worth the extra minute — a lone "after" shows a correct picture without
    showing that this phase caused it.
  - **`rules/road-joints.md` held at 268 by trading**, and the criterion held: the
    file already had the mechanism (the taper's cap) and gained a second owner, so
    an extension pays its own way. What paid for it was genuinely spendable — a
    duplicated `HatchPattern` sentence and a standalone `<defs>`-gate paragraph
    folded into the sentence that already named the borrowing. Reflowing recovered
    nothing at all, as Phase 1 of `zk-014` recorded; only cutting words moved it.

### Phase 9 — The panel says which side the lanes hang on  (added 2026-08-11)

Added by the third reopening (§2.11.3). Depends on Phase 2, which shipped
`LinkAlign`.

*Produces the observable: **no** — and §2.11.3 carries the explicit argument
`CLAUDE.md` requires for a phase whose output is a panel. It exists because the
picture it prevents is a ramp drawn through a motorway.*

- **Scope:** the Inspector's Alignment control gains a readout of what the current
  setting does to *this* road — `right`/`left` **of travel** plus the magnitude in
  canvas units, per §2.11.3's frame decision. Two sites:
  - a new `alignmentReading` in `src/editor/geometry.ts`, beside
    `alignmentShift` (in `geometry.ts`):
    `(lanes, style, align) → { side: "left" | "right" | "on"; offset: number }`,
    where `side` is the sign of `alignmentShift` and `offset` its magnitude.
    Direction-blind, exactly as `alignmentShift` is.
  - `src/components/Inspector.tsx`, the `<Field label="Alignment">` block in the
    link arm: one added `<Field>` rendering that value through the existing
    `.readout` class. The panel imports `linkAlign`/`linkStyle` already and
    computes nothing.
  - **No model change, no new action, no geometry beyond the new pure function,
    and no Rust.** `LinkAlign` and `LinkView.align` shipped in Phase 2.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green, **488
  vitest** and **`cargo test` 69** as Phase 8 left them, moving only by the tests
  this phase adds.
  - The reading's **side is asserted against the drawing**, not against the enum,
    and this is the phase's one load-bearing assertion. For the shipped 4-lane
    eastbound fixture (`aligned`, in `Diagram.test.tsx`, "a 4-lane arterial drawn due
    east from the origin") the `offside` reading is `{ side: "right", offset: 18 }`
    and that document's casing is drawn at `d="M 0 18 L 120 18"`, with `nearside`
    mirroring to `-18` — so the test asserts the reading's
    side against the **sign of that `y`** and its offset against the **magnitude**,
    rather than against the word `offside`. A test keyed to the words passes under
    an inversion, which is the trap this spec hit repeatedly (§2.3). **That
    side-equals-sign-of-`y` equivalence is fixture-scoped**, true because `aligned`
    runs due east; it is a cross-check, never a rule, and it cannot reach the
    implementation, which takes `side` from `alignmentShift` and never sees a
    polyline. The dev pass's westbound leg is what covers the general case.
  - **That one assertion lives in `Diagram.test.tsx`, beside the fixture**, while
    `alignmentReading`'s own tests go in `geometry.test.ts`. The split is forced
    rather than chosen: `aligned` is module-private to `describe("link alignment")`,
    and `geometry.test.ts` is a `.ts` file that cannot render `<Diagram>`.
  - **`centre` reads `{ side: "on", offset: 0 }`, and `nearside` is `right`'s exact
    mirror in side and equal in offset.** Stated as a claim about
    `alignmentReading` and **not** about `alignmentShift`: `geometry.test.ts`
    already pins `centre → 0` and `nearside === -offside` on the *shift* and has
    since Phase 2, so an item phrased on the shift is green before this phase
    starts and tests nothing it builds.
  - **`alignmentReading` is tested in `geometry.test.ts`; no `Inspector.test.tsx`
    is created.** The panel stays the one surface with no test file — a standing
    property of this repo, recorded in three rules — which is why §2.11.3 puts the
    derivation in a pure function rather than inline in the panel.
  - A `bun run dev` pass: set each alignment on a real road and confirm the
    readout matches which way the asphalt moved, on a road drawn **westbound** as
    well as eastbound — the case that tells a travel-frame readout from a
    screen-frame one, and the only one the pure test cannot see.
- **Docs touched:** `rules/road-rendering.md`, whose Alignment section documents
  the **field and its sign** rather than the control — it gains the reading and its
  frame, and sits at exactly **272/272**, so trade prose rather than add; this
  spec's **OQ-5**, which becomes resolved; and the project-memory roadmap. **No
  rule is falsified**, which is the dividend of keeping the derivation out of the
  panel: `rules/canvas-interaction.md`, `rules/signs.md` and `rules/road-markings.md`
  each state there is no Inspector test file, and each stays true.
- **As built (2026-08-14).** 493 vitest (up 5), `cargo test` unchanged at 69; no
  model change, no action, no Rust, no CSS. Three departures from the plan, each
  found by building it:
  - **The readout's label is `Lane region`, not the mock's `Lanes`** (taken by the
    user). The panel has carried a `<Field label="Lanes">` for the lane-count stepper
    since long before this phase, so §2.11.3's mock read literally puts two rows of
    that name in one panel. `Lane region` is the term this section's own prose and
    `rules/road-rendering.md` already use for the measured thing.
  - **An empty `lanes` array is *one default lane*, not a zero-width road**, which
    `rules/road-rendering.md` has recorded since the road spec and this phase's author
    still got wrong: it shifts `4.5`, not `0`. So `on the line` is reachable only
    through `centre` or a lane of literally zero width, which no control can author.
    The doc comment claiming otherwise was corrected before it shipped.
  - **The `shift === 0` branch is pinned after all.** The gate expected branching on
    `align === "centre"` instead to go green — a judgement no test could hold. The
    zero-width-lane case written *because* of the correction above catches it, so all
    three mutations fail exactly one assertion each.

### Phase 10 — Where two roads meet, neither paints over the other  (added 2026-09-14)

Added by the fourth reopening (§2.12.1). Depends on Phases 3 and 8, the two butt-cap
owners it generalises. It passed its own scoped review in two rounds on 2026-09-14,
the first of which changed its design.

*Produces the observable: **yes**.*
- Every straight waypoint joint, on the canvas and in a figure, keeps its lines
  unbroken. A bent one loses the round cap that overpainted them, keeping only the
  inside sliver §2.12.1 names.
- An aligned junction loses its knob.
- Every free end draws flat, which changes the arm ends of two landing figures.

- **Scope** (§2.12.1): TypeScript and CSS only, with no model change, no action and no
  Rust.
  - **`src/model/document.ts`**: a helper returning the set of distinct other nodes a
    node's incident links reach, self-loops excluded (named in words here, because it
    does not exist yet). Phase 11 reuses it.
  - **`src/editor/geometry.ts`**:
    - a pure function for **the joint discs**,
      `(doc, offsets, tapered: Set<NodeId>) → { at: Vec2; r: number }[]`. It
      implements §2.12.1's rule 2 on `geometry.ts:junctionArms`, and deduplicates
      origins with `geometry.ts:SAME_POINT`, keeping the widest arm's radius.
    - the `TAPER_MAX_BEND` doc comment stops citing `.road-casing--butt`, and says
      "butt caps" instead.
  - **`Diagram.tsx:tapers`**:
    - returns the set of nodes where it drew a wedge, in place of `butt`;
    - loses its gore block, since a gore node is a `junction` and gets no disc.
  - **`Diagram.tsx:Diagram`**:
    - emits the joint discs as `<circle class="road-joint">`, after the hatch
      pattern and before the first road;
    - stops passing `butt`.

    **`Diagram.tsx:RoadShape`** loses its `butt` prop, and the casing's class is
    always plain `road-casing`. No other element is added, removed, or moved in the
    document.
  - **`src/styles/diagram.css`**:
    - `.road-casing` declares `stroke-linecap: butt`;
    - the `.road-casing--butt` rule and its comment go;
    - a `.road-joint` rule fills `var(--asphalt)`;
    - the comment above `.road-casing` stops describing a round cap.

    As ever, no `<` or `&` anywhere in the file, and no chrome token, comments
    included.
  - **`src/styles.css`**:
    - `.road-hit` gains `stroke-linecap: round`;
    - `.road-halo`'s `stroke-linecap` becomes `butt` (its join stays round);
    - `.marking-halo`'s comment stops saying the road's halo is round "because the
      road does".
  - **`export.tsx:strokeAllowance`**: its doc comment stops naming a round cap and
    names the butt end's sideways corners instead (§2.12.1). The function is
    unchanged.
  - **Figures**: regenerate `examples/rendered/*.svg` and `index.html` with
    `ZUKAI_UPDATE_GOLDEN=1 bun run render-examples`. No `examples/*.zkai` is edited.
- **Exit gate:**
  - **Checks:**
    - `bun run build` and `bun run test` green;
    - `cargo test` unchanged at 74;
    - `spec-lint` 0 errors;
    - `bun run render-examples` passes without the opt-in after regeneration.
  - **`geometry.test.ts`, the joint discs:**
    - a straight centred waypoint gives discs at the node, radius `roadWidth / 2`;
    - a node whose links reach three distinct nodes gives discs;
    - a free end gives none;
    - a divided road's endpoint (reversed twins only) gives none;
    - a `junction` node gives none;
    - a node in `tapered` gives none;
    - a straight divided waypoint gives two, at the two carriageway offsets;
    - coinciding origins of different widths give one disc at the wider radius.
  - **`document.ts`'s helper:** a reversed twin pair counts its far node once, and a
    self-loop contributes nothing.
  - **`Diagram.test.tsx`:**
    - **Joint discs:** a straight waypoint emits `road-joint`, and its last
      `road-joint` precedes its first `road-casing`, each needle first asserted
      present (this spec's §2.11.1 lesson about `indexOf`). `laneDrop()`, `exit()`
      and a T junction emit none.
    - **No markup anywhere carries `road-casing--butt`**, on the tapered, gored and
      plain fixtures alike.
  - **`export.test.ts`:** the embedded stylesheet has no `.road-casing--butt`, and the
    `.road-casing` rule block declares `stroke-linecap: butt`. Assert on that block,
    not the file, because `.road-edge` keeps its round cap.
  - **Shipped tests: one of three outcomes.** No test is rewritten to pass.
    1. **Rewritten as stated.**
       - `Diagram.test.tsx` "butt-caps both links of a tapered joint, and only
         those" → the tapered joint draws its wedge and no `road-joint`.
       - `Diagram.test.tsx` "butt-caps every arm of a gore, not just the two the
         triangle uses" → the gore node draws no `road-joint`.
       - `Diagram.test.tsx` "leaves a joint of equal width exactly as it was" → its
         wedge-free, casing-literal assertions stand, plus the `road-joint` it now
         carries. Retitled, since "exactly as it was" stops being true.
       - `export.test.ts` "carries the taper's paint in the embedded stylesheet" →
         its `.road-casing--butt` clause inverts.
       - `export.test.ts` "flattens a gore arm's far end too, a cap being a
         whole-path property" → asserts
         `<path class="road-casing" d="M 0 18 L 120 18"`, retitled to say every
         free end is flat.
       - `export.test.ts` "leaves room for the round end-cap of the widest road
         allowed" → its assertions stand; its title and comment name the butt end's
         sideways overhang rather than a round cap.
    2. **One clause deleted, the rest standing.** The four
       `not.toContain("road-casing--butt")` clauses, which go vacuous once no
       modifier exists and are covered by the new "no markup anywhere" assertion:
       - the `plain` half of the tapered-joint case above;
       - "draws no wedge where three links meet";
       - "never wedges between the two carriageways of a divided road";
       - "draws no wedge at a right-angled corner, equal width or not".
    3. **Any other failure is a finding to stop on.** Nothing moves in the
       document, so a changed `d`, width or class string anywhere else means the
       phase did something it must not.
  - **The regenerated figures, as a diff.** In `examples/rendered/*.svg`, the drawing
    markup (outside the embedded `<style>`) differs only by `road-casing--butt`
    becoming `road-casing` on `motorway-ramp`'s three gore arms. `roundabout` and
    `signalized-cross` differ only in the stylesheet. `index.html` follows the same
    diff.
  - **Mutations, each failing a clause above:**
    - `.road-casing` left round (the stylesheet assertion);
    - discs emitted after the roads (the disc-order case);
    - a disc at a free end or a divided endpoint (geometry);
    - a disc at a tapered node (the rewritten taper case);
    - the junction exclusion dropped from the joint discs (fails "a T junction emits
      none" and the geometry `junction` case).
  - **Dev pass**, before and after on the same documents, rendered as §2.12.1's were:
    - a straight waypoint; waypoints bent 30° and 90°;
    - a T whose through road is aligned `offside`; a cross with one `offside` arm;
    - §1's lane drop; a divided road bent at a waypoint (its median half-disc
      unchanged, §2.12.1).

    Then `bun run dev`:
    - a press on the outside corner of a 90° waypoint's disc selects a road rather
      than panning (`elementFromPoint` there returns a `road-hit`);
    - a selected road's halo ends flat at a free end;
    - selecting and dragging a road beside a joint still works.

    None of these can be tested, because no test in this repo reads `styles.css`.
- **Close-out:**
  - **Rules:**
    - `rules/road-joints.md`: the butt-cap section becomes the joint rule, and its
      taper and gore bullets change with it.
    - `rules/road-rendering.md`: the casing's cap and the discs, in "Where each piece
      lives".
    - `rules/diagram-export.md`: `strokeAllowance`'s round-cap reasoning.
    - `rules/marking-kinds.md`: its "`.road-halo` takes round ones" sentence.
    - `rules/canvas-interaction.md`: its chrome list names `.road-hit`, which gains
      the round cap and the reason for it.
  - **Line budgets:** `road-joints.md` 268/268, `road-rendering.md` 274/284,
    `marking-kinds.md` 250/250 and `canvas-interaction.md` 190/190 trade prose rather
    than grow.
  - **Spec notes:** a dated `CORRECTED` note beside §2.4's "The round end cap has to
    go at a tapered joint" and beside §2.11.2's rule, since both read as the current
    mechanism.
  - **Phases 3 and 8 are not cut:** what each produced (no bulge at a wedge, no cap
    across a gore's edge line) still holds, now by a wider rule. A cut would record
    that their observable left the product, and it has not (review round 1
    adjudication).
  - **Other:** roadmap memory, one line. One push.

### Phase 11 — A node that joins two roads is a waypoint  (added 2026-09-14)

Added by the fourth reopening (§2.12.2). Depends on Phase 10 for the neighbours
helper, which does not exist until Phase 10 ships. It passed its own scoped review in
two rounds on 2026-09-14.

*Produces the observable: **the canvas, not a figure**, argued in §2.12.2. A through
node stops painting a paper bead on the road, and the saved file stops calling it an
end.*

- **Scope** (§2.12.2): **`src/editor/state.ts` only.**
  - A private helper takes a document and some node ids, and applies §2.12.2's rule
    to each through the Phase 10 neighbours helper (the `document.ts` function
    returning the set of distinct other nodes a node's incident links reach).
    - **It reads the document after the edit**: the one with the new link added, or
      with the link or node removed. Evaluated before the edit, the chain case and
      both delete cases fail.
    - **It skips any id no longer in `doc.nodes`.** That is the deleted node itself,
      which is the far node of a self-loop the node arm drops. `completeLink` cannot
      create a self-loop, but a loaded file can hold one.
    - **Where it changes no kind, it returns its input's `nodes` array by
      reference.**
  - It is called from `state.ts:completeLink` with the new link's two nodes. In
    `state.ts:deleteSelection` it is called from the `link` arm with the deleted
    link's two nodes, and from the `node` arm with the far node of every dropped link.
  - No other action, no loader, no import path. Review round 1 confirmed these are
    the only three places a node's links change: no action re-points, splits or
    reverses a link, and `loadDocument`/`importDocument` pass through none of them.
- **Exit gate:**
  - **Checks:** `bun run build` and `bun run test` green; `cargo test` unchanged at
    74; `spec-lint` 0 errors.
  - **`state.test.ts`:**
    - `N1→N2` then `N2→N3`: `N2` is a `waypoint`, `N1` and `N3` stay `endpoint`.
    - `N1→N2` then the reversed twin `N2→N1`: both stay `endpoint`.
    - A second link at a `junction` leaves it a `junction`, with `doc.junctions`
      identical by reference.
    - A third link at a waypoint leaves it a waypoint.
    - Deleting `L2` from the chain returns `N2` to `endpoint`, and so does deleting
      node `N3`.
    - One `undo` after the `completeLink` that retyped `N2` restores both the link
      and the `endpoint`.
    - A manual `setNodeKind` back to `endpoint` on `N2` survives a `moveNode`, and
      is re-derived by a `completeLink` at `N2`.
    - A `completeLink` between two fresh nodes leaves `doc.nodes` identical by
      reference.
    - A `loadDocument` whose file holds an `endpoint` joining two links keeps it
      an `endpoint`.
  - **Shipped tests:** anything that fails is a finding to stop on.
    - Fixtures that set `waypoint` explicitly, such as `Diagram.test.tsx`'s
      `chain()`, stay green: `state.ts:setNodeKind` rebuilds `doc.nodes` with the
      same kind, which draws the same markup.
    - Hand-built `Document` literals in `geometry.test.ts` go through no action, so
      this rule never reaches them.
  - **Mutations:**
    - only the promotion built (the delete cases fail);
    - incident links counted instead of distinct neighbours (the twin case fails);
    - `junction` not excluded (the junction case fails).
  - **Dev pass:** draw a three-node road; the middle node reads `waypoint` in the
    Inspector and loses its bead. Delete one link and it reads `endpoint` again.
    Undo restores both.
- **Close-out:**
  - `rules/canvas-interaction.md`: the link tool's row, and both halves of the rule —
    what `completeLink` and `deleteSelection`'s two link-removing arms do to the kinds
    of the nodes they touch. Trades prose at 190/190.
  - `rules/junctions.md`: that auto-typing never reaches a junction. Trades prose at
    215/215.
  - **A rule over its cap is a spec-lint *warning* (`RULE_OVER_CAP`), not an error**,
    so "0 errors" would not catch one. The close-out check is that both files report
    `OK` at or under their caps.
  - Roadmap memory, one line. One push.

### Phase 12 — A node's dot shows while it is being edited  (added 2026-09-14)

Added by the fourth reopening (§2.12.3). Depends on Phase 11 only for its dev pass,
whose through nodes should already be waypoints. It passed its own scoped review in
two rounds on 2026-09-14.

*Produces the observable: **the canvas, not a figure**, argued in §2.12.3.*

- **Scope** (§2.12.3):
  - **`Diagram.tsx:Interaction`** gains a required boolean, `revealNodes`: every
    node's dot is shown. **`Canvas.tsx:Canvas`** sets it to `tool === "link"`.
  - **`Diagram.tsx:NodeShape`** takes whether its dot is shown.
    - Its group's class becomes `node node-{type}`, then ` is-selected` when selected,
      then ` is-shown` when shown, in that order.
    - `is-shown` is only ever emitted when an `interaction` exists, exactly like the
      dot.
    - The `Diagram` node layer computes "shown" from four things: the selection (node
      arm, or the link arm naming a link whose `from_node` or `to_node` is this node),
      `linkFrom`, whether any link touches the node, and `revealNodes`.
  - **Unchanged:** the dots, the halos, `onPointerDown`, and every attribute but that
    class string.
  - **`src/styles.css`**: the dot of a `.node` group without `is-shown` gets
    `opacity: 0`, and `.node:hover .node-dot` restores `opacity: 1`.
    - **The hover rule is written after the hiding rule.** The two selectors have
      equal specificity, so source order decides, and reversed, hover reveals nothing
      in either engine (measured in review round 1).
    - A comment says the transparent dot is still the hit target, and why.
  - **`export.test.ts:CHROME`** gains `is-shown`.
  - **Forced edit, left unlisted:** because `revealNodes` is required, the one
    `Interaction` literal outside `Canvas.tsx` gains it as `false`. That literal is
    `Diagram.test.tsx`'s `interaction()` helper, and every spread of it inherits the
    field.
- **Exit gate:**
  - **Checks:** `bun run build` and `bun run test` green; `cargo test` unchanged at
    74; `spec-lint` 0 errors.
  - **`Diagram.test.tsx`,** each case named with its fixture:
    - **On a two-link chain `N1→N2→N3`:**
      - with `selection: null`, every node's group carries a `node-dot` and none
        carries `is-shown`;
      - selecting `L1` shows `N1` and `N2` and not `N3`;
      - selecting node `N3` shows `N3` alone;
      - `selection: { kind: "bend", link: "L1", index: 0 }` shows none;
      - `linkFrom: "N3"` with `selection: null` shows `N3` alone;
      - `revealNodes: true` shows all three.
    - **On two nodes and no link:** both are shown with `selection: null`.
    - **On `sample()`'s roundabout junction `N2`:** its group markup is identical with
      `revealNodes` true and false, and carries no `is-shown`.
  - **`export.test.ts`:** the existing chrome assertions pass with `is-shown` in
    `CHROME`. Their vacuity check is the `revealNodes: true` case above, which carries
    the token on the canvas.
  - **Shipped tests, edited as stated:**
    - "emits a centred undivided node exactly as it did before the dots moved" and
      "marks a divided road's endpoint on both carriageways, from one group" change
      to render with `{ ...interaction(), selection: null }`.
    - Both fail as they stand, and the reason is the fixture, not the claim: the
      helper selects `L1`, which is `N1→N2` in both `chain()` and `twoWay()`, so both
      nodes would carry `is-shown`.
    - With no selection, every literal in them stands unchanged (measured in review
      round 1: exactly these two fail, 564 of 566 pass).
    - Anything else that fails is a finding.
  - **Mutations:**
    - shown whenever an `interaction` exists (fails the `selection: null` case);
    - the bend arm counted as the link arm (fails the bend case);
    - the no-link fallback dropped (fails the unconnected case);
    - the `linkFrom` clause dropped (fails the `linkFrom` case).
  - **The stylesheet is gated by the dev pass**, because no test in this repo reads
    `styles.css`, and this phase does not start one: `specs/road_declutter_spec.md`
    Phase 1 made the same call for the arrow's rule.
    - `bun run dev`: no bead at rest on `examples/motorway-ramp.zkai`;
    - hovering a road end reveals its dot;
    - pressing a road end whose dot is hidden drags its node;
    - selecting a link shows exactly its two ends;
    - the link tool shows every node, and a link can be drawn between two of them.

    Repeat the press-and-drag in the desktop window, or in Playwright WebKit if the
    window cannot be driven, because the measurement in §2.12.3 is the claim this
    rests on.
- **Close-out:**
  - **Rules:**
    - `rules/road-joints.md`: the dots section, where a dot is drawn on the canvas but
      shown only while being edited.
    - `rules/canvas-interaction.md`: the chrome list gains `is-shown`, and the hover
      rule.
    - `rules/diagram-export.md`: its quote of `CHROME`, in place.
  - **Line budgets:** `canvas-interaction.md` 190/190 and `road-joints.md` trade
    prose; `diagram-export.md` changes a quote in place.
  - **Other:** OQ-11 stays open unless the dev pass says otherwise. Roadmap memory,
    one line. One push.

### Phase 13 — A joint draws one dot per road through it  (added 2026-09-14)

Added by the fifth reopening (§2.13.2, §2.13.4). Depends on no unshipped phase.

*Produces the observable: **the canvas, not a figure**.* A figure carries no dots
(§2.11.1). The report was a canvas report — one waypoint drawn as two nodes — and the
through pairs this phase builds are the one piece Phase 14's walk stands on, which is
why it goes first.

- **Scope:**
  - **`geometry.ts`:** `throughPairs(doc)`, exported and pure, returning
    `Map<LinkId, LinkId>` by §2.13.2's two passes, its sort key and its direction rule.
    It reads directions from `document.ts:linkPolyline`.
  - **`geometry.ts:nodeDots`:** §2.13.4's rule — the arm it takes, the order it emits,
    and the whole-result `SAME_POINT` merge. The signature is unchanged, and it may
    compute only the pairs at the node it is asked about.
  - **Comments this phase makes false are corrected in place**, and that is the only
    edit to their code: `geometry.ts:SAME_POINT` ("the lane-drop step this must never
    merge"), `geometry.ts:jointDiscs` ("as `nodeDots` counts them"), and
    `Diagram.tsx:NodeShape` ("once per drawn road end").
  - **Nothing else:** `junctionArms`, `jointDiscs`' behaviour, `Diagram.tsx:tapers`, the
    model and Rust are untouched.
- **Exit gate:**
  - **Checks:** `bun run build` and `bun run test` green; `cargo test` unchanged at 74;
    `spec-lint` 0 errors.
  - **`geometry.test.ts`, the pairs.** Every case compares the **whole map**, as
    `Object.fromEntries(throughPairs(doc))` against the object literal below, never a
    lookup per node, so a pair appearing anywhere it should not fails. Vitest does not
    equate a `Map` with a plain object, so the conversion is required.
    - `N1→N2→N3` gives `{ L1: "L2" }`.
    - A reversed twin at a free end (`N1→N2`, `N2→N1`) gives `{}`.
    - The divided lane drop of "draws four dots where a divided road drops a lane at a
      waypoint" gives exactly `{ L1: "L3", L4: "L2" }`.
    - A right-angle corner waypoint gives its one pair, by the first pass.
    - A diverge (one arriving link, a straight continuation, and a ramp 35° off it)
      pairs the continuation only. The mirror-image merge pairs the mainline only.
    - Two straight undivided roads crossing at one node pair both straight-throughs.
    - **Competing candidates:** `A(0,0)→N(360,0)`, with `N→B(720,0)` and
      `N→C(720,36)`. `C` turns 5.71°, inside `TAPER_MAX_BEND`. The pair is `A`'s link
      with `B`'s.
    - **An exact tie:** `A(0,0)→N(360,0)`, with `N→C(720,36)` and `N→D(720,−36)`, and
      no straight continuation. The turns are equal, and the smaller leaving id wins.
    - One arriving link with two leaving links, each turned 30°, gives `{}`.
    - **A bend on its own node, in the second pass:** the diverge above, with the
      straight continuation carrying one bend placed exactly on `N` and its far node
      beyond it on the same line. It still pairs with the arriving link, by its next
      segment's direction. A plain chain would not test this, since the first pass
      reads no direction.
    - The diverge, the crossing, the competing case and the tie each give the same map
      under every permutation of `doc.links`.
  - **`geometry.test.ts`, the dots:**
    - "draws four dots where a divided road drops a lane at a waypoint" is **rewritten,
      not deleted**, to `[{ x: 120, y: 18 }, { x: 120, y: -18 }]` (the 3-lane
      carriageways' origins, `±(30/2 + 3)`), in `junctionArms` order. Its doc comment
      says why the pairing is not the clustering it rules out: a pair is topological —
      which link continues which — so no distance and no order enters it.
    - A 1 → 2 undivided waypoint with both links `nearside`-aligned draws one dot, at
      `L1`'s origin (`y = −4.5`), and that point lies inside `L2`'s lane region
      `[−18, 0]`.
    - A 2-lane waypoint aligned `offside` then `nearside` draws one dot, at the arriving
      link's origin (`y = +9`), under both orders of `doc.links`.
    - "draws two dots where an unevenly split divided road parts by float slack" stops
      testing `SAME_POINT`, since each pair now yields one dot at any tolerance. Its
      claim moves to `jointDiscs` on the same fixture, which still merges arm origins:
      two discs, where `SAME_POINT = 0` gives four, since `distance < 0` merges not even
      identical points. The doc comment moves with it, and its "three exact origins"
      count stays asserted first.
    - "draws the same dots for every order of a three-arm fan" stays green unchanged.
  - **Shipped tests:** anything else that fails is a finding to stop on.
  - **Mutations:**
    - twins not excluded (the reversed-twin case gains `L1: "L2"` and `L2: "L1"` by the
      first pass, and the divided map gains `L2: "L1"` and `L3: "L4"` at its free ends);
    - the `TAPER_MAX_BEND` bound dropped (the 30° case fails);
    - the first pass dropped (the corner case fails);
    - the sort dropped, taking the first candidate in `doc.links` order (the competing
      and tie cases fail under permutation);
    - the direction read off the adjacent segment even when it is zero-length, as the
      `(0, 0)` that `junctionArms`' `|| 1` idiom yields (the bend-on-its-node case gives
      `{}`). Written as a bare `0 / 0` instead, the `NaN` dot survives a bound spelled
      `dot < cos` and is caught only by one spelled `!(dot >= cos)`. So the second pass
      is written so that a non-finite dot is never taken;
    - the wider arm's origin taken (the divided case reads `22.5`);
    - equal widths taking the first arm in `junctionArms` order (the 2-lane
      `offside`/`nearside` case fails under one of its two orders);
    - `SAME_POINT` set to 0 (the retargeted `jointDiscs` case fails).
  - **Figures:** `bun run render-examples` passes unchanged, since dots are chrome.
  - **Dev pass:** draw 1 → 2 lanes with both links `nearside`, and hover the waypoint:
    one ring. A divided lane drop under the link tool: two rings, one per carriageway.
- **Close-out:**
  - `rules/road-joints.md`: the dots section, one dot per through pair, and the
    frontmatter `covers:` line, which says "once per drawn road end". Trades prose at
    268/268.
  - A dated `CORRECTED` note at the head of §2.10.2. It covers every claim there this
    phase reverses: "one dot per drawn road end", the four dots at a divided lane drop,
    "no angle, no mean, no ordering", and the aligned jink drawing two dots.
  - Roadmap memory, one line. One push.

### Phase 14 — The joint says which side the lanes change on  (added 2026-09-14)

Added by the fifth reopening (§2.13.1, §2.13.3, §2.13.5). Depends on Phase 13's
`throughPairs`, and it rewrites Phase 13's two alignment-based dot tests (below).
OQ-12 and OQ-13 are resolved (no migration arm; the walk carries through junctions).

*Produces the observable: **the figure**.* A lane change is drawn on the side the human
names, at the node where it happens. A road that gains a lane on one side and loses
one on the other is drawn straight, which today it cannot be for 2 → 3 → 2 (§2.13).

**Sized as one pass deliberately.** Split into "add the side" then "remove alignment",
the first half changes what `lateralShift` returns, and every alignment test would be
rewritten twice.

- **Scope, model (both mirrors):**
  - **`layout.rs`:** `NodeView` gains `lane_change: LaneChange`.
    - The enum is `Both` (default), `Nearside`, `Offside`, `snake_case`.
    - The field is `#[serde(default, skip_serializing_if = "LaneChange::is_both")]`.
    - `NodeView` is `Copy`, so the enum is too.
  - **`types.ts`:** `LaneChange = "both" | "nearside" | "offside"`, and
    `NodeView.lane_change?: LaneChange`, absent for `both`.
  - **Removed from both mirrors:** `LinkView.align` and `LinkAlign`. Rust also loses
    `LinkAlign::is_centre`; TypeScript loses `linkAlign` and `DEFAULT_LINK_ALIGN`
    from `document.ts`.
  - **Compile-forced, listed so they are not a surprise:** every Rust `NodeView { pos }`
    literal gains the field — `network/import.rs:import` and `model/mod.rs`'s round-trip
    fixture.
  - **`SCHEMA_VERSION` stays 3.**
- **Scope, `geometry.ts`:**
  - A new pure function returns every link's walked shift by §2.13.3: the head rule,
    the restart at a carriageway, and the table. It reads `carriageways` and Phase 13's
    `throughPairs`. `carriageways` itself does not change, so its tests stand.
  - `lateralShift` returns the walked value.
  - `alignmentShift`, `alignmentReading` and `AlignmentReading` are removed.
- **Scope, the one wiring obligation (§2.13.3):** every non-test caller that hands
  `carriageways(doc)` to a drawing function hands the walked record instead.
  - That is `Diagram.tsx:Diagram` and two sites in `Canvas.tsx`, `beginBend` and
    `projectOntoLink`.
  - A missed `Canvas.tsx` site makes a press on a moved road project onto where the road
    is not drawn, which no test here can see; the dev pass covers it.
  - **Two test helpers carry the same obligation:** `Diagram.test.tsx:padR` and
    `geometry.test.ts`'s `node dots` helper `dots`. Each hands the walked record to
    `junctionArms` / `nodeDots` instead of `carriageways(doc)`. Otherwise
    `padR(doc, "N3")` below measures `21.6` rather than `24`, and a dot test passes
    whether or not the walk is wired. Where a fixture states no side the two records
    are equal, so every other test's `carriageways` call may stay.
- **Scope, `state.ts`:**
  - `setLinkAlign` and its action arm go.
  - `setNodeLaneChange { id, change }` is added:
    - it stores `both` as an absent key;
    - it writes `doc.layout.nodes` only;
    - it returns `state` unchanged for a node with no layout entry.
  - **`moveNode` keeps the rest of the node's view.** It writes
    `{ ...doc.layout.nodes[id], pos }` rather than `{ pos }`, or a drag erases the side
    (§2.13.3).
  - The six doc comments citing `setLinkAlign` as the absent-key precedent re-point to
    `setNodeLaneChange`.
- **Scope, `Inspector.tsx`:**
  - The link panel loses its Alignment and Lane region rows.
  - The node panel gains a "Lanes change on" segmented row (Nearside / Both /
    Offside), after Type and before `JunctionFields`. It shows on any node, a junction
    included, that either:
    - stores a non-`both` side, so a stored side can always be seen and cleared; or
    - has a through pair whose two links both have a zero `carriageways` value.
- **Scope, stale doc links, corrected in place:**
  - `model/mod.rs`'s `SCHEMA_VERSION` comment names `layout::LinkView::align` as the
    field that needed no bump. It names `layout::NodeView::lane_change` instead.
  - `decoration.rs`'s `anchor` comment cites `LinkAlign`'s shape. It cites
    `LaneChange`'s.
- **Scope, shipped TypeScript tests.** Measured on 2026-09-14 at `0420124`: with
  `alignmentShift` returning 0, 20 tests fail. More reference a removed symbol and so
  stop compiling. Phase 13 adds two more. The whole set, by what happens to each:
  - **Rewritten onto a stated side, with their new literals.** Each fixture drops its
    `setLinkAlign` actions and states the side with `setNodeLaneChange` instead:
    - **`Diagram.test.tsx`, `tapers` block:** `laneDrop()` states `nearside` at `N2`.
      "closes a lane drop with one wedge on the nearside" pins
      `points="120,19.5 120,10.5 144,10.5"`, and "paints an edge line 1.5 inside the
      wedge's hypotenuse" measures from `19.5` and `10.5`. `L1` is a head at `0`, and
      `L2` is at `−4.5`: each value is the old one less 18.
    - **`Diagram.test.tsx`, gores block:** `exit()` states `nearside` at `N2`. "puts
      the nose on the mainline's own edge line" pins
      `class="road-edge" d="M 120 9 L 240 9"` and `nose[1] ≈ 9`. `L2`'s polyline is at
      `−4.5`, and its nearside edge at `−4.5 + 13.5`.
    - **`Diagram.test.tsx`, "carries a junction's arms along with the road":**
      - The fixture becomes `N1(0,0) → N2(120,0) → N3(240,0)`: a 1-lane `L1`, a
        3-lane `L2`, `offside` stated at `N2`, and `N3` a `signalized_cross`.
      - `L2`'s casing is `M 120 -9 L 240 -9`, since `d = 0 + 4.5 − 13.5`.
      - The stop bar is centred at `−9`.
      - `padR(doc, "N3")` is `24`: a reach of `9 + 15` against a base of `30 × 0.62 + 3 = 21.6`,
        so the floor still binds.
    - **`export.test.ts`:**
      - `tapered()` and `gored()` state `nearside` at `N2`.
      - "draws every free end flat, a gore arm's far end included" pins
        `'<path class="road-casing" d="M 0 0 L 120 0"'`.
      - "needs no allowance of its own — the frame already covers the wedge" keeps its
        three corners.
    - **`geometry.test.ts`, `tapers` block:** the `end()` helper takes the signed
      offset as a number instead of an alignment. It passes `18`, `13.5` and `0` where
      it passed `offside` on 4 lanes, `offside` on 3, and `centre`. Every corner
      literal, and the nested `taperEdge` block, stand unchanged. The comparison
      against `alignmentShift(defaults(4), "offside") * 2` becomes `36`. This keeps
      §2.4's sign pins, and without it the whole file fails to collect.
    - **`geometry.test.ts`, "draws the same dots for every order of a three-arm
      fan":**
      - Three leaving links cannot carry a side, since each is a head. So each fan road
        gets its reversed twin instead.
      - Six origins stand off `N1` by their carriageway offsets, with no through pairs
        among them.
      - The test asserts six dots, and one set under all 720 orders of `doc.links`.
      - Its doc comment's clustering figures ("2, 1, 2, 2, 1, 2") were measured on the
        old fixture. Remeasure them on the new one, or remove them.
    - **Phase 13's dot tests:**
      - The 1 → 2 `nearside`-aligned waypoint becomes a **2 → 1** waypoint stating
        `offside`. The narrower road is then the downstream one, which only the walk
        moves: `d = 0, +4.5`. The dot is at `L2`'s origin, `(120, 4.5)`, inside `L1`'s
        lane region `[−9, 9]`. Unwired, it would read `y = 0`, so the case tests the
        wiring. (A 1 → 2 case would put the dot on the head's origin at `0` either way.)
        The `node dots` block's `lay` helper learns to take a node's side for it.
      - The equal-width `offside`/`nearside` pair has no replacement on an undivided
        road, since §2.13.3 makes equal-width origins coincide there. It becomes an
        undivided 2-lane `N1→N2` continuing into one carriageway of a divided 2-lane
        road `N2⇄N3`. The pair `(L1, L2)` has equal widths and origins `0` and `13.5`.
        The dots are `{(120, 0), (120, −13.5)}`, as a set, under both orders of the pair.
    - **`state.test.ts`:** the three `setLinkAlign` cases ("stores centre as no key at
      all, not as a string", "is one undo step, restoring the alignment the link had
      before", "creates a layout entry for a link that has none") become the
      `setNodeLaneChange` cases in the gate.
  - **Deleted with the mechanism,** since each claim is about per-link alignment
    itself:
    - `Diagram.test.tsx`: "draws a centred link exactly where an unaligned one goes",
      "puts an offside-aligned road's offside edge on its polyline", "mirrors it exactly
      for nearside", "adds alignment to a carriageway offset rather than replacing it",
      and "reads a road the way the road is drawn, not the way the enum is spelled".
      The `link alignment` block goes, apart from the junction case above, which moves
      out of it.
    - `geometry.test.ts`: the `alignmentShift` and `alignmentReading` describe blocks,
      "adds the carriageway offset and the alignment shift, on one link" (the walk's
      restart case replaces it), and "draws an aligned undivided road's dot off the
      node".
  - **Anything else that fails is a finding to stop on.**
- **Scope, shipped Rust tests, one-for-one, so `cargo test` stays at 74:**
  - `layout.rs`:
    - `an_alignment_survives_a_yaml_round_trip` → a `lane_change` round trip;
    - `a_centred_link_writes_no_align_key_at_all` → a `both` node writes no
      `lane_change` key;
    - `a_file_without_the_field_loads_as_centre` → a node without the key loads as
      `Both`.
  - `model/mod.rs`:
    - the round-trip fixture carries `lane_change: Offside` on a node instead of an
      alignment on `L1`;
    - `a_zkai_saved_with_a_road_class_still_loads_and_writes_none` keeps
      `align: offside` in its input YAML, expects `LinkView` with empty `bends`, and
      asserts the output carries no `align`.
- **Exit gate:**
  - **Checks:**
    - `bun run build` and `bun run test` green;
    - `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` clean;
    - `cargo test` green at **74**;
    - `spec-lint` 0 errors.
  - **`geometry.test.ts`, the walk.** Offsets are asserted as signed `d`, and the
    sign-bearing ones also as drawn `y`, never as magnitudes (§2.3). Default lanes
    throughout.
    - **With no side stated,** the walked record `toEqual`s `carriageways(doc)` exactly
      on: a straight chain, the divided lane drop, §1's exit through a gore, and a
      crossroads.
    - **1 → 2 eastbound, `offside` at `N2`:** `d = 0, −4.5`. `L2`'s drawn nearside edge
      line lies at the same `y` as `L1`'s, and its offside edge line lies 9 further
      toward `−y`. With `nearside`: `d = 0, +4.5`, and the offside edge lines share a
      `y`.
    - **1 → 2 → 1, `offside` then `nearside`:** `d = 0, −4.5, −9`, and `L3`'s offside
      edge line lies at `L2`'s `y`.
    - **2 → 3 → 2, `offside` then `nearside`:** `d = 0, −4.5, −9`. This is the case
      §2.13 shows alignment cannot draw.
    - **§1's exit, `nearside` at the gore:** `L2`'s offside edge equals `L1`'s, and the
      ramp `L3` keeps `d = 0`.
    - **The divided lane drop with `offside` at `N2`** still equals `carriageways(doc)`.
    - **The restart:**
      - The fixture: a 1-lane `N1→N2`, a 2-lane `N2→N3` with `offside` at `N2`, then a
        divided 2-lane `N3⇄N4`.
      - The result is `d = 0, −4.5`, and then `13.5` for both carriageways. Carried
        instead, the first carriageway would come out at `−4.5`.
    - **A cycle:**
      - The fixture: `N1(0,0) → N2(120,0) → N3(60,104) → N1`, with `L1` 1 lane, `L2`
        2 lanes, `L3` 1 lane, and `offside` at `N2`.
      - The record is `{ L1: 0, L2: −4.5, L3: −4.5 }` under every rotation of
        `doc.links`, since the walk starts from `L1`, the smallest id.
    - **A side stated upstream of a crossroads** carries to its straight-through on the
      far side (OQ-13).
  - **`Diagram.test.tsx`:** the rewritten literals above, and a 1 → 2 waypoint stating
    `offside` draws exactly one `road-taper`, on the offside.
  - **`state.test.ts`:**
    - `setNodeLaneChange` writes the key, clears it to absent for `both`, is one undo
      step, and leaves `doc.layout.links` identical by reference.
    - A `moveNode` after it keeps `lane_change`.
  - **Rust:**
    - `lane_change` round-trips;
    - an absent key loads as `Both` and is not written;
    - a file carrying a link's `align` loads and writes no `align`;
    - that last test asserts `SCHEMA_VERSION` is 3, so the removal is decided rather
      than overlooked.
  - **Figures:** `bun run render-examples` passes with the landing figures
    byte-identical, since no example states either field.
  - **Mutations:**
    - the `nearside` and `offside` rows swapped (the 1 → 2 drawn-`y` case fails);
    - the restart dropped, so the table applies at a carriageway (the restart case
      fails);
    - the walk stopped at junctions (the gore case fails);
    - `moveNode` writing `{ pos }` (the drag case fails);
    - a head taking `0` instead of its `c` (the divided equality fails).
  - **Dev pass:**
    - Draw a 1 → 2 lane road and set Offside at the waypoint. The lane opens on the
      left of travel, and one ring shows.
    - Drag that waypoint. The lane stays on the left.
    - Extend it 2 → 1 with Nearside at the new waypoint. The nodes stay on one line.
    - On the moved road, place a marking and bend the road. Both land on the drawn
      road, which is the check on the `Canvas.tsx` sites.
    - The link panel has no Alignment row.
    - Open a `.zkai` carrying `align`. It loads, draws centred, and shows no banner.
- **Close-out:**
  - **Spec:**
    - Phase 2 and Phase 9 take `cut: <ship date>` and `by: zk-005`, with a `## 0.`
      closing note at the top of this file that says why (§2.13.5).
    - Dated `CORRECTED` notes beside §1's usage example, §2.3, §2.11.3 and OQ-5.
    - The frontmatter `note` points at §0.
  - **Rules.** Budgets are measured, not assumed; a `RULE_OVER_CAP` is only a warning,
    so read the report:
    - **`rules/road-rendering.md`** (274/284): its `covers:` line, its Alignment section
      (which becomes the side a road's lanes change on), the opening "one model
      addition" sentence, "the one thing genuinely added to draw the road", and the
      where-it-lives lists (`alignmentShift`/`alignmentReading`, `setLinkAlign`,
      `LinkView.align`/`linkAlign`).
    - **`rules/document-model.md`** (144/144, trades prose): `LinkView.align`'s three
      mentions — the optional-field example, the version-1 history, and the
      `is_centre` predicate example.
    - **`rules/road-joints.md`** (at its cap after Phase 13, trades prose): the taper
      section's "either alignment", and the joint-disc section's "a knob on an aligned
      T".
    - **`rules/road-markings.md`** (280/280, trades prose): Placement's "the alignment
      shift" becomes the walked shift, and "`LinkAlign`'s shape" becomes
      `LaneChange`'s.
    - **`rules/junctions.md`** (215/215) and **`rules/signs.md`**: each lists
      `LinkView.align` among the one-representation examples. Re-point each to
      `NodeView.lane_change`.
  - **Other:** `CLAUDE.md` none needed. Roadmap memory, one line. One push.
