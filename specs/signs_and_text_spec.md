---
status: implemented (all 4 phases, 2026-07-26; reviewed in 2 rounds)
last_updated: 2026-07-26
note: Put text and roadside signs in the drawing — the font that must travel inside an exported file, painted road text, and the sign vocabulary. Closes export spec OQ-4.
implemented: ["Phase 1", "Phase 2", "Phase 3", "Phase 4"]
not_implemented: []
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
  Sign tool, click beside the ramp         → S1 custom{""}, at (x, y)     [P2]
    Inspector ▸ Link ▸ L2                  → S1 associated_link = L2      [P2]
    Inspector ▸ Kind ▸ Speed limit ▸ 50    → S1 speed_limit{50}           [P3]
  Sign tool, click above the gore          → S2 custom{""}
    Inspector ▸ Kind ▸ Direction ▸ "M4 W"  → S2 direction{"M4 W"}         [P4]

  → BUS painted flat along the ramp's kerb lane, a 50 roundel beside it, and a
    destination plate over the gore, sized to the text it carries — and all of
    it survives an export to SVG *and* a rasterized PNG in the intended face
```

Two things this spec is **not** allowed to break, both already asserted:
`export.test.ts` pins that the drawing emits no `<text>` and names no
`font-family` (added by markings Phase 1, `export.test.ts:465`, and repeated at
`:494` and `:539`) — which §2.3 keeps holding for every text-free document rather
than deleting — and that the embedded stylesheet stays XML-safe and
reference-free, which §2.3 narrows rather than deletes.

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
- **It is OFL-1.1** (`node_modules/@fontsource/overpass-mono/LICENSE` — the mono
  package, since the mono face is the one embedded), which permits embedding —
  including in a document — provided the notice travels with it (§2.3's last
  paragraph, OQ-5).
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

**That import is JavaScript, so the `@font-face` is built in TypeScript — there
is no `fonts.css`.** A `.css` file cannot carry the import, and the repo's only
CSS-embedding route is `?raw` (`export.tsx:26`), which does **no** URL rewriting:
a `url(…)` written literally in a stylesheet would travel into the exported file
as an unresolved external reference — precisely the invariant §2.3 exists to
protect. So the face lives in a new `src/editor/fonts.ts`:

- `FONT_FAMILY = "Overpass Mono"` — the family name, verified against
  `node_modules/@fontsource/overpass-mono/metadata.json` (`"family": "Overpass
  Mono"`) and against what the app already loads (`main.tsx:11`). **One
  constant, two consumers** — the `@font-face` below and the markup attribute of
  §2.3 — so the file and the canvas cannot name different faces.
- `fontFaceCss()` — a template literal returning
  `@font-face{font-family:"Overpass Mono";font-style:normal;font-weight:400;src:url(${fontUrl}) format("woff2")}`.

This is not a hole in `rules/diagram-export.md`'s one-definition-site rule: that
rule governs **paint**, which must match between canvas and file, and the
`@font-face` is not paint — it is where the bytes come from, and the canvas gets
its bytes from `@fontsource` (`main.tsx:11`) instead. What must not drift is the
*family name*, and that is the single constant above.

`tsc` is satisfied without a new declaration: `vite/client.d.ts:253` declares
`*?inline`, and `src/vite-env.d.ts:1` references it.

### 2.3 The font breaks a standing invariant, and the invariant is what gives (decision, recorded)

`diagramSvg` embeds `diagram.css` verbatim inside the file's `<style>`
(`export.tsx:176`), and two rules govern what may live there. The second one
survives untouched; the first does not.

- **XML-safety survives.** No `<` or `&` anywhere, comments included, because the
  text is embedded raw inside an XML document (`export.test.ts:207`). Base64's
  alphabet is `A–Z a–z 0–9 + / =` — it cannot contain either.
- **"No `url(`" is asserted in eight places** (`export.test.ts:140`, `:156`,
  `:181`, `:342`, `:391`, `:446`, `:495`, `:538`) **and would survive by
  accident, which is the reason to change it.** All eight are scoped to
  `embeddedCss()`, which reads only the *first* `<style>` — so the second block's
  `url(data:font/woff2;base64,…)` never reaches them and every one keeps passing
  untouched. That is a gap, not a pass: the constraint people believe is asserted
  ("this file references nothing outside itself") would silently stop covering
  the one new thing that could violate it.

**The rule's *intent* is what matters, and it is documented at both of its
sites**: "carries its own styling, with **no external reference**"
(`export.test.ts:132`) and "a `url()` that resolved **anywhere else** would taint
the canvas the PNG path draws into" (`:192`). A `data:` URI resolves nowhere
else — it is the file. So the assertion becomes: **every `url(` in the whole
exported file — not merely the first stylesheet — is either `url(#…)` (the
in-document hatch fragment) or `url(data:…)`**, written once as a helper the
eight sites share. Widening the *subject* from `embeddedCss()` to the file is
what makes this stronger rather than weaker: it is the only version of the rule
that can actually fail on an embedded font.

**The font travels only when a glyph does.** `needsHatch` (`Diagram.tsx:199`)
already establishes the posture: emit the expensive thing only when the document
references it. A `needsText(doc)` predicate gates `fontFaceCss()`, which
`diagramSvg` injects as a **second `<style>`, emitted after** the `diagram.css`
one — never `@import`ed into it, which would fail the no-`@import` assertion at
`export.test.ts:139`. **The order is load-bearing, not cosmetic:**
`embeddedCss()` (`export.test.ts:48`) slices from the *first* `<style>` to the
*first* `</style>`, so a font block emitted first would silently redirect every
existing assertion about `.road-casing`, `--asphalt` and XML-safety onto the
wrong stylesheet. `needsText` is exported from `Diagram.tsx` (unlike
module-private `needsHatch`) because its consumer is `export.tsx`.

**What `needsText` counts, exactly** — it must agree with what the tree actually
emits, or the file carries 18 kB for no glyph (or, worse, a glyph with no face):

- **Phase 1:** any `text` marking whose `content` is **non-empty**. Empty
  `content` emits **no `<text>`** — but not nothing: it takes `markingPaint`'s
  transverse-bar fall-through, exactly as an empty `turn_arrow` does today, so
  the picker's fresh `{ type: "text", content: "" }` is a marking you can see,
  select and type into rather than an invisible object findable only by accident.
  (That fall-through's doc-comment currently names `hatching` **and** `text` as
  out of scope; it loses `text` here and keeps `hatching`.) So the rule is:
  `<text>` iff non-empty, and `needsText` counts the same condition — one
  predicate, no way for the font and the glyph to disagree.
- **Phase 2 onward:** `|| doc.signs.length > 0`. Deliberately *not* refined to
  "signs whose kind draws a glyph" — a give-way triangle and a priority diamond
  carry no letters, but teaching the export path the kind vocabulary to save
  18 kB on a rare sign-without-text document is a table that can fall out of step
  with what Phase 3 draws. One conservative predicate, recorded here so a later
  pass doesn't read it as an oversight.

**Where `font-family` is declared is the trap, and it is not `diagram.css`.**
Four existing assertions forbid the *substring* `font-family` in files exported
from documents that carry no text — `export.test.ts:468` and `:471` (the whole
file, and the stylesheet), and `:494` and `:539` on the give-way/crossing/arrow
and double-centreline documents. A rule in `diagram.css` fails all four, because
that stylesheet is embedded verbatim in **every** export; putting it only in the
gated font block would leave the *canvas* drawing painted text in the inherited
proportional `"Overpass"` while the file drew Overpass Mono — the exact
canvas/file drift `rules/diagram-export.md`'s two-importer rule exists to
prevent, and it would make OQ-2's mis-measurement certain rather than possible.

So **`font-family` and `font-size` travel as presentation attributes on the
`<text>` element**, from `FONT_FAMILY` and `TEXT_SIZE`. That is not a new
mechanism: the turn arrow already carries its `stroke-width` as an attribute
rather than a rule, for the same reason — it is derived from a build constant
rather than chosen as paint (`Diagram.tsx:580`, pinned at `export.test.ts:509`).
`diagram.css` gains only `.marking-text { fill: … }`, which is paint.

Three consequences worth stating. A document with no text exports **the same
markup and the same font posture as today** — no `<text>`, no `@font-face`, no
`font-family` — so the four assertions above hold **unchanged**, and the test at
`:465` is *reframed* (its name and doc-comment now say "no text unless the
document asks for it") rather than inverted, since `painted()` carries no text
and its body still passes verbatim. Not *byte*-identical, and the difference is
worth being exact about: `diagram.css` gains one `.marking-text { fill: … }`
rule, which every export carries the way it already carries `.marking-zebra` for
a document with no crossing. `diagram.css` stays about paint; and the app keeps
loading its font through `@fontsource` rather than a second copy.

**The OFL notice travels with it.** OFL-1.1 requires the copyright and licence
notice to accompany the font, embedded or not. When (and only when) the face is
embedded, `diagramSvg` emits an XML comment carrying the attribution
`metadata.json` states — `Copyright 2021 The Overpass Project Authors
(https://github.com/RedHatOfficial/Overpass)`, SIL OFL 1.1 — cheap, correct, and
it lives outside `<style>`, where a `<` is legal. (It contains no `--`, which is
the one sequence an XML comment may not carry.)

### 2.4 Drawn text is monospace, which is what makes a plate's width pure (decision, recorded)

A direction plate has to be **as wide as its text**, and an SVG `<text>` has no
width until something lays it out. Three ways to get one:

- **Measure it in the DOM.** Correct, and it makes the exporter impure:
  `measureDiagram` is deliberately "the only DOM-touching function in this
  module" (`export.tsx:93`), and vitest here runs with **no DOM at all** —
  `vitest.config.ts` is standalone from `vite.config.ts` and sets
  `environment: "node"` explicitly (with `css: true`, which is what lets the
  export tests read a real stylesheet) — so nothing about plate sizing would be
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

**Pinned as a literal, not as its own formula.** Asserting `textWidth(s) === s.length
× ADVANCE × TEXT_SIZE` restates the implementation and would pass for any wrong
`ADVANCE`; the load-bearing question is whether the number *is* Overpass Mono's
advance ratio. So it is **measured once** — `ctx.measureText("MMMM").width / 4 /
fontSize` in the app with the face loaded, during Phase 1's `bun run dev` pass —
recorded in the constant's doc-comment with that provenance, and pinned as a bare
number in `geometry.test.ts`, the way `MARKING_PITCH` and `CROSSWALK_DEPTH` are.
A face swap then fails a test instead of silently resizing every plate.

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
  **Both arms of `deleteSelection`, not just the link one:** the node arm
  (`state.ts:825`) drops every incident link, so it can strand exactly the same
  reference — which is why the markings cascade handles both
  (`state.ts:790-792`, "Both the link arm and the node arm drop them"). The node
  arm already builds the `dropped` set the clear needs.

`associated_link` is also **written** in Phase 2, by a `setSignLink` action
behind a link picker in the Inspector. Without one the field would be permanently
empty from the UI — a readout of something nothing can set, and a clear-on-delete
reachable only from a hand-edited file. The picker is a `<select>` over
`doc.links` plus a "None" option; the sign renders identically either way, since
§2.5's whole point is that the field anchors nothing.

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
deleting nothing are now mechanical. The two still-silent ones are named here and
covered unevenly, which Phase 2's gate says out loud rather than glossing:
`isSelected` gets a markup assertion (a selected sign carries its halo), while the
`Inspector` — which has **no test file anywhere in the repo** — is checked in the
`bun run dev` pass. Both are in Phase 2's scope either way; only the regression
net differs.

### 2.7 What each kind paints, and what carries the meaning

Every sign is drawn from two numbers — its position and one build constant,
`SIGN_SIZE` — in the manner of `GORE_LENGTH`/`TAPER_LENGTH`: a sign is a
**symbol**, not a scale model, so it does not shrink with a narrow ramp the way a
turn arrow does.

**Shape carries the meaning, colour confirms it.** An octagon reads as "stop" in
grey; a red disc without the white bar is not a no-entry. That ordering is what
lets Phase 3 be pure geometry plus **one** new palette entry: `diagram.css`'s
variable block gains its first **sign** colour, `--sign-red`, commented as such
so nothing later mistakes it for road paint. The rest of a sign is drawn from
what the palette already carries — `--paint-white` (`diagram.css:30`) for a
plate, `--paint-yellow` (`:31`) for the priority diamond, `--ink` (`:38`) for
text on a light plate.

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
| `needsText` (**exported** — its consumer is `export.tsx`), `SignShape`, the sign layer, the `text` arm of `markingPaint` | `src/components/Diagram.tsx` | ✅ via `renderToStaticMarkup` |
| `Interaction.onSignPointerDown` | `src/components/Diagram.tsx` | — |
| `FONT_FAMILY`, `fontFaceCss()`, and the `?inline` import that builds it | `src/editor/fonts.ts` | ✅ `export.test.ts` |
| The gated second `<style>` and the OFL comment | `src/editor/export.tsx` | ✅ `export.test.ts` |
| Sign paint, `.marking-text` fill — **but not `font-family`/`font-size`**, which are attributes (§2.3) | `src/styles/diagram.css` | — reaches exports free |
| `addSign`/`moveSign`/`setSignKind`/`setSignLink`, the `Selection` arm, the `associated_link` clear in **both** delete arms | `src/editor/state.ts` | ✅ `state.test.ts` |
| The sign tool, its `TOOL_KEYS` entry `s` | `src/components/Canvas.tsx`, `Toolbar.tsx`, `App.tsx` | — |
| The sign Inspector branch and its link picker, the marking text field, `MARKING_PICKER`'s `text` entry | `src/components/Inspector.tsx` | — |

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

- **OQ-1 RESOLVED — yes** (Phase 1, 2026-07-26). Measured in a real WKWebView
  running the exact `rasterizePng` path — Blob, object URL, `Image`,
  `canvas.drawImage`, readback. The string `IIIIIIII` (chosen because eight `I`s
  ink 4.718 em monospaced and about 2.2 em in any proportional fallback, where
  `BUS` in Overpass Mono and in Helvetica land within a pixel of each other) inks
  **58 px** with the `@font-face` block present and **32 px** with it deleted,
  against **56.6 px** predicted from the face's own metrics. A second, independent
  fallback — the bytes embedded under a family name nothing asks for — agrees with
  the first to the pixel. The canvas is **not** tainted and `toBlob` returned
  4,954 bytes, so §1's PNG claim stands and the outline fallback below was never
  reached. The original question, kept for the reasoning:

  **Does WKWebView rasterize a data-URI `@font-face` inside an
  `<img>`-loaded SVG?** `rasterizePng` loads the file through a blob URL into an
  `Image` (`export.tsx:205-215`), which puts the SVG in *secure static mode*: no
  external fetches at all. A `data:` URI is not a fetch and this is the standard
  embedding technique, but the engine here is WebKit and the failure mode is
  silent substitution rather than an error. **This blocks nothing until Phase 1,
  and Phase 1's gate is exactly this experiment.** Fallback if it fails: convert
  text to path outlines at export time — which costs a font-parsing dependency
  *and* breaks `rules/diagram-export.md`'s one-tree rule unless the canvas draws
  outlines too. **That fallback is deliberately not designed here, and "stop"
  means escalate, not improvise:** if the experiment fails, Phase 1 lands its
  geometry and its SVG path, the PNG claim is struck from §1, and the spec comes
  **back to review** with outlines as a new phase — Phases 2–4 are not blocked by
  it (a sign draws in SVG either way), but §1's "survives a rasterized PNG" is.
  (needs-experiment; the one genuine risk in this spec.)
- **OQ-2 RESOLVED — yes, and it is one `await`** (Phase 1). `getBBox` on a
  `<text>` measures whatever face is currently resolved, so a measurement taken
  before `document.fonts.ready` frames the export to a fallback-font box — a
  clipped or over-padded file, silently. `measureDiagram` is now `async` and
  awaits `document.fonts?.ready`, **gated on `needsText(doc)`** so a document with
  no glyph is measured exactly as before. Its one caller (`exportDiagram`,
  `files.ts`) was already `async`, so the change is a single `await`.
  `strokeAllowance` needed nothing: text is fill and `getBBox` includes fill,
  confirmed by an assertion rather than assumed.
- **OQ-3** — **Monospace or proportional?** §2.4 takes monospace and says why.
  Reads well in the app at `TEXT_SIZE = 6` for `BUS`, `M4 W` and `SLOW` in a
  3-lane road. Revisit only if a destination plate reads badly. (design-call,
  taken.)
- **OQ-4** — **Subset the embedded face?** ≈18 kB per exported SVG buys the whole
  latin range and zero drift from the canvas. A digits-and-caps subset would be
  ~2 kB but is a second artefact. (design-call; proposed: no subset until a file
  size complains.)
- **OQ-5 RESOLVED** — **Where exactly does the OFL notice go?** An XML comment
  in the exported SVG, emitted by `diagramSvg` only when the face is embedded,
  carrying the attribution
  `node_modules/@fontsource/overpass-mono/metadata.json` states verbatim:
  `Copyright 2021 The Overpass Project Authors
  (https://github.com/RedHatOfficial/Overpass)`, SIL OFL 1.1. A PNG carries
  nothing, and that is correct rather than a gap — the licence governs the font
  *software*, and a raster contains no font. Landed in §2.3.
- **OQ-6 TAKEN — the empty triangle, with the string editable in the Inspector**
  (Phase 3). An empty triangle is honest and says "warning", which is what §2.7's
  shape-first rule buys; drawing the symbol string as text inside it would defeat
  exactly that, and dropping the kind from the picker would leave a model kind the
  app cannot reach. The field is an `<input>` rather than a readout for
  `associated_link`'s reason — a field nothing can set reports on hand-edited files
  only. A symbol library remains out of scope. (design-call, taken.)
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
  - *Font:* `src/editor/fonts.ts` — `FONT_FAMILY` and `fontFaceCss()` from a
    `?inline` woff2 import (§2.2); `needsText(doc)` (exported) and the
    conditional **second** `<style>`, emitted **after** `diagram.css`'s, in
    `diagramSvg`; the OFL comment; narrowing the eight `url(` assertions to the
    shared helper of §2.3.
  - *Geometry:* `TEXT_SIZE`, `ADVANCE`, `textWidth(s)`, and `markingText(anchor,
    content)` in `geometry.ts` — the rotated, lane-centred baseline.
  - *Drawing:* the `text` arm of `markingPaint` (`Diagram.tsx:557`), which today
    falls through to the placeholder bar — emitting one `<text>` with
    `font-family`/`font-size` **attributes** (§2.3), and the bar for empty
    content, which is the `turn_arrow` case's existing shape (`noFallthroughCasesInSwitch`
    means the arm `break`s to the bar rather than falling through implicitly);
    `.marking-text` (fill only) in `diagram.css`. Selection is unaffected either
    way — `.marking-hit`/`.marking-halo` are drawn by `MarkingShape`
    (`Diagram.tsx:499-508`), outside `markingPaint`.
  - *Inspector:* `MARKING_PICKER` (`Inspector.tsx:76`) gains
    `{ type: "text", content: "" }` — it deliberately omits `text` today — plus a
    text field in the marking panel dispatching `setMarkingKind` with
    `{ type: "text", content }`: the **fourth** dispatcher of that action and
    still no new one, which is what markings Phase 2's "carry the whole tagged
    `MarkingKind`" bought.
- **Exit gate:** `bun run build` + `bun run test` green.
  - `geometry.test.ts`: `ADVANCE` equals its **measured literal** (§2.4) — the
    assertion that can fail — and `textWidth` is `chars × ADVANCE × TEXT_SIZE`;
    `markingText` centres on the lane band and runs along the road, pinned on a
    due-east and a due-north road so the rotation is not a magnitude test.
  - `export.test.ts`: a document with no text embeds **no** `@font-face` and its
    markup is unchanged; a document with text embeds exactly one, both
    stylesheets stay XML-safe, and every `url(` in the file is `url(#…)` or
    `url(data:…)`. The four `font-family` assertions on text-free documents
    (`:468`, `:471`, `:494`, `:539`) must still pass **unmodified** — that is the
    check that `font-family` stayed out of `diagram.css` (§2.3). `embeddedCss()`
    still returns the `diagram.css` block, which pins the injection order; a text
    document's font block is read separately. The test at `:465` is **reframed,
    not inverted** — its body is unchanged (`painted()` carries no text); its
    name and doc-comment change from "the constraint the whole spec is cut
    around" to *no text unless the document asks for it*, and the comment's claim
    that `Sign` is out of scope until a font is embedded is now the thing that
    just happened.
  - A text marking with `content: ""` emits no `<text>` and no `@font-face` —
    and still draws its bar, so it stays visible and selectable (§2.3).
  - **The load-bearing one, and it is not a unit test: export a PNG from the app
    and confirm the glyphs are Overpass Mono, not a system fallback** (OQ-1).
    Compare against the SVG opened in a browser. If it substitutes, **stop and
    escalate** on OQ-1's terms — land the SVG path, strike §1's PNG claim, and
    return the spec to review — rather than improvising the outline fallback.
  - A `bun run dev` pass: paint `BUS` in a lane, check it rides the road on a
    bent link, and **measure** `ADVANCE` (§2.4) and settle `TEXT_SIZE` in the app.
- **Docs touched:** `rules/road-markings.md` (a seventh kind, and the `default`
  arm loses `text`); `rules/diagram-export.md` — the "no external reference" rule
  and the standing no-font constraint both change here; export spec **OQ-4
  RESOLVED**; the project-memory roadmap.
- **As built (2026-07-26)** — five departures from the plan above, each recorded
  because a later phase reads this section as the contract:
  - **`markingText(anchor)` takes no `content`.** The geometry does not depend on
    the string — `text-anchor="middle"` centres it — and `noUnusedParameters`
    rejects a parameter kept for symmetry. `textWidth(content)` is the separate
    function for the case that does care, which is Phase 4's plate.
  - **A third constant, `CAP_HEIGHT`.** §2.7 forbids `dominant-baseline`, so
    centring a run on its band is arithmetic, and arithmetic needs the number.
  - **Both ratios come from the face's own tables, not from `ctx.measureText`.**
    `hmtx` gives every glyph an advance of 1232 and `OS/2.sCapHeight` is 1400,
    against a 2000-unit em — so `ADVANCE = 0.616` and `CAP_HEIGHT = 0.7` exactly,
    with no rasterizer rounding in them. §2.4's canvas method was run as a check
    and agrees: `getBBox().width` on `BUS` in the app is 11.09375 against
    `3 × 0.616 × 6 = 11.088`.
  - **`state.ts` was touched, which Phase 1's scope did not anticipate.** The
    Words field dispatches per keystroke so the paint follows the typing, and
    `coalesceKeyFor` gained a **non-empty-content** text key so a word is one undo
    step while the picker's empty seed stays its own. `rules/history.md` records
    the boundary and why it is drawn there.
  - **`export.test.ts`'s shared helper keeps the stricter rule too.** §2.3 widens
    the subject from `embeddedCss()` to the whole file; `expectSelfContained`
    additionally keeps `diagram.css`'s no-`url(`-at-all form, so the widening adds
    coverage without trading any away.
  - One trap worth naming, caught by the existing assertions rather than by
    review: **`diagram.css` may not even *spell* `font-family` or `@font-face`**,
    comments included, because four assertions forbid the substring across the
    whole file. `.marking-text`'s comment talks around both.

### Phase 2 — A sign exists: place, select, drag, delete  (depends on Phase 1)

- **Scope:** the whole pipeline for **one** kind (`custom`, the one needing no
  vocabulary), so Phases 3–4 are only geometry — the shape markings Phase 1 took.
  - *State:* `Tool` gains `"sign"`; `Selection` gains its fourth arm and the four
    sites of §2.6 (two of them compile errors); `addSign` (minting via
    `nextId(…, "S")`, seeding `custom { label: "" }`, writing both `doc.signs`
    and `layout.signs`), `moveSign` (added to `coalesceKeyFor`, `state.ts:217`,
    which today names only `moveNode`), `setSignKind`, `setSignLink`, the
    `deleteSelection` arm, and the `associated_link` **clear** in **both** the
    link and node arms (§2.5).
  - *Canvas/Diagram:* a sign tool and `TOOL_KEYS` entry `s` (free today,
    `App.tsx:22-26`); `Interaction.onSignPointerDown`; `SignShape` and the sign
    layer **above the nodes** (§2.7), with hit target and halo gated on
    `interaction`; `needsText` extended to `doc.signs.length > 0` (§2.3).
  - *Inspector:* a sign branch — kind readout, the label field, the
    `associated_link` picker, Delete.
- **Exit gate:** `bun run build` + `bun run test` green. `state.test.ts`: placing
  and dragging a sign are undoable, a drag coalesces to one snapshot, deleting a
  selected sign removes exactly it, and a sign selection survives undo/redo
  (`selectionValid`'s new arm) — plus the cascade in **both** directions:
  deleting an *associated link* clears the field and **keeps the sign**, and so
  does deleting a *node the associated link is incident to* (§2.5). `Diagram.test.tsx`:
  a sign draws at its layout position, above the junction glyphs; a **selected**
  sign carries `is-selected`/its halo, which is the regression net for the
  hand-widened `isSelected` (`Diagram.tsx:444`, one of §2.6's two silent sites);
  a sign with no layout entry emits nothing (the hand-edited case); an empty
  document is still `<g class="diagram"></g>`. The Inspector — §2.6's *other*
  silent site — has no test file anywhere in the repo, so it is checked in the
  `bun run dev` pass rather than claimed as automated: place, drag, select,
  delete, and confirm the panel shows the sign branch and not the blank `<aside>`
  fall-through.
- **Docs touched:** a new `rules/signs.md` or a section in `rules/road-markings.md`
  — decide in the plan, on the same "who chose it" line markings Phase 1 used;
  `rules/history.md` for `moveSign`'s coalescing.
- **As built (2026-07-26)** — six departures from the plan above, each recorded
  because Phases 3–4 read this section as the contract:
  - **`signPlate(label)` sizes the plate to its text, which was Phase 4's job.**
    A fixed `SIGN_SIZE` box overflows at about five characters, and `custom` is
    precisely the free-text kind — so `max(SIGN_SIZE, textWidth(label) + 2 *
    PLATE_PAD)` landed here instead, with `SIGN_SIZE` demoted to the floor that
    keeps an empty label drawable. **Phase 4 is correspondingly smaller**: the
    `direction` kind and its Inspector field, with its plate assertions (monotonic
    growth, an empty string still drawable, centred at every length) already met
    in `geometry.test.ts`.
  - **A new `rules/signs.md`**, not a section of `rules/road-markings.md` — §2.5
    spends its length proving a sign is not a marking, and that file's first
    section is "The anchor", which a sign does not have.
  - **The plate's height is `TEXT_SIZE * 2`, and the baseline is arithmetic from
    `TEXT_SIZE * CAP_HEIGHT`** — not from `SIGN_SIZE` as §2.7 says. §2.7's
    *constraint* (no `dominant-baseline`) holds; its arithmetic was loose. Using
    Phase 1's number is what keeps one centring rule for both text sites, and
    `geometry.test.ts` asserts the plate's baseline against `markingText`'s
    directly rather than against a literal they both happen to match. A square
    plate also reads as a card rather than as a sign.
  - **The halo is gated on `selected`, not on `interaction`** as Phase 2's scope
    line says — the latter would ring every sign on the canvas. `MarkingShape`'s
    existing split (hit target on `interaction`, halo on `selected`).
  - **`isSelected`'s `kind` parameter is typed off `Selection`** rather than
    widened by hand. §2.6's table calls the site "silent"; passing `"sign"` to the
    hand-written union was in fact a compile error, so what is *genuinely* silent
    is forgetting to call it at all — which the markup assertion covers and no
    signature can.
  - **`rules/diagram-export.md` was touched too**, which the line above omits: its
    standing description of `needsText` said the predicate counts exactly what the
    tree emits a `<text>` for, and that is now true of one arm and deliberately
    false of the other.
  - Two traps worth naming, both caught by running the thing rather than by
    review: **`Canvas.tsx`'s `onPointerMove` fails silently** if its `else` arm
    keeps dispatching `moveNode` — a sign id there is an identity no-op via that
    reducer's layout guard, so the sign simply refuses to move; and
    **`clearSignLinks` is a `map` where `keepMarkings` is a `filter`**, so array
    identity has to be recovered by a pre-check rather than by a length
    comparison.

### Phase 3 — The vocabulary: the shapes that carry the meaning  (depends on Phase 2)

- **Scope:** `speed_limit`, `stop`, `give_way`, `priority`, `no_entry`, and
  `warning`'s empty triangle (§2.9, OQ-6) — pure geometry per §2.7's table, plus
  the palette's first sign colours and a kind picker in the Inspector (with a
  `kph` stepper for the roundel).
- **Exit gate:** `bun run build` + `bun run test` green. `geometry.test.ts`: the
  octagon has eight equal sides and the give-way triangle points **down** while
  the warning triangle points up — a shape test, since a magnitude one passes
  under a flip. `Diagram.test.tsx`: each kind emits its own class token and its
  own element count; the roundel carries its number as a `<text>` (the drawing's
  *second* only in a document that also carries painted text — assert the
  roundel's own element, not an index into the file). `export.test.ts`: every kind travels, colours and all, with the
  stylesheet rules still XML-safe and reference-free. A `bun run dev` pass on §1's
  50 roundel.
- **As built (2026-07-26)** — six departures from the plan above, each recorded
  because Phase 4 reads this section as the contract:
  - **`signBox(kind)` was not in the scope line, and the phase does not work
    without it.** Phase 2's chrome inflates `signPlate(label).box`, which is
    `TEXT_SIZE * 2` tall — so a halo grown from it rings a 22-unit roundel from the
    *inside*. The box is now the plate's for the two kinds that carry words and the
    `SIGN_SIZE` square for the six that do not, with `signPlateLabel` as the single
    place that decides which is which (Phase 4 flips `direction` on one line).
    `inflate` widened from `SignPlate` to a new `SignChrome`, which `SignPlate`
    extends.
  - **The roundel's number keeps `TEXT_SIZE`; the ring got fat instead.** §2.4 fixes
    one type size for the whole drawing, so closing the white space inside a 22-unit
    disc is `SIGN_RING = 4`'s job rather than a second constant only one sign would
    use. What falls out is a containment rule in the manner of `ARROW_REACH`: **three
    digits fit inside the ring**, asserted in `geometry.test.ts`, and it is why the
    Inspector's stepper stops at 130.
  - **`BASELINE_DROP` is a fourth constant**, extracted rather than added: Phase 1's
    centring expression was written out in `markingText` and `signPlate`, and Phase 3
    needed it at two more sites (a roundel's number, an octagon's `STOP`). One
    exported constant, four callers, and the existing assertion that the two text
    sites agree still holds by construction.
  - **The warning symbol is an editable field, not a readout.** §2.9 says only that
    the string is "shown in the Inspector", and Phase 2's review had already rejected
    a readout of something nothing can set (`associated_link`). It is the panel's
    third `<input>` and takes a third coalescing key, `signSymbol:<id>` — a key per
    **field**, not per sign.
  - **The Kind picker's active button is `disabled`.** A sign's kind is the whole
    payload, so re-picking the current one resets its field; `MarkingKindPicker`
    does not have this problem because a marking's `position` and `lane` live
    outside its kind.
  - **`priority` is two polygons and `no_entry` is a disc plus a rect**, so §2.1's
    "one shape per kind" reading is not quite what shipped: a white outer edge needs
    the plate's ink outline to hold against light paper, and a red disc *without* the
    bar is a different sign. Both are recorded in `rules/signs.md`'s table, which is
    the one that now says what each kind emits.

### Phase 4 — Direction signs, and text that sizes its plate  (depends on Phase 3)

- **Scope:** `direction { text }` — the one kind whose geometry depends on its
  content. `signPlate(text)` from §2.4's `textWidth`, padded by a build constant;
  and a text field in the Inspector. **`signPlate` landed in Phase 2** (see its
  As-built note), so what remains here is the kind itself and its field; the
  geometry gate below is already met and is kept as the regression net.
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
- **As built (2026-07-26)** — one real departure and three notes; the phase was as
  small as its scope line promised, because Phase 2 had already built the plate:
  - **A direction plate is green with white letters, which §2.1's table does not
    say.** Taken deliberately, and the reasoning is §2.7's own rule reaching its
    limit rather than a break from it: shape carries the meaning and colour
    confirms it — but a destination and a `custom` plate are *both* rectangles as
    wide as their words, so no shape **can** separate them, and without a colour
    the two kinds draw identical pictures differing only in a class token. So the
    palette takes a second sign colour, `--sign-green`, and two rules on the group's
    own kind token (`.sign-direction .sign-plate`, `.sign-direction .sign-label`) —
    `.sign-stop .sign-label`'s existing form, which is what made this cheap. The
    plate's dark outline stays: that is what holds any plate against light paper.
  - **The kind itself was one line.** `signPlateLabel`'s `direction` arm returns
    `kind.text` instead of `""`, and the plate, the hit box and the halo all widen
    with it — the single-place-that-decides rule Phase 3 wrote `signBox` around,
    collecting on itself. `signPaint` needed no code at all, only a comment that
    had said the difference "is Phase 4's".
  - **A fourth coalescing key, `signText:<id>`.** A key per *field* still, so the
    Destination and Label runs stay distinguishable in the stack — asserted by
    typing a label, picking Direction, typing a destination, and undoing twice onto
    the label still whole. `SIGN_PICKER` withholds nothing now, which is the first
    time it and `SIGN_KINDS` have agreed.
  - **The gate's `export.test.ts` clause needed restating, not skipping.** "A long
    destination round-trips with no clipping" is `measureDiagram`'s question and
    that function needs a DOM this suite does not have (§2.4). What is asserted
    instead is the half that *decides* it: the plate is fill with a 1-unit outline,
    so `strokeAllowance` on a 19-character destination is still the road's, and
    `getBBox` — which measures fill — already contains the letters. The framing
    itself was checked in the app, on a PNG export.

## 5. Review log

**Round 1 — 2026-07-26 — `NOT READY` → fixed.** Clean-room reviewer with repo
access; every `file:line` in §§1–2.8 verified against the source, and the `?inline`
transform confirmed to survive vitest.

*Two blocking findings, both accepted:*

1. **Where `font-family` is declared was never stated, and all three candidate
   homes broke something the spec asserted.** `diagram.css` fails four existing
   `font-family` assertions on text-free documents (`export.test.ts:468`, `:471`,
   `:494`, `:539` — the spec had named only `:465`) and falsifies its own
   "byte-identical" claim; the gated font block alone would drift the canvas from
   the file. **Resolved** in §2.3: `font-family`/`font-size` travel as
   presentation attributes on the `<text>`, on the turn arrow's existing
   `stroke-width` precedent, so all four assertions hold **unchanged** and the
   `:465` test is *reframed*, not inverted (§1 and Phase 1's gate corrected to
   match).
2. **The `?inline` import cannot live in `src/styles/fonts.css`**, and `?raw`
   does no URL rewriting, so a literal `url(…)` in a stylesheet would have
   travelled as an unresolved external reference — breaking the very invariant
   §2.3 protects. **Resolved** in §2.2: `fonts.css` is dropped for
   `src/editor/fonts.ts` (`FONT_FAMILY` + `fontFaceCss()`), emitted as a second
   `<style>` **after** `diagram.css`'s so `embeddedCss()` keeps measuring the
   right block.

*Non-blocking, accepted:* the `<style>` ordering hazard (folded into the above);
the stale vitest citation (it is `vitest.config.ts`, `environment: "node"`, not
"no `environment` in `vite.config.ts`"); §2.6's overclaim that both silent sites
are tested (`isSelected` gets a markup assertion, the Inspector has no test file
in the repo and is a `bun run dev` check); the `associated_link` clear needs the
**node** arm too; nothing could ever *set* `associated_link` (Phase 2 gains
`setSignLink` and a link picker, rather than shipping a dead readout);
`MARKING_PICKER`'s missing `text` entry and the fresh-pick payloads
(`content: ""`, `custom { label: "" }`, and empty content renders nothing);
`textWidth`'s tautological assertion (`ADVANCE` is now a measured, pinned
literal); §2.7's palette arithmetic (one new entry, not five); the OFL citation
pointing at the proportional package; `needsText` needing export across the
`Diagram.tsx`/`export.tsx` boundary; and OQ-1's missing failure branch (a failed
raster experiment now escalates and returns the spec to review, explicitly).

*Also resolved this round:* **OQ-5**, with the exact attribution string from
`@fontsource/overpass-mono/metadata.json`.

*Rejected:* the suggestion that **Phase 1 may overflow one plan-mode pass** — it
is the largest phase, but splitting the font pipeline from painted text would
leave the font untestable, since painted text is the only thing that exercises
it. The reviewer's own read was "probably one pass"; recorded here so the size is
a known risk rather than an oversight.

**Round 2 — 2026-07-26 — `READY`.** Same reviewer resumed. Both blockers
confirmed resolved, **zero new blocking findings**. It verified the precondition
the attribute mechanism rests on and the spec had only asserted: no author rule
can override a presentation attribute on the canvas's `<text>`, since
`styles.css`'s only universal rule is `* { box-sizing: border-box }` (`:30`) and
every `font-family` there is either on a chrome class or on the root — reaching
an SVG `<text>` by *inheritance*, which loses to a declaration on the element
itself. Also confirmed end to end: the `*?inline` typing chain
(`vite/client.d.ts:253` → `src/vite-env.d.ts:1` → `tsconfig.json`'s
`include: ["src"]`), that `fontFaceCss()`'s `font-weight:400` is the weight
`main.tsx:11` actually loads, that the OFL string is byte-for-byte
`metadata.json`'s, that exporting `needsText` into `export.tsx` adds no import
cycle, and that no existing test builds a document with signs, so Phase 2's
`needsText` widening cannot disturb the suite.

*Three non-blocking residues, all folded in this round:*

- **§2.3's premise was stale in the spec's own favour.** All eight `url(`
  assertions are scoped to `embeddedCss()`, which never sees the second
  `<style>` — so they would keep passing untouched rather than "not standing".
  Rewritten as the sharper point: they survive *by accident*, which is a coverage
  gap, and the fix is to widen the subject from the first stylesheet to the whole
  file.
- **"Byte-identically to today" was overstated** — `diagram.css` gains
  `.marking-text { fill: … }`. Restated precisely (same markup, same font
  posture; one more paint rule, as `.marking-zebra` already is for a document
  with no crossing).
- **Phase 3's "the drawing's second `<text>`"** presumed a document that also
  carries painted text; the gate now asserts the roundel's own element rather
  than an index.

Two further implementation details it surfaced were folded into Phase 1:
`noFallthroughCasesInSwitch` makes the empty-content `break` to the bar the
natural shape, and `.marking-hit`/`.marking-halo` live in `MarkingShape`
(`Diagram.tsx:499-508`), so selection holds whichever way that arm goes.

**Converged in 2 rounds.** `status: draft` → `reviewed`; cleared for
implementation, starting with Phase 1.
