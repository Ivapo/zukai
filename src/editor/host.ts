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

/** A document read off disk, and the path it came from. */
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
  /**
   * Whether a document can be read at all. False in the browser until the wasm
   * codec lands (§2.4), and checked *before* the discard prompt so nobody is
   * asked to throw away work for a command that cannot run.
   */
  readonly canOpenDocuments: boolean;

  /** Pick a `.zkai` and read it. `null` if the user backed out. */
  open(): Promise<OpenedDocument | null>;
  /** Read a `.zkai` whose path is already known (Open Recent). */
  read(path: string): Promise<RawDocument>;
  /**
   * Write the document. `path` is where it goes; `null` means ask. Returns where
   * it landed, or `null` if the user backed out of the dialog.
   */
  save(doc: Document, path: string | null, name: string): Promise<string | null>;
  /** Pick an Assimilator `network.yaml` and read it. */
  importNetwork(): Promise<RawDocument | null>;

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
