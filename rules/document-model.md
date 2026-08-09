---
title: document-model
sources:
  - src-tauri/src/model/mod.rs
  - src-tauri/src/model/graph.rs
  - src-tauri/src/model/layout.rs
  - src-tauri/src/model/decoration.rs
  - src-tauri/src/model/ids.rs
  - src/model/types.ts
  - src/model/document.ts
covers: >
  the three parts of a Document and what separates them, the invariants, the
  Rust-TypeScript mirror discipline and its one instructive exception, and what
  does and does not move SCHEMA_VERSION
max_lines: 130
generated: 2026-08-08
---

# Document Model

Terse by design — read the rustdoc in `src-tauri/src/model/` for field detail.

## Three parts, one `Document`

`Document` (`model/mod.rs`) carries `schema_version`, `metadata` and three parts:

| Part | Types | Leaves for Assimilator? |
|------|-------|------------------------|
| **Semantic graph** | `graph.rs` — `Node`, `Link`, `Lane`, `Junction` | shaped like the `network.yaml` subset; **nothing writes that format** |
| **Layout** (presentation) | `layout.rs` — `Layout`, `Vec2`, `NodeView`, `LinkView`, `JunctionView`, `JunctionGlyph`, `LinkStyle`, `LinkAlign` | ❌ |
| **Decorations** (Zukai-native) | `decoration.rs` — `Marking`, `MarkingKind`, `LinkEnd`, `Sign`, `SignKind` | ❌ Assimilator has no equivalent |

Every collection is defaulted and elided when empty: a new document on disk is `schema_version` and `metadata` alone.

Ids are string newtypes (`ids.rs`, minted by the private `string_id!` macro) so
ids imported from Assimilator keep their names; `LaneIdx` is a plain `u32`. **One
of the five names nothing in a `Document`:** `MovementId` is read by the
`network.yaml` mirror and never stored (`rules/network-yaml.md`).

## Invariants

- The **semantic graph is geometry-free** — no coordinates in `graph.rs`.
  Positions live only in `layout`, keyed by entity id (`BTreeMap`, for stable
  diffs). A missing layout entry is not an error → the renderer auto-places, and
  an orphan entry is ignored.
- **Nothing exports.** Zukai reads `network.yaml` and never writes it, so the
  split does not protect a round trip — it exists because a diagram's positions
  are not the road's. The module rustdoc in `graph.rs` and `layout.rs` still
  describes an export step; that writer was cut in `979a60d`.
- A **junction is a plain graph node** (`type: junction`) plus a `Junction`
  record and a `JunctionView { glyph, rotation, scale }`, keyed by `node_id` — a
  record *about* a node rather than an entity beside it, which is why
  `findJunction` is the one finder in `document.ts` not reading `.id`. The glyph
  is a render hint and the arms are the incident links, so there is no composite
  "roundabout object" and no "gore object": a gore is a node a human labelled,
  and which two arms it sits between is read off the geometry at render time.
- **Which turns a junction permits is not in the model.** A junction says its
  turns with `turn_arrow` markings on the approach (`rules/junctions.md`).

## Rust ↔ TypeScript mirror

`src/model/types.ts` is a **hand-kept mirror**; Rust is authoritative, and the two
stay in sync by hand until `ts-rs` codegen arrives. String-literal unions match
serde's `snake_case` exactly (`NodeKind = "endpoint" | "junction" | "waypoint"`),
so a document built in the frontend serializes to the YAML Rust reads. A Rust
field elided by `skip_serializing_if` is **optional** in TS (`align?`, `anchor?`,
`back?`, `bends?`) — the mirror's one systematic asymmetry.

`document.ts` mirrors three *values* as well: `DEFAULT_LANE_WIDTH`,
`DEFAULT_SPEED_LIMIT` and `DEFAULT_MEDIAN_GAP` restate `graph.rs`'s three
`default_*` functions by hand, so a lane minted in the frontend matches one serde
defaulted.

**Not every Rust type has a TS twin, and the exception is instructive.**
`src-tauri/src/network/` mirrors a *foreign* format only Rust reads —
`NetworkMovement`, `MovementKind` — so it has no counterpart here and must not
grow one. The test is whether a `Document` ever holds the value: if import reads
it and converts it (`from_lanes` becoming a painted arrow), it never crosses IPC
and belongs to the mirror alone.

## Serialization and `SCHEMA_VERSION`

Zukai saves its own YAML through `serde_yaml`, keyed by `SCHEMA_VERSION` in
`mod.rs` — distinct from Assimilator's `network.yaml` `schema_version`. The
`yaml_round_trips` test exercises every part of the model in one sample document.

**A new optional field costs no bump; a new enum *variant* does.** Nothing in
`src-tauri/` derives `deny_unknown_fields`, so an older build ignores a field it
does not know, and `#[serde(default)]` covers the other direction — which is why
`LinkView.align` arrived at version 1. A new variant is not symmetric: an older
build fails to deserialize the *whole document*, and `persist.rs`'s probe rejects
only files declaring a **newer** version, so it cannot turn that into a readable
message unless the version moves with the variant. `JunctionGlyph::Gore` is the
variant that took the version to **2**.

**A *removed* field costs no bump either** — the reading-direction mirror of a new
one. `a_zkai_saved_with_movements_still_loads_and_writes_none` asserts both
halves: serde ignores the stale `movements:` key on the way in, and it is gone on
the way back out.

Three things move together on a bump, and the third is easy to miss:

- `SCHEMA_VERSION` in `model/mod.rs` **and** its mirror in `src/model/types.ts`;
- `persist.rs`'s `rejects_a_newer_schema_version` fixture, which has to stay
  *above* the constant. Left behind it the test silently stops testing anything —
  the probe passes and, since every `Document` field but `schema_version` and
  `metadata` is defaulted, so does the full parse, so `expect_err` fails.
- A **migration arm is only needed if the bump breaks an older file.** Neither
  bump so far does, and `still_loads_a_version_1_file` pins it.

Pair every defaulted field with a `skip_serializing_if` so a document that never
set it saves byte-for-byte as before — `Vec::is_empty` for `bends` and for
`TurnArrow.back`, `Option::is_none` for `Lane.kind`, and a hand-written predicate
(`LinkAlign::is_centre`, `LinkEnd::is_start`) for a plain enum, which has no such
helper. Both predicates are **private to the module that owns the field**, which
is what keeps the pattern copyable: `is_start` lives in `decoration.rs` beside
`Marking.anchor`, not with the layout types its shape was borrowed from. And a
**`Vec` beats an `Option<Vec>`** for the same job: `TurnArrow.back` elided when
empty makes empty and absent one document, so `Some(vec![])` never exists and
emptying the control is the whole route back to a single-headed arrow.

## What a field has to justify

**Some fields were `carried, never edited`** — held only so an imported
`network.yaml` survived a round trip. `Movement` carried `priority`, `yields_to`
and `lane_mapping` for exactly that reason and **lost all three in `fe8b452`**,
when the export was cut: a field whose only justification is surviving a round
trip has none once nothing writes the file.

**`Movement` itself then went the same way** (2026-07-28), the sharper version:
its four remaining fields were genuinely *drawn* as dashed arcs across the
junction pad, so "a field with no reader is not necessarily dead" was satisfied
and the type still had to go. The drawing it fed was the **wrong drawing** —
sixteen arcs webbed over one `cross-4` glyph, saying in the middle of a junction
what a road says with paint on its approach. So a field needs a reason that is
not the round trip, **and the reason has to be a picture somebody wants**.

## On disk

Files use the **`.zkai`** extension, read and written by the `save_document` /
`load_document` Tauri commands in `persist.rs`. YAML is only the on-disk body —
the document crosses IPC as JSON. Because empty collections and layout sub-maps
are elided, that JSON can omit them entirely; the frontend restores them with
`normalizeDocument` (`document.ts`) at exactly one boundary, the `loadDocument`
reducer case. Full path: `rules/persistence.md`.
