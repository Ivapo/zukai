/**
 * What the file commands need from the machine they are running on.
 *
 * `files.ts` used to reach for `invoke`, a dialog plugin and the window object
 * directly, which made every one of its commands a desktop command. This is the
 * seam that stopped that: one interface, two implementations, and the difference
 * between a signed app and a browser tab stated where a reader can see it.
 *
 * The alternative — a browser `invoke()` shim dispatching to wasm — was declined
 * (`specs/web_demo_spec.md` §2.3): every file command in `lib.rs:run`'s handler
 * list takes a `path: String`, and in a browser that argument is a lie.
 *
 * Two rules hold this apart, and both are load-bearing:
 *
 * - **The hosts throw; only `files.ts` reports.** No implementation imports
 *   `report` or `detail`, or the seam becomes a cycle. A host signals failure by
 *   throwing and cancellation by returning `null` — the distinction the dialogs
 *   already drew.
 * - **No Tauri type crosses.** {@link Unsubscribe} exists because
 *   `installCloseGuard` used to return `@tauri-apps/api/event`'s `UnlistenFn`,
 *   and carrying that name down the browser path would put a Tauri type in the
 *   one module that exists to be free of them.
 */

import { isTauri } from "@tauri-apps/api/core";
import type { RawDocument } from "../model/document";
import type { Document } from "../model/types";
import type { ExportRequest, ExportTarget } from "./export-target";
import { browserHost } from "./host-browser";
import { tauriHost } from "./host-tauri";

/** Undo an installed listener. This project's own name for `() => void`. */
export type Unsubscribe = () => void;

/**
 * A document read off disk, and the path it came from.
 *
 * `path` is **host-opaque**, like `ExportTarget.destination`: an absolute
 * filesystem path on the desktop, a bare `File.name` in a browser, which is all
 * a page ever learns about where a file came from. It is produced and consumed
 * by the same host; nothing else may take it for a location.
 */
export interface OpenedDocument {
  doc: RawDocument;
  path: string;
}

/**
 * Whether the window may close, asked two ways because the hosts can afford
 * different answers. A desktop window can be held open across an `await`, so it
 * gets {@link mayClose} and a real prompt; a browser's `beforeunload` must
 * decide inside the event, so it gets the synchronous
 * {@link hasUnsavedWork} and the browser supplies its own wording.
 */
export interface CloseGuard {
  hasUnsavedWork(): boolean;
  /**
   * **Never rejects.** A prompt that failed to appear is no reason to lose the
   * document, so a failure resolves `false` — keep the window — and reports
   * itself on the way past.
   */
  mayClose(): Promise<boolean>;
}

export interface Host {
  /** Pick a `.zkai` and read it. `null` if the user backed out. */
  open(): Promise<OpenedDocument | null>;
  /**
   * Decode a `.zkai` whose **text** is already in hand — a dropped file. The
   * push-shaped twin of {@link open}, exactly as {@link importNetworkText} is
   * the twin of {@link importNetwork}, and where the document codec is called.
   */
  openDocumentText(text: string): Promise<RawDocument>;
  /** Read a `.zkai` whose path is already known (Open Recent). */
  read(path: string): Promise<RawDocument>;
  /**
   * Write the document. `path` is where it goes; `null` means ask. Returns where
   * it landed.
   *
   * **`null` carries a third meaning here**, on top of the seam's usual
   * "cancelled": *delivered, but there is nothing to adopt*. A browser download
   * has no address, so the browser host answers `null` rather than inventing a
   * path for a file the page cannot address — which is what makes its Save
   * honestly a Save-a-copy (§OQ-3). Both readings mean the same thing to the
   * caller, which is why one sentinel still covers them: do not call `adopt`.
   */
  save(doc: Document, path: string | null, name: string): Promise<string | null>;
  /** Pick an Assimilator `network.yaml` and read it. */
  importNetwork(): Promise<RawDocument | null>;
  /**
   * Convert a `network.yaml` whose **text** is already in hand — a dropped file,
   * where the seam above is pull-shaped and a drop is push-shaped.
   *
   * This is the one method that names a codec, and that is deliberate: it keeps
   * `files.ts` naming neither `invoke` nor wasm, and it keeps the hosts from
   * importing `files.ts`, which would close the cycle this module forbids. Both
   * hosts honour it — the desktop over IPC, the browser through the wasm — so
   * the seam carries no method a host refuses.
   */
  importNetworkText(text: string): Promise<RawDocument>;

  /** Decide where an export goes. `null` if the user backed out. */
  exportTarget(request: ExportRequest): Promise<ExportTarget | null>;
  /** Deliver the finished bytes to that target. */
  deliverExport(target: ExportTarget, data: string | Uint8Array): Promise<void>;

  /** The remembered file list. Empty where the host remembers nothing (§2.5). */
  recents(): Promise<string[]>;
  rememberRecent(path: string): Promise<string[]>;

  /** Ask a yes/no question and block until it is answered. */
  confirm(question: string): Promise<boolean>;
  /** Put an error where the user will actually see it (§2.7). */
  notify(title: string, detail: string): Promise<void>;
  /** Guard against closing with unsaved work; `null` if there is no such event. */
  closeGuard(guard: CloseGuard): Promise<Unsubscribe | null>;
}

/**
 * Which host this is. Synchronous, because the surfaces that vary by host must
 * not flicker: `App`'s `menuInstalled` only becomes true once `installMenu`
 * resolves over IPC, so anything gated on it renders the *browser* shape for the
 * first frames of a desktop launch. `isTauri()` reads a global and is right
 * immediately.
 */
export function selectHost(tauri: boolean): Host {
  return tauri ? tauriHost : browserHost;
}

let chosen: Host | null = null;

/** The host for this process, decided once. */
export function host(): Host {
  return (chosen ??= selectHost(isTauri()));
}
