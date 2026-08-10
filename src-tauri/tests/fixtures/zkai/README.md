# `.zkai` fixtures

Zukai documents committed so `cargo test` can open a file the current build can
no longer **write**. That is the whole reason the directory exists, and it is why
these files are different in kind from `../network/`: those are copies of another
project's output, and these are hand-authored records of Zukai's own past.

| File | Carries | Read by |
|---|---|---|
| `t-junction-glyph.zkai` | `glyph: t_junction` and a `rotation:` key | `src-tauri/src/persist.rs` |

## Do not regenerate one by saving from the app

A fixture here reproduces a **parse** failure, so it has to carry spellings the
model no longer produces. Open `t-junction-glyph.zkai` in Zukai and save it and
you get a valid document that tests nothing — the glyph comes back `generic` and
the `rotation:` key is gone, which is exactly what its test asserts about the
*output*. Edit these by hand, and treat a failure as the fixture doing its job.

## Why this one carries two retirements

`t-junction-glyph.zkai` is a small T — a junction node, three arms, a
`priority` rule — written the way Zukai wrote one before
`specs/junction_glyphs_spec.md` Phase 2. It proves both halves of that spec's
§2.4 table in one file, and the two halves are not symmetric:

- **A removed enum *variant* needs a migration arm.** `t_junction` would
  otherwise fail serde on the whole document, and the version probe cannot help,
  because the file declares an older-or-equal version. `persist.rs:migrate` folds
  it to `generic`.
- **A removed *field* needs nothing.** `JunctionView::rotation` went in the same
  pass; nothing derives `deny_unknown_fields`, so serde ignores the key on the
  way in and it is simply absent on the way out.
