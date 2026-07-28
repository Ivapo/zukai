---
status: draft
last_updated: 2026-07-27
note: "Lane arrows become how a junction's turns are shown — painted on the approach lanes, seeded from an imported network, and replacing the dashed arcs across the pad. Includes the two things that have to exist first: a marking you can drag, and a marking that measures from the junction end."
implemented: []
not_implemented: ["Phase 1", "Phase 2", "Phase 3", "Phase 4"]
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

End state — importing `cross-4` and looking at one approach:

```
Import network… ▸ cross-4.yaml          (16 turns in the file)

        lane 0  ↰            ← left only
        lane 1  ↑            ← through
        lane 2  ↑↱           ← through and right
   ═══════════════════════
        ▓▓▓▓▓▓▓▓▓▓▓▓▓        ← the junction pad, with no arcs across it

Each arrow is an ordinary `Marking`: select it, drag it, re-pick its
directions, or delete it. Nothing re-derives it afterwards.
```

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
(`rules/network-yaml.md`). Shorten that arm and an arrow minted at 1200 units is
off the end of its own road.

Dragging is **not** the answer to this. Import a four-arm cross, get eight to
sixteen arrows, drag the nodes into shape, and every arrow needs re-dragging —
which is precisely the tedium Phase 3 exists to remove.

#### 2.3.1 `Marking.anchor` (decision, recorded)

A new optional field, `anchor?: "start" | "end"`, absent meaning `start` — today's
behaviour, byte-identical for every existing document. `LinkAlign`'s shape
exactly (`centre`/`nearside`/`offside`, absent = centre, `is_centre` as the
`skip_serializing_if`), for `LinkAlign`'s reason.

**No `SCHEMA_VERSION` bump**, and the rule is stated in `model/mod.rs`: a new
optional *field* is not a breaking change, because nothing derives
`deny_unknown_fields` and an older build ignores what it does not know. A new
**variant of an existing enum** is what costs a bump; a brand-new enum reached
only through a brand-new optional field is not that.

**It fixes stop lines too**, which is what makes it worth a field rather than a
one-off in the importer. A stop line wants to sit at the junction; it has wanted
that since road markings shipped, and markings OQ-5 ("snapping a marking to a
junction's rim") is the open question this half-answers.

### 2.4 Where the arrow sits, and why it is not a distance

Links are not to scale, so **no metre value is meaningful here**. The offset is
derived from the arrow's own drawn size: it sits **one arrow-length clear of the
junction**, so the paint and the gap before it read as one unit whatever the road
is.

That is markings §2.4's rule collecting again — *containment is a property of the
tiling, not a clamp applied to it* — and it is why `ARROW_REACH` (`geometry.ts:1143`)
is the model to follow rather than a new constant expressed in metres.

**What "the junction" means here is OQ-1**, and it is the one genuinely open
question in this spec. Two candidates:

- **the end node**, which is what `anchor: "end"` naturally means and is pure
  arithmetic on the polyline;
- **the junction's rim**, `rayCircleExit` — the identical expression the stop bar
  is placed with, so the two cannot come to disagree about where a road meets the
  glyph (`rules/junctions.md`).

The rim is what both the arrow and the stop line actually want, and it is the
only one that survives the junction's **Size** stepper, since the pad radius sits
between the node and the road. It also costs more: the rim exists only where the
end node carries a junction glyph with a pad, so `anchor: "end"` needs a fallback
to the node for an endpoint.

### 2.5 What import paints, and from what

One field comes back into the mirror: **`NetworkMovement.from_lanes`** — which
lanes of the approach feed a given turn. Read, converted to paint, and **never
stored**, which is the read-only mirror's own rule (`mirror what is drawn`,
`rules/network-yaml.md`) in its cleanest case.

The derivation, per junction:

1. Group the file's movements by `from_link` — **approach links only**, which
   falls out for free, since a movement's `from_link` is by definition the road
   arriving.
2. For each approach, group by lane index across every movement's `from_lanes`.
3. Map each movement's `type` to a `TurnDirection`: `through`/`left`/`right`
   pass through, `u-turn` → `u_turn`. Four kinds, four directions.
4. Mint one `turn_arrow` per lane that has at least one direction, in
   `TURN_DIRECTIONS`' canonical order (`Inspector.tsx`), so two imports of the
   same file produce identical documents.

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
  form. Phase 2 gives auto-placed paint a stable anchor; a human dragging paint
  onto the rim still lands where they dropped it.

## 3. Open questions

- **OQ-1** — **Does `anchor: "end"` measure from the end node or the junction
  rim?** §2.4 lays out both. Proposed: **the rim**, with a fallback to the node
  where there is no pad — it is what the stop bar already uses, and it is the
  only reading that survives the Size stepper. Cost: the anchor stops being
  arithmetic on the polyline and needs the junction's geometry.
  (design-call; **needs settling before Phase 2**, since it is Phase 2's whole
  behaviour.)
- **OQ-2** — **Does a drag change a marking's `lane`, or only its `position`?**
  §2.2 proposes both, on the grounds that the lane already falls out of a click.
  The alternative is that a drag runs along the road only and the Span control
  changes lanes, which is more predictable and less direct.
  (design-call.)
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
    absent-key rule, `setMarkingLane`'s shape. An unknown marking, and a drag
    that lands on the same `(position, lane)`, both return `state` by identity.
  - `coalesceKeyFor` — `markingDrag:<id>`, the **third** drag key beside
    `moveNode` and `moveSign` (`rules/history.md`), so one drag is one undo step.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green.
  - `state.test.ts`: a drag writes both fields; a drag onto the same place
    returns `doc` by identity; a run of drags collapses to one undo step, and the
    leading `select` is what opens it (`rules/history.md`'s "the run is broken by
    the leading `select`").
  - A `bun run dev` pass: drag a stop line along a road and across a divider.
- **Docs touched:** `rules/road-markings.md` (a marking gains a position of its
  own to drag, which its sign counterpart's text explicitly said it lacked);
  `rules/history.md` (the third drag key).

### Phase 2 — A marking anchored to the junction  (depends on Phase 1)

- **Scope:** `Marking.anchor`, and **OQ-1 settled first**.
  - `graph.rs`/`types.ts` — `anchor?: "start" | "end"`, `LinkAlign`'s shape
    including `is_start` for `skip_serializing_if`. No `SCHEMA_VERSION` move
    (§2.3.1), asserted rather than assumed.
  - `geometry.ts` — `markingAnchor` resolves `along` through the anchor. Needs
    the polyline's length, and — if OQ-1 lands on the rim — the same
    `rayCircleExit` the stop bar uses.
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

- **Scope:** the phase that makes the picture.
  - `network/mod.rs` — `NetworkMovement.from_lanes` returns to the mirror, read
    and never stored.
  - `network/import.rs` — `lane_arrows(junctions, links) -> Vec<Marking>` by
    §2.5's four steps, appended to `doc.markings`. Approach links only; ids from
    `nextId` over the document's markings.
  - The offset by §2.4, `anchor: "end"`.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green.
  - `import.rs`: `cross-4` yields one arrow per approach lane that has a turn,
    with the directions its movements imply, asserted **by naming a lane and its
    turns** rather than by counting; its four u-turns paint nothing; a lane with
    no movements gets no marking.
  - Two imports of the same file produce identical `markings` — the canonical
    direction order.
  - A `bun run tauri dev` pass: import `cross-4`, **drag the arms into a
    schematic shape**, and confirm the arrows stay at the junction. That is the
    check Phase 2 exists for and it cannot be made in a unit test.
- **Docs touched:** `rules/network-yaml.md` (the one field read back, and why it
  is not a carried field); `rules/road-markings.md`.

### Phase 4 — The arcs and the movement list go  (depends on Phase 3)

- **Scope:** removal only. Roughly 250 references in source and 140 in tests.
  - `Diagram.tsx` — `MovementShape`, `MOVEMENT_HEAD`, `byLink`, the `pad` gate;
    `diagram.css`'s three `.jn-movement*` rules.
  - `geometry.ts` — `movementArc`, `movementPath`, `MovementEnd`, `MovementArc`,
    `movementKind`, `movementId`, `legalMovements`, `derivableMovements`.
  - `state.ts` — `addMovement`, `deleteMovement`, `setMovementKind`,
    `deriveMovements`, `withMovements`, `dropMovements`, and their action arms.
  - `Inspector.tsx` — `MovementRows`, `MovementAdd`, `MOVEMENT_KINDS`;
    `styles.css`'s `.movement-*`.
  - `graph.rs`/`types.ts` — `Junction.movements`, `Movement`, `MovementKind`,
    `MovementId`; `import.rs`'s `import_movement`.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green.
  - `Diagram.test.tsx`: a junction with a pad renders `jn-pad` → `jn-stopbar`
    with nothing between, and the whole `.jn-movement*` vocabulary is absent from
    an exported SVG.
  - **One turn vocabulary is left.** A test asserting `TurnDirection` is the only
    turn enum in the model — the section `rules/junctions.md` devotes to keeping
    two apart becomes a deletion.
  - A `.zkai` saved with `movements:` still loads (serde ignores the key), and
    saving it again drops them. No `SCHEMA_VERSION` move.
- **Docs touched:** `rules/junctions.md` loses its movement half entirely;
  `specs/junction_semantics_spec.md` gets a §0 closing note marking Phases 2–4
  cut, on `signal_plans_spec.md`'s model; `CLAUDE.md`; the project-memory roadmap;
  mark this spec `implemented`.

## 5. Review log

Not yet reviewed. Run `/review-spec specs/lane_arrows_spec.md` before planning
Phase 1 — `status` must reach `reviewed` first (`CLAUDE.md`, standing
plan-mode rule).
