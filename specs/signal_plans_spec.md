---
id: zk-010
title: signal-plans
status: accepted
last_updated: 2026-07-31
note: >
  Fixed-time signal plans. All four phases were cut — a plan is a table, its
  only drawable form is a stage diagram, and this project prints network
  figures. Kept as the record of why: read §0 and stop there.

phases:
  - name: "Phase 1 — A plan, and the stages in it"
    reviewed: 2026-07-27
    shipped: 2026-07-27
    cut: 2026-07-27
    by: zk-010
  - name: "Phase 2 — Which movements run when"
    reviewed: 2026-07-27
    shipped: null
    cut: 2026-07-27
    by: zk-010
  - name: "Phase 3 — The plan on the canvas"
    reviewed: 2026-07-27
    shipped: null
    cut: 2026-07-27
    by: zk-010
  - name: "Phase 4 — Derive a plan"
    reviewed: 2026-07-27
    shipped: null
    cut: 2026-07-27
    by: zk-010

extends: null
supersedes: null
superseded_by: null
related: [zk-008, zk-009, zk-006]
reference: "Assimilator's `crates/config/src/network.rs` — `SignalPlanConfig` (`:1380-1393`) and `PhaseConfig` (`:1395-1421`) — plus `crates/network/src/validation.rs`, whose rule 4 (`:14`, computed at `:425-436`, tolerance `CYCLE_TIME_TOLERANCE = 0.01` at `:30`) and dangling-movement check (`:437-457`, `UnknownGreenMovement`) are the two things an editor here can break. Read at `../assimilator` on 2026-07-27. Explicitly *not* in scope from it: actuated and adaptive control, `detectors`, the per-junction `b_amber`/`enforce_entry_guards` simulation fields, and corridor coordination beyond carrying `offset`."
---

# Signal Plans Spec

## 0. Closing note — the whole spec is cut (2026-07-27)

**Read this and stop.** All four phases are gone. Phase 1 shipped in the morning
and was reverted the same day; 2, 3 and 4 were never started. Everything below is
kept as the record of a well-reviewed spec that was aimed at the wrong target,
and it still argues for building all of it. It is not a plan.

**The question that ended it**, asked by the user and correct: *what use are the
signal phases when they are not shown in a figure?* Zukai exists to produce
readable figures for a paper. Trace this spec against that:

- **Phases 1–2 are a panel**, a table of stage timings. Nothing printed.
- **Phase 3 is the only drawing — and §2.5 excludes it from every export on
  purpose.** `previewPhase` rides on `Interaction`, `diagramSvg(doc, bounds)`
  takes no `Interaction`, and `interaction` absent *is* export mode. Its own exit
  gate asserts "an export drops the preview". So the one drawable part of this
  feature **cannot reach a figure**, by design. That was recorded as the spec's
  best structural idea, and it is the same fact read the other way round.
- **Phase 4 fills the table faster.**

**The alternative that was considered and rejected**: re-scope Phase 3 to a
**stage diagram** — small multiples, one miniature junction per stage, exported
as one figure. That *is* the conventional form and it *would* print. The user
declined it: the goal is drawing road networks that fit in a figure, not
publishing signal phasing. Recorded here so it is not proposed a second time.

**Why Phase 1 went too, having been kept for a day.** It was spared at first
because it fixed a real bug — `setJunctionControl`'s unsignalized branch kept a
`signal_plan` that should not exist. But the bug only existed *because* the field
did. With `Junction.signal_plan` gone from both mirrors there is nothing to leave
behind, so the fix is not lost, it is unnecessary. What remained was a panel
editing stage timings for a cycle that could not say what ran in it.

**The two bugs Phase 2 was going to fix are moot**, for the same reason: nothing
in the model holds a movement id inside a stage any more, so `deleteMovement` and
`dropMovements` have no stale reference to leave.

**The lesson, generalised**, and it is in `CLAUDE.md` now: before planning a
spec's phases, ask **which phase produces the picture**. A phase whose output is
a panel, a table, or a file no reader ever sees needs an argument, not an
assumption. Three review rounds and six blocking findings on this spec all
concerned whether the design was *correct*; none asked whether it was *wanted*.

## 1. Goal

Zukai can say a junction is **signalized** and can draw it as one — `control:
signal` has been settable since junction semantics Phase 1, and
`Diagram.tsx:1020` paints a `.jn-stopbar` across every arm of a
`signalized_cross`. What it cannot say is **what the signal does**.

`Junction.signal_plan` has been in both mirrors since the first commit
(`graph.rs:234-265`, `types.ts:97-111`) and **nothing in `src/` reads it** — a
grep for `signal_plan` outside the type declaration returns nothing. So the field
is carried and never consulted, which has two consequences that are now live
rather than theoretical:

- **An imported plan is invisible.** `cross-4.yaml:531` is a real 60-second plan
  with two 25 s stages, and importing it puts a plan in the document that no
  panel shows, no drawing reflects, and no control can edit.
- **An authored signalized junction exports broken.** Zukai mints no plan, so a
  junction drawn here as `control: signal` writes `signal_plan` absent — which
  parses cleanly and, as `network_yaml_spec.md` §2.3.2 puts it, leaves **every
  approach reading red**. That is the silent-failure column of that spec's own
  §2.2, and it is the **most consequential** entry still open on it — not the
  last: `priority`, `yields_to` and `lane_mapping` remain carried-not-edited
  (that spec's OQ-8, and `rules/junctions.md`'s list of fields nothing consumes),
  and this spec does not close them.

End state — the junction panel gains a plan, and the canvas gains a way to see it:

```
Select a signalized junction ▸ Inspector

  Control    [ Signal ] [ Unsignalized ]
  Movements  M_L1_L3  through   ×
             M_L1_L6  left      ×
             …                          [ Derive all turns ]

  Signal plan                    cycle 60 s · offset 0 s   [ Remove ]
    ▸ P1   green 25   amber 3   all-red 2
        M_L5_L3  ● protected      M_L5_L2  ◐ permitted
        M_L5_L7  ● protected      M_L1_L3  ○ —
    ▸ P2   green 25   amber 3   all-red 2
        …
                                             [ + Stage ]  [ Derive plan ]

  cycle 60 s is *derived* — the sum of every stage's green+amber+all-red — and
  is the one number the panel will not let you type (§2.2). Assimilator rejects
  a plan whose stages do not sum to it (validation rule 4), so the invalid state
  is made unrepresentable rather than validated after the fact.

Click a stage row → the canvas shows that stage: its protected movements draw
their arcs bright, its permitted ones muted, everything else stopped, and the
signalized glyph's stop bars follow (§2.5). Which stage is previewed is editor
state, never document state — it does not dirty, and does not enter undo.
```

## 2. Design

### 2.1 The model already exists, on both sides, and this spec adds no field

`SignalPlan` (`graph.rs:234-244`) is `cycle_time: f64`, `offset: f64`
(`#[serde(default)]`) and `phases: Vec<Phase>`. `Phase` (`:246-265`) is `id:
PhaseId`, `duration: f64`, `green_movements: Vec<MovementId>`,
`permitted_movements: Vec<MovementId>`, `amber_time: f64` (`default = 3.0`,
`:280-282`) and `all_red_time: f64` (`default = 2.0`, `:284-286`). The
TypeScript mirror is `types.ts:97-111`, field for field.

Three things follow, and together they size this spec:

- **No `SCHEMA_VERSION` bump.** Still 2. Nothing here adds a field to `Document`
  or a variant to an enum — the two things `ramps_and_tapers_spec` OQ-3
  established as the difference between a bump and no bump.
- **No Rust.** The reducer is TypeScript, the panel is TypeScript, and the
  format's writer already emits a plan correctly (`network_yaml_spec.md` Phase
  3, whose gate round-trips `cross-4`'s plan unchanged). This is the shape
  `road_markings_spec` and `signs_and_text_spec` both had.
- **`green_movements` and `permitted_movements` are optional in the TS mirror**
  (`types.ts:100-101`), because Rust elides an empty vec. Every read in the panel
  is `?? []`, the rule `movements` already follows in `JunctionFields`
  (`Inspector.tsx:1084`).

### 2.2 `cycle_time` is derived, never typed (decision, recorded)

Assimilator validates that **every stage's `duration + amber_time + all_red_time`
sums to `cycle_time`** (`validation.rs:14`, computed at `:425-436`, tolerance
0.01 s at `:30`). `cross-4` satisfies it exactly: 2 × (25 + 3 + 2) = 60.

An editor that lets a human type `cycle_time` therefore lets them write a file
Assimilator refuses — and refuses *late*, at load, not at the keystroke. The two
answers are validate-after-the-fact (a warning in the panel) or **make the
invalid state unrepresentable**. This spec takes the second: **the panel shows
`cycle_time` as a readout and every plan-editing action recomputes it** from the
stages. There is no cycle-time input.

That is markings §2.4's rule collecting again — *containment is a property of the
tiling, not a clamp applied to it*. It also means rule 4 cannot be broken by
anything a user does here, so no phase of this spec needs a validation pass.

**The one case it does not cover, and what happens there.** A hand-edited or
foreign `network.yaml` may arrive with stages that do not sum. Import does not
touch it (§2.6), so the document holds the file's own number until the first
plan edit, which recomputes. Recorded as **OQ-1** rather than silently
"corrected", because rewriting a number the user did not ask us to touch is how a
round-trip claim rots.

### 2.3 A stage assigns each movement one of three roles

`PhaseConfig.green_movements` is **protected** green ("proceed without checking
conflicts"); `permitted_movements` is **permitted** green ("must gap-accept
against conflicting protected streams"). Both are per-stage lists of
`MovementId`. `cross-4` uses both on every stage — four protected and four
permitted each — so this is not a distinction the fixtures let us skip.

So the panel's unit is not a list but a **tri-state per (stage, movement)**:

| Role | Written to | Meaning |
|---|---|---|
| protected | `green_movements` | right of way, no gap acceptance |
| permitted | `permitted_movements` | green, but yields to conflicting protected |
| off | neither | red this stage |

**A movement in neither list is red**, which is why "off" needs no storage and
why an empty stage is an all-red stage. One action carries the whole tri-state
(`setPhaseMovement`), on the precedent of `setMarkingKind` carrying the whole
tagged `MarkingKind` rather than growing an action per field
(`road_markings_spec` Phase 2).

**`permitted_movements` is edited, not merely carried.** It is the one field in
this area that `network_yaml_spec.md` §2.3.2 left in the carried bucket, and the
reason to promote it is `cross-4`: a plan whose permitted movements are dropped
to protected is a materially more dangerous junction, and one whose permitted
movements are dropped to *off* is a slower one. Neither would fail to parse.

### 2.3.1 Creating a plan **does** guard on `control`, and that departs from precedent on purpose (decision, recorded)

`setJunctionRule` deliberately does not look at `control` (`state.ts:689-699`,
and the doc-comment there argues it at length): encoding a sibling field's state
into an action that does not own it makes the same value legal or illegal
depending on something it never touches, so the *panel* withholds the row.

**`createSignalPlan` does the opposite: it returns `state` by identity unless
`junction.control === "signal"`.** The asymmetry is not inconsistency, and the
difference is in the other program. A `rule` on a signalized junction is inert —
Assimilator reads `rule` only for unsignalized control. A **`signal_plan` on an
unsignalized junction is not inert**: `validation.rs:424` enters the rule-4 block
on `if let Some(ref signal_plan)` with **no `control` check at all**, so a stray
plan is validated, and a stray plan whose stages do not sum makes the whole file
fail to load. `graph.rs:115-117` already says the field is "`None` unless
signalized"; this is the action that makes that true rather than aspirational.

The panel withholds the control as well — both, not either, exactly as the Rule
row is withheld *and* `setJunctionControl` clears the field.

### 2.4 Three cascades, and two of them are live bugs today

A phase names movements by id, so **anything that removes a movement must purge
it from every stage**. Assimilator checks exactly this
(`validation.rs:437-457`, `UnknownGreenMovement`), so a stale id is not benign:
it is a file that fails to load.

Neither existing cascade does it, and both are reachable now:

- **`deleteMovement`** (`state.ts:810-830`; the reducer case is `:455`) removes
  the movement through `withMovements` (`:734-744`), which rewrites `j.movements`
  and touches nothing else. Import `cross-4`, delete one movement, export →
  `UnknownGreenMovement`.
- **`dropMovements`** (`:1062-1074`), the link-deletion cascade, filters stranded
  movements out of `j.movements` and likewise leaves the plan alone. Same result,
  one step earlier.

There is a **third**, and it is a different kind of wrong:

- **`setJunctionControl`** (`:656-677`) drops `rule` when moving to `signal`
  (`const { rule: _dropped, ...rest } = j`) but the unsignalized branch is
  `{ ...j, control }` — so **`signal_plan` survives the flip**. `graph.rs:115-117`
  says the field is "`None` unless signalized", and Assimilator validates rule 4
  against any plan present regardless of `control`. Flipping an imported
  `cross-4` to unsignalized therefore keeps a plan that should not exist.

**The decision: all three are fixed in this spec, and the clearing belongs where
the analogous clearing already lives.** Dropping the plan on a flip to
unsignalized is `setJunctionControl`'s job for exactly the reason clearing `rule`
is (`rules/junctions.md`: "clearing `rule` belongs to the control action but
guarding it does not"). Purging phase references belongs to the two movement
cascades, as a helper they share.

**The identity trap comes with them.** `dropMovements` opens with
`if (!junctions.some(…)) return junctions` precisely so a link deletion in a
document with no affected movement hands history an identical array
(`rules/junctions.md`'s third cascade answer). A purge written as an
unconditional `map` over phases passes every behavioural test and dirties the
document on every unrelated delete. Phase 2's gate asserts the reference.

### 2.5 The preview stage is editor state, not document state (decision, recorded)

"Which stage am I looking at" is a question about the *view*, like `tool` and
`selection` — not about the network. Putting it in `Document` would dirty the
document on a click, push an undo snapshot for a preview, and export a field
Assimilator has no place for.

So: **a new `EditorState` field**, `previewPhase: { node: NodeId; phase: PhaseId
} | null`, set by clicking a stage row and cleared by `install()` (the
file-boundary reset all three whole-document actions share, `state.ts`) and by
selecting something else. It is **not** a fifth `Selection` arm — a stage is not
an object on the canvas and has no hit target, the same argument junction
semantics §2.3 made for movements getting no arm.

It cannot be local `useState` in the Inspector, which is where `MovementAdd`'s
two picks live: the *drawing* has to react.

**How it reaches the drawing, and the dividend that falls out.** `Diagram` does
not read `EditorState` — its props are `{ doc, interaction }`
(`Diagram.tsx:104-110`), and `Canvas` is what holds the state and builds the
`interaction` object (`Canvas.tsx:277`). `Interaction` (`Diagram.tsx:81-84`)
already carries exactly this class of thing: `selection`, `linkFrom`, `cursor` —
editor state the drawing reflects but the document does not hold. **`previewPhase`
joins them there**, and that is not merely tidy:

> `interaction` **absent means export mode** (`Diagram.tsx:103`), and the
> exporter calls `diagramSvg(state.doc, …)` with no interaction at all
> (`files.ts`).

So a preview carried on `interaction` is **automatically absent from every
exported SVG and PNG**, with no gate, no flag and no second code path — the same
way the selection halo already is. That answers the question Phase 3 was
otherwise going to have to settle about `rules/diagram-export.md`.

**When the previewed stage stops existing** — `deletePhase`, `removeSignalPlan`,
or an undo past the plan's creation — the field is *not* patched up by those
actions. The drawing looks the stage up by id and finds nothing, which renders
exactly as no preview; the panel does the same. A dangling `previewPhase` is
inert by construction, which is cheaper than three actions each remembering to
clear it.

### 2.6 What import and export do (nothing new)

Both directions already carry a plan correctly and this spec changes neither:

- Import maps `SignalPlanConfig`/`PhaseConfig` straight across (the mirror reuses
  no enums here — a plan is all scalars and id lists).
- Export writes `green_movements` **always**, `[]` legal and absent not, which is
  `network_yaml_spec.md` §2.3.2's rule and is already held by the mirror's bare
  field declaration.
- The `cargo test` round-trip on `cross-4`'s plan already exists and must stay
  green. It is this spec's regression net for the format half, which is why no
  phase here adds a Rust test.

### 2.7 What a new plan is seeded with

"Create plan" has to produce something, and the something must satisfy §2.2 the
moment it exists. Proposed: **one stage, `duration: 20`, `amber_time: 3`,
`all_red_time: 2`** — so `cycle_time` is 25 — **with no movements at all**.

That is an all-red junction, which is deliberately useless and deliberately
honest: it is a *frame*, and filling it is either two clicks per movement (Phase
2) or one click on Derive (Phase 4). The alternative — seeding every movement
protected in a single stage — produces a plan that runs and is *wrong*, a
junction where every conflicting stream has right of way simultaneously. A
useless plan the panel visibly nags about beats a plausible plan that lies.

The amber and all-red numbers are **Zukai's own** serde defaults
(`graph.rs:280-286`) — *not* Assimilator's, whose `PhaseConfig.amber_time` and
`all_red_time` carry no `serde(default)` at all (`network.rs:1417-1419`) and are
required. They are reused here because they match what `cross-4` actually
writes, which is a weaker claim than "the format's defaults" and the accurate
one. Recorded as **OQ-4**.

### 2.8 Non-goals

- **Actuated, adaptive, or vehicle-responsive control.** Assimilator's plan model
  is fixed-time and so is this. Detectors are already a `network_yaml_spec.md`
  §2.8 non-goal and stay one.
- **Corridor coordination.** `offset` is carried and editable as a number
  (**OQ-5**), but there is no notion of a corridor, no cross-junction
  relationship, and no way to see two junctions' cycles against each other.
- **A signal head that shows the previewed stage.** One already exists and this
  spec leaves it exactly as it is. `SignalHead` (`Diagram.tsx:1048`, defined
  `:1177-1214`) draws a body and **three lamps, all lit**, once per
  `signalized_cross` — at a fixed 45° offset from the node, not per arm. That
  is the point: **one head cannot show four arms' aspects**, so it is a badge
  meaning "this junction is signalized", not a state display, and colouring it
  from the previewed stage would be a claim about an arm it does not belong to.
  Phase 3 therefore leaves `SignalHead` untouched and says so in its gate, so
  the all-lit head beside preview-coloured stop bars reads as intended rather
  than as a bug. A head **per arm**, which could carry an aspect, is a glyph
  change and is **OQ-6**.
- **Conflict checking.** Whether two protected movements conflict is
  Assimilator's model to answer (`conflict_pairs`, a standing non-goal). Zukai
  will happily let a human put two crossing movements in one stage — the same
  posture the whole editor takes towards semantics it does not simulate.
- **Per-lane signals.** A movement is the unit, as it is for Assimilator.
- **A second junction's plan on screen at once.** One previewed stage, on the
  selected junction.

## 3. Open questions

- **OQ-1** — **An imported plan whose stages do not sum to `cycle_time`.**
  §2.2 leaves the file's number alone until the first edit, then recomputes.
  The alternative is to normalize on import, which makes every such file
  round-trip *changed*. Proposed: **leave it**, and let the first edit fix it.
  (design-call.)
- **OQ-2** — **Does a stage carry a human-readable name?** Assimilator's
  `PhaseConfig` has only `id` (`:1403`), and an extra label would be a
  Zukai-only field on a semantic record — the thing the two-layer schema exists
  to avoid. Proposed: **no**; `P1`/`P2` and the movement list are the identity.
  (design-call.)
- **OQ-3** — **Is a one-stage plan legal?** Structurally yes (rule 4 only asks
  that it sums), and it is what §2.7 seeds. It means one stage green forever.
  Proposed: **allow it** — it is a frame, not a claim. (answerable-from-code;
  confirmed against `validation.rs:425-436`, which imposes no minimum.)
- **OQ-4** — **What does a fresh plan contain?** (design-call; **RESOLVED**:
  §2.7's one empty stage, 20/3/2. The alternative — every movement protected in
  one stage — produces a plan that runs and is *wrong*, which is worse than one
  that is visibly unfinished. Phase 1's scope commits to it.)
- **OQ-5** — **Is `offset` editable or carried?** It is meaningless for the
  single-junction fragments Zukai represents (`CLAUDE.md`: "parts of networks"),
  which argues carried-not-edited. (design-call; **RESOLVED — shown and
  editable**: it is one number, the panel already has the stepper idiom
  (`SignKph`, `Inspector.tsx:749-780`), and a readout of an unsettable field is
  what `associated_link` taught us not to build twice. Phase 1's `setPlanOffset`
  is the commitment.)
- **OQ-6** — **A signal head per arm.** The existing `SignalHead` is one badge
  per junction with all three lamps lit, and §2.8 keeps it that way because one
  head cannot show four arms. A head *per arm* could carry the previewed stage's
  aspect and would be the most legible form this feature could take — but it is a
  change to the glyph vocabulary, which is a rendering pass (ramps OQ-7, junction
  OQ-5), not a semantic one. (design-call; deferred, and the reason is scope
  rather than doubt.)
- **OQ-7** — **Does deleting the last stage delete the plan?** Proposed: **no** —
  a plan with no stages is a plan with `cycle_time: 0`, and the panel has an
  explicit Remove control. Auto-removing would make the Remove button's job
  ambiguous and would surprise a user mid-edit. Note the limit of what is known:
  `cycle_time: 0` **passes** rule 4 (`|0 − 0| < 0.01`), so such a file loads —
  what Assimilator's *runtime* does with a zero-length cycle is untested by any
  gate here, and no fixture has one. (design-call.)
- **OQ-8** — **Derive's grouping rule (Phase 4), settled here rather than in the
  phase.** Group movements by **approach link**; pair two approaches into one
  stage when their bearings differ from 180° by **≤ 30°**; every approach left
  unpaired becomes its own stage. Within a stage the role follows the movement's
  kind, and **`MovementKind` has four variants, so the rule must name four**
  (`graph.rs:222-232`, `types.ts:65`): `through` and `right` are **protected**;
  `left` **and `u-turn`** are **permitted**. Timings are §2.7's 20/3/2 per stage,
  so `cycle_time` follows by construction.

  **That is what `cross-4` does, read properly** — and the draft of this OQ had
  it wrong, citing the same lines for a three-kind rule. Pairing its movement ids
  to their declared types, P1's four permitted are `M_L5_L2` (left), `M_L5_L6`
  (**u-turn**), `M_L8_L3` (left) and `M_L8_L7` (**u-turn**); P2's are the same
  shape. So its permitted list is *two lefts plus two u-turns*, not four lefts,
  and a three-kind rule would have left two movements of every stage with no role
  at all.

  The gap was invisible to every gate below, which is the reason it is called out
  rather than quietly fixed: the count assertions use a 12-movement cross, and
  `derivableMovements` (`geometry.ts`) **strips u-turns**, so a junction whose
  movements were derived has none to mis-assign. Only an *imported* junction
  reaches the case — `cross-4` has four — which is exactly what the closing gate
  runs.

  **The counts that rule actually implies**, since the draft of this OQ got its
  own worked example wrong: an orthogonal 4-arm cross gives **2** stages (two
  opposing pairs). An orthogonal 3-arm T gives **2** as well — the two opposing
  approaches pair, and the stem is the unpaired remainder — *not* three. That is
  also the right answer in traffic terms (a major-road stage and a minor-stem
  stage), which is why the corrected rule needs no special case for a T. A Y or a
  skewed junction whose approaches all fall outside the 30° band degenerates to
  one stage per approach, which is safe, slow, and honest. (design-call;
  **RESOLVED** — Phase 4 implements exactly this and its gate asserts both counts
  against named bearings.)
- **OQ-9** — **Does the drawn stage need to survive deselection?** §2.5 clears
  `previewPhase` when the selection changes, so panning away from the junction
  loses the preview. That is consistent with the Inspector being the plan's only
  home, but it also means the drawing cannot be compared between stages
  side-by-side. (design-call; proposed: **clear it**, and revisit only if the
  dev pass finds it annoying.)

## 4. Implementation phases

Strictly sequential; each is one plan-mode pass with a concrete exit gate.

### Phase 1 — A plan, and the stages in it

- **Scope:** the plan as an editable record, and the panel frame that shows it.
  **TypeScript only** — no Rust, no `SCHEMA_VERSION` move (§2.1).
  - `src/editor/state.ts` — `createSignalPlan`, `removeSignalPlan`, `addPhase`,
    `deletePhase`, `setPhaseTiming` (one action carrying `duration`/`amber_time`/
    `all_red_time`, on `setMarkingKind`'s whole-payload precedent), `setPlanOffset`.
    A `withSignalPlan(junctions, id, plan)` helper mirroring `withMovements`
    (`:734-744`), **absent-is-the-one-representation** included: a removed plan
    drops the key rather than storing `undefined`.
  - **`cycleTime(plan)`** — the derivation of §2.2, applied by every action above.
    One function, so the invariant has one owner.
  - **The `setJunctionControl` fix** (§2.4): the unsignalized branch drops
    `signal_plan` the way the signal branch already drops `rule`.
  - `src/components/Inspector.tsx` — a `SignalPlanFields` section inside
    `JunctionFields` (`:1071`), rendered only when `junction.control === "signal"`,
    the way the Rule row is withheld when it is (`:1130`). Cycle/offset header,
    a row per stage with three number steppers (`SignKph`'s idiom, `:749-780`),
    Add stage, Remove plan.
  - Stage ids minted with `nextId(existing, "P")` (`document.ts:130-139`) over
    *that junction's* phases, so `P1`/`P2` continue rather than collide.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green.
  - `state.test.ts`: creating a plan on a signalized junction yields a plan whose
    stages sum to its `cycle_time`; editing any timing recomputes it; adding and
    deleting a stage both recompute it.
  - Flipping control to `unsignalized` **drops the plan**, asserted as
    **`"signal_plan" in junction === false`** — the absent-key form, not
    `toBeUndefined()`, which passes on a stored `undefined` and would export a
    `signal_plan: null`. There is deliberately **no identity assertion on this
    action**: a flip always rewrites `control`, so `doc`, `doc.junctions` and the
    junction are new on every call by construction, and asserting otherwise would
    be asserting something impossible.
  - **Creating a plan on an unsignalized junction returns `state` by identity**
    (§2.3.1) — the one place this spec departs from `setJunctionRule`'s
    don't-guard-on-a-sibling posture, because a stray plan is *not* inert:
    `validation.rs:424` validates any plan present regardless of `control`.
  - A `bun run tauri dev` pass: import `cross-4`, select the junction, and read
    its real plan — 60 s cycle, two stages of 25/3/2. This is the first time
    anything in Zukai has displayed that data.
- **Docs touched:** `rules/junctions.md` (whose opening still says `signal_plan`
  is a field nothing reads); the project-memory roadmap.

### Phase 2 — Which movements run when  (depends on Phase 1)

- **Scope:** the tri-state of §2.3, and the three cascades of §2.4.
  - `setPhaseMovement(node, phase, movement, role)` with
    `role: "protected" | "permitted" | "off"`, writing the movement into
    `green_movements`, `permitted_movements`, or neither. Empty lists are
    **dropped keys**, `movements: []`'s rule a spec earlier.
  - A shared `purgeMovements(plan, gone)` applied by **`deleteMovement`** and
    **`dropMovements`**, with `dropMovements`' pre-check shape so an unrelated
    delete returns the junctions array by identity (§2.4).
  - Inspector: each stage row lists the junction's movements with a three-way
    control. The list is the junction's `movements`, so a movement added later
    appears in every stage as "off" with nothing stored.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green.
  - `state.test.ts`: assigning protected/permitted/off moves the id between the
    two lists and out of both; a list that empties **loses its key**.
  - **Deleting a movement purges it from every stage of the plan**, both lists —
    the assertion that would have caught today's bug.
  - **Deleting a link purges the movements it strands from the plan too**, one
    cascade further out.
  - **A delete that strands nothing returns `doc.junctions` by reference** — the
    identity assertion no behavioural test sees (`rules/junctions.md`).
  - A `bun run dev` pass on the panel's ergonomics with `cross-4`, whose junction
    has **16 movements** — every one of which gets a row in **each** of the two
    stages, since the row list is the junction's movements rather than the
    stage's. 8 of the 16 are assigned per stage; the other 8 render as "off".
    32 rows is the real ergonomic question this pass exists to answer.
- **Docs touched:** `rules/junctions.md` (the cascade section gains its fourth
  answer).

### Phase 3 — The plan on the canvas  (depends on Phase 2)

- **Scope:** seeing a stage, and nothing about editing one.
  - `previewPhase` on `EditorState` (§2.5), set by clicking a stage row, cleared
    by `install()` and by a selection change. Never in `Document`, never in
    history — and carried to the drawing **on `Interaction`** beside `selection`
    (`Diagram.tsx:81-84`), built by `Canvas` (`Canvas.tsx:277`), which is what
    keeps it out of exports for free (§2.5).
  - `MovementShape` (`Diagram.tsx:1149`) gains a signal role prop, and the paint
    covers **both** of its elements: the stroked `.jn-movement-line` *and* the
    filled `.jn-movement-head` (`diagram.css:361-371`), which is a separate white
    polygon — styling only the line leaves a bright head on a stopped arc.
  - **The stop-bar rule, stated completely** (`Diagram.tsx:1036-1047`). An arm's
    bar is **lifted** iff some movement of the previewed stage is *not* off and
    approaches on that arm — `m.from_link === arm.id`, since arms are found by
    link id and carry no direction of their own (`Diagram.tsx:951-955`).
    Otherwise the bar **stays**. That single iff covers the three cases the draft
    left open: an arm whose movements are all `permitted` **loses** its bar
    (permitted is green), an arm whose movements are all off keeps it, and an arm
    **no movement approaches on** — a divided road's exit carriageway, which
    `junctionArms` emits for every incident link — keeps it, because nothing
    green approaches there.
  - **`SignalHead` is left exactly as it is** (§2.8): one all-lit badge per
    junction, not a per-arm aspect. Stated in scope so the implementer does not
    "fix" it, and in the dev gate so it does not read as a bug.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green.
  - `Diagram.test.tsx`: with a stage previewed, each movement arc carries the
    class its role implies, **on both the line and the head**; the stop bars
    match the iff above, asserted on a four-arm cross including **one arm with no
    approaching movement**.
  - With no stage previewed the markup is **byte-identical to today's** — the
    assertion that keeps a feature nobody is using from changing every existing
    drawing.
  - Previewing a stage does **not** dirty the document (`state.test.ts`).
  - **An export drops the preview**, asserted in `export.test.ts` rather than
    assumed: preview a stage, export, and the SVG carries no role class. It
    should pass on the first run — that is §2.5's dividend — and the assertion is
    what stops a later refactor moving `previewPhase` off `Interaction` and
    silently baking a preview into every exported picture.
  - A `bun run tauri dev` pass: click between `cross-4`'s two stages and watch
    the junction change — with the head staying all-lit, by design.
- **Docs touched:** `rules/junctions.md`; `rules/diagram-export.md`, whose
  "an export is not a document" neighbourhood gains the `Interaction`-absent
  reason this works.

### Phase 4 — Derive a plan  (depends on Phase 3)

- **Scope:** the one-click seed, `deriveMovements`' analogue (junction semantics
  Phase 4) and the same discipline.
  - `derivablePlan(doc, node)` in `geometry.ts`, by **OQ-8's resolved rule**
    (group by approach, pair within 30° of opposite, through/right protected,
    left **and u-turn** permitted, 20/3/2 per stage), **exported** so the panel
    can disable the
    button exactly when the action would return the document by identity — the
    rule `derivableMovements` established and the reason it is not inlined.
  - A `deriveSignalPlan` action and one button beside Derive all turns.
  - **Stage ids are minted from an empty plan, not appended to the existing
    one.** Derive *replaces*, so it numbers from `P1` every time. Phase 1's
    `nextId(existing, "P")` over the junction's current phases is the wrong tool
    here: it would yield `P3`/`P4` on the second derive and make the idempotence
    below unreachable by construction.
- **Exit gate:** `bun run build` + `bun run test` + `cargo test` green.
  - On a 4-arm orthogonal cross with all 12 movements: **two stages**, every
    movement in exactly one of them, and the stages summing to `cycle_time` by
    construction.
  - On a 3-arm T: **two stages** — the opposing pair, then the stem — asserted
    against *named* bearings (north/south paired, east the remainder) rather than
    an arbitrary number, since the count is the thing OQ-8's draft got wrong.
  - Deriving over an existing plan **replaces** it, and deriving twice is
    idempotent — the second click returns `doc` by identity and the button
    greys.
  - **Every movement lands in a role, u-turns included** — asserted on an
    *imported* `cross-4` rather than on a derived cross, because
    `derivableMovements` strips u-turns and a derived junction therefore cannot
    exercise the case. Two assertions, not one: no movement of the junction is
    absent from both lists of its stage (**coverage**), *and* its four u-turns
    land in `permitted_movements` specifically (**role**). Coverage alone is what
    the fourth clause needed to become enforceable at all, but it would still
    pass an implementation that put u-turns in `green_movements` — a protected
    u-turn across opposing traffic being the one wrong answer worth naming.
  - **The closing check, and it is performable this time**: import `cross-4`,
    **remove its plan**, Derive a new one, export, and run the result through
    Assimilator by `network_yaml_spec.md` Phase 4's procedure (`-p
    assimilator-cli`, a control copy, the stale `model_params.mobil.a_bias` line
    dropped from both). Pass = the run completes and reports vehicles completed.
    A plan Zukai *invented* driving a real simulation is the strongest claim this
    spec can make, and unlike that spec's gate it is not scale-neutral theatre:
    the plan is entirely ours.
- **Docs touched:** `rules/junctions.md`; `CLAUDE.md`'s spec list; the
  project-memory roadmap; mark this spec `implemented`.
