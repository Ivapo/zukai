/**
 * Draw the landing page's figures with the app that draws roads.
 *
 * The pictures on `index.html` are not hand-written markup: each one is an SVG
 * the demo itself exported, from a `.zkai` in `examples/` opened through the
 * real Open button. That is what makes `specs/web_demo_spec.md` §2.6's claim —
 * the page is made of exported diagrams — checkable rather than aspirational.
 *
 * **Why a browser and not a build step.** `export.tsx:diagramSvg(doc, bounds)`
 * is pure, but `bounds` come from `measureDiagram`, which needs
 * `document.fonts`, a *rendered* `document.body` host and `getBBox`. There is no
 * headless path in this repo, and getting it wrong is silent: `bounds = null`
 * does not throw, it collapses `frame()` to the margin around the origin and
 * lands the drawing outside its own viewBox. So the generator drives the built
 * demo in headless Chromium, and the app's own export path is the only one.
 *
 * **It asserts by default and rewrites only under `ZUKAI_UPDATE_GOLDEN=1`** —
 * the discipline `src-tauri/tests/fixtures/golden/README.md` established. A
 * script that regenerates its own reference on every run always matches itself
 * and therefore asserts nothing.
 *
 *     bun run render-examples                        # check
 *     ZUKAI_UPDATE_GOLDEN=1 bun run render-examples  # regenerate, then check
 *
 * Byte-identity is claimed for headless Chromium at the pinned Playwright
 * version and nowhere else: `getBBox` and `document.fonts.ready` differ between
 * engines, which is the same disclaimer zk-015 Phase 1 makes about the two
 * hosts' exports.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { preview, type PreviewServer } from "vite";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const EXAMPLES = join(ROOT, "examples");
const RENDERED = join(EXAMPLES, "rendered");
const LANDING = join(ROOT, "index.html");
const BUILT_LANDING = join(ROOT, "dist", "index.html");

/** The opt-in. Anything else — unset, `0`, `true` — is check-only. */
const UPDATE = process.env.ZUKAI_UPDATE_GOLDEN === "1";

/** The viewport the 380px overflow clause is measured at. */
const NARROW = { width: 380, height: 800 };

/**
 * Where an inlined diagram goes on the landing page. The generator owns the
 * bytes between the two markers, so the page cannot carry a hand-drawn figure
 * and the inlined copy cannot drift by being re-indented or annotated — either
 * would break the byte-presence check below, which is the point.
 */
const openMarker = (name: string) => `<!-- zukai:diagram ${name} -->`;
const CLOSE_MARKER = "<!-- /zukai:diagram -->";

const problems: string[] = [];
const fail = (message: string) => problems.push(message);

/** `roundabout.zkai` → `roundabout`. */
function stem(file: string): string {
  return file.replace(/\.zkai$/, "");
}

function exampleFiles(): string[] {
  return readdirSync(EXAMPLES)
    .filter((f) => f.endsWith(".zkai"))
    .sort();
}

/**
 * Open one document in the demo and press Export SVG, returning the bytes the
 * browser downloaded.
 *
 * Three things here are dictated by how the browser host actually works, and
 * are named so they are not rediscovered:
 *
 * - `host-browser.ts:pickFile` never adds its `<input type="file">` to the
 *   document, so there is no locator to `setInputFiles` on — take the
 *   `filechooser` event instead.
 * - `host-browser.ts:download` delivers through an `<a download>` over
 *   `URL.createObjectURL`, so the file arrives as a *download event* rather
 *   than as a return value.
 * - **The font must be resolved before Export is pressed.** `measureDiagram`
 *   awaits `document.fonts?.ready` *before* it mounts its measuring host, so it
 *   guarantees a resolved face only if the face was already requested. Export
 *   too early and `getBBox` measures the fallback and writes a *stably* wrong
 *   frame — which an assert-by-default diff cannot tell from a right one.
 */
async function exportOne(page: Page, file: string): Promise<Buffer> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open…", exact: true }).click();
  await (await chooser).setFiles(join(EXAMPLES, file));

  await page.waitForFunction(
    (title) => document.title === title,
    `${file} — Zukai`,
    { timeout: 15_000 },
  );

  await page.evaluate(async () => {
    await document.fonts.load('400 16px "Overpass Mono"');
    await document.fonts.ready;
  });

  const banner = await page.locator(".banner").count();
  if (banner > 0) {
    fail(
      `${file}: the demo showed an error banner — ${await page.locator(".banner").innerText()}`,
    );
  }

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG", exact: true }).click();
  const download = await downloading;

  const chunks: Buffer[] = [];
  const stream = await download.createReadStream();
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Replace one marker block's contents; returns the page unchanged if absent. */
function inject(html: string, name: string, svg: string): string {
  const open = openMarker(name);
  const start = html.indexOf(open);
  if (start === -1) {
    fail(`index.html carries no ${open} marker for the ${name} diagram`);
    return html;
  }
  const from = start + open.length;
  const to = html.indexOf(CLOSE_MARKER, from);
  if (to === -1) {
    fail(`index.html's ${open} block is never closed with ${CLOSE_MARKER}`);
    return html;
  }
  return `${html.slice(0, from)}\n${svg}\n${html.slice(to)}`;
}

async function main(): Promise<void> {
  const files = exampleFiles();
  if (files.length === 0) throw new Error(`no .zkai documents in ${EXAMPLES}`);

  const server: PreviewServer = await preview({ root: ROOT });
  const base = server.resolvedUrls?.local[0];
  if (!base) throw new Error("vite preview started without a local URL");

  const browser: Browser = await chromium.launch();
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
  });

  try {
    const drawn = new Map<string, Buffer>();

    for (const file of files) {
      const page = await context.newPage();
      await page.goto(new URL("demo/", base).href);
      await page.locator(".toolbar").waitFor();
      drawn.set(stem(file), await exportOne(page, file));
      await page.close();
    }

    if (UPDATE) {
      let html = readFileSync(LANDING, "utf8");
      for (const [name, svg] of drawn) {
        writeFileSync(join(RENDERED, `${name}.svg`), svg);
        html = inject(html, name, svg.toString("utf8"));
      }
      writeFileSync(LANDING, html);
      console.log(
        `regenerated ${drawn.size} diagram(s) into examples/rendered/ and index.html.\n` +
          "dist/ is now stale — re-run without ZUKAI_UPDATE_GOLDEN to check.",
      );
    } else {
      // 1. Each committed picture is still what the app draws.
      for (const [name, svg] of drawn) {
        const path = join(RENDERED, `${name}.svg`);
        let committed: Buffer;
        try {
          committed = readFileSync(path);
        } catch {
          fail(
            `examples/rendered/${name}.svg is missing — run with ZUKAI_UPDATE_GOLDEN=1`,
          );
          continue;
        }
        if (!committed.equals(svg)) {
          fail(
            `examples/rendered/${name}.svg differs from what the app just drew ` +
              `(${committed.byteLength} committed vs ${svg.byteLength} drawn). ` +
              "Read the diff before regenerating.",
          );
        }
      }

      // 2. At least one carries text, so the @font-face block is exercised.
      const withText = [...drawn].filter(([, svg]) =>
        svg.includes("@font-face"),
      );
      if (withText.length === 0) {
        fail(
          "no regenerated diagram carries text, so the embedded @font-face block " +
            "is never exercised — a textless diagram diffs clean while testing none of the risk",
        );
      }

      // 3. Every diagram on the page is one of those files, byte for byte —
      //    in the source and in what the build actually serves.
      const source = readFileSync(LANDING, "utf8");
      const built = readFileSync(BUILT_LANDING, "utf8");
      for (const [name, svg] of drawn) {
        const text = svg.toString("utf8");
        if (!source.includes(text)) {
          fail(
            `index.html does not carry examples/rendered/${name}.svg byte for byte`,
          );
        }
        if (!built.includes(text)) {
          fail(
            `dist/index.html does not carry examples/rendered/${name}.svg byte for byte`,
          );
        }
      }

      // 4. …and nothing else on the page is a diagram. `public/mark.svg` is
      //    excluded by staying an `img[src]`, which is why this says *diagram*.
      const svgCount = (source.match(/<svg\b/g) ?? []).length;
      if (svgCount !== drawn.size) {
        fail(
          `index.html has ${svgCount} <svg> elements but ${drawn.size} generated diagrams — ` +
            "every diagram on the page must come from examples/rendered/",
        );
      }

      // 5. The page holds together narrow, and loads without complaint.
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.setViewportSize(NARROW);
      await page.goto(base);
      await page.evaluate(() => document.fonts.ready);

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      if (overflow.scrollWidth > overflow.clientWidth) {
        fail(
          `the landing page scrolls sideways at ${NARROW.width}px: ` +
            `scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`,
        );
      }
      for (const error of errors)
        fail(`console error on the landing page: ${error}`);
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
    return;
  }
  if (!UPDATE) {
    console.log(
      `${files.length} diagram(s) match, and the landing page is made of them.`,
    );
  }
}

await main();
