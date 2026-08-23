/**
 * The example schematics the demo can open without a checkout.
 *
 * `examples/*.zkai` are documents drawn in Zukai and committed so the landing
 * page can be made of the figures they export (`examples/README.md`). This is
 * their second consumer: a visitor who has only the deployed page needs a way to
 * get one of those drawings onto the canvas, and until this existed the demo's
 * own gate had to hand the checker a repo checkout.
 *
 * **A lazy glob, never a `fetch`** (`specs/web_demo_spec.md` §4 Phase 6). Vite
 * resolves a root-relative glob at build time and emits each match as its own
 * chunk, so nothing here reads `import.meta.env.BASE_URL`, nothing calls
 * `fetch`, there is no second copy of a document to drift from `examples/`, and
 * there is no runtime 404 arm to design — the key set is fixed when the build
 * runs. What a *matchless* glob yields is `{}`, silently, which is what
 * `examples.test.ts` exists to catch.
 *
 * **The explicit `<string>` is load-bearing.** `import.meta.glob`'s first
 * overload infers the module type from the deprecated `as` option and not from
 * `query`, so omitting the type parameter yields `Promise<unknown>` and `tsc`
 * rejects the value where `Host.openDocumentText` wants a string.
 *
 * A **leaf** on purpose, exactly as `export-target.ts` is: it imports no host,
 * no command module and no component, which is what lets it be tested in
 * vitest's `node` environment with no DOM and no `@tauri-apps` in the graph.
 */

const MODULES = import.meta.glob<string>("/examples/*.zkai", {
  query: "?raw",
  import: "default",
});

/**
 * Each example's text, by **stem** — `roundabout`, not
 * `/examples/roundabout.zkai`. The re-keying lives here rather than at the call
 * site so that `files.ts:openExample` takes the name a menu can show and nothing
 * outside this module ever holds a glob key.
 *
 * Insertion order is sorted and string keys keep it, so `Object.keys` gives the
 * menu a stable alphabetical order for free. Each loader is paid for on first
 * use — a visitor who never opens an example never fetches one.
 */
export const EXAMPLES: Record<string, () => Promise<string>> =
  Object.fromEntries(
    Object.keys(MODULES)
      .sort()
      .map((key) => [stemOf(key), MODULES[key]]),
  );

/**
 * A label for the menu, derived from the file stem.
 *
 * **Not the document's own `metadata.name`**, and that is a decision: the name
 * lives inside the YAML, so reading it would mean decoding every example at page
 * load — fetching the wasm that `specs/web_demo_spec.md` OQ-4 deliberately keeps
 * behind a dynamic import, charged to a visitor who may never open one. A stem
 * needs no manifest and so has no second source of truth to drift from.
 *
 * The cost is named rather than hidden: the menu can disagree with the
 * document's own name, and does — `roundabout.zkai` is `Four-arm roundabout`
 * inside. The answer is to name the files so their stems read, not to add a
 * manifest.
 *
 * Interior case is **preserved**: `ROUNDABOUT` stays `ROUNDABOUT`. A
 * lowercase-then-capitalise would read the same on every filename this repo has
 * and be wrong on the first one that carries an initialism.
 */
export function exampleLabel(stem: string): string {
  const words = stem.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `/examples/signalized-cross.zkai` → `signalized-cross`. */
function stemOf(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1).replace(/\.zkai$/, "");
}
