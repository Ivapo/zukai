---
id: zk-017
title: road-declutter
note: >
  Take off the road what a figure's reader never asked for — the direction
  arrowhead halfway along every link becomes an editing mark on the selected
  one, and the four road classes, two of which draw identically, go.
status: accepted
last_updated: 2026-09-14

phases:
  - name: "Phase 1 — The direction arrow becomes chrome"
    reviewed: 2026-09-14
    shipped: 2026-09-14
    cut: null
    by: null
  - name: "Phase 2 — Road class goes"
    reviewed: 2026-09-14
    shipped: null
    cut: null
    by: null

extends: null
supersedes: null     # becomes [{id: zk-004, phases: ["Phase 2 — Road class paints"]}]
                     # at Phase 2's close-out, in the same commit that cuts it there
superseded_by: null
related: [zk-003, zk-005, zk-015, zk-016]
reference: null
---

# Road Declutter Spec

## 1. Goal

Two things on every drawn road carry nothing a reader of the figure wants, and one
of them carries nothing at all.

**A white arrowhead sits halfway along every link.** `RoadShape` draws it through
`Diagram.tsx:arrowTriangle`, it is gated on nothing, and so it is in every exported
SVG and PNG and on all three landing-page figures. No road is painted with an
arrowhead down its middle. Where a figure needs to say which way traffic runs, it
already has the road's own way of saying so — a `turn_arrow` marking, `through`
included (`rules/marking-kinds.md`) — placed where a human wants it rather than
stamped on every link.

**Every link carries one of four road classes, and they are two looks.**
`LinkStyle` is `motorway | arterial | local | ramp`, and what each draws is:

| Class | Casing | Lane width | Edge line |
|---|---|---|---|
| `motorway` | `--asphalt` | ×1.0 | base |
| `arterial` (default) | `--asphalt` | ×1.0 | base |
| `local` | `--asphalt-2` | ×0.9 | 1.2 |
| `ramp` | `--asphalt-2` | ×0.8 | 1.2 |

`motorway` and `arterial` are byte-identical in markup but for the class token, and
`local` and `ramp` differ only by a tenth of a lane. `--asphalt-2` is `#23272d`
against `#2b2f36`. Import never sets a class (`import.rs:network_to_document` writes
`LinkStyle::default()`, on the argument that a class inferred from a speed limit is
a guess dressed as a fact), and of the three committed examples only
`motorway-ramp.zkai` sets one.

The class arrived in the first commit as "a rendering hint only" and was made to
paint by `road_rendering_spec.md` Phase 2, whose §1 named the symptom it fixed: four
buttons and a byte-identical drawing. That phase answered *"is the class drawn?"*;
it never asked *"is the class the picture?"* — and this project's scope narrowing
of 2026-07-27, which added that question, came two days after it shipped.

**The observable is the drawn network, in an exported figure and on the canvas.**
End state:

```
Export ▸ motorway-ramp.zkai, as SVG

  before                                   after
  MAIN_W motorway, shoulder + 3 ▸ arrowhead    MAIN_W shoulder + 3   no arrowhead
  MAIN_E motorway, shoulder + 3 ▸ arrowhead    MAIN_E shoulder + 3   no arrowhead
  RAMP   ramp, 1 lane           ▸ arrowhead,   RAMP   1 lane         no arrowhead,
                                  ×0.8 lane,                           full lane width,
                                  darker                               the mainline's
                                  asphalt                              asphalt

Canvas ▸ click RAMP
  the Inspector shows Link RAMP, and RAMP alone carries its arrowhead;
  there is no Road class row
```

A ramp still reads as a ramp: it is one lane leaving three through a gore, which is
what the lane count, the gore and its chevrons already say (§2.2).

### 1.1 Non-goals

- **No replacement for the class.** No document-wide road type, no per-link colour,
  no "motorway look". If a figure needs to say *motorway*, a sign or a `text`
  marking says it, and a hard shoulder is a `shoulder` lane — which is, per
  `Diagram.tsx:RoadShape`'s own comment, "the whole of what distinguishes a motorway
  from an arterial" already.
- **No new direction affordance.** The arrow keeps its shape, size and midpoint; it
  changes where it is drawn, not what it is.
- **No automatic turn arrows.** A figure that loses its direction arrows gains
  nothing in their place unless a human paints it; import's seeded turn arrows
  (`lane_arrows_spec.md` Phase 3) are unchanged.
- **No `SCHEMA_VERSION` bump, and no migration arm** (§2.3).

## 2. Design

### 2.1 The arrow is an editing mark, drawn on the selected link (decision, recorded)

**It is chrome on the precedent the node dot set** (`ramps_and_tapers_spec.md`
§2.11.1): a mark that tells the *editor* something about the document, rather than
something the road does, is gated on `interaction`, which `export.tsx:diagramInner`
never passes, so no filter exists for anyone to forget.

**And only on the selected link**, rather than on every link while editing. Three
reasons, in order of weight:

- **The canvas is where a human judges the figure.** A node dot on every road end is
  on the canvas because it is the node's hit target; an arrow is no one's hit
  target, so an arrow on every link would be the one mark making every road on the
  canvas look different from the file it exports, for no interaction it serves.
- **The one consumer that needs it sees a selected link.** The Inspector's *Lane
  region* readout states a side "of travel" and tells the reader to convert by
  looking at the arrowhead (the comment above the readout in
  `Inspector.tsx:Inspector`, and `ramps_and_tapers_spec.md` §2.11.3's "The picture
  already states the travel direction"). That panel exists only for
  `selection.kind === "link"`, so an arrow on exactly that link keeps the argument
  true everywhere it is used.
- **The Inspector's *Direction* row already names `from → to`** for the selected
  link, so the arrow on it is the same fact drawn where the road is.

Only the `link` arm of `Selection`: a selected bend or marking on that link does not
draw it. A bend's panel states a canvas position and a marking's states its anchor;
neither speaks in the road's travel frame.

**Mechanism.** In `RoadShape`, `arrow` is computed and rendered only when `selected`
— which is `isSelected(interaction?.selection ?? null, "link", link.id)` and so is
already false wherever `interaction` is absent. `.road-arrow` moves from
`src/styles/diagram.css` to `src/styles.css`, and `road-arrow` joins
`export.test.ts:CHROME`. Both halves are the node dot's: the regex is matched
against the whole exported file, embedded stylesheet included, so a rule left in
`diagram.css` fails every chrome assertion rather than passing silently.

**Nothing else hangs off the arrow's midpoint.** `geometry.ts:lengthLabel` measures
its own halfway point (`pointAlongPolyline(points, midway(points))`); `RoadShape`'s
`mid` is the arrow's alone — commit `67f9018` moved the arrow to sit level with the
label, not the other way round — so gating it moves no label.

### 2.2 Road class goes, whole, and nothing inherits it (decision, recorded)

**What the class could say, the lanes already say.** A hard shoulder is a
`shoulder` lane and draws its solid line and hatch. Width is lane count, and the doc
comment on `classWidthFactor` in `geometry.ts` concedes the tension: "never large
enough to confuse lane count: road width is how a reader counts lanes". A ×0.8 lane
is exactly a quantity that makes a 5-lane ramp and a 4-lane arterial the same width.
A ramp's identity is its topology — a gore, a taper, one lane — and every one of
those is drawn by another subsystem with no reference to the class.

**Nothing is kept "just in case".** Keeping `LinkStyle` in the model with no
rendering effect restores the exact defect `road_rendering_spec.md` §1 opened on —
a control that stores a choice and draws nothing — and keeping it only for the
round trip is the field `CLAUDE.md` says not to add.

**What goes**, in both mirrors and the renderer. A symbol this phase deletes is named
in words — `LinkStyle` in `layout.rs` — and never as `file:symbol`: `spec-lint`
resolves the second form, and fails `CIT_SYMBOL_ABSENT` the moment the symbol is gone.

- **Model.** `LinkStyle` and `LinkView.style` in `layout.rs`; `LinkStyle` and
  `LinkView.style` in `types.ts`, leaving `LinkView` with two optional fields.
- **Derivation.** `classWidthFactor` and `CLASS_WIDTH_FACTOR` in `geometry.ts`; the
  `style` parameter of `laneWidths`, `roadWidth`, `laneBands`, `alignmentShift` and
  `alignmentReading`, and of every call site that reads `linkStyle(doc, id)` to feed
  one (`Canvas.tsx`, `Diagram.tsx`, `Inspector.tsx:Inspector`,
  `export.tsx:strokeAllowance`, `geometry.ts`); `linkStyle` and `DEFAULT_LINK_STYLE`
  in `document.ts`.
- **Paint.** The class token on the road group, on a taper's group and on a bay's
  (`road-${style}` in `RoadShape`, `TaperShape` and `BayShape`, and the `style` field
  of the wedge record in `Diagram.tsx` and of `geometry.ts:BusBay` that carry it
  there); the four `/* road class */`
  rules and the `--asphalt-2` token in `diagram.css`, which nothing else reads.
- **Editing.** `state.ts`'s `setLinkStyle` action and function; the *Road class* row
  and `LINK_STYLES` in `Inspector.tsx`.

**The taper and the bay lose a class token, not a behaviour.** Both groups carried
`road-${style}` so a `local` road's darker asphalt reached its wedge and its lay-by
(`rules/road-joints.md`, `bus_stops_spec.md` §2); with one asphalt there is nothing
to reach, and their base rules already paint `--asphalt`.

### 2.3 The file: a removed field, the cheap direction (decision, recorded)

`rules/document-model.md` records it: **a removed field costs no bump and no arm.**
Nothing derives `deny_unknown_fields`, so a `.zkai` carrying `style: ramp` loads in
the new build with the key ignored, and an older build reading a new file defaults
the missing field through `#[serde(default)]`. `JunctionView.rotation` and
`movements:` both left this way, and
`a_zkai_saved_with_movements_still_loads_and_writes_none` is the test shape to copy.

**Which does mean an old document draws differently on open**, with no warning: a
`ramp` or `local` link widens to full lane width and takes the one asphalt. That is
the change this spec exists to make, and the file cannot record a choice the app no
longer offers. (OQ-1 asks whether it should say so.)

**A link no longer needs a `LinkView` to exist.** Today `state.ts:completeLink` and
`import.rs:network_to_document` mint a view for every link,
and every `linkAlign`/bends reader already falls back when the view is absent
(`withBends`' doc comment says so). With `style` gone a minted view is `{}`, which
serializes as `L1: {}` for every plain link — bytes that say nothing. So **neither
site mints one**, and `layout.links` holds exactly the links that carry an alignment
or bends. `setLinkAlign` and `withBends` keep minting on demand, with the fallback
shape `{}` in place of `{ style: DEFAULT_LINK_STYLE }`.

Two consequences, named so they are expected rather than found:

- **The import golden loses its whole `links:` block**, not one line per link:
  `cross-4.zkai` and `cross-4.document.json` under `src-tauri/tests/fixtures/golden/`
  hold eight views that were nothing but `style: arterial`. The diff is deletions
  only, and that is the check.
- **An old file's class-only views load as `{}` and save as `L1: {}`.** Harmless,
  and not worth an elision predicate on a map value that serde does not offer;
  `persist.rs:migrate` could drop them, and that would be a migration arm for a
  cosmetic, which the rule above reserves for removed variants.

`src-tauri/tests/fixtures/zkai/t-junction-glyph.zkai` keeps its `style:` keys: it is
an old-file fixture, and it now also proves a stale class loads.

## 3. Open questions

- **OQ-1** — Should opening a document that carries a non-default `style:` say that
  its roads now draw differently? *(design call; blocks nothing — proposed: no.
  `movements:` and `rotation:` left silently, a file with `style: arterial`
  everywhere — every example but one — draws identically, and the only visible
  change is a lane widening by at most a fifth. A notice would be the first
  load-time warning this app has, for the smallest change it has made.)*
- **OQ-2** — Does a figure that relied on the arrowheads to tell a two-way road's
  carriageways apart need anything in their place? *(design call; blocked Phase 1.)*
  **RESOLVED 2026-09-14 (review round 1) — no, and Phase 1 edits no example.** The
  renderer puts nothing in the arrows' place, and no committed `.zkai` is changed to
  compensate: "if it reads ambiguous" was a taste gate with an unscoped edit behind it,
  and which turn arrows go on which of the roundabout's lanes is a drawing decision for
  the human who owns that example, not a clause of this phase. The roundabout figure's
  loss of direction is named here and accepted; painting turn arrows onto it later is a
  document edit that needs no spec. The original proposal's reasoning stands, and
  only its last sentence is withdrawn: proposed: no. `geometry.ts:carriageways`
  places each carriageway on its own drive side (`DRIVE_SIDE`), which is the
  convention a reader of a right-hand-traffic figure already assumes, and a figure
  that wants it stated paints a `through` arrow. The case that tests the proposal is
  on the landing page: `signalized-cross.zkai` states its approaches with eight turn
  arrows, but `roundabout.zkai` has four two-way arms and **no** turn arrow, so after
  Phase 1 that figure states travel direction by drive side alone. ~~Phase 1's dev
  pass looks at it, and if it reads ambiguous the answer is turn arrows in that
  example — a document edit, not a renderer change.~~

## 4. Implementation phases

Strictly sequential in the sense that Phase 2's figure regeneration assumes Phase 1's
figures carry no arrows. Neither phase builds on the other's code, but they meet in
one expression: the arrow's size is `Math.max(6, w * 0.45)` with `w` from
`roadWidth`, whose `style` parameter Phase 2 removes. No Phase 1 literal moves with
it — the shipped arrow tests draw default-class roads, whose width Phase 2 leaves
unchanged.

### Phase 1 — The direction arrow becomes chrome
*Produces the observable: yes — every exported figure and the three landing figures
lose their arrowheads, and the canvas draws one on the selected link.*

- **Scope** (§2.1): in `Diagram.tsx:RoadShape`, compute and render the arrow only when
  `selected`; move `.road-arrow` from `src/styles/diagram.css` to `src/styles.css`;
  add `road-arrow` to `export.test.ts:CHROME` and note it in that constant's doc
  comment as the newest token. Regenerate `examples/rendered/*.svg` and `index.html`
  through `ZUKAI_UPDATE_GOLDEN=1 bun run render-examples`. TypeScript, CSS and
  generated figures only; no Rust, and **no `examples/*.zkai` edited** (OQ-2).
  - **Comments that restate the claim this phase falsifies**, edited in the same
    commit: `geometry.ts:alignmentReading`'s doc comment ("the arrow head `RoadShape`
    paints at the link's far end" — now the midpoint, and on the selected link);
    the Lane region comment in `Inspector.tsx:Inspector` (it stays true, since the
    panel implies a selected link — reword only if it names the figure);
    `diagram.css`'s header, which lists what lives in `styles.css` instead ("so does
    the node dot") and gains the arrow — **in words, never the class token**: `CHROME`
    is matched against the embedded stylesheet comments included, so a header naming
    `road-arrow` fails every chrome assertion, which is why it already says "the node
    dot" rather than `node-dot`; and `CHROME`'s doc comment, whose "fails all
    ten" is already thirteen (`grep -c "not.toMatch(CHROME)"`) — state the count the
    grep gives at implementation, or drop the number.
- **Exit gate:**
  - `bun run build` and `bun run test` green; `spec-lint` 0 errors;
    `bun run render-examples` passes **without** the opt-in after regeneration.
  - `Diagram.test.tsx`: the two shipped arrow cases (the straight road and the bent
    route, both through `arrowPoints`) render with the file's top-level `interaction()`
    helper, whose selection is already `L1` — the link both cases draw — and assert the
    same points as before, unchanged (the arrow's size reads nothing from
    `interaction`). New cases, on a two-way pair built in the test — `L1` `N1(0,0) →
    N2(120,0)` and `L2` `N2 → N1`, both one lane:
    - selecting `L1` finds **exactly one** `road-arrow`, and its apex (first point of
      `arrowPoints`) has the greater `x` of its three corners — `L1`'s arrow, pointing
      east, not `L2`'s;
    - `selection: null` finds none;
    - `selection: { kind: "bend", link: "L1", index: 0 }` finds none (§2.1's "only the
      link arm");
    - a render with no `interaction` finds none.
  - `export.test.ts`: the existing "contains the drawing and none of the canvas
    chrome" case passes with `road-arrow` in `CHROME` — which is the assertion that
    the rule left `diagram.css`.
  - Mutations, each failing a clause above: the arrow gated on `interaction` rather
    than `selected` (fails the `selection: null` and bend-selection cases, and the
    exactly-one case); `.road-arrow` left in `diagram.css` (fails every `CHROME`
    assertion). The one mutation no test catches — the rule deleted from
    `diagram.css` and never added to `styles.css`, which draws the arrow in SVG's
    default black — is the dev pass's "white" below; no test in this repo reads
    `styles.css`, and this phase does not start one.
  - Dev pass (`bun run dev`): open `motorway-ramp`; no arrowheads; click each link in
    turn and a **white** arrowhead appears on it alone; add a bend to a link, select
    the bend, and no arrow shows; open `roundabout` and confirm it draws with no
    arrowheads (an observation for the record, not a gate — OQ-2); export SVG and PNG
    and find no arrowhead in either.
- **Close-out:** `rules/road-rendering.md` (where `arrowTriangle` is listed, the arrow
  is now chrome on the selected link); `rules/diagram-export.md` (it quotes the
  `CHROME` regex verbatim, so the quote gains `road-arrow`); `rules/canvas-interaction.md`
  (its list of what `interaction` gates gains the arrow). **Line budget:**
  `road-rendering.md` 284/284 and `canvas-interaction.md` 190/190 trade prose rather
  than grow; `diagram-export.md` 304/305 changes a quote in place. A dated `CORRECTED`
  note beside `ramps_and_tapers_spec.md` §2.11.3's "The picture already states the
  travel direction" — the arrow is at the midpoint, not the far end, and on the
  canvas's selected link, not in a figure — because that is a decision's grounding a
  reader would otherwise take as current. Roadmap memory: one line. One push: the
  feature and figures in one commit, rules and spec in a second.

### Phase 2 — Road class goes
*Produces the observable: yes — a `ramp` or `local` road draws at full lane width on
the one asphalt, in the figure and on the canvas; the panel loses its Road class row.*

- **Scope** (§2.2, §2.3):
  - **Rust.** Remove `LinkStyle` and `LinkView.style` from `model/layout.rs`, and every
    construction of them (`model/mod.rs`'s sample document, `layout.rs`'s test helper
    `view`, `network/import.rs:network_to_document`), which stops inserting a
    `LinkView` per link.
    Regenerate both import goldens through `ZUKAI_UPDATE_GOLDEN=1 cargo test`.
  - **TypeScript model and state.** `LinkStyle` and `LinkView.style` in `types.ts`;
    `linkStyle` and `DEFAULT_LINK_STYLE` in `document.ts`; `state.ts`'s `setLinkStyle`
    action arm and function; `completeLink` inserts no view; `setLinkAlign` and
    `withBends` mint `{}`.
  - **Geometry.** `classWidthFactor`, `CLASS_WIDTH_FACTOR`, and the `style` parameter
    of `laneWidths`, `roadWidth`, `laneBands`, `alignmentShift`, `alignmentReading` and
    their call sites, `Inspector.tsx:Inspector` among them; the `style` field of the
    record `geometry.ts` builds per bay.
  - **Render and panel.** The class token on the road, taper and bay groups and the
    `style` fields feeding the last two in `Diagram.tsx`; the road-class block and
    `--asphalt-2` in `diagram.css`; the *Road class* row and `LINK_STYLES` in
    `Inspector.tsx`, and the Lane region comment's example figures, which quote a
    ramp's and a local road's widths.
  - **Comments naming a class**, which the `git grep` below finds and so must go in
    this pass: the sign comment in `diagram.css` citing `.road-local .road-casing`
    (outside the road-class block, and copied into every rendered figure); the doc
    comments on `TaperShape` and `BayShape`; `export.tsx:strokeAllowance`'s doc
    comment, which says the class is part of the width it measures;
    `withBends`' `{@link setLinkStyle}`; and the taper comment in `Diagram.test.tsx`
    naming `.road-local .road-taper`.
  - **Examples.** Strip `style:` from the three `examples/*.zkai`. All 19 views in
    them are class-only, so each file's `layout.links` key goes whole rather than
    being left as a bare `links:`. Regenerate `examples/rendered/*.svg` and
    `index.html`.
- **Exit gate:**
  - `bun run build`, `bun run test`, and from `src-tauri/` `cargo test`,
    `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`, all green;
    `spec-lint` 0 errors; `bun run render-examples` passes without the opt-in.
  - `git grep -n -E "LinkStyle|linkStyle|classWidthFactor|setLinkStyle|DEFAULT_LINK_STYLE|asphalt-2|road-(motorway|arterial|local|ramp)"`
    returns nothing outside `specs/` and `rules/`.
  - The golden diffs are **deletions only** (`git diff --numstat` shows `0` added for
    both files).
  - Rust: a `.zkai` whose links carry `style: ramp` loads, and re-encoded carries no
    `style` key (the shape of
    `a_zkai_saved_with_movements_still_loads_and_writes_none`, in `model/mod.rs`); an
    import produces a document whose `layout.links` is empty.
  - `state.test.ts`: `completeLink` leaves `layout.links` without the new link's id;
    `setLinkAlign` and a bend placed on such a link each create its view.
  - **Shipped tests: one of three outcomes, decided by what the test asserts.** No
    test is rewritten to pass. An expected literal that moves under the second rule is
    a finding to stop on, not an edit to make.
    1. **Deleted whole — the class is the subject.** Exactly these:
       - `Diagram.test.tsx`: `describe("road class")`, all four cases.
       - `geometry.test.ts`: `describe("classWidthFactor")`, all six cases;
         `alignmentShift`'s "shifts a ramp less far than an arterial of the same lane
         count"; and "measures each carriageway at its own road class".
       - `export.test.ts`: "measures the road at its own class, not the default" and
         "carries the road class and its paint rule into the file".
       - `state.test.ts`: "sets an alignment without disturbing the road class".
    2. **The class leaves the fixture; every assertion stands.** Here the class is a
       loop variable, a helper default or a fixture value, for an invariant that is
       not about class. The loop, parameter or `setLinkStyle` action goes:
       - the class loops in `describe("alignmentShift")` and
         `describe("alignmentReading")`;
       - the three "…at every lane count and class" containment cases in
         `geometry.test.ts`, whose titles lose "and class";
       - the `style` parameter of `geometry.test.ts`'s `end()` and `carriageway()`
         helpers, and every `{ style: DEFAULT_LINK_STYLE, … }` view literal;
       - the two `setLinkStyle` actions in the taper fixture;
       - the gore fixtures that set `L3` to `ramp`, in `Diagram.test.tsx` and
         `export.test.ts`. Review round 1 set every factor to 1 and broke no literal
         in either.

       Edits forced only by a removed parameter or type are not listed:
       `DEFAULT_LINK_STYLE` passed positionally, `linkStyle(doc, id)` fed to a
       helper, and imports and helpers left unused. `tsc` names each one, and each
       has exactly one fix.
    3. **Rewritten as stated here — the class carried a claim that outlives it.**
       - `geometry.test.ts` "draws nothing where the two casing edges agree, whatever
         the lane counts": the 5-lane `ramp` becomes 5 lanes of `2.8` m against 4 of
         `3.5` m. Both draw exactly `39` (`5 × 2.8 × 9/3.5 + 3`, measured in
         floating point), so `toBe` and the empty-wedge assertion stand.
       - "keeps every direction set inside the band, at every size": the size is
         what this case varies, and `ramp` was its narrow one. That size becomes
         three lanes of `2.8` m, the width a ramp lane drew at (`0.8 × 3.5`), so the
         case still spans two band widths.
       - "pins the face's own metrics": the cap-height bound becomes `LANE_PX`, the
         narrowest default lane once no class narrows one, and its comment says so.
       - `import.rs`, `layout_is_seeded_with_defaults_rather_than_derived`: the
         `links.len() == 3` assertion and the per-view loop become
         `assert!(doc.layout.links.is_empty())`, which is the import clause above.
         Its junction-glyph half stays.
       - `state.test.ts` view shapes: `{ style: "arterial", align: "offside" }` →
         `{ align: "offside" }`, `{ style: "arterial" }` → `{}`, and
         `{ style: "arterial", bends }` → `{ bends }`. In "is one undo step,
         restoring the alignment the link had before", the last assertion becomes
         `expect(view(twice)).toBeUndefined()`, because the link it starts from now
         has no view.
       - `Diagram.test.tsx`'s `roadGroup` helper matches `<g class="road">` rather than
         `road road-[^"]*`. `<g class="taper road-motorway">` and
         `<g class="bay road-arterial">` become `<g class="taper">` and
         `<g class="bay">`. `geometry.test.ts`'s `bays[0].style` assertion goes with
         the field.
       - The bus-bay case "carries the road's class on its group, and the box's
         chrome in the bay" loses the class from its title and from its comment
         ("The class token reaches the bay…"). Its assertion is now the token-free
         group, and the grep gate cannot see a title.
  - Dev pass (`bun run dev`):
    - open `motorway-ramp`; the ramp is a full-width lane on the same asphalt as the
      mainline, and the Link panel has no Road class row;
    - open the **pre-change** `motorway-ramp.zkai`
      (`git show <phase base>:examples/motorway-ramp.zkai`, which carries
      `style: ramp`), and it draws; save it, and the file has no `style` key;
    - undo and redo an alignment change on a link with no view.
- **Close-out:** each rule below is edited in place:
  - `rules/road-rendering.md`: the lane-width derivation loses its factor, and the
    "Road class paints as a class token" section goes;
  - `rules/document-model.md`: a third removed-field example, and `LinkStyle` leaves
    the layer table;
  - `rules/diagram-export.md`: `strokeAllowance` and its class width;
  - `rules/road-joints.md`: a taper's class token;
  - `rules/network-yaml.md`: import's default class, and that it writes no view.

  **Line budgets:**
  - `road-rendering.md` 284/284 shrinks, since a section goes;
  - `document-model.md` 144/144 and `road-joints.md` 268/268 trade prose rather than
    grow;
  - `network-yaml.md` 343/345 and `diagram-export.md` 304/305 change in place.

  **User-facing documentation:** `README.md`'s Road rendering bullet drops "road
  class".

  **The supersession lands here, both halves in one commit.** This spec's
  `supersedes` gains `{id: zk-004, phases: ["Phase 2 — Road class paints"]}`, and
  `road_rendering_spec.md` Phase 2 gains `cut: <ship date>, by: zk-017`.
  - `spec-lint` rejects the `supersedes` half without the cut (`EDGE_PHASE_NOT_CUT`),
    which is why the draft carries neither.
  - The cut half alone passes the linter, since it has no reverse check. But it would
    leave zk-004 naming a `by` that claims nothing, so the two land together.

  No `## 0.` note on zk-004: a phase-scoped cut leaves it `accepted`, and the edge is
  the record. Roadmap memory: one line. One push.
