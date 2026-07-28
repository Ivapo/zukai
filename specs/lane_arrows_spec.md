---
status: reviewed
last_updated: 2026-07-27
note: "Lane arrows become how a junction's turns are shown — painted on the approach lanes, seeded from an imported network, and replacing the dashed arcs across the pad. Includes the two things that have to exist first: a marking you can drag, and a marking that measures from the junction end."
implemented: []
not_implemented: ["Phase 1", "Phase 2", "Phase 3", "Phase 4", "Phase 5 (deferred)"]
related: [specs/road_markings_spec.md, specs/junction_semantics_spec.md, specs/network_yaml_spec.md]
reference: "Assimilator's `MovementConfig.from_lanes` (`crates/config/src/network.rs:1334-1378`) is the only field this spec reads back out of the format — which lanes of an approach feed a given turn. Read at `../assimilator` on 2026-07-26. Nothing else is wanted from it: `lane_mapping`, `priority` and `yields_to` were dropped in `fe8b452` and stay dropped."
---

# Lane Arrows Spec

## 1. Goal

A reader of a junction diagram needs to know **which lane goes where**. Zukai
currently answers that question twice, badly:

- **On the canvas**, with `MovementShape` — a dashed arc across the junction pad
  per permitted turn, with an arrowhead where it leaves
  (`Diagram.tsx`, junction semantics Phase 3). `cross-4` imports with **16
  movements**, so a `generic` glyph draws sixteen curves over one pad. That is a
  web, not a diagram, and it puts the information in the middle of the junction
  rather than on the approach a driver reads it from.
- **In the panel**, with the Movements list — a table of `L1 → L3  through  ×`
  rows. Accurate, and it never prints.

Neither is what a road actually does, and neither is what a figure wants. A real
junction says it with **paint on the approach lanes**: an arrow per lane, showing
the turns that lane may take.

Zukai can already draw exactly that — `MarkingKind.turn_arrow` with
`directions: TurnDirection[]` and `Marking.lane` (road markings Phase 3). What it
cannot do is **put them there without a human placing every one by hand**, and an
imported network arrives with none: `network_to_document` mints no markings at
all.

End state — importing `cross-4` and looking at approach `L1`, which the fixture
gives **two** lanes (`cross-4.yaml:30-38`):

```
Import network… ▸ cross-4.yaml          (16 turns in the file)

   file: L1 lane 0 → through + left     (M_L1_L3, M_L1_L7)
         L1 lane 1 → through + right    (M_L1_L3, M_L1_L6)

   drawn, kerb at the bottom:
        lane 1  ↰↑           ← offside (median): through and left
        lane 0  ↑↱           ← nearside (kerb):  through and right
   ═══════════════════════
        ▓▓▓▓▓▓▓▓▓▓▓▓▓        ← the junction pad, with no arcs across it

Each arrow is an ordinary `Marking`: select it, drag it, re-pick its
directions, or delete it. Nothing re-derives it afterwards.
```

**The lane indices are not the file's** — they are flipped, and §2.5.1 is why.
The file counts from the median, Zukai counts from the kerb, so the file's lane 0
(which turns left) is drawn as Zukai's *highest* index. Getting that backwards
mirror-images every approach in the drawing, which is the one way this feature
can fail while looking entirely plausible.

**The test this spec is written against** (`CLAUDE.md`): *which phase produces
the picture?* Phase 3 does, and Phases 1–2 exist because without them the picture
falls apart on the first drag. Phase 4 removes the two things this replaces.

## 2. Design

### 2.1 The arrow *is* the representation, not a view of something else

The turns a lane may take are **whatever is painted on it**. There is no second
copy in the model and nothing derives one from the other.

The alternative — arrows computed from `Junction.movements` on every render —
was considered and rejected for three reasons:

1. **It cannot work uniformly.** Zukai's own movements carry no lane detail:
   `deriveMovements` mints `M_L1_L3` with no idea which lane it uses, and
   `Movement` is four fields since `fe8b452` (id, two links, a turn kind). So a
   derivation would draw arrows on imported junctions and nothing on hand-drawn
   ones.
2. **It stomps hand edits with no way to refuse.** Adjust an arrow because the
   source data was wrong or because the figure reads better simplified, then
   touch any movement at that junction, and the adjustment is gone.
3. **They are different claims.** A movement is what the junction *permits*; an
   arrow is what the road *tells a driver*, and a simplified drawing may
   deliberately say less. `rules/junctions.md` already records the separation as
   a named non-goal: "a painted arrow is a human's decoration rather than a
   derivation."

So **import seeds and lets go** — `deriveMovements`' own posture, which merges
once and never looks again.

**What this costs, recorded rather than discovered.** An arrow says *you may turn
left from this lane*. It does not say **which road** that left leads to; the arcs
did, because each named an exit link. At an orthogonal cross that is no loss; at
a five-arm junction with two possible lefts the drawing is ambiguous where it was
not before. Real signage has the same limitation and answers it with a
destination plate, which Zukai has (`SignKind.direction`). Accepted.

Second cost, smaller: **nothing validates a painted turn.** `legalMovements`
refuses a turn onto a road that does not leave the node; paint refuses nothing.
That is the posture the editor already takes towards semantics it does not
simulate.

### 2.2 A marking has no position of its own to drag, and that is the gap

`Drag` is three kinds — `node`, `sign`, `pan` (`Canvas.tsx:27-29`). Under the
select tool a marking **selects and stops** (`onMarkingPointerDown`, `:172-174`).
So the marking editor can create, re-kind, re-lane and delete, and cannot
**move**. That is the missing verb, and it is the reason this spec's Phase 1
exists independently of everything else in it.

The work is small because the projection already exists: `placeMarking`
(`Canvas.tsx:134-148`) turns a pointer into `(position, lane)` via
`nearestOnPolyline` and `laneBands`, and dispatches `addMarking`. A drag is that
same computation pointed at an existing marking.

**A drag writes both `position` and `lane`**, because dragging across a lane
divider should move the arrow to the lane under the pointer — the lane already
"falls out of the click" for placement (`rules/road-markings.md`) and must fall
out of the drag for the same reason.

### 2.3 A marking measures from the start of its road, and auto-placement cannot live with that

`markingAnchor` is `marking.position * UNITS_PER_METRE`, walked from the
polyline's **first** point (`geometry.ts:956-968`). So a marking sits at a fixed
distance from the *far* end of its road and drifts relative to the junction the
moment a node moves.

For hand-placed paint that has been survivable. For **auto-placed** paint it is
fatal, and specifically fatal here: an imported network is what you drag hardest,
because `UNITS_PER_METRE` puts a 500 m arm 1285 units long against a 9-unit lane
(`rules/network-yaml.md`). Shorten that arm and an arrow minted at 1200 units no
longer sits where it was put: `pointAlongPolyline` **clamps**
(`remaining = Math.min(total, Math.max(0, along))`, `geometry.ts:897`), so it
does not vanish — it piles up at the far end, inside the junction pad, on top of
every other arrow that also ran off. Not a crash; just every approach's paint
stacked in the middle of the junction, which is the same figure the arcs already
failed to be.

Dragging is **not** the answer to this. Import a four-arm cross, get eight to
sixteen arrows, drag the nodes into shape, and every arrow needs re-dragging —
which is precisely the tedium Phase 3 exists to remove.

#### 2.3.1 `Marking.anchor` (decision, recorded)

A new optional field, `anchor?: "start" | "end"`, absent meaning `start` — today's
behaviour, byte-identical for every existing document. `LinkAlign`'s shape
exactly (`centre`/`nearside`/`offside`, absent = centre, `is_centre` as the
`skip_serializing_if`), for `LinkAlign`'s reason. **The two live in different
files**: `Marking` is `model/decoration.rs:14`, `LinkAlign` is
`model/layout.rs:94` with its private `is_centre` at `:107`.

**No `SCHEMA_VERSION` bump**, and the rule is stated in `model/mod.rs`: a new
optional *field* is not a breaking change, because nothing derives
`deny_unknown_fields` and an older build ignores what it does not know. A new
**variant of an existing enum** is what costs a bump; a brand-new enum reached
only through a brand-new optional field is not that.

**It fixes stop lines too**, which is what makes it worth a field rather than a
one-off in the importer. A stop line wants to sit at the junction; it has wanted
that since road markings shipped. Two of the **road markings spec's** open
questions get a half-answer each — always written `markings OQ-N` here, because
this spec has its own OQ-5 and OQ-6 is one digit away from it:

- **markings OQ-6** ("should a marking follow the road when a node is dragged?")
  is this section's motivation exactly, and is the closer neighbour of the two.
- **markings OQ-5** ("snapping a marking to a junction's rim") is answered for
  *auto-placed* paint only, and only once Phase 5 lands the rim — a human
  dragging a marking still lands where they dropped it (§2.7).

### 2.4 Where the arrow sits, and why it is not a distance

Links are not to scale, so **no metre value is meaningful here**. The offset is
derived from the arrow's own drawn size: it sits **one arrow-length clear of the
junction**, so the paint and the gap before it read as one unit whatever the road
is.

That is markings §2.4's rule collecting again — *containment is a property of the
tiling, not a clamp applied to it*.

**The constant is `TURN_ARROW_LENGTH = 15`** (`geometry.ts:1131`) — the arrow's
extent *along* the road. Not `ARROW_REACH` (`:1143`), which is `0.42 × band
width` (`:1220`), a **lateral** fraction governing how far a branch swings
sideways; it has no along-road meaning and would make the offset depend on lane
width, which is not what "one arrow-length" says.

Two conversions apply, and both are easy to drop:

- **`markingArrow` centres the shaft on `position`** — `shaft: [at(0,
  -TURN_ARROW_LENGTH / 2), at(0, fork)]` (`:1281`). So a marking whose anchor
  distance is `d` puts the arrow's *near end* at `d - L/2`. To leave a full
  arrow-length of clear road, the anchor distance is `L + L/2`, not `L`.
- **`Marking.position` is metres** (`model/decoration.rs:19-21`), while
  `TURN_ARROW_LENGTH` is world units. The stored value is therefore
  `(L * 1.5) / UNITS_PER_METRE`, and Phase 3 writes it in Rust, where
  `UNITS_PER_METRE` already has a hand-mirror (`network/mod.rs:58`).

**What "the junction" measures to was OQ-1, now RESOLVED: the end node**, with
the junction's rim deferred to Phase 5. The reasoning is worth keeping, because
the rim is the better answer and is not being rejected, only sequenced:

- **the end node** is pure arithmetic on the polyline — `markingAnchor` already
  has the points, and `anchor: "end"` is one subtraction from the total length;
- **the junction's rim**, `rayCircleExit` — the identical expression the stop bar
  is placed with, so the two cannot come to disagree about where a road meets the
  glyph (`rules/junctions.md`).

The rim is what both the arrow and the stop line actually want, and it is the
only one that survives the junction's **Size** stepper, since the pad radius sits
between the node and the road. What settled it is that the rim is **not
reachable from `geometry.ts` today**: the pad radius is computed inside a React
render body (`rp`, `Diagram.tsx:934`) from `junctionArms` (`:357`) and `interface
Arm` (`:331`), **both module-private to `Diagram.tsx`**. Routing `markingAnchor`
through the rim means lifting that geometry into `geometry.ts` first — a refactor
of load-bearing render code with `Diagram.test.tsx` riding on it, which is its
own pass and not Phase 2's.

**What the end node costs, stated rather than discovered:** the pad covers the
first `rp` units of every approach, so an arrow at `1.5 L` from the node sits on
the pad whenever `rp > 1.5 L ≈ 22` units — which a large glyph or a wide road
reaches. The arrow is then drawn on asphalt instead of ahead of it. It is
visible, it is draggable (Phase 1), and Phase 5 removes it. It is not a
correctness bug and it does not block the figure.

### 2.5 What import paints, and from what

One field comes back into the mirror: **`NetworkMovement.from_lanes`** — which
lanes of the approach feed a given turn. Read, converted to paint, and **never
stored**, which is the read-only mirror's own rule (`mirror what is drawn`,
`rules/network-yaml.md`) in its cleanest case.

**It comes back with `#[serde(default)]`, which departs from the mirror rule on
purpose.** Assimilator declares it required — `pub from_lanes: Vec<LaneIdx>`, no
default (`network.rs:1347`) — and `network/mod.rs:13-17` says a field's
optionality follows Assimilator's. That clause existed to guarantee **faithful
writing**: a movement Zukai could not reproduce byte-for-byte was a bug while an
export existed. The export is gone (`979a60d`), and the existing test
`the_lane_and_priority_keys_are_ignored_either_way` (`network/mod.rs:402-415`)
now pins the opposite rule deliberately — a bare movement parses. Restoring the
field as required would break that test, so it comes back optional, and an absent
`from_lanes` takes the same path as an empty one: **it paints nothing.**

The derivation, per junction:

1. Group the file's movements by `from_link` — **approach links only**, which
   falls out for free, since a movement's `from_link` is by definition the road
   arriving.
2. For each approach, group by lane index across every movement's `from_lanes`,
   **translating each index by §2.5.1 first**.
3. Map each movement's `type` to a `TurnDirection`: `through`/`left`/`right`
   pass through, `u-turn` → `u_turn`. Four kinds, four directions.
4. Mint one `turn_arrow` per lane that has at least one direction, in the
   canonical direction order, so two imports of the same file produce identical
   documents. That order is `TURN_DIRECTIONS` (`Inspector.tsx:115`) — which is a
   **module-private TS const**, so Phase 3 (Rust) writes its own ordering
   alongside `UNITS_PER_METRE`'s existing hand-mirror and a test pins the two
   equal.

#### 2.5.1 The two lane numberings run in opposite directions

This is the one thing in this spec that fails silently and looks right:

- **Assimilator counts from the median.** "Lane index (0-based; by convention, 0
  is the leftmost/fastest lane)" (`crates/config/src/network.rs:877`).
- **Zukai counts from the kerb.** "**Lane 0 is the nearside (kerb) lane**, so it
  comes back with the most positive offset" (`geometry.ts:197-200`).

So the translation is `zukai_index = lanes.len() - 1 - file_index`. Map the
indices straight through and `cross-4`'s left-turn arrow lands on the kerb lane
and its right-turn arrow in the median — a mirror image, drawn confidently, on a
fixture whose uniform 3.5 m lanes give no other clue that anything is wrong.

**`import_link` has the same bug already, and Phase 3 fixes both.** It copies the
lane array in file order (`import.rs:114-125`), so an imported hard shoulder at
the file's outside lane is drawn in the median. Nothing has noticed because
import sets every `kind: None` (`:123`) and the fixtures' lanes are all one
width — the array is mis-ordered but currently indistinguishable.

Both go through **one** helper, because fixing only one is worse than fixing
neither: translating in `lane_arrows` alone puts the arrows right and leaves the
widths mirrored, so the drawing disagrees with itself. That is
`rules/persistence.md`'s normalize-at-one-boundary rule arriving one format over
— the file's convention is converted once, at the edge, and nothing downstream
knows there was ever another numbering.

**Reversing the array means renumbering `Lane.id`, not just moving elements.**
`Lane.id` is documented as "`0`-based lane index within the link"
(`graph.rs:69-70`), and the code treats it positionally — `link.lanes[i]?.kind`
(`Diagram.tsx:753`), `l.lanes[i] ?? defaultLane(i)` (`state.ts:977`). Copy
`lane.id` through a reversal (`import.rs:118` does exactly that today) and
`lanes[0].id == 1`, which breaks the struct's own invariant while every
positional reader carries on working — a second silent failure hiding inside the
fix for the first. The imported lane takes its **new position** as its id.

The two translations do not compound, which is worth stating because it looks
like they might: `import_link` reorders the *array*, `lane_arrows` maps a *file
index* into the reordered array, and reversal is its own inverse — so both are
`n - 1 - i` and applying each once is correct. File lane 0 (median) ends up at
Zukai index `n - 1`, which is where `laneBands` draws the median.

Three cases fall out with no special handling, and all three are right:

- **A u-turn contributes nothing.** `cross-4`'s four u-turns carry
  `from_lanes: []`, so no lane claims them.
- **A lane serving several turns gets one arrow with several branches** — which
  markings Phase 3 already draws as one shaft with a branch per direction.
- **A lane with no movements gets no paint.** Not a "dead end" symbol: the only
  real case is an on-ramp where a turn becomes mandatory, and that is a
  one-direction arrow, not a terminator. A lane with zero movements in a file is
  more likely incomplete data than a real dead end, and painting a symbol on it
  would be Zukai asserting something the file never said.

### 2.6 Known limit, deferred on purpose

Markings Phase 3 recorded that **three or more directions in a narrow lane run
their heads together**, and six draw a starburst. Real approach lanes routinely
serve three (left + through + right), so the first honest import will hit it.

Out of scope here. This spec's job is to put the right arrow on the right lane;
making a three-branch arrow legible is a geometry pass on `markingArrow`.

### 2.7 Non-goals

- **Deriving arrows for a hand-drawn junction.** Nothing supplies lane detail for
  one, so there is nothing to derive from. Paint them.
- **Re-deriving after the fact.** No live binding (§2.1), and no "Re-derive
  arrows" button either until something asks for one — the escape hatch is
  documented in §2.1 rather than built.
- **Making a crowded arrow legible** (§2.6).
- **Snapping a marking to a junction rim by hand**, markings OQ-5's general
  form. Phase 2 gives auto-placed paint a stable anchor and Phase 5 moves that
  anchor to the rim; a human dragging paint onto the rim still lands where they
  dropped it, in every phase.
- **Re-ordering an existing document's lanes.** §2.5.1 fixes the numbering at the
  **import boundary** only. A `.zkai` saved from an earlier import keeps whatever
  order it was written with; nothing migrates it, and no `SCHEMA_VERSION` moves.
  The mis-ordering is invisible for uniform-width lanes, which is every network
  imported so far.

## 3. Open questions

- **OQ-1** — **Does `anchor: "end"` measure from the end node or the junction
  rim?** (design-call.) **RESOLVED — the end node in Phase 2; the rim in
  Phase 5.** The rim is the better answer and §2.4 keeps the argument for it, but
  it is not reachable from `geometry.ts`: the pad radius is computed in a React
  render body (`Diagram.tsx:934`) from `junctionArms` (`:357`) and `interface
  Arm` (`:331`), both module-private. Lifting those into `geometry.ts` is a
  refactor of load-bearing render code and gets its own pass. The end node is one
  subtraction on the polyline, and §2.4 records what it costs until Phase 5.
- **OQ-2** — **Does a drag change a marking's `lane`, or only its `position`?**
  (design-call.) **RESOLVED — both**, per §2.2: the lane already falls out of a
  click for placement, and a drag that crossed a divider without changing lanes
  would be the surprising reading. The rejected alternative — drag runs along the
  road, the Span control changes lanes — is more predictable and less direct, and
  is recoverable by hand if the drag turns out to feel loose in Phase 1's dev
  pass.
- **OQ-3** — **What happens to arrows already on a link when it is re-imported?**
  Import installs a whole new document (`install()`), so the question does not
  arise today. Recorded because it becomes real the moment anything merges an
  import into an open document. (answerable-from-code; **not a blocker**.)
- **OQ-4** — **Should Phase 4 also drop `Junction.rule`?** It is in the same
  position as `movements` — a semantic field nothing draws — and by this
  project's own test it is a cut candidate. Unlike `movements` it costs almost
  nothing to leave, and unlike `movements` it has a panel row a human uses.
  Proposed: **leave it**, and revisit only if it is still unread a spec later.
  (design-call.)
- **OQ-5** — **Does the junction hit disc block picking up an arrow?** `jn-hit`
  is `r = outerR + 2` and sits above the marking layer (`Diagram.tsx:972`), so
  paint parked near a junction cannot be grabbed — markings OQ-5 already measured
  two units of clearance on the centreline for a 3-lane arterial. An end-anchored
  arrow at `1.5 × TURN_ARROW_LENGTH ≈ 22` units clears a small pad and does not
  clear a large one, which is the same boundary §2.4 records. Phase 1's dev pass
  is where this shows up. (answerable-from-code; **not a blocker** — it degrades
  a drag, and Phase 5's rim placement moves the arrow out from under the disc.)

## 4. Implementation phases

Strictly sequential; each is one plan-mode pass with a concrete exit gate.

**The order is the point.** The removal is last, so there is never a commit where
a junction cannot express its turns at all.

### Phase 1 — A marking you can drag

- **Scope:** the missing verb, and nothing about arrows.
  - `Canvas.tsx` — a fourth `Drag` arm, `{ kind: "marking"; id: MarkingId }`.
    `onMarkingPointerDown`'s select-tool branch begins the drag after selecting,
    on `onNodePointerDown`'s shape; `onPointerMove` re-runs `placeMarking`'s
    projection and dispatches.
  - `state.ts` — `moveMarking(id, position, lane?)`. Absent `lane` is the
    absent-key rule, `setMarkingLane`'s shape (`state.ts:1160`). An unknown
    marking, and a drag that lands on the same `(position, lane)`, both return
    `state` by identity. **This is a new pattern, not an inherited one** —
    `moveNode` (`state.ts:533`) and `moveSign` both rebuild unconditionally, so
    there is no same-value early return to copy. Write it deliberately; the
    identity test in the gate is what makes it real.
  - `coalesceKeyFor` — `markingDrag:<id>`, the **third** drag key beside
    `moveNode` and `moveSign` (`rules/history.md`), so one drag is one undo step.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green.
  - `state.test.ts`: a drag writes both fields; a drag onto the same place
    returns `doc` by identity; a run of drags collapses to one undo step, and the
    leading `select` is what opens it (`rules/history.md`'s "the run is broken by
    the leading `select`").
  - A `bun run dev` pass: drag a stop line along a road and across a divider.
    Drag one **up against a junction** too — that is where `jn-hit` (OQ-5) will
    refuse the pick-up if it is going to.
- **Docs touched:** `rules/road-markings.md` (a marking gains a position of its
  own to drag, which its sign counterpart's text explicitly said it lacked);
  `rules/history.md` (the third drag key).

### Phase 2 — A marking anchored to the end of its road  (depends on Phase 1)

- **Scope:** `Marking.anchor`. **OQ-1 is settled (§2.4): the end node, not the
  rim** — the rim is Phase 5, and nothing in this phase touches `Diagram.tsx`.
  - `model/decoration.rs` / `types.ts` — `anchor?: "start" | "end"` on `Marking`
    (`decoration.rs:14`), `LinkAlign`'s shape (`model/layout.rs:94`) including an
    `is_start` predicate for `skip_serializing_if`. No `SCHEMA_VERSION` move
    (§2.3.1), asserted rather than assumed.
  - `geometry.ts` — `markingAnchor` (`:956-968`) resolves `along` through the
    anchor: `end` is `total - position * UNITS_PER_METRE`, walked from the same
    first point. Pure polyline arithmetic — no junction geometry.
    **There is no `polylineLength` helper to call.** The total is accumulated
    privately inside `pointAlongPolyline` (`geometry.ts:885-894`); either extract
    it or recompute it. Its `len < SAME_EDGE` (`1e-6`) filter skips degenerate
    segments, which makes no numerical difference to the sum — match it anyway so
    the two cannot drift.
  - `Inspector.tsx` — a two-segment Anchor row on a marking, so the field is
    reachable by hand rather than only by import. `associated_link`'s lesson: a
    field nothing can set is a field only a hand-edited file can set.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green.
  - `geometry.test.ts`: an `end`-anchored marking stays a fixed distance from the
    junction while a node moves, asserted by **moving the node** rather than by
    arithmetic; a `start`-anchored one is unchanged from today.
  - `model/mod.rs`: a `.zkai` with no `anchor` loads as `start`, and one saved
    with `start` writes **no key**.
  - **Every existing marking test still passes untouched** — the assertion that
    absent-means-today is real.
- **Docs touched:** `rules/road-markings.md`; markings OQ-5 gains its half-answer.

### Phase 3 — Import paints the lanes  (depends on Phase 2)

- **Scope:** the phase that makes the picture. All Rust.
  - `network/mod.rs` — `NetworkMovement.from_lanes` returns to the mirror as
    `#[serde(default)] pub from_lanes: Vec<LaneIdx>`, read and never stored. The
    departure from the mirror rule is §2.5's, and the struct doc comment
    (`:193-205`), which currently says all five lane fields are dropped "because
    nothing draws them", stops being true and is corrected in the same edit.
  - A **lane-index translation helper**, §2.5.1: `lanes.len() - 1 - file_index`,
    applied in **two** places — `lane_arrows`, and `import_link`'s lane array
    (`import.rs:114-125`), which has the same bug today and is fixed here rather
    than left disagreeing with the arrows. The reversal **renumbers `Lane.id` by
    new position** rather than copying it through (`import.rs:118`), per §2.5.1.
  - `network/import.rs` — `lane_arrows(junctions, links) -> Vec<Marking>` by
    §2.5's four steps, appended to `doc.markings`. Approach links only. Ids are
    minted Rust-side (`nextId` is `src/model/document.ts:130`, TypeScript only) —
    follow `import.rs`'s existing id minting rather than mirroring that function.
  - A Rust canonical direction order mirroring `TURN_DIRECTIONS`
    (`Inspector.tsx:115`, module-private), with a test pinning the two equal.
  - The offset by §2.4 — `1.5 × TURN_ARROW_LENGTH`, divided by
    `UNITS_PER_METRE` (`network/mod.rs:58`) because `position` is metres — and
    `anchor: "end"`.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green.
  - `import.rs`: `cross-4` yields one arrow per approach lane that has a turn,
    with the directions its movements imply, asserted **by naming a lane and its
    turns** rather than by counting. Concretely, from `cross-4.yaml:176-212`:
    approach `L1` file-lane 0 (`through` + `left`) lands on **Zukai lane 1**, and
    file-lane 1 (`through` + `right`) on **Zukai lane 0**. An assertion that
    would pass under an identity map is not an assertion of §2.5.1.
  - The four u-turns (`from_lanes: []`) paint nothing; a movement with **no**
    `from_lanes` key paints nothing either — the `bare` case
    `the_lane_and_priority_keys_are_ignored_either_way` already parses, extended
    to assert it also yields no arrow. **That existing test still passes.**
  - `import_link`: a link whose file lanes have **distinct widths** comes back
    reversed, so the file's outside lane is Zukai's lane 0, **and `lanes[i].id ==
    i` still holds** after the reversal. This is the only test that catches
    §2.5.1's second half, since every current fixture is uniform.
  - Two imports of the same file produce identical `markings` — the canonical
    direction order.
  - A `bun run tauri dev` pass: import `cross-4`, **drag the arms into a
    schematic shape**, and confirm the arrows stay at the junction. That is the
    check Phase 2 exists for and it cannot be made in a unit test.
- **Docs touched:** `rules/network-yaml.md` (the one field read back, why it is
  not a carried field, and the lane numbering the boundary now converts);
  `rules/road-markings.md`.

### Phase 4 — The arcs and the movement list go  (depends on Phase 3)

- **Scope:** removal only, plus one relocation. Roughly 245 "movement" line
  references in TS source (Inspector 56, state 87, geometry 40, Diagram 27,
  `styles.css` 24, types 8, `diagram.css` 3), ~142 in TS tests, ~79 in Rust.
- **If it overruns, the split is at the language boundary:** the TS removal
  (canvas, state, panel, styles) is one commit and the Rust removal plus the
  `MovementKind`/`MovementId` relocation is a second. Both leave the build green;
  neither leaves a junction unable to express its turns, because Phase 3 already
  paints them.
  - `Diagram.tsx` — `MovementShape`, `MOVEMENT_HEAD`, `byLink`, the `pad` gate;
    `diagram.css`'s three `.jn-movement*` rules.
  - `geometry.ts` — `movementArc`, `movementPath`, `MovementEnd`, `MovementArc`,
    `movementKind`, `movementId`, `legalMovements`, `derivableMovements`.
  - `state.ts` — `addMovement`, `deleteMovement`, `setMovementKind`,
    `deriveMovements`, `withMovements`, `dropMovements`, and their action arms.
  - `Inspector.tsx` — `MovementRows`, `MovementAdd`, `MOVEMENT_KINDS`;
    `styles.css`'s `.movement-*`.
  - `model/graph.rs` — `Junction.movements` (`:114`) and `Movement` (`:148`);
    `import.rs`'s `import_movement`; the corresponding `types.ts` types.
  - **`MovementKind` and `MovementId` are *relocated*, not deleted** — and this
    is the one part of Phase 4 that is not a removal. `NetworkMovement`
    (`network/mod.rs:207-218`) is built from both, and Phase 3 makes it
    load-bearing: the importer still parses movements to derive arrows, it just
    stops storing them. So `MovementKind` (`graph.rs:163`) and `MovementId`
    (`model/ids.rs:57`) move **into `network/mod.rs`**, where they stop being
    model types and become what they now are — the mirror's own vocabulary for a
    foreign format. `the_shared_enums_spell_what_assimilator_spells` moves with
    them.
    **`MovementId` may simply stay in `ids.rs`**, and that is the cheaper option:
    `string_id!` (`ids.rs:13`) is not `#[macro_export]`ed, so moving the newtype
    means hand-writing what the macro generates. It is an id type, not a turn
    enum, so the gate below does not ask it to move. `MovementKind` is the one
    that must.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green.
  - `Diagram.test.tsx`: a junction with a pad renders `jn-pad` → `jn-stopbar`
    with nothing between, and the whole `.jn-movement*` vocabulary is absent from
    an exported SVG.
  - **One turn vocabulary is left in the model.** Stated precisely, because it is
    not a runtime assertion: `TurnDirection` is the only turn enum under
    `src-tauri/src/model/` and `src/types.ts` — checked by grep during the pass,
    and recorded in `rules/junctions.md` rather than as a test. `MovementKind`
    surviving in `network/` is the intended outcome, not a miss: the two
    vocabularies the rule kept apart are no longer both in the model, which is
    what made them confusable.
  - A `.zkai` saved with `movements:` still loads (serde ignores the key), and
    saving it again drops them. No `SCHEMA_VERSION` move.
- **Docs touched:** `rules/junctions.md` loses its movement half entirely (72
  mentions across 456 lines — a rewrite, not a trim);
  `specs/junction_semantics_spec.md` gets a §0 closing note marking Phases 2–4
  cut, on `signal_plans_spec.md`'s model; `CLAUDE.md`; the project-memory roadmap.

### Phase 5 — The anchor finds the rim  (depends on Phase 4; deferred)

- **Why it is separate:** OQ-1's better answer, held back because it is a
  refactor rather than a feature. §2.4 records what Phase 2's end-node anchor
  costs until this lands: a pad larger than ~22 units draws the arrow on asphalt
  instead of ahead of it.
- **What unblocks it:** `junctionArms` (`Diagram.tsx:357`), `interface Arm`
  (`:331`) and the pad radius `rp` (`:934`) lift out of the React render body
  into `geometry.ts`. That is the whole of the work and the whole of the risk —
  `Diagram.test.tsx` rides on all three.
- **Scope:** the lift, then `markingAnchor` resolves an `end` anchor through
  `rayCircleExit` against the pad, **with a fallback to the end node** where the
  end node carries no pad (an `endpoint`, a roundabout, a gore — `Diagram.tsx`'s
  own `pad` gate names the exclusions). The stop bar and the arrow then measure
  from one expression, which is §2.4's original argument.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green.
  - `geometry.test.ts`: an `end`-anchored marking holds its clearance from the
    **rim** while the junction's Size stepper changes the pad radius — the check
    the end-node anchor cannot pass, asserted by changing `scale`.
  - A marking on a link ending at an `endpoint` node falls back to the node and
    is unchanged from Phase 2.
  - Every `Diagram.test.tsx` assertion passes untouched across the lift.
- **Docs touched:** `rules/road-markings.md`; `rules/junctions.md` (the pad
  geometry acquires a second caller); markings OQ-5 closes for auto-placed paint;
  mark this spec `implemented`.

## 5. Review log

### Round 1 — 2026-07-27 — `VERDICT: NOT READY` (4 blocking)

Clean-room reviewer with repo access. Grounding came back almost entirely clean:
every `Canvas.tsx`, `geometry.ts`, `state.ts` and `Inspector.tsx` citation
verified exact, both commit hashes say what the spec claims, and `cross-4` does
import with 16 movements whose four u-turns carry `from_lanes: []`.

**Blockers fixed:**

1. **The two lane numberings run in opposite directions.** Assimilator's lane 0
   is the leftmost/median (`network.rs:877`); Zukai's is the nearside kerb
   (`geometry.ts:197-200`). §2.5's derivation mapped indices straight through,
   which mirror-images every approach — invisibly, since `cross-4`'s lanes are
   uniform 3.5 m. Fixed by new **§2.5.1**, a translation helper applied in both
   `lane_arrows` and `import_link` (which carries the same bug today), a rewritten
   §1 example pinned to the fixture's real two-lane approach, and a Phase 3 gate
   that names lanes and turns so an identity map cannot pass it.
2. **Phase 4 deleted `MovementKind`/`MovementId`, which Phase 3 makes
   load-bearing.** `NetworkMovement` (`network/mod.rs:207-218`) is built from
   both and must survive, since the importer still parses movements to derive
   arrows. Fixed: they are **relocated into `network/mod.rs`**, and the
   "one turn vocabulary" gate reworded to "one in the *model*" — a grep, since it
   was never a writable runtime assertion.
3. **OQ-1 was unresolved while gating Phase 2, and its proposed answer cost more
   than §2.4 said.** The rim lives in module-private `Diagram.tsx` render code
   (`junctionArms:357`, `Arm:331`, `rp:934`), so routing `markingAnchor` through
   it is a refactor, not arithmetic. **RESOLVED**: end node in Phase 2, rim in a
   new **deferred Phase 5** that names the lift as its whole scope. §2.4 now
   records what the end-node anchor costs in the meantime.
4. **`from_lanes`' optionality was unspecified and the two governing rules
   disagreed.** Assimilator declares it required (`network.rs:1347`) and the
   mirror rule follows Assimilator; but `the_lane_and_priority_keys_are_ignored_either_way`
   deliberately pins that a bare movement parses. **RESOLVED**: it returns with
   `#[serde(default)]`, the departure recorded in §2.5 — the optionality clause
   existed to guarantee faithful *writing*, and the export is gone. Absent takes
   the same path as empty: paints nothing.

**Non-blocking, folded in:** corrected file citations (`Marking` is
`model/decoration.rs:14`, `LinkAlign` `model/layout.rs:94`, `MovementId`
`model/ids.rs:57`); §2.4 now cites `TURN_ARROW_LENGTH = 15` rather than
`ARROW_REACH` (a *lateral* fraction of band width), and states the two
conversions — `markingArrow` centres the shaft on `position`, and `position` is
metres; §2.3's "off the end of its own road" corrected to the clamp's actual
behaviour (`geometry.ts:897`); `nextId`/`TURN_DIRECTIONS` flagged TS-only so
Phase 3 mints its own; OQ-2 marked RESOLVED; Phase 1's identity return flagged as
a new pattern with no precedent to inherit; markings **OQ-6** named as the closer
neighbour to §2.3 than OQ-5; the `network/mod.rs:193-205` doc comment added to
Phase 3's docs-touched; a Phase 4 split point at the language boundary; and the
`jn-hit` dead zone recorded as **OQ-5** with Phase 1's dev pass as where it shows.

**Rejected:** nothing — every finding was accepted or resolved into an OQ.

### Round 2 — 2026-07-27 — `VERDICT: READY` (0 blocking) — **converged**

Same reviewer resumed. All four blockers confirmed resolved, with the resolutions
re-verified against the code rather than taken on the changelog's word. Three
checks worth keeping:

- **§2.5.1's translation is right in both directions**, because `n - 1 - i` is an
  involution — which is *why* one helper can serve both call sites without a
  second formula. The worked numbers were re-derived from the fixture, including
  that §1's "kerb at the bottom" is correct: `DRIVE_SIDE = 1` and a right-of-travel
  normal of `(-dir.y, dir.x)` put lane 0 at `+y` for eastbound travel.
- **The distinct-width `import_link` test really is the only catcher.**
  `t_junction.yaml`'s links are single-lane (reversal is a no-op), `cross-4`'s are
  uniform, and no existing test asserts lane order — so the reversal breaks
  nothing silently.
- **§2.4's cost is exact, not hand-waved**: `rp = max((maxW * 0.62 + 3) * scale,
  reach)` is 16.0 for a 2-lane road and 27.2 for a 4-lane one, against the
  `1.5 × 15 = 22.5` offset. A wide road does reach it.

**Two non-blocking implementation facts folded in afterwards:** there is no
`polylineLength` helper — the total lives inside `pointAlongPolyline`
(`geometry.ts:885-894`) and Phase 2 must extract or recompute it; and `string_id!`
(`ids.rs:13`) is not `#[macro_export]`ed, so Phase 4 leaves `MovementId` in
`ids.rs` (it is an id, not a turn enum) and moves only `MovementKind`.

The reviewer also flagged that `import_link`'s reversal should say what happens to
`Lane.id` — already folded into §2.5.1 during the sweep, and answered more
strongly than asked: ids are **renumbered by new position**, because `Lane.id` is
documented as the index (`graph.rs:69-70`) and every reader is positional
(`Diagram.tsx:753`, `state.ts:977`), so copying ids through a reversal would hide
a second silent failure inside the fix for the first.

**Status moved `draft` → `reviewed`. Cleared for Phase 1.**
