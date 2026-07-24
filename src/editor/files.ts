/**
 * The New / Open / Save / Save As commands: native file dialogs plus the IPC
 * calls to the Rust persistence commands, the recent-files list, and the
 * window's unsaved-changes guard.
 *
 * With `menu.ts` this is one of only two modules that touch the Tauri runtime,
 * deliberately kept out of the reducer so the *apply* logic
 * (`loadDocument`/`newDocument`/`markSaved`, `normalizeDocument`) stays pure and
 * unit-testable. Dialogs and `invoke` only work under `tauri dev`/a built app —
 * in the plain Vite dev server every command below fails and is reported, rather
 * than throwing into the void.
 */

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import {
  ensureZkaiExtension,
  RawDocument,
  ZKAI_EXTENSION,
} from "../model/document";
import { Action, EditorState } from "./state";

type Dispatch = (action: Action) => void;

const FILTERS = [{ name: "Zukai schematic", extensions: [ZKAI_EXTENSION] }];

/** Discard the current document for a fresh one, guarding unsaved changes. */
export async function newDocument(
  state: EditorState,
  dispatch: Dispatch,
): Promise<void> {
  try {
    if (await confirmDiscard(state)) dispatch({ type: "newDocument" });
  } catch (err) {
    await report("Couldn't start a new document", err);
  }
}

/** Pick a `.zkai` file and load it, guarding unsaved changes. */
export async function openDocument(
  state: EditorState,
  dispatch: Dispatch,
): Promise<void> {
  try {
    if (!(await confirmDiscard(state))) return;
    const path = await open({
      title: "Open schematic",
      multiple: false,
      directory: false,
      filters: FILTERS,
    });
    if (path === null) return;
    await load(path, dispatch);
  } catch (err) {
    await report("Couldn't open the file", err);
  }
}

/** Open a remembered path from the menu's recent list, skipping the picker. */
export async function openRecentDocument(
  state: EditorState,
  dispatch: Dispatch,
  path: string,
): Promise<void> {
  try {
    if (!(await confirmDiscard(state))) return;
    await load(path, dispatch);
  } catch (err) {
    await report("Couldn't open the file", err);
    // The file may have been moved or deleted since it was remembered; a re-read
    // prunes it from the list.
    await refreshRecents(dispatch);
  }
}

/** Save to the backing file, falling back to Save As when there isn't one. */
export async function saveDocument(
  state: EditorState,
  dispatch: Dispatch,
): Promise<void> {
  try {
    const path = state.currentPath ?? (await pickSavePath(state));
    if (path === null) return;
    await write(path, state, dispatch);
  } catch (err) {
    await report("Couldn't save the file", err);
  }
}

/** Always ask for a path, then save to it (and adopt it as the backing file). */
export async function saveDocumentAs(
  state: EditorState,
  dispatch: Dispatch,
): Promise<void> {
  try {
    const path = await pickSavePath(state);
    if (path === null) return;
    await write(path, state, dispatch);
  } catch (err) {
    await report("Couldn't save the file", err);
  }
}

/** Read a document through the Rust command and install it as the current one. */
async function load(path: string, dispatch: Dispatch): Promise<void> {
  // Handed to the reducer raw: the command's JSON omits empty collections
  // (`skip_serializing_if`), and `loadDocument` is the one place that normalizes.
  const doc = await invoke<RawDocument>("load_document", { path });
  dispatch({ type: "loadDocument", doc, path });
  await rememberRecent(path, dispatch);
}

/** Run the save dialog; `null` when the user cancels. */
async function pickSavePath(state: EditorState): Promise<string | null> {
  const chosen = await save({
    title: "Save schematic",
    defaultPath: ensureZkaiExtension(
      state.currentPath ?? state.doc.metadata.name,
    ),
    filters: FILTERS,
  });
  return chosen === null ? null : ensureZkaiExtension(chosen);
}

/** Write the document through the Rust command and clear `dirty`. */
async function write(
  path: string,
  state: EditorState,
  dispatch: Dispatch,
): Promise<void> {
  await invoke("save_document", { path, doc: state.doc });
  dispatch({ type: "markSaved", path });
  await rememberRecent(path, dispatch);
}

/**
 * Load the remembered document list into state. Silent without a Tauri runtime:
 * the browser dev server has no menu to show them in anyway.
 */
export async function refreshRecents(dispatch: Dispatch): Promise<void> {
  if (!isTauri()) return;
  try {
    const recents = await invoke<string[]>("recent_files");
    dispatch({ type: "setRecents", recents });
  } catch (err) {
    console.error(`[zukai] Couldn't read the recent files: ${detail(err)}`);
  }
}

/**
 * Remember a path as the most recent document. Deliberately swallows its errors:
 * a broken recents store must not turn a successful save or open into a failure.
 */
async function rememberRecent(path: string, dispatch: Dispatch): Promise<void> {
  try {
    const recents = await invoke<string[]>("push_recent_file", { path });
    dispatch({ type: "setRecents", recents });
  } catch (err) {
    console.error(`[zukai] Couldn't update the recent files: ${detail(err)}`);
  }
}

/**
 * Guard the window's close button with the same prompt as New/Open, so closing
 * never silently drops unsaved work. Returns the unlisten handle, or `null` when
 * there is no native window to guard (plain `bun run dev`).
 */
export async function installCloseGuard(
  getState: () => EditorState,
): Promise<UnlistenFn | null> {
  if (!isTauri()) return null;
  try {
    return await getCurrentWindow().onCloseRequested(async (event) => {
      try {
        if (!(await confirmDiscard(getState()))) event.preventDefault();
      } catch (err) {
        // A prompt that failed to appear is no reason to lose the document:
        // keep the window and tell the user why it would not close.
        event.preventDefault();
        await report("Couldn't check for unsaved changes", err);
      }
    });
  } catch (err) {
    console.error(`[zukai] Couldn't guard the close button: ${detail(err)}`);
    return null;
  }
}

/**
 * `true` when it is safe to replace the current document — either nothing is
 * unsaved, or the user confirmed. Uses the dialog plugin's `ask()`; the webview's
 * own `window.confirm` is unreliable across platforms.
 */
async function confirmDiscard(state: EditorState): Promise<boolean> {
  if (!state.dirty) return true;
  return ask("Discard unsaved changes?", {
    title: "Unsaved changes",
    kind: "warning",
    okLabel: "Discard",
    cancelLabel: "Cancel",
  });
}

/** Surface a failed command to the user, always leaving a console trail. */
async function report(title: string, err: unknown): Promise<void> {
  const text = detail(err);
  console.error(`[zukai] ${title}: ${text}`);
  try {
    await message(text, { title, kind: "error" });
  } catch {
    // No Tauri runtime (plain `bun run dev`) — the console line above is it.
  }
}

/** Readable text for a thrown value; Tauri command errors arrive as `Err(String)`. */
function detail(err: unknown): string {
  if (typeof err === "string") return err;
  return err instanceof Error ? err.message : String(err);
}
