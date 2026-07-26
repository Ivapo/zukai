/**
 * The typeface an exported picture carries inside itself.
 *
 * A standalone SVG reaches no external font: the first glyph either falls back
 * to whatever the viewer has, or — in the PNG path, which rasterizes through the
 * webview — bakes that substitution in permanently. So the face travels as a
 * data-URI `@font-face`, and this module is the only place it is named.
 *
 * **TypeScript, not a stylesheet, and that is forced.** `export.tsx` embeds CSS
 * with `?raw`, which does no URL rewriting at all — a `url(…)` written literally
 * in a `.css` file would travel into the exported picture as an unresolved
 * external reference, which is exactly the invariant the embedding exists to
 * protect. Only a JavaScript module can carry the `?inline` import that resolves
 * the font to bytes at build time (signs spec §2.2).
 */

// Vite resolves this to a `data:font/woff2;base64,…` URL at build time, so no
// 18 kB blob is checked in and no generation script has to be kept in step with
// the dependency. `vite/client.d.ts` declares `*?inline`, referenced by
// `src/vite-env.d.ts`, so `tsc` needs no declaration of its own.
import fontUrl from "@fontsource/overpass-mono/files/overpass-mono-latin-400-normal.woff2?inline";

/**
 * The face the drawing sets text in.
 *
 * **Overpass Mono, and monospace is the load-bearing half.** An SVG `<text>` has
 * no width until something lays it out, and a direction plate has to be as wide
 * as the text it carries — so a proportional face would need either a DOM
 * measurement (which would make the exporter impure, and the suite runs with no
 * DOM) or a generated metrics table that can fall out of step with the font.
 * Monospace makes a string's width one multiplication (`textWidth`), pure and
 * exact. Overpass itself is derived from Highway Gothic, the FHWA signage face,
 * so the mono cut reads as the same hand as the chrome rather than a foreign one
 * (§2.4).
 *
 * **One constant, two consumers** — the `@font-face` below and the `font-family`
 * *attribute* on every `<text>` the diagram draws — so the embedded bytes and the
 * markup that asks for them cannot name different faces.
 *
 * Verified against `@fontsource/overpass-mono/metadata.json` (`"family":
 * "Overpass Mono"`), which is also the name `main.tsx` loads for the canvas.
 */
export const FONT_FAMILY = "Overpass Mono";

/**
 * The `@font-face` rule that carries the face inside an exported picture.
 *
 * Weight 400 normal, matching the one weight `main.tsx` loads and the one the
 * drawing ever asks for. Latin only, unsubsetted: a subset would be a second
 * artefact that can disagree with the face the canvas draws, which is the drift
 * `rules/diagram-export.md` exists to prevent, and the whole file is ≈18 kB
 * base64 (OQ-4).
 *
 * **Safe to embed raw inside XML**, which is what `export.tsx` does with it:
 * base64's alphabet is `A-Z a-z 0-9 + / =`, so it can carry neither a `<` to end
 * the element nor an `&` to start an entity.
 *
 * No `font-display`: the property governs a *loading* strategy, and there is
 * nothing to load — the bytes are already in the file.
 */
export function fontFaceCss(): string {
  return `@font-face{font-family:"${FONT_FAMILY}";font-style:normal;font-weight:400;src:url(${fontUrl}) format("woff2")}`;
}

/**
 * The attribution OFL-1.1 requires to travel with the embedded face, as an XML
 * comment.
 *
 * A comment rather than a `<style>` comment or a `<desc>`: it lives outside
 * `<style>`, where a `<` is legal, and it is the one place in the file that may
 * carry the URL the notice names. The string is `metadata.json`'s `attribution`
 * verbatim, and it contains no `--`, which is the one sequence an XML comment
 * may not hold (§2.3, OQ-5).
 *
 * A PNG carries nothing, and that is correct rather than a gap: the licence
 * governs the font *software*, and a raster contains no font.
 */
export const FONT_NOTICE =
  "<!-- Overpass Mono is embedded below as a data URI." +
  " Copyright 2021 The Overpass Project Authors (https://github.com/RedHatOfficial/Overpass)." +
  " Licensed under the SIL Open Font License 1.1, https://openfontlicense.org -->";
