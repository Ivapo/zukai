/**
 * The desktop host: native dialogs and the IPC calls to the Rust commands.
 *
 * Everything here was `files.ts`'s, and moved verbatim — this module is the only
 * place in the frontend that reaches the Tauri *runtime*, and `menu.ts` the only
 * other that names it at all. (`isTauri()` is a synchronous global check, not a
 * runtime call, and is used wherever a surface varies by host.)
 */

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import {
  ensureExtension,
  ensureZkaiExtension,
  NETWORK_EXTENSIONS,
  type RawDocument,
  withExtension,
  ZKAI_EXTENSION,
} from "../model/document";
import type { Document } from "../model/types";
import { exportFormat } from "./export";
import { exportMime, type ExportRequest, type ExportTarget } from "./export-target";
import type { CloseGuard, Host, OpenedDocument, Unsubscribe } from "./host";

/** The `.zkai` filter, shared by Open and Save. */
const FILTERS = [{ name: "Zukai schematic", extensions: [ZKAI_EXTENSION] }];

/** The same extensions the canvas drop routes on, so the two cannot disagree. */
const NETWORK_FILTERS = [
  { name: "Assimilator network", extensions: NETWORK_EXTENSIONS },
];

/**
 * Both formats in one dialog. Which one is written is decided by the *name* the
 * user leaves, not by the filter they picked — see `export.tsx:exportFormat`.
 */
const EXPORT_FILTERS = [
  { name: "SVG image", extensions: ["svg"] },
  { name: "PNG image", extensions: ["png"] },
];

export const tauriHost: Host = {
  canOpenDocuments: true,

  async open(): Promise<OpenedDocument | null> {
    const path = await open({
      title: "Open schematic",
      multiple: false,
      directory: false,
      filters: FILTERS,
    });
    if (path === null) return null;
    return { doc: await this.read(path), path };
  },

  read(path: string): Promise<RawDocument> {
    // Raw: the reducer is the one place that normalizes.
    return invoke<RawDocument>("load_document", { path });
  },

  async save(
    doc: Document,
    path: string | null,
    name: string,
  ): Promise<string | null> {
    let chosen = path;
    if (chosen === null) {
      const picked = await save({
        title: "Save schematic",
        defaultPath: ensureZkaiExtension(name),
        filters: FILTERS,
      });
      if (picked === null) return null;
      chosen = ensureZkaiExtension(picked);
    }
    await invoke("save_document", { path: chosen, doc });
    return chosen;
  },

  async importNetwork(): Promise<RawDocument | null> {
    const path = await open({
      title: "Import network",
      multiple: false,
      directory: false,
      filters: NETWORK_FILTERS,
    });
    if (path === null) return null;
    // Raw, like `read`: the reducer is the one place that normalizes.
    return invoke<RawDocument>("import_network", { path });
  },

  importNetworkText(text: string): Promise<RawDocument> {
    // A second command rather than reading the file here: the codec is Rust's,
    // and a `network.yaml` read in JavaScript would be the second reader §2.4
    // exists to prevent. Nothing dispatches to this on the desktop yet — the
    // canvas drop is browser-only for now — but the seam is honoured rather
    // than refused, which is what makes turning it on later a one-liner.
    return invoke<RawDocument>("import_network_text", { text });
  },

  async exportTarget(request: ExportRequest): Promise<ExportTarget | null> {
    // `request.format` is ignored: on the desktop one command offers both, and
    // the name the user leaves is what chooses. The default is built from
    // `currentPath` directly — reducing it to a basename would silently move the
    // dialog out of the document's own folder.
    const chosen = await save({
      title: "Export diagram",
      defaultPath: withExtension(request.currentPath ?? request.name, "svg"),
      filters: EXPORT_FILTERS,
    });
    if (chosen === null) return null;

    const format = exportFormat(chosen);
    return {
      // Read the format *before* touching the name. An SVG gains the extension
      // if it has none at all; a PNG is written exactly as chosen, because
      // `exportFormat` only says "png" for a name that already ends in it.
      destination: format === "svg" ? ensureExtension(chosen, "svg") : chosen,
      format,
      mime: exportMime(format),
    };
  },

  async deliverExport(
    target: ExportTarget,
    data: string | Uint8Array,
  ): Promise<void> {
    if (typeof data === "string") {
      await invoke("write_text_file", {
        path: target.destination,
        contents: data,
      });
      return;
    }
    // `Array.from` is load-bearing: nested in the argument object a
    // `Uint8Array` stringifies to `{"0":…,"1":…}`, which serde will not read
    // back as a `Vec<u8>`. A plain number array it does.
    await invoke("write_binary_file", {
      path: target.destination,
      contents: Array.from(data),
    });
  },

  recents(): Promise<string[]> {
    return invoke<string[]>("recent_files");
  },

  rememberRecent(path: string): Promise<string[]> {
    return invoke<string[]>("push_recent_file", { path });
  },

  confirm(question: string): Promise<boolean> {
    // The plugin's dialog rather than `window.confirm`, which is unreliable
    // across the platforms' webviews.
    return ask(question, {
      title: "Unsaved changes",
      kind: "warning",
      okLabel: "Discard",
      cancelLabel: "Cancel",
    });
  },

  async notify(title: string, detail: string): Promise<void> {
    await message(detail, { title, kind: "error" });
  },

  closeGuard(guard: CloseGuard): Promise<Unsubscribe | null> {
    return getCurrentWindow().onCloseRequested(async (event) => {
      if (!(await guard.mayClose())) event.preventDefault();
    });
  },
};
