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

Nothing fetches this directory. The landing page carries the pictures inline and
the deployed site ships neither the documents nor `rendered/`. Serving them is
zk-015 Phase 6's job, and that is why they live here rather than in `public/`.
