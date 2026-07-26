---
status: draft
last_updated: 2026-07-26
note: Put text and roadside signs in the drawing — the font that must travel inside an exported file, painted road text, and the sign vocabulary. Closes export spec OQ-4.
implemented: []
not_implemented: ["Phase 1", "Phase 2", "Phase 3", "Phase 4"]
related: [specs/road_markings_spec.md, specs/diagram_export_spec.md, specs/road_rendering_spec.md]
reference: "Road-atlas and motorway-signage convention — a speed roundel, an octagonal stop, an inverted give-way triangle, a destination plate, and text painted flat on the carriageway. Not to-scale sign dimensions, not a national sign catalogue (no symbol library), and not Assimilator's business at all: `decoration.rs` says signs never export to `network.yaml`."
---

# Signs and Text Spec

## 1. Goal

`specs/road_markings_spec.md` drew every paint a human places **except the two
that need letters**, and said why: the diagram renders zero `<text>`, because an
exported SVG reaches no external font — the first glyph either falls back to
whatever the viewer has or, in the PNG path, **bakes that substitution in
permanently**. That is `diagram_export_spec.md` **OQ-4**, recorded there as
`needs-input` and inherited here as this spec's first paragraph.

So the drawing can say a road is a 3-lane arterial that stops at signals, and
cannot say it is the **M4**. `Sign`, `SignKind` and `Layout.signs` have been in
the model since the first commit (`decoration.rs:91`, `:104`, `layout.rs:53`,
mirrored at `types.ts:137-152`, `:207`) and — exactly as `Marking` was before its
own spec — **nothing has ever read them**: `emptyDocument` seeds both
(`document.ts:38`, `:40`), `normalizeDocument` restores both (`:71`, `:74`), and a
repo-wide search finds no action, no reducer case, no Inspector control and no
element.

End state — a motorway offramp, drawn as a diagram. The `[Pn]` tag on
each line is the phase that enables it:

```
File ▸ a motorway offramp with a signed destination and a limit

  N1 ──L1(motorway, 3 lanes)──▶ N2 (gore) ──L2(ramp, 1 lane)──▶ N3

  Marking tool, click lane 0 on L2         → M1 stop_line, lane 0
    Inspector ▸ Kind ▸ Text ▸ "BUS"        → M1 text{BUS}, lane 0         [P1]
  Sign tool, click beside the ramp         → S1 custom{"…"}, at (x, y)    [P2]
    Inspector ▸ Kind ▸ Speed limit ▸ 50    → S1 speed_limit{50}           [P3]
  Sign tool, click above the gore          → S2
    Inspector ▸ Kind ▸ Direction ▸ "M4 W"  → S2 direction{"M4 W"}         [P4]

  → BUS painted flat along the ramp's kerb lane, a 50 roundel beside it, and a
    destination plate over the gore, sized to the text it carries — and all of
    it survives an export to SVG *and* a rasterized PNG in the intended face
```

Two things this spec is **not** allowed to break, both already asserted:
`export.test.ts` pins that the drawing emits no `<text>` (added by markings Phase
1, `export.test.ts:465`) — that assertion inverts here rather than surviving —
and that the embedded stylesheet stays XML-safe and reference-free, which §2.3
narrows rather than deletes.

## 2. Design

### 2.1 What the model already carries, and exactly how much of it fits

| `SignKind` | Drawn as | In scope |
|---|---|---|
| `speed_limit { kph }` | white roundel, red ring, the number | ✅ Phase 3 |
| `stop` | red octagon, "STOP" | ✅ Phase 3 |
| `give_way` | inverted white triangle, red border | ✅ Phase 3 |
| `priority` | yellow diamond, white border | ✅ Phase 3 |
| `no_entry` | red disc, white bar | ✅ Phase 3 |
| `warning { symbol }` | upright triangle, red border — **the symbol is not drawn** | ⚠️ Phase 3, §2.9 |
| `direction { text }` | a plate sized to its text | ✅ Phase 4 |
| `custom { label }` | a plate carrying the label | ✅ Phase 2 |

Plus `MarkingKind::Text { content }` (`decoration.rs:47`, `types.ts:124`), the
seventh marking kind and the one markings §2.8 cut out — Phase 1 here.

`Sign` is `{ id, kind, associated_link? }` and its **canvas position lives in
`Layout.signs: BTreeMap<SignId, Vec2>`** — the semantic/presentation split
`rules/document-model.md` describes, and the same shape `layout.nodes` takes.
`SignId` is a transparent string newtype, so `nextId(ids, "S")`
(`document.ts:127`) mints one exactly as nodes, links and markings get theirs.

**No Rust, and no `SCHEMA_VERSION` bump** — as with the markings spec, and for
the same reason: every type this spec renders already exists in both mirrors, and
nothing here adds a field or an enum variant. (`rules/document-model.md` has the
rule: a field is free, a variant is not.)

### 2.2 The font is already in the repo, and it is the right one (decision, recorded)

Export OQ-4 is written as an open question with a cost attached ("embedding a
font as a data-URI `@font-face` inside `diagram.css`, which is its own piece of
work with its own size and licensing questions"). Three facts, each verified,
shrink it to a mechanism:

- **It is already a dependency.** `@fontsource/overpass` and
  `@fontsource/overpass-mono` (`package.json:14-15`), imported by `main.tsx:7-12`
  and used by the chrome (`styles.css:25`, `:76`). Nothing new is vendored.
- **It is OFL-1.1** (`node_modules/@fontsource/overpass/LICENSE`), which permits
  embedding — including in a document — provided the notice travels with it
  (§2.3's last paragraph, OQ-5).
- **Overpass is derived from Highway Gothic**, the FHWA signage face. For a
  schematic road diagram that is the correct typeface on its merits, not merely
  the convenient one.

Size, measured rather than guessed: the latin woff2 is 17.0 kB proportional and
**13.2 kB mono**, so a base64 `@font-face` adds ≈18 kB to an exported SVG. No
subsetting in v1 — a subset is a second artefact that can disagree with the face
the canvas draws, which is the drift `rules/diagram-export.md` exists to prevent
(OQ-4).

**The data URI is built by Vite, not checked in.** `import fontUrl from
"@fontsource/overpass-mono/files/overpass-mono-latin-400-normal.woff2?inline"`
yields a `data:` URL at build time, so no 18 kB blob enters the repo and no
generation script has to be kept in step with the dependency. The same transform
runs under vitest, so the export tests see the real thing.

### 2.3 The font breaks a standing invariant, and the invariant is what gives (decision, recorded)

`diagramSvg` embeds `diagram.css` verbatim inside the file's `<style>`
(`export.tsx:176`), and two rules govern what may live there. The second one
survives untouched; the first does not.

- **XML-safety survives.** No `<` or `&` anywhere, comments included, because the
  text is embedded raw inside an XML document (`export.test.ts:207`). Base64's
  alphabet is `A–Z a–z 0–9 + / =` — it cannot contain either.
- **"No `url(`" has to narrow, and it is asserted in eight places**
  (`export.test.ts:140`, `:156`, `:181`, `:342`, `:391`, `:446`, `:495`, `:538`).
  A data-URI `@font-face` needs `url(data:font/woff2;base64,…)`, so the literal
  assertion cannot stand.

**The rule's *intent* is what matters, and it is documented at both of its
sites**: "carries its own styling, with **no external reference**"
(`export.test.ts:132`) and "a `url()` that resolved **anywhere else** would taint
the canvas the PNG path draws into" (`:192`). A `data:` URI resolves nowhere
else — it is the file. So the assertion becomes: **every `url(` in an exported
file is either `url(#…)` (the in-document hatch fragment) or `url(data:…)`**,
written once as a helper the eight sites share, so the constraint gets *stronger*
and more legible rather than being deleted.

**The font travels only when a glyph does.** `needsHatch` (`Diagram.tsx:199`)
already establishes the posture: emit the expensive thing only when the document
references it. A `needsText(doc)` predicate — any `text` marking, any sign — gates
a separate `src/styles/fonts.css` (its own file, injected by `diagramSvg`, *not*
`@import`ed into `diagram.css`, which would fail the no-`@import` assertion at
`export.test.ts:139`). Consequences worth stating: a document with no text
exports **byte-identically to today**, `diagram.css` stays about paint, and the
app keeps loading its font through `@fontsource` rather than a second copy.

**The OFL notice travels with it.** OFL-1.1 requires the copyright and licence
notice to accompany the font, embedded or not. When (and only when) the face is
embedded, `diagramSvg` emits an XML comment carrying it — cheap, correct, and it
lives outside `<style>`, where a `<` is legal.

### 2.4 Drawn text is monospace, which is what makes a plate's width pure (decision, recorded)

A direction plate has to be **as wide as its text**, and an SVG `<text>` has no
width until something lays it out. Three ways to get one:

- **Measure it in the DOM.** Correct, and it makes the exporter impure:
  `measureDiagram` is deliberately "the only DOM-touching function in this
  module" (`export.tsx:93`), and vitest here runs with **no DOM at all** (no
  `environment` in `vite.config.ts`), so nothing about plate sizing would be
  testable.
- **Ship a proportional metrics table**, generated from the woff2. Exact and
  pure, but it is a build artefact that can fall out of step with the font, for a
  drawing that is schematic by construction.
- **Use a monospace face**, where width is `chars × ADVANCE × size`. Pure, exact,
  one number, and testable in the suite that exists.

**Monospace wins.** Zukai's drawn text is **Overpass Mono** — the same Highway
Gothic lineage as the proportional face, so it does not read as a foreign hand,
and it is the smaller file besides (§2.2). `ADVANCE` is the face's advance ratio,
established once in the app the way `MARKING_PITCH` and the arrow's proportions
were, and pinned in `geometry.test.ts` thereafter.

The cost, stated rather than discovered: a long destination sets a wider plate
than proportional type would, and real signage is not monospaced. Revisit only if
it reads badly (OQ-3).

### 2.5 A sign is node-shaped, not marking-shaped (decision, recorded)

The temptation is to reuse the marking pipeline, and the model says not to. A
`Marking` is anchored to a link at a position in metres and derives its point
from the road (`rules/road-markings.md`, "The anchor"); a **`Sign` carries its own
canvas position** in `layout.signs`, and `associated_link` is explicitly "for
context" (`decoration.rs:98`), not an anchor. So:

- placement is `addNode`'s shape, not `addMarking`'s — the sign tool drops a sign
  where the pointer is, on **empty canvas or anywhere else**, and no lane or
  arc-length is derived from the click;
- dragging is `moveNode`'s shape (`moveSign`), which means it inherits history's
  **drag coalescing** and must be added to the same list (`rules/history.md`);
- there is **no delete cascade**. Deleting a link cannot orphan a sign the way it
  orphaned a marking, because no sign depends on a link to be drawable. What it
  *can* leave is a dangling `associated_link`, and the answer is to **clear the
  field, not delete the sign** — a sign is free-standing by design, and one that
  vanished because an unrelated road was deleted would be the surprising
  behaviour. (Markings' cascade lesson, applied in the other direction.)

### 2.6 The fourth `Selection` arm — and this time the compiler helps

`Selection` gains `{ kind: "sign"; id: SignId }`. Markings §2.6 is the reason
that is a smaller job than it was: two of the four narrowing sites were converted
to `switch`es with `default: return unreachable(sel)` **precisely so a fourth
selection kind would not repeat the three silent failures**, and both now fail to
compile until this arm is handled (`state.ts:305`, `:863`).

Exactly what is and is not caught, because the difference is the whole point:

| Site | Adding the arm |
|---|---|
| `selectionValid` (`state.ts:295`) | **compile error** — `unreachable(sel)` |
| `deleteSelection` (`state.ts:794`) | **compile error** — `unreachable(selection)` |
| `isSelected` (`Diagram.tsx:444`) | **silent** — its `kind` parameter is its own union, widened by hand |
| `Inspector` (`Inspector.tsx:129`) | **silent** — an `if` chain whose tail is the link panel |

So the two that used to drop a selection across undo and dirty the document while
deleting nothing are now mechanical, and the two remaining silent ones are named
here and tested in Phase 2's gate.

### 2.7 What each kind paints, and what carries the meaning

Every sign is drawn from two numbers — its position and one build constant,
`SIGN_SIZE` — in the manner of `GORE_LENGTH`/`TAPER_LENGTH`: a sign is a
**symbol**, not a scale model, so it does not shrink with a narrow ramp the way a
turn arrow does.

**Shape carries the meaning, colour confirms it.** An octagon reads as "stop" in
grey; a red disc without the white bar is not a no-entry. That ordering is what
lets Phase 3 be pure geometry plus five palette entries — and `diagram.css`'s
variable block gains its first **sign** colours (`--sign-red`, and the existing
`--paint-white`/`--paint-yellow` reused), commented as such so nothing later
mistakes them for road paint.

Three constraints a plausible implementation gets wrong:

- **A sign is its own layer, above the junction glyphs.** Markings sit *below*
  the glyphs because paint under a pad is genuinely covered (markings §2.7); a
  sign is beside the road, not on it, and must never be occluded. So the sign
  layer renders **after** the nodes, and it is the topmost thing in the drawing.
- **Text is `text-anchor="middle"` on a point, never a laid-out box.** One
  `<text>` per sign, centred, with no `dominant-baseline` (WebKit's support in a
  rasterized SVG is the exact class of thing OQ-1 covers) — the baseline offset
  is arithmetic from `SIGN_SIZE` instead.
- **Painted road text is *not* a sign** and takes the marking anchor, so it
  rotates with the road and sits in a lane. It is the one place text is drawn at
  an angle, which is why Phase 1 has to settle the transform before any sign
  needs it.

### 2.8 Where the logic lives

| Piece | Where | Pure? |
|---|---|---|
| `ADVANCE`, `TEXT_SIZE`, `SIGN_SIZE`, `textWidth`, `markingText`, `signPlate` | `src/editor/geometry.ts` | ✅ vitest |
| `needsText`, `SignShape`, the sign layer, the `text` arm of `markingPaint` | `src/components/Diagram.tsx` | ✅ via `renderToStaticMarkup` |
| `Interaction.onSignPointerDown` | `src/components/Diagram.tsx` | — |
| The `@font-face`, and the `?inline` import that builds it | `src/styles/fonts.css` + `src/editor/export.tsx` | ✅ `export.test.ts` |
| Sign paint | `src/styles/diagram.css` | — reaches exports free |
| `addSign`/`moveSign`/`setSignKind`, the `Selection` arm, the `associated_link` clear | `src/editor/state.ts` | ✅ `state.test.ts` |
| The sign tool, its `TOOL_KEYS` entry `s` | `src/components/Canvas.tsx`, `Toolbar.tsx`, `App.tsx` | — |
| The sign Inspector branch, the marking text field | `src/components/Inspector.tsx` | — |

`strokeAllowance` (`export.tsx:69`) is expected to need **no** change — a sign is
fill and thin strokes, and `measureDiagram`'s `getBBox` measures the text box
itself. **That last clause is the risk, not a reassurance**: `getBBox` on a
`<text>` whose face has not loaded returns a *fallback-font* box, and the export
would frame the drawing to the wrong size. See OQ-2.

### 2.9 Non-goals

- **No symbol library.** `SignKind::Warning { symbol }` is a free string naming a
  pictogram (`bend_right`, `pedestrians`, `roundabout`); drawing them is a
  catalogue of artwork, not a phase. The **triangle** is drawn and carries
  "warning"; the symbol string is shown in the Inspector and not rendered. OQ-6.
- **No posts, gantries, or multi-panel assemblies.** One sign is one plate — and
  no arrow on a direction plate either: a destination that points needs a
  direction the model does not carry (`SignKind::Direction` is `{ text }` and
  nothing else), so it would be a guess or a new field, and this spec adds
  neither.
- **No text wrapping, no multi-line, no rotation of sign text.** A destination is
  one line; painted road text rotates with the road because the road is what it
  is painted on.
- **No font subsetting** in v1 (§2.2, OQ-4), and no second face — one family,
  one weight.
- **Not `MarkingKind::Hatching`**, which markings §2.10 still owns.
- **Nothing reaches `network.yaml`.** `decoration.rs:1-6` says it outright:
  Assimilator has no concept of either markings or signs, so neither ever
  exports. This spec adds no import/export surface.

## 3. Open questions

- **OQ-1** — **Does WKWebView rasterize a data-URI `@font-face` inside an
  `<img>`-loaded SVG?** `rasterizePng` loads the file through a blob URL into an
  `Image` (`export.tsx:205-215`), which puts the SVG in *secure static mode*: no
  external fetches at all. A `data:` URI is not a fetch and this is the standard
  embedding technique, but the engine here is WebKit and the failure mode is
  silent substitution rather than an error. **This blocks nothing until Phase 1,
  and Phase 1's gate is exactly this experiment.** Fallback if it fails: convert
  text to path outlines at export time — which costs a font-parsing dependency
  *and* breaks `rules/diagram-export.md`'s one-tree rule unless the canvas draws
  outlines too. (needs-experiment; the one genuine risk in this spec.)
- **OQ-2** — **Does `measureDiagram` have to wait for the font?** `getBBox` on a
  `<text>` measures whatever face is currently resolved, so a measurement taken
  before `document.fonts.ready` frames the export to a fallback-font box — a
  clipped or over-padded file, silently. Making it `await`-ing turns a sync
  function async and changes its one caller. (answerable-from-code; settle in
  Phase 1, where the first `<text>` appears.)
- **OQ-3** — **Monospace or proportional?** §2.4 takes monospace and says why.
  Revisit only if a destination plate reads badly in the app. (design-call,
  taken.)
- **OQ-4** — **Subset the embedded face?** ≈18 kB per exported SVG buys the whole
  latin range and zero drift from the canvas. A digits-and-caps subset would be
  ~2 kB but is a second artefact. (design-call; proposed: no subset until a file
  size complains.)
- **OQ-5** — **Where exactly does the OFL notice go?** An XML comment in the
  exported SVG is proposed (§2.3). A PNG has nowhere to carry one at all, which
  may be fine — the licence governs the font software, and a raster contains no
  font. (needs-input; does not block Phase 1's mechanism, only its wording.)
- **OQ-6** — **What does a `warning` sign look like with no symbol?** An empty
  triangle is honest but says only "warning". The alternatives are drawing the
  symbol string as text inside it (ugly, and it defeats the shape-carries-meaning
  rule of §2.7) or dropping the kind from the picker until a symbol library
  exists. (design-call; proposed: the empty triangle, with the string in the
  Inspector.)
- **OQ-7** — **Should a sign snap to the road it is associated with?**
  `associated_link` exists and is unused as an anchor by §2.5's decision. A "put
  it beside L2" affordance is plausible later; it is also markings OQ-5's problem
  wearing a different hat, and inherits its constraint (the junction hit disc).
  (design-call; not in scope for any phase here.)

## 4. Implementation phases

Strictly sequential; each is one plan-mode pass with a concrete exit gate.

### Phase 1 — A glyph in the drawing: the font, and painted road text

- **Scope:** the smallest change that puts a letter on screen *and in a raster* —
  and it needs no new selection, tool, or lifecycle, because painted text is a
  `Marking` and the whole pipeline for one already exists.
  - *Font:* `src/styles/fonts.css` built from a `?inline` woff2 import (§2.2);
    `needsText(doc)` and the conditional injection in `diagramSvg`; the OFL
    notice; narrowing the eight `url(` assertions to the shared helper of §2.3.
  - *Geometry:* `TEXT_SIZE`, `ADVANCE`, `textWidth(s)`, and `markingText(anchor,
    content)` in `geometry.ts` — the rotated, lane-centred baseline.
  - *Drawing:* the `text` arm of `markingPaint` (`Diagram.tsx:557`), which today
    falls through to the placeholder bar; `.marking-text` in `diagram.css`.
  - *Inspector:* a text field in the marking panel, dispatching `setMarkingKind`
    with `{ type: "text", content }` — the **fourth** dispatcher of that action
    and still no new one, which is what markings Phase 2's "carry the whole
    tagged `MarkingKind`" bought.
- **Exit gate:** `bun run build` + `bun run test` green.
  - `geometry.test.ts`: `textWidth` is exactly `chars × ADVANCE × TEXT_SIZE`;
    `markingText` centres on the lane band and runs along the road, pinned on a
    due-east and a due-north road so the rotation is not a magnitude test.
  - `export.test.ts`: a document with no text embeds **no** `@font-face` and its
    markup is unchanged; a document with text embeds exactly one, the stylesheet
    stays XML-safe, and every `url(` in the file is `url(#…)` or `url(data:…)`.
    The `emits no text at all` assertion (`:465`) inverts to *no text unless the
    document asks for it*.
  - **The load-bearing one, and it is not a unit test: export a PNG from the app
    and confirm the glyphs are Overpass Mono, not a system fallback** (OQ-1).
    Compare against the SVG opened in a browser. If it substitutes, stop and take
    OQ-1's fallback rather than proceeding to Phase 2.
  - A `bun run dev` pass: paint `BUS` in a lane, check it rides the road on a
    bent link, and settle `ADVANCE`/`TEXT_SIZE` in the app.
- **Docs touched:** `rules/road-markings.md` (a seventh kind, and the `default`
  arm loses `text`); `rules/diagram-export.md` — the "no external reference" rule
  and the standing no-font constraint both change here; export spec **OQ-4
  RESOLVED**; the project-memory roadmap.

### Phase 2 — A sign exists: place, select, drag, delete  (depends on Phase 1)

- **Scope:** the whole pipeline for **one** kind (`custom`, the one needing no
  vocabulary), so Phases 3–4 are only geometry — the shape markings Phase 1 took.
  - *State:* `Tool` gains `"sign"`; `Selection` gains its fourth arm and the four
    sites of §2.6 (two of them compile errors); `addSign` (minting via
    `nextId(…, "S")`, writing `layout.signs`), `moveSign` (added to history's
    coalescing list), `setSignKind`, the `deleteSelection` arm, and the
    `associated_link` **clear** on link deletion (§2.5).
  - *Canvas/Diagram:* a sign tool and `TOOL_KEYS` entry `s`;
    `Interaction.onSignPointerDown`; `SignShape` and the sign layer **above the
    nodes** (§2.7), with hit target and halo gated on `interaction`.
  - *Inspector:* a sign branch — kind readout, the label field, `associated_link`,
    Delete.
- **Exit gate:** `bun run build` + `bun run test` green. `state.test.ts`: placing
  and dragging a sign are undoable, a drag coalesces to one snapshot, deleting a
  selected sign removes exactly it, deleting an *associated link* clears the field
  and **keeps the sign**, and a sign selection survives undo/redo. `Diagram.test.tsx`:
  a sign draws at its layout position, above the junction glyphs; a sign with no
  layout entry emits nothing (the hand-edited case); an empty document is still
  `<g class="diagram"></g>`. A `bun run dev` pass: place, drag, select, delete.
- **Docs touched:** a new `rules/signs.md` or a section in `rules/road-markings.md`
  — decide in the plan, on the same "who chose it" line markings Phase 1 used;
  `rules/history.md` for `moveSign`'s coalescing.

### Phase 3 — The vocabulary: the shapes that carry the meaning  (depends on Phase 2)

- **Scope:** `speed_limit`, `stop`, `give_way`, `priority`, `no_entry`, and
  `warning`'s empty triangle (§2.9, OQ-6) — pure geometry per §2.7's table, plus
  the palette's first sign colours and a kind picker in the Inspector (with a
  `kph` stepper for the roundel).
- **Exit gate:** `bun run build` + `bun run test` green. `geometry.test.ts`: the
  octagon has eight equal sides and the give-way triangle points **down** while
  the warning triangle points up — a shape test, since a magnitude one passes
  under a flip. `Diagram.test.tsx`: each kind emits its own class token and its
  own element count; the roundel carries its number as the drawing's second
  `<text>`. `export.test.ts`: every kind travels, colours and all, with the
  stylesheet rules still XML-safe and reference-free. A `bun run dev` pass on §1's
  50 roundel.

### Phase 4 — Direction signs, and text that sizes its plate  (depends on Phase 3)

- **Scope:** `direction { text }` — the one kind whose geometry depends on its
  content. `signPlate(text)` from §2.4's `textWidth`, padded by a build constant;
  and a text field in the Inspector.
- **Exit gate:** `bun run build` + `bun run test` green. `geometry.test.ts`: a
  plate's width is `textWidth(text) + 2 × padding` and grows monotonically with
  the text; an empty string still yields a drawable plate rather than a zero-width
  one. `Diagram.test.tsx`: the text is centred in its plate at every length.
  `export.test.ts`: a long destination round-trips with no clipping — the
  `measureDiagram`/OQ-2 interaction, verified on the widest sign in the suite.
  A `bun run dev` pass on §1's `M4 W` plate, plus a PNG export of it.
- **Docs touched:** `rules/signs.md`; `rules/diagram-export.md` if OQ-2 changed
  `measureDiagram`'s signature; the project-memory roadmap; mark this spec
  `implemented`.
