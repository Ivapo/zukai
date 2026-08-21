/**
 * The browser host: no filesystem, no dialogs, no IPC.
 *
 * Four capabilities work here and now — export, confirm, notify and the close
 * guard — which is enough for the thing the web demo exists to do: get a real
 * road figure out of a tab as a file. The other three need the wasm codec
 * (`specs/web_demo_spec.md` §2.4, and Phase 2), because a second JavaScript
 * encoder for `.zkai` would drift from the serde one that defines the format.
 *
 * Until then those three **throw**, naming themselves. `files.ts` already wraps
 * every command in a `try`/`catch` that reports, so the reply arrives as a
 * visible banner rather than a swallowed console line — no new wiring, and the
 * notify path is exercised by the same code that will carry real failures.
 *
 * Several methods below deliberately declare fewer parameters than {@link Host}
 * asks for. A function of fewer arguments is assignable to one of more, and it
 * keeps `noUnusedParameters` quiet without a row of underscores.
 */

import type { RawDocument } from "../model/document";
import {
  browserExportTarget,
  type ExportRequest,
  type ExportTarget,
} from "./export-target";
import type { CloseGuard, Host, OpenedDocument, Unsubscribe } from "./host";
import { showNotice } from "./notices";

/** What a command that needs the wasm codec throws until Phase 2 lands. */
function notYet(command: string): Error {
  return new Error(
    `${command} is not available in the browser yet — it needs the document ` +
      `codec, which the web build does not carry until the next release. ` +
      `Export still works, and the desktop app does all of it.`,
  );
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

  importNetwork(): Promise<RawDocument | null> {
    throw notYet("Import");
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
