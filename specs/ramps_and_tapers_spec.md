---
id: zk-005
title: ramps-and-tapers
status: accepted
last_updated: 2026-08-11
note: >
  Draw the transitions between roads — lane-count tapers, ramp gores, and
  junction interiors that follow a divided road's carriageways.

phases:
  - name: "Phase 1 — Arms carry their position (road spec OQ-6)"
    reviewed: 2026-07-25
    shipped: 2026-07-25
    cut: null
    by: null
  - name: "Phase 2 — Link alignment"
    reviewed: 2026-07-25
    shipped: 2026-07-25
    cut: null
    by: null
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
    shipped: null
    cut: null
    by: null

extends: null
supersedes: null
superseded_by: null
related: [zk-004, zk-003]
reference: "Motorway diagram convention as road atlases and variable-message signage use it — tapered lane drops, chevroned gore areas at a diverge, a continuous outer edge through a lane change. Not to-scale interchange geometry (that is Assimilator's job). The chevrons inside a gore are presentation on the gore glyph, not `Marking`s — corrected 2026-08-10, see §2.9."
---

# Ramps and Tapers Spec

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
- **OQ-4 — TAKEN UP by §2.10 and Phase 6 (added 2026-08-11): a dot per
  carriageway.** ~~Node dots on a divided road.~~ The road spec's Phase 3 note
  recorded that an endpoint/waypoint dot sits *in the median* of a divided road
  rather than on either carriageway (`src/components/Diagram.tsx:NodeShape`,
  which draws at `nodePos`). Phase 1 gave arms an `origin`, which made "one dot
  per carriageway" cheap; the question left open was whether it is *right*, or
  whether a divided road's endpoint should show nothing at all. §2.10.1 takes the
  dot per carriageway, and the argument that settles it is not aesthetic: the dot
  is the node's only hit target, so "nothing at all" removes the drag rather than
  removing a mark. **Open until Phase 6 ships.**
- **OQ-5** — **Could alignment be derived instead of set?** At a joint with a
  ramp leaving on one side, the side the lane is dropped on is arguably readable
  from the ramp's own direction. That would remove a control, at the cost of a
  heuristic the road spec's §2.4 was careful to reject for pairing, and of a
  taper that flips when a node is dragged past the mainline. (design-call;
  proposed: keep it explicit, and revisit if setting it twice per exit becomes
  tedious in practice.)
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
