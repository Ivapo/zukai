# Example schematics

Documents **drawn in Zukai**, committed so the landing page can be made of the
figures they export. That is the whole reason the directory exists, and it makes
these a fourth kind of committed file, distinct from all three under
`src-tauri/tests/fixtures/`: `network/` holds another project's *input*, `zkai/`
holds hand-authored records of Zukai's *past*, `golden/` holds one conversion's
*output*, and this holds documents the app both produced and can reproduce.

| File | Shows |
|---|---|
| `roundabout.zkai` | the roundabout glyph, give-way lines on every entry, length labels |
| `signalized-cross.zkai` | signal control, stop lines, per-lane turn arrows, a direction plate |
| `motorway-ramp.zkai` | motorway class, hard-shoulder hatching, a gore diverge, a ramp |

**The filename is user-visible.** The demo's Examples menu labels each entry from
the stem — hyphens become spaces and the first letter is capitalised — because
reading a document's own `metadata.name` would mean decoding all of them at page
load. So name a file so its stem reads, and expect the menu to disagree with the
name inside (`roundabout.zkai` is `Four-arm roundabout`). Renaming one also
renames its `rendered/` picture and the marker on the landing page, so regenerate
after.

Each one is a **fixed point of the app's own codec** — opened in the demo and
saved again, the bytes do not move. Keep it that way: edit a document by opening
it in Zukai and saving, not by hand, or the next `.zkai` round trip will rewrite
the file underneath a reviewer.

## `rendered/` is generated, and asserted

`rendered/*.svg` is what the demo's own **Export SVG** produced for each
document, written by `scripts/render-examples.ts` driving the built app in
headless Chromium. Those exact bytes are inlined into `index.html`, which is how
`specs/web_demo_spec.md` §2.6's claim — the landing page is made of exported
diagrams — becomes a check rather than a promise.

```bash
bun run render-examples                        # assert; this is the gate
ZUKAI_UPDATE_GOLDEN=1 bun run render-examples  # regenerate, then assert
```

The env var is the point, and it is the discipline
`src-tauri/tests/fixtures/golden/README.md` established: a script that rewrites
its own reference on every run always matches itself and therefore asserts
nothing. When the check goes red, read the diff before regenerating.

Byte-identity is claimed for headless Chromium at the pinned Playwright version
and nowhere else — `getBBox` and `document.fonts.ready` differ between engines,
the same disclaimer zk-015 Phase 1 makes about the desktop and browser exports.

## These are read, not served

Nothing fetches this directory, and that is still true now that the demo can open
them. It does not fetch them either: `src/editor/examples.ts` holds
`examples/*.zkai` as a lazy `import.meta.glob`, so Vite resolves the pattern at
build time and emits each document as its own chunk. That is the whole reason
they live here rather than in `public/` — a copy under `public/` would be a
second set of bytes to drift from these, fetched by URL against a base that
changes with the deploy.

So this directory has two consumers and neither is a runtime read: the landing
page carries `rendered/`'s pictures inline, and the demo carries the documents
compiled in. The deployed site ships neither as a file.
