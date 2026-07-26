# Signs

The objects a human stands *beside* the road: how a sign is placed, moved,
selected and deleted, what it is drawn from, and why none of that reuses the
marking pipeline. Frontend only — `Sign`, `SignKind` and `Layout.signs` have been
in the model since the first commit, so nothing here crosses IPC, reaches disk on
its own terms, or moves `SCHEMA_VERSION`. The design rationale lives in
`specs/signs_and_text_spec.md`; hand-maintained.

**One of the eight kinds is drawn.** `custom { label }` is a plate carrying its
label (spec Phase 2); the other seven fall through to the same bare plate until
Phase 3 gives them shapes. Nothing about a sign ever reaches `network.yaml` —
`decoration.rs` says it outright: Assimilator has no concept of one.

## A sign is node-shaped, not marking-shaped

This is the decision everything below descends from. A `Marking` is anchored to a
link at a position in metres and **derives** its point from the road
(`rules/road-markings.md`, "The anchor"). A `Sign` is `{ id, kind,
associated_link? }` and **carries its own canvas position** in `Layout.signs`, so
nothing about it is derived from a road at all. Three consequences:

| | Marking | Sign |
|---|---|---|
| Placement | `addMarking` — a click on a road, projected to arc-length + lane | `addSign` — a click *anywhere*, stored verbatim |
| Dragging | none; it has no position of its own | `moveSign`, on `moveNode`'s shape (coalescing included) |
| A deleted road | drops the marking | **clears `associated_link`, keeps the sign** |

`layout.signs[id]` is a **bare `Vec2`**, not the `{ pos }` wrapper `layout.nodes`
uses — it mirrors Rust's `BTreeMap<SignId, Vec2>` (`layout.rs`). That asymmetry is
the reflex error of the whole subsystem, which is why there is deliberately **no
`signPos` helper** to hide it: `nodePos` exists because `NodeView` wraps its
point, and a helper that merely re-exported a `Vec2` would add a name and nothing
else. Both directions of the mistake are compiler-caught.

## The four actions

| Action | Shape it copies | Note |
|---|---|---|
| `addSign(pos)` | `addNode` | writes `doc.signs` **and** `doc.layout.signs`; always `custom { label: "" }`; selects it |
| `moveSign(id, pos)` | `moveNode` | guards on the **layout** entry, returning `state` by identity |
| `setSignKind(id, kind)` | `setMarkingKind` | carries the **whole tagged `SignKind`**, so Phases 3–4 add controls and no actions |
| `setSignLink(id, link?)` | `setMarkingLane` | `link` absent clears the key; guards on both the sign and the link |

`associated_link` is stored as an **absent key**, never `undefined` — the
one-representation rule `Lane.kind`, `LinkView.align` and `Marking.lane` already
follow, matching Rust's `skip_serializing_if = "Option::is_none"`.

There is no `deleteSign` action, for the reason there is no `deleteMarking`: the
Inspector's Delete dispatches `deleteSelection`, as the node and link panels do
and as the Delete/Backspace key does, so a separate action would have no
dispatcher.

**Two coalescing keys** (`rules/history.md`): `moveSign:<id>` for the drag, and
`signLabel:<id>` for the Label field, which dispatches per keystroke so the plate
follows the typing. The label key excludes the **empty** string, as the marking's
Words field does — here the empty seed arrives from `addSign`, a different action,
so the carve-out is doing nothing yet; it is there for Phase 3's Kind picker,
which will mint `custom { label: "" }` through `setSignKind` and meet Phase 1's
hazard exactly.

## What removes a sign, and what does not

**Nothing but deleting it.** A deleted road cannot orphan a sign the way it
orphaned a marking, because nothing about a sign depends on a link to be drawable.
What a deleted road *can* leave is a dangling `associated_link`, and the answer is
to **clear the field**: a sign that vanished because an unrelated road was deleted
would be the surprising behaviour. Both delete arms carry it, because the node arm
drops every incident link and so strands exactly the same reference — it reuses
the `dropped` set it already builds for the marking cascade.

```
deleteSelection on a link → clearSignLinks(signs, l => l === id)
deleteSelection on a node → clearSignLinks(signs, l => dropped.has(l))
deleteSelection on a sign → the sign, from doc.signs *and* doc.layout.signs
```

**`clearSignLinks` is a `map` where `keepMarkings` is a `filter`, and that is the
whole difficulty.** A `filter` recovers array identity from a length comparison; a
`map` always returns a fresh array, so the check has to come first
(`signs.some(stranded)` before mapping). It is not about dirtying — both arms
rebuild `doc` regardless, since each is removing something — but about a document
whose signs never named the deleted road **still sharing the array** with its
history snapshots, the way `rules/history.md` assumes every untouched sub-tree
does. `state.test.ts` asserts the identity directly, since no behavioural
assertion can see it.

The **sign arm of `deleteSelection` has two places to delete from**, so it checks
before touching either: deleting a sign that is already gone must return `doc`
itself, or history takes a snapshot for no change.

`Diagram` skips a sign with no `layout.signs` entry, which only a hand-edited
document can produce — the node layer's own skip, for the same reason.

## The sign layer is the topmost thing in the drawing

`SignShape`s render in `Diagram` **after the nodes and the junction glyphs**, and
that is the exact opposite of the marking layer's rule: paint sits *below* the
glyphs because a pad is the intersection's own surface and paint under one is
genuinely covered, while a sign stands beside the road rather than on it and must
never be occluded.

The layer is an **unwrapped `.map()`**, never a `<g class="signs">` around it: a
document with no sign has to render as exactly `<g class="diagram"></g>`, which
`Diagram.test.tsx` pins twice.

The kind's class token comes from the model — `kind.type.replace(/_/g, "-")`, so
`speed_limit` → `.sign-speed-limit` — rather than from a table that could fall out
of step as Phase 3 adds shapes.

### What one sign is drawn from

Everything is drawn **about the origin** and the group is translated to the sign's
position, the way `NodeShape` and `JunctionGlyphShape` are.

| Element | Where its rule lives | Note |
|---|---|---|
| `.sign-hit` | `styles.css` | the plate inflated by 3; gated on `interaction` |
| `.sign-halo` | `styles.css` | inflated by 4; gated on **`selected`**, not on `interaction` |
| `.sign-plate` | `diagram.css` | light plate, dark outline — the inverse of the road |
| `.sign-label` | `diagram.css` | **fill only**; the face and size are attributes |

**One hit box and one halo for every kind**, whatever the plate becomes — the
marking layer's rule (its hit target is the anchor's bar for all six kinds)
applied here for the same reason: selecting a sign has to feel identical across
the vocabulary, so Phase 3 changes only the paint.

**An empty label emits no `<text>` at all**, and the plate is what keeps a freshly
placed sign visible and selectable — the empty text marking's placeholder bar,
again. `needsText` deliberately does *not* model that (see below).

`SIGN_SIZE` (22) is the symbol size Phase 3's shapes will take in both directions,
and the **floor** on a plate's width. `signPlate(label)` is
`max(SIGN_SIZE, textWidth(label) + 2 * PLATE_PAD)` wide and `TEXT_SIZE * 2` tall —
the height is the **type it carries**, not `SIGN_SIZE`, because a square plate
reads as a card rather than as a sign. The label is centred by **arithmetic**, not
`dominant-baseline` (whose support inside a rasterized SVG is the class of thing
that fails silently in the PNG path): the baseline drops `TEXT_SIZE * CAP_HEIGHT /
2`, which is the *identical* rule `markingText` centres a run on its lane band
with. `geometry.test.ts` asserts the two against each other rather than against
two numbers that happen to match.

**The plate sizes to its text from Phase 2 on**, ahead of the spec's plan (which
reserved it for Phase 4's direction plate): a fixed box overflows at about five
characters, and `custom` is the free-text kind. Phase 4 inherits the function.

A sign is a **symbol, not a scale model** — it does not shrink beside a narrow
ramp the way a turn arrow does — which is also why the plate's outline takes
`non-scaling-stroke` on the canvas, on `.jn-priority`'s precedent: a 1-unit
outline that scaled away at low zoom would stop separating a white plate from
light paper.

## `needsText` is conservative about signs, and the asymmetry is the design

`needsText(doc)` (exported from `Diagram.tsx`, consumed by `export.tsx`) gates the
embedded face. Its two arms count different things on purpose:

- **markings** — exactly what `markingPaint` emits a `<text>` for, i.e. non-empty
  content, so the font and the glyph cannot disagree;
- **signs** — `doc.signs.length > 0`, whatever the kind and whatever the label.

A sign with an empty label draws a plate and no `<text>`, and the face travels
anyway. Refining that would put the kind vocabulary in the export path, where it
can fall out of step with what Phase 3 draws; ≈18 kB on a rare
sign-without-letters document is the price, and it is recorded here so a later
pass does not read it as an oversight. `export.test.ts` pins both halves.

`strokeAllowance` needed **no** change and `export.test.ts` confirms it rather
than assuming: a plate is fill with a 1-unit outline, half of which is well under
the `2` floor, and `getBBox` measures fill with no allowance at all.

## The pointer handlers, and the two dead zones

- **`onBackgroundPointerDown` gained a `sign` arm** beside the node one. It drops
  a sign at `worldPoint(e)` and derives nothing else from the click.
- **A sign lands on a road for free.** `onLinkPointerDown` returns early for every
  tool but `select` and `marking` ("let other tools act on the background"), so
  the event bubbles to the background handler and the sign lands where the pointer
  was.
- **`onSignPointerDown` stops propagation unconditionally**, then selects and
  drags under *every* tool. Signs are the topmost layer, so the event can reach no
  road, marking or glyph group — but not stopping it would send it to the `<svg>`,
  whose select tail clears the selection and pans, and whose sign-tool arm would
  drop a second sign.
- **Under the sign tool, clicking a sign drags it rather than stacking another** —
  the *node* tool's rule, not the marking tool's. A marking belongs to a road with
  room for two and has a 12-unit hit strip that is hard to avoid; a sign is a
  free-standing object at a point, and a second one minted exactly beneath the
  first would be invisible.

**Two dead zones, both a trade and neither a bug**, confirmed in the app: a
sign-tool click over a **node dot** or over a **marking** places nothing, because
`onNodePointerDown` and `onMarkingPointerDown` claim the event unconditionally.
This is the same trade `rules/road-markings.md` already records in the other
direction ("a marking is a small dead zone for the node tool"). Nudging the click
is the whole remedy.

## The fourth `Selection` arm — and this time the compiler helped

`Selection` gains `{ kind: "sign"; id: SignId }`. Markings §2.6 is why that cost
two **compile errors** instead of three silent misroutes: `selectionValid` and
`deleteSelection` are `switch`es with `default: return unreachable(sel)`, and
neither builds until the new arm is handled.

The other two sites are still not policed, and are covered unevenly:

| Site | Adding the arm | Covered by |
|---|---|---|
| `selectionValid` (`state.ts`) | **compile error** | that, plus an undo/redo test |
| `deleteSelection` (`state.ts`) | **compile error** | that, plus a delete test |
| `isSelected` (`Diagram.tsx`) | compiles once its parameter is `Selection["kind"]` | a markup assertion: a selected sign carries its halo, an unselected one does not |
| `Inspector` (`Inspector.tsx`) | **silent** — an `if` chain whose tail is the link panel | the `bun run dev` pass; there is no Inspector test file in the repo |

`isSelected`'s `kind` parameter is now **derived from `Selection`** rather than
hand-listed, so the union can no longer lag the type. What stays silent is
forgetting to *call* it: an element that never lights up is no build error.

The Inspector's sign branch must come **before the link tail**, which runs
`findLink` on whatever id it gets and renders the blank `<aside>` — not a wrong
panel but *no* panel, the exact scar markings §2.6 left.

## Where each piece lives

| Piece | Where | Tested by |
|---|---|---|
| `SIGN_SIZE`, `PLATE_PAD`, `SignPlate`, `signPlate` | `src/editor/geometry.ts` | `geometry.test.ts` (pure) |
| `SignShape`, `inflate`, the sign layer, `needsText`'s second arm, `Interaction.onSignPointerDown` | `src/components/Diagram.tsx` | `Diagram.test.tsx` via `renderToStaticMarkup` |
| `addSign`/`moveSign`/`setSignKind`/`setSignLink`, the `Selection` arm, `clearSignLinks` and the two clears | `src/editor/state.ts` | `state.test.ts` |
| `findSign` | `src/model/document.ts` | transitively |
| `.sign-plate`, `.sign-label` — paint, and the only sign rules that reach an export | `src/styles/diagram.css` | `export.test.ts` |
| `.sign`, `.sign-hit`, `.sign-halo`, `.sign-link-select` — interaction, so **not** in `diagram.css` | `src/styles.css` | `export.test.ts`'s `CHROME` regex |
| The sign tool: the background arm, `onSignPointerDown`, the `Drag` arm | `src/components/Canvas.tsx` | the `bun run dev` pass — SVG bubbling is what is under test |
| The toolbar button and `TOOL_KEYS` entry `s` | `src/components/Toolbar.tsx`, `src/App.tsx` | — |
| The sign panel: `SIGN_KINDS`, `SignLabel`, `SignLink` | `src/components/Inspector.tsx` | the `bun run dev` pass |

One trap that is not obvious from the table: **`Canvas.tsx`'s `onPointerMove` must
branch on `d.kind`**. Its `else` arm used to dispatch `moveNode` unconditionally,
and a sign id there is an identity no-op via that reducer's layout guard — the
sign would refuse to move with nothing thrown and nothing logged.

## Open, and deliberately

- **The warning sign's symbol (spec OQ-6).** `SignKind::Warning { symbol }` is a
  free string naming a pictogram; Phase 3 draws the triangle and shows the string
  in the Inspector, and a symbol library is a catalogue of artwork rather than a
  phase.
- **Snapping a sign to the road it names (spec OQ-7).** `associated_link` exists
  and anchors nothing by decision. A "put it beside L2" affordance is plausible
  later, and inherits markings OQ-5's constraint: the junction's hit disc.
- **No posts, gantries, or multi-panel assemblies**, and no arrow on a direction
  plate — `SignKind::Direction` is `{ text }` and nothing else, so an arrow would
  be a guess or a new field.
