/**
 * The New / Open / Save / Save As commands: native file dialogs plus the IPC
 * calls to the Rust persistence commands.
 *
 * This is the only module that touches the Tauri runtime, deliberately kept out
 * of the reducer so the *apply* logic (`loadDocument`/`newDocument`/`markSaved`,
 * `normalizeDocument`) stays pure and unit-testable. Dialogs and `invoke` only
 * work under `tauri dev`/a built app — in the plain Vite dev server every command
 * below fails and is reported, rather than throwing into the void.
 */

import { invoke } from "@tauri-apps/api/core";
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
    // Handed to the reducer raw: the command's JSON omits empty collections
    // (`skip_serializing_if`), and `loadDocument` is the one place that normalizes.
    const doc = await invoke<RawDocument>("load_document", { path });
    dispatch({ type: "loadDocument", doc, path });
  } catch (err) {
    await report("Couldn't open the file", err);
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
  // Tauri command errors arrive as the command's `Err(String)`.
  const detail =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? err.message
        : String(err);
  console.error(`[zukai] ${title}: ${detail}`);
  try {
    await message(detail, { title, kind: "error" });
  } catch {
    // No Tauri runtime (plain `bun run dev`) — the console line above is it.
  }
}
