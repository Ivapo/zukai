---
id: zk-005
title: ramps-and-tapers
status: accepted
last_updated: 2026-08-10
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
  widened `hasShoulder` — which it renamed `Diagram.tsx:needsHatch` for exactly
  this reason — to fire for a gore glyph, so the borrowed pattern existed.
  With the borrowing gone it is a shoulder test again, and the rename should
  arguably go back with it. **Phase 4's gate test inverts**: "a document with a
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
- **OQ-4** — **Node dots on a divided road.** The road spec's Phase 3 note
  records that an endpoint/waypoint dot now sits *in the median* of a divided
  road rather than on either carriageway (`NodeShape`, `Diagram.tsx:357`, draws
  at `nodePos`). Phase 1 gives arms an `origin`, which makes "one dot per
  carriageway" cheap — but is a dot per carriageway right, or should a divided
  road's endpoint show nothing at all? (design-call; does not block any phase.)
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
- **OQ-7 — left open by decision (Phase 4), for the junction-semantics spec.**
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
