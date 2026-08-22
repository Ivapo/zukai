/**
 * The browser host: no filesystem, no dialogs, no IPC.
 *
 * Five capabilities work here and now — import, export, confirm, notify and the
 * close guard — which covers the thing the web demo exists to do: get a real
 * network onto the canvas and a real road figure back out of the tab as a file.
 * Import reads Assimilator's format through the **wasm** build of this project's
 * own Rust (`network-wasm.ts`), never a JavaScript YAML reader, because serde
 * plus the model's attributes are the single source of truth for what these
 * files mean and a second reader would drift (`specs/web_demo_spec.md` §2.4).
 *
 * The three that remain — Open, Open Recent and Save — need the `.zkai` codec,
 * which the wasm does not carry until Phase 3. Until then they **throw**, naming
 * themselves. `files.ts` already wraps every command in a `try`/`catch` that
 * reports, so the reply arrives as a visible banner rather than a swallowed
 * console line — no new wiring, and the notify path is exercised by the same
 * code that carries real failures.
 *
 * Several methods below deliberately declare fewer parameters than {@link Host}
 * asks for. A function of fewer arguments is assignable to one of more, and it
 * keeps `noUnusedParameters` quiet without a row of underscores.
 */

import { NETWORK_EXTENSIONS, type RawDocument } from "../model/document";
import {
  browserExportTarget,
  type ExportRequest,
  type ExportTarget,
} from "./export-target";
import type { CloseGuard, Host, OpenedDocument, Unsubscribe } from "./host";
import { importNetworkYaml } from "./network-wasm";
import { showNotice } from "./notices";

/** What a command that needs the `.zkai` codec throws until Phase 3 lands. */
function notYet(command: string): Error {
  return new Error(
    `${command} is not available in the browser yet — it needs the .zkai ` +
      `codec, which the web build does not carry until the next release. ` +
      `Import and Export work, and the desktop app does all of it.`,
  );
}

/**
 * Ask for one file and hand back what was chosen, or `null` if the picker was
 * dismissed — this host's stand-in for a native open dialog, and it keeps the
 * seam's cancel contract intact.
 *
 * The input is never added to the document — nothing renders it, and `click()`
 * opens the picker from anywhere. (`showPicker()` reads better and is newer;
 * `click()` is what `deliverExport`'s `<a download>` already relies on, so
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

export const browserHost: Host = {
  // Checked before the discard prompt, so a dirty document is never asked to
  // throw away work for a command that is about to refuse.
  canOpenDocuments: false,

  open(): Promise<OpenedDocument | null> {
    throw notYet("Open");
  },

  // Unreachable rather than merely unimplemented: `recents` is empty here, so
  // no Open Recent surface exists and nothing can supply a path.
  read(): Promise<RawDocument> {
    throw notYet("Open Recent");
  },

  save(): Promise<string | null> {
    throw notYet("Save");
  },

  async importNetwork(): Promise<RawDocument | null> {
    const file = await pickFile(NETWORK_EXTENSIONS.map((e) => `.${e}`).join(","));
    if (file === null) return null;
    return this.importNetworkText(await file.text());
  },

  importNetworkText(text: string): Promise<RawDocument> {
    // Raw, like the desktop's `invoke`: the reducer is the one place that
    // normalizes. The wasm loads on this first call, not at startup.
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
    const blob = new Blob([data as BlobPart], { type: target.mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = target.destination;
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
