/**
 * The browser host: no filesystem, no dialogs, no IPC.
 *
 * Everything the demo exists to do works here — import a real `network.yaml`,
 * schematise it, open and save the `.zkai`, and get a road figure back out of
 * the tab as a picture. Both codecs are the **wasm** build of this project's own
 * Rust (`wasm.ts`), never a JavaScript YAML reader, because serde plus the
 * model's attributes are the single source of truth for what these files mean
 * and a second reader would drift (`specs/web_demo_spec.md` §2.4).
 *
 * Two capabilities are still not what they are on the desktop, and both are
 * decisions rather than gaps:
 *
 * - **Save is honestly Save-a-copy.** A download has no address, so `save`
 *   returns `null` — the value that already means "nothing was adopted". The
 *   document stays dirty and gains no `currentPath`, and a second Cmd-S
 *   downloads again rather than writing in place (OQ-3, resolved).
 * - **Open Recent does not exist.** `recents` answers `[]` by decision — a demo
 *   that reopens your last session is not what the demo is for (§2.5) — so no
 *   surface can supply a path and {@link browserHost.read} is unreachable rather
 *   than merely unimplemented. It throws, and `files.ts` wraps every command in
 *   a `try`/`catch` that reports, so the reply arrives as a visible banner
 *   rather than a swallowed console line.
 *
 * Several methods below deliberately declare fewer parameters than {@link Host}
 * asks for. A function of fewer arguments is assignable to one of more, and it
 * keeps `noUnusedParameters` quiet without a row of underscores.
 */

import {
  basename,
  ensureZkaiExtension,
  NETWORK_EXTENSIONS,
  type RawDocument,
  ZKAI_EXTENSION,
} from "../model/document";
import type { Document } from "../model/types";
import {
  browserExportTarget,
  type ExportRequest,
  type ExportTarget,
} from "./export-target";
import type { CloseGuard, Host, OpenedDocument, Unsubscribe } from "./host";
import { decodeZkai, encodeZkai, importNetworkYaml } from "./wasm";
import { showNotice } from "./notices";

/**
 * What a `.zkai` download is served as. It is YAML, and saying so is what keeps
 * a browser from guessing; the `download` attribute is what names the file, so
 * the type never has to imply the extension.
 */
const ZKAI_MIME = "text/yaml;charset=utf-8";

/**
 * Ask for one file and hand back what was chosen, or `null` if the picker was
 * dismissed — this host's stand-in for a native open dialog, and it keeps the
 * seam's cancel contract intact.
 *
 * The input is never added to the document — nothing renders it, and `click()`
 * opens the picker from anywhere. (`showPicker()` reads better and is newer;
 * `click()` is what {@link download}'s `<a download>` already relies on, so
 * the file keeps one idiom.) `cancel` is how a dismissed picker announces itself; a
 * browser too old to fire it leaves the promise pending, which is
 * indistinguishable from the user never having answered.
 */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), {
      once: true,
    });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

/**
 * Hand bytes to the browser under a name. This host's only way of writing
 * anything, so a saved document and an exported picture leave by exactly one
 * path and the two cannot acquire different quirks.
 */
function download(name: string, data: string | Uint8Array, mime: string): void {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  // Firefox only follows a link that is in the document.
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Not in this tick: Safari has cancelled the download it just started when
    // the URL is revoked synchronously.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export const browserHost: Host = {
  async open(): Promise<OpenedDocument | null> {
    const file = await pickFile(`.${ZKAI_EXTENSION}`);
    if (file === null) return null;
    // `file.name`, because that is the whole of what a page learns about where
    // a file came from — and `OpenedDocument.path` is host-opaque for exactly
    // this reason. It is what the toolbar then shows and what an export names
    // itself after.
    return { doc: await this.openDocumentText(await file.text()), path: file.name };
  },

  openDocumentText(text: string): Promise<RawDocument> {
    // Raw, like the desktop's `invoke`: the reducer is the one place that
    // normalizes. The wasm loads on first use, not at startup.
    return decodeZkai(text);
  },

  read(): Promise<RawDocument> {
    // Unreachable rather than merely unimplemented: `recents` is empty on this
    // host by decision, so no Open Recent surface exists and nothing can supply
    // a path.
    throw new Error(
      "Open Recent is not available in the browser — this build remembers no " +
        "files. Open a .zkai with the Open button, or drop one on the canvas.",
    );
  },

  async save(
    doc: Document,
    path: string | null,
    name: string,
  ): Promise<string | null> {
    download(
      // A `download` attribute names a file, not a location, so a document
      // opened as `interchange.zkai` saves back as `interchange.zkai`.
      basename(ensureZkaiExtension(path ?? name)),
      await encodeZkai(doc),
      ZKAI_MIME,
    );
    // **`null`, and the document stays dirty.** There is no address to adopt —
    // a page cannot write in place — so this host says so rather than inventing
    // a path, and Save is honestly a Save-a-copy (OQ-3, resolved).
    return null;
  },

  async importNetwork(): Promise<RawDocument | null> {
    const file = await pickFile(NETWORK_EXTENSIONS.map((e) => `.${e}`).join(","));
    if (file === null) return null;
    return this.importNetworkText(await file.text());
  },

  importNetworkText(text: string): Promise<RawDocument> {
    return importNetworkYaml(text);
  },

  async exportTarget(request: ExportRequest): Promise<ExportTarget | null> {
    // Never null: there is no dialog to back out of. The format came from the
    // command — Export SVG or Export PNG — because a download has no name for
    // the user to choose a format by.
    return browserExportTarget(
      request.format ?? "svg",
      request.currentPath,
      request.name,
    );
  },

  async deliverExport(
    target: ExportTarget,
    data: string | Uint8Array,
  ): Promise<void> {
    download(target.destination, data, target.mime);
  },

  // A demo that reopens your last session is not what the demo is for (§2.5).
  async recents(): Promise<string[]> {
    return [];
  },

  async rememberRecent(): Promise<string[]> {
    return [];
  },

  async confirm(question: string): Promise<boolean> {
    // Blocking is the point for a question the user just asked to be asked.
    // §2.7 rules out `alert()` for *errors*, where a modal would interrupt
    // someone who never asked for anything.
    return window.confirm(question);
  },

  async notify(title: string, detail: string): Promise<void> {
    showNotice({ title, detail });
  },

  async closeGuard(guard: CloseGuard): Promise<Unsubscribe | null> {
    // `beforeunload` has to answer inside the event, so the synchronous half of
    // the guard is the one this host can use; the browser supplies the wording.
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (guard.hasUnsavedWork()) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  },
};
