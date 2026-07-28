# Document Model

Authoritative map of Zukai's document model. Terse by design — read the rustdoc in
`src-tauri/src/model/` for field-level detail. Hand-maintained: update this when
the model changes.

## Three parts, one `Document`

A `Document` (`src-tauri/src/model/mod.rs`) has three deliberately-separated parts:

| Part | Files | Exports to Assimilator? |
|------|-------|------------------------|
| **Semantic graph** | `graph.rs` — `Node`, `Link`, `Lane`, `Junction`, `Movement`, `SignalPlan`, `Phase` | ✅ yes — this is the `network.yaml`-compatible subset |
| **Layout** (presentation) | `layout.rs` — `Vec2`, `NodeView`, `LinkView`, `JunctionView`, `JunctionGlyph`, `LinkStyle`, `LinkAlign` | ❌ dropped on export |
| **Decorations** (Zukai-native) | `decoration.rs` — `Marking`, `Sign`, `LinkEnd` | ❌ never — Assimilator has no equivalent |

Ids are string newtypes (`ids.rs`) so ids imported from Assimilator survive a
round-trip. Lane index is `u32`.

## Invariants

- The **semantic graph is geometry-free** — no coordinates live in `graph.rs`.
  Positions live only in `layout`, keyed by entity id (`BTreeMap` for stable
  diffs). A missing layout entry is not an error → the renderer auto-places.
- **Presentation never round-trips through Assimilator.** Export serializes the
  graph and synthesizes placeholder geometry; import rebuilds layout from a naive
  seed. This is why the split is physical, not just conceptual.
- A **junction is a plain graph node** (`type: junction`) plus a `Junction` record
  and a `JunctionView { glyph, rotation, scale }`. The glyph (roundabout /
  signalized_cross / gore / …) is a render hint; the arms are the incident links.
  There is no composite "roundabout object" — and equally no "gore object": a
  gore is a node the human labelled, and which two of its arms it is drawn
  between is read off the geometry at render time.

## Rust ↔ TypeScript mirror

`src/model/types.ts` is a **hand-kept mirror** of the Rust model. The Rust side is
authoritative; keep them in sync by hand until `ts-rs` codegen is introduced.
String-literal unions in TS match serde's `snake_case` output exactly (e.g.
`NodeKind = "endpoint" | "junction" | "waypoint"`, `MovementKind` uses
`"u-turn"`), so a document built in the frontend serializes to the same YAML the
Rust side reads. When you change a Rust type, change its TS twin in the same pass.

## Serialization

Zukai saves its own YAML (schema keyed by `SCHEMA_VERSION` in `mod.rs`, distinct
from Assimilator's `network.yaml` `schema_version`), via `serde_yaml`. The model
round-trips — see the tests in `mod.rs`.

**A new optional field costs no `SCHEMA_VERSION` bump; a new enum *variant*
does.** Nothing in `src-tauri/` uses `deny_unknown_fields`, so an older build
ignores a field it does not know, and `#[serde(default)]` covers the other
direction — which is why `LinkView.align` was added at `SCHEMA_VERSION = 1`. A
new variant of an existing enum is not symmetric: an older build fails to
deserialize the *whole document*, and `persist.rs`'s version probe only rejects
files declaring a **newer** version, so it cannot turn that into a useful message
unless the version moves with the variant. `JunctionGlyph::Gore` is the variant
that took the version to **2**.

Three things move together on a bump, and the third is easy to miss:

- `SCHEMA_VERSION` in `src-tauri/src/model/mod.rs` **and** its TypeScript mirror
  in `src/model/types.ts`;
- `persist.rs`'s `rejects_a_newer_schema_version` fixture, which has to stay
  *above* the constant. Left behind it the test silently stops testing anything —
  the probe passes and, since every other `Document` field is
  `#[serde(default)]`, so does the full parse, so `expect_err` fails.
- A **migration arm is only needed if the bump breaks an older file.** Neither
  bump so far does: a version-1 document is a valid version-2 document, and
  `persist.rs` carries a test that one still loads.

Pair every defaulted field with a `skip_serializing_if` so a document that never
set it saves byte-for-byte as before — `Vec::is_empty` for `bends`,
`Option::is_none` for `Lane.kind`, and a hand-written predicate
(`LinkAlign::is_centre`, `LinkEnd::is_start`) for a plain enum, which has no such
helper. Both predicates are **private to the module that owns the field**, which
is what keeps the pattern copyable: `is_start` lives in `decoration.rs` beside
`Marking.anchor`, not with the layout types its shape was borrowed from.

**A new optional field costs no bump, and a brand-new enum *type* reached only
through one does not change that.** `LinkView.align` arrived that way at version
1 and `Marking.anchor` (with `LinkEnd`) at version 2 — a new **variant** of an
*existing* enum is what costs a bump, because an older build fails to deserialize
the whole document. The mirror discipline applies in full either way: the field
moves in `src/model/types.ts` in the same commit, as **optional**, because Rust
elides it.

**Some fields were `carried, never edited`** — held so an imported `network.yaml`
survived a round trip, with nothing in the editor creating one. `Movement` carried
`priority`, `yields_to` and `lane_mapping` for exactly that reason and **lost all
three in `fe8b452`**, when the export was cut: a field whose only justification is
surviving a round trip has no justification once nothing writes the file
(`graph.rs:142` keeps the note). `Junction.signal_plan` is the survivor of the
pattern. The rule that outlived them: a field with no reader is not necessarily
dead — but it needs a reason that is not the round trip.

On-disk files use the **`.zkai`** extension and are read/written by the
`save_document` / `load_document` Tauri commands in `src-tauri/src/persist.rs`.
`load_document` probes `schema_version` first (a minimal `VersionProbe` struct)
and rejects a *newer* file with a friendly error before deserializing the full
`Document`; the YAML shape is unchanged. YAML is only the on-disk body — the
document crosses IPC as JSON.

Because empty collections and layout sub-maps are `skip_serializing_if`-elided,
`load_document`'s JSON can omit them entirely. The frontend restores them with
`normalizeDocument` (`src/model/document.ts`) at exactly one boundary — the
`loadDocument` reducer case. See `rules/persistence.md` for the full save/open path.
