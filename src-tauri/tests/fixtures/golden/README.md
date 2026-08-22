# Golden documents

The output of a conversion, committed so that **two readers in two languages can
be held to the same bytes**. That is the whole reason the directory exists, and
it makes these files a third kind, distinct from both of their neighbours:
`../network/` holds another project's *input*, `../zkai/` holds hand-authored
records of Zukai's *past*, and this holds *this build's own output*.

| File | Is | Read by |
|---|---|---|
| `cross-4.document.json` | `../network/cross-4.yaml` imported | `src-tauri/src/network/import.rs`, `src/editor/network-wasm.test.ts` |

## Regenerate it deliberately, never automatically

```bash
cd src-tauri && ZUKAI_UPDATE_GOLDEN=1 cargo test
```

The env var is the point. A test that rewrites its own fixture on every run
always matches itself and therefore asserts nothing — so the Rust test **asserts
by default** and only the opt-in above writes. When it goes red, read the diff
before regenerating: the file is the one place a change to `network_to_document`
shows up as a whole document rather than as one property.

## What the pair of readers actually catches

Not converter drift — both readers call the same `network_to_document`, so a
change there moves them together. What it catches is **marshalling** drift, on
the wasm side. `serde_wasm_bindgen`'s default serializer emits an ES `Map` for a
Rust map, and `model/layout.rs:Layout` is four `BTreeMap`s while
`document.ts:normalizeDocument` indexes plain objects — so `layout.nodes ?? {}`
would pass a `Map` straight through and every lookup would yield `undefined`.
That is a blank canvas that throws nothing, and `Serializer::json_compatible()`
in `src-tauri/src/wasm.rs` is what prevents it. This file is how we know.
