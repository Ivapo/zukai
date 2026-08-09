---
title: signs
sources:
  - src/App.tsx
  - src/components/Canvas.tsx
  - src/components/Diagram.tsx
  - src/components/Inspector.tsx
  - src/components/Toolbar.tsx
  - src/editor/geometry.ts
  - src/editor/state.ts
  - src/model/document.ts
  - src/styles.css
  - src/styles/diagram.css
  - src-tauri/src/model/decoration.rs
covers: >
  the objects a human stands beside the road: why a sign is node-shaped rather
  than marking-shaped, the four actions, what removes one, the topmost sign
  layer and what a sign is drawn from, the shape-then-colour vocabulary, and the
  panel
max_lines: 250
generated: 2026-08-09
---

# Signs

The objects a human stands *beside* the road. Frontend only — `Sign`, `SignKind`
and `Layout.signs` have been in the model since the first commit, so nothing here
moves `SCHEMA_VERSION`. Rationale: `specs/signs_and_text_spec.md`.

**All eight kinds are drawn.** Six carry their meaning in a *shape*; `custom
{ label }` and `direction { text }` are plates carrying their words, and since
neither can be told from the other by shape, a destination is separated by
**colour** instead. Nothing about a sign reaches `network.yaml` — Assimilator has
no concept of one.

## A sign is node-shaped, not marking-shaped

The decision everything below descends from. A `Marking` is anchored to a link at
a position in metres and **derives** its point from the road; a `Sign` is
`{ id, kind, associated_link? }` and **carries its own canvas position** in
`Layout.signs`, so nothing about it is derived from a road.

| | Marking | Sign |
|---|---|---|
| Placement | `addMarking` — a click on a road, projected to arc-length + lane | `addSign` — a click *anywhere*, stored verbatim |
| Dragging | `moveMarking` — re-projected onto its road, **no grab offset** | `moveSign`, on `moveNode`'s shape |
| A deleted road | drops the marking | **clears `associated_link`, keeps the sign** |

`layout.signs[id]` is a **bare `Vec2`**, not the `{ pos }` wrapper `layout.nodes`
uses — it mirrors Rust's `BTreeMap<SignId, Vec2>`. That asymmetry is the reflex
error of the subsystem, which is why there is deliberately **no `signPos`
helper**: `nodePos` exists because `NodeView` wraps its point, and a helper
re-exporting a `Vec2` would add a name and nothing else.

## The four actions

| Action | Shape it copies | Note |
|---|---|---|
| `addSign(pos)` | `addNode` | writes `doc.signs` **and** `doc.layout.signs`; always `custom { label: "" }`; selects it |
| `moveSign(id, pos)` | `moveNode` | guards on the **layout** entry, returning `state` by identity |
| `setSignKind(id, kind)` | `setMarkingKind` | carries the **whole tagged `SignKind`**, so later phases added controls and no actions |
| `setSignLink(id, link?)` | `setMarkingLane` | `link` absent clears the key; guards on both the sign and the link |

`associated_link` is an **absent key**, never `undefined` — the
one-representation rule `Lane.kind`, `LinkView.align` and `Marking.lane` follow.
There is no `deleteSign`, for the reason there is no `deleteMarking`: the
Inspector's Delete dispatches `deleteSelection`, so a separate action would have
no dispatcher.

**Four coalescing keys** (`rules/history.md`): `moveSign:<id>` for the drag, and
`signLabel:<id>` / `signSymbol:<id>` / `signText:<id>` for the three text fields,
which dispatch per keystroke so the sign follows the typing. All three exclude the
**empty** string, and the Kind picker is what made that carve-out load-bearing
rather than defensive: picking Custom, Warning or Direction mints an empty string
through `setSignKind` itself, so without it the first keystroke would swallow the
pick. A key per **field**, not per sign — the three belong to three kinds, and
switching between them is a pick that closes the run anyway.

## What removes a sign, and what does not

**Nothing but deleting it.** A deleted road cannot orphan a sign the way it
orphans a marking, because nothing about a sign depends on a link to be drawable.
What it *can* leave is a dangling `associated_link`, and the answer is to **clear
the field**. Both delete arms carry it — the node arm drops every incident link
and strands the same reference, reusing the `dropped` set it already builds.

**`clearSignLinks` is a `map` where `keepMarkings` is a `filter`, and that is the
whole difficulty.** A `filter` recovers array identity from a length comparison; a
`map` always returns a fresh array, so the check comes first
(`signs.some(stranded)` before mapping). Not about dirtying — both arms rebuild
`doc` regardless — but about a document whose signs never named the deleted road
**still sharing the array** with its history snapshots. `state.test.ts` asserts
it, since no behavioural assertion can.

The **sign arm of `deleteSelection` has two places to delete from**, so it checks
before touching either. `Diagram` skips a sign with no `layout.signs` entry, which
only a hand-edited document can produce.

## The sign layer is the topmost thing in the drawing

`SignShape`s render **after the nodes and the junction glyphs** — the exact
opposite of the marking layer's rule. Paint sits *below* the glyphs because a pad
is the intersection's own surface and paint under one is genuinely covered; a sign
stands beside the road and must never be occluded. The layer is an **unwrapped
`.map()`**, never a `<g class="signs">`: a document with no sign has to render as
exactly `<g class="diagram"></g>`. The kind's class token comes from the model
(`kind.type.replace(/_/g, "-")`), not a table that could fall out of step.
Everything is drawn **about the origin**, the group translated to the sign's
position. `.sign-hit` (inflated 3) and `.sign-halo` (inflated 4) are chrome in
`styles.css`; the plate, the label and the six symbols paint from `diagram.css`.

**One hit box and one halo for every kind**, whatever the sign paints — the
marking layer's rule applied here so selecting a sign feels identical across the
vocabulary. **`signBox(kind)` is what keeps that true** now that six kinds are not
rectangles: the plate's box for the two that carry words, the `SIGN_SIZE` square
for the rest. Taking it from the plate unconditionally would ring a 22-unit
roundel with a 12-unit halo. **An empty label emits no `<text>` at all**, and the
plate is what keeps a freshly placed sign visible and selectable.

`SIGN_SIZE` (22) is the symbol size in **both** directions and the **floor** on a
plate's width; `signPlate(label)` is `max(SIGN_SIZE, textWidth(label) + 2 *
PLATE_PAD)` wide and `TEXT_SIZE * 2` tall — the height is the **type it carries**,
because a square plate reads as a card rather than a sign. Text is centred by
**arithmetic**, not `dominant-baseline` (whose support inside a rasterized SVG is
the class of thing that fails silently in the PNG path): the baseline drops
`BASELINE_DROP`, the one constant a painted road word, a plate's label and a
roundel's number all take. **The plate sizes to its text from Phase 2 on**, ahead
of the spec's plan, because a fixed box overflows at about five characters — and
**`signPlateLabel` is the only place that reads a kind's string**, so a
destination widened its plate, its hit box and its halo together, in one line.

A sign is a **symbol, not a scale model** — it does not shrink beside a narrow
ramp the way a turn arrow does — which is why a **light** outline takes
`non-scaling-stroke` on the canvas, on `.jn-priority`'s precedent: a 1-unit
outline that scaled away at low zoom would stop separating a white plate from
light paper. A symbol's own red border is proportion, not separation, and scales
with the drawing like the paint it is.

### The vocabulary: shape first, colour second

`signPaint` switches on the kind and the geometry it calls owns no markup —
`markingPaint`'s shape, one layer up. It is **exhaustive over `SignKind`**, unlike
the marking switch, whose fall-through bar exists for a kind (`hatching`) only a
hand-edited document can carry.

| Kind | Elements | Geometry |
|---|---|---|
| `speed_limit` | `.sign-roundel` + `.sign-roundel-ring` + `.sign-label` | `signRoundel()` |
| `stop` | `.sign-octagon` + `.sign-label` | `signOctagon()` |
| `give_way` / `warning` | `.sign-triangle` | `signTriangle("down")` / `("up")` |
| `priority` | `.sign-diamond-border` + `.sign-diamond` | `signPriority()` |
| `no_entry` | `.sign-disc` + `.sign-bar` | `signNoEntry()` |
| `direction`, `custom` | `.sign-plate` (+ `.sign-label`) | `signPlate(label)` |

**Shape carries the meaning and colour confirms it** — an octagon reads as "stop"
in grey, and a red disc without the white bar is not a no-entry. That ordering
keeps the vocabulary down to **two** palette entries, `--sign-red` and
`--sign-green`, commented in `diagram.css` as *sign* colours so nothing mistakes
them for road paint. It is also why every assertion in `geometry.test.ts` is a
**shape** test: a flipped triangle or a rotated octagon passes any assertion on a
size. Five consequences:

- **The two triangles are one construction and one flip** (both from
  `regularPolygon`, as the octagon and diamond are). Which way they point is the
  whole message, so two builders could drift with nothing to notice.
- **The priority sign is two polygons**, because its outer edge is white and needs
  a dark outline to hold against light paper — one path cannot carry two strokes.
- **The roundel's ring is fat because the type size is fixed.** One `TEXT_SIZE`
  for the whole drawing, so `SIGN_RING` closes the white space a small number
  would sit adrift in. The containment that falls out — **three digits inside the
  ring** — is why the stepper stops at 130, and it is asserted.
- **Two labels are not ink**: `.sign-stop .sign-label` and
  `.sign-direction .sign-label`, both white, both by the group's own kind token.
- **The direction panel is the one place colour carries the meaning alone** — the
  exception the rule forced rather than a break from it, since a destination and a
  `custom` plate are both rectangles as wide as their words. **Not the spec's
  reading** (§2.1 gives `direction` a bare plate), and taken deliberately.

## The panel

`SIGN_KINDS` names every kind a document can carry and **`SIGN_PICKER` is the
separate list of what can be chosen**, each entry carrying the payload a fresh
pick starts from. The two now agree, so the split stands as a rule about who names
what rather than a phase gate. **The active button is `disabled`, not merely
highlighted**: a sign's kind is the *whole* payload, so re-picking would reset its
field.

Four kinds add a control and no action, `setSignKind` carrying the whole tagged
kind. **Limit** is the lane stepper's control, ±10 across `10..130`, disabled at
both ends rather than clamping silently. **Label** is a `custom` sign's words.
**Symbol** is a warning's pictogram name, shown and never drawn. **Destination**
is a direction sign's words, which the plate grows to fit; no arrow beside them,
since `Direction` is `{ text }` and nothing else.

## `needsText` is conservative about signs, and the asymmetry is the design

It gates the embedded face (`rules/diagram-export.md`), and its two arms count
different things on purpose: **markings** count exactly what `markingPaint` emits
a `<text>` for; **signs** count `doc.signs.length > 0`, whatever the kind and
label. A sign with an empty label draws a plate and no `<text>`, and the face
travels anyway — refining that would put the kind vocabulary in the export path.
`strokeAllowance` needed **no** change: the widest stroke in the sign layer is the
roundel's ring at `SIGN_RING` (4, an attribute rather than a rule — the triangle's
3 is only the widest in `diagram.css`), so half of it *meets* the `2` floor rather
than passing it, and `getBBox` measures fill. `export.test.ts` pins both.

## The pointer handlers, and the two dead zones

`onBackgroundPointerDown` gained a `sign` arm beside the node one, and **a sign
lands on a road for free** because `onLinkPointerDown` returns early for every
tool but `select` and `marking`, so the event bubbles. **`onSignPointerDown` stops
propagation unconditionally**, then selects and drags under *every* tool: signs
are topmost, so the event can reach no road or glyph group, but not stopping it
would send it to the `<svg>`, whose select tail clears the selection and pans and
whose sign-tool arm would drop a second sign. **Under the sign tool, clicking a
sign drags it rather than stacking another** — the *node* tool's rule, because a
second sign minted beneath the first would be invisible.

**Two dead zones, both a trade and neither a bug**, confirmed in the app: a
sign-tool click over a **node dot** or a **marking** places nothing, because those
handlers claim the event unconditionally. Nudging the click is the remedy.

**One trap:** `Canvas.tsx`'s `onPointerMove` must branch on `d.kind`. Its `else`
arm once dispatched `moveNode` unconditionally, and a sign id there is an identity
no-op via that reducer's layout guard — the sign refuses to move with nothing
thrown and nothing logged.

## The fourth `Selection` arm — and this time the compiler helped

`Selection` gains `{ kind: "sign"; id: SignId }`, and markings §2.6 is why that
cost two **compile errors** instead of three silent misroutes: `selectionValid`
and `deleteSelection` are `switch`es with `default: return unreachable(sel)`.
`isSelected` (`Diagram.tsx`) takes `Selection["kind"]`, so the union cannot lag
the type; what stays silent is forgetting to *call* it, which a markup assertion
covers. The **Inspector is the one genuinely unpoliced site** — an `if` chain
whose tail is the link panel, so the sign branch must come *before* it or
`findLink` runs on a sign id and renders the blank `<aside>`: not a wrong panel
but *no* panel. There is no Inspector test file; that is a `bun run dev` check.

## Open, and deliberately

- **The warning sign's symbol (OQ-6).** A free string naming a pictogram. The
  triangle is drawn and the string is **editable and never drawn** — a readout of
  a field nothing can set would report on hand-edited files only, which is
  `associated_link`'s lesson. A symbol library is a catalogue, not a phase.
- **Snapping a sign to the road it names (OQ-7).** `associated_link` anchors
  nothing by decision; a "put it beside L2" affordance inherits markings OQ-5's
  constraint, the junction's hit disc.
- **No posts, gantries or multi-panel assemblies**, no arrow on a direction plate,
  and no wrapping: a destination is one line however long, and the plate grows
  rather than the text folding.
