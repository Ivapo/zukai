/**
 * The native application menu.
 *
 * Built from JS rather than Rust so its items call the very same
 * {@link FileActions} the toolbar buttons do — one command surface, no menu-id
 * and event plumbing to keep in sync across the language boundary. With
 * `files.ts` this is one of only two modules that touch the Tauri runtime: under
 * the plain Vite dev server there is no menu at all, `installMenu` reports that
 * it installed nothing, and the webview's keyboard shortcuts stay in charge.
 */

import { isTauri } from "@tauri-apps/api/core";
import {
  Menu,
  MenuItem,
  PredefinedMenuItem,
  Submenu,
} from "@tauri-apps/api/menu";
import { FileActions } from "../components/Toolbar";
import { fileLabel } from "../model/document";

export interface MenuOptions {
  /** The New/Open/Save/Save As commands, shared with the toolbar. */
  files: FileActions;
  /** Remembered document paths, most recent first. */
  recents: string[];
  onOpenRecent: (path: string) => void;
  /** Document undo/redo, shared with the toolbar buttons. */
  onUndo: () => void;
  onRedo: () => void;
}

/** The menu we last installed; kept so a rebuild can release the old one. */
let installed: Menu | null = null;

/**
 * Rebuilds queue behind one another: a recents update can land while the
 * previous install is still awaiting IPC, and two interleaved builds would race
 * over which menu ends up current.
 */
let pending: Promise<boolean> = Promise.resolve(false);

/**
 * Install (or reinstall) the application menu. Resolves to whether a menu was
 * installed — `false` without a Tauri runtime, which is the signal `App` uses to
 * keep handling the Cmd/Ctrl shortcuts itself.
 */
export function installMenu(opts: MenuOptions): Promise<boolean> {
  pending = pending.then(() => build(opts));
  return pending;
}

async function build(opts: MenuOptions): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const menu = await Menu.default();
    const file = await findSubmenu(menu, "File");
    const commands = await fileCommands(opts);
    if (file) {
      // Tauri's default File submenu already holds Close Window (and Quit off
      // macOS); our commands go above it, separated from it. `insert` at 0 rather
      // than `prepend`: the plugin's prepend puts *each* item of a batch at
      // position 0, which reverses them, while insert advances the position.
      await file.insert(
        [...commands, await PredefinedMenuItem.new({ item: "Separator" })],
        0,
      );
    } else {
      // Linux's default menu has no File submenu — give the commands their own.
      await menu.insert(await Submenu.new({ text: "File", items: commands }), 0);
    }

    // Tauri's default Edit submenu opens with the *predefined* Undo/Redo, which
    // drive webview text editing and own Cmd+Z / Shift+Cmd+Z. Swap in our own so
    // the chords undo the document instead. Removing the pair takes two
    // `removeAt(0)`: Redo shifts into 0 once Undo is gone.
    const edit = await findSubmenu(menu, "Edit");
    const history = await historyCommands(opts);
    if (edit) {
      await edit.removeAt(0);
      await edit.removeAt(0);
      await edit.insert(history, 0);
    } else {
      // Same fallback as File above: a default menu without an Edit submenu
      // would otherwise leave the app with no undo accelerator at all, since a
      // successful install stops `App` from claiming the chords.
      await menu.insert(await Submenu.new({ text: "Edit", items: history }), 1);
    }

    const previous = installed;
    installed = menu;
    await menu.setAsAppMenu();
    // Release only menus we built ourselves; the one Tauri created at startup is
    // not ours to destroy.
    await previous?.close();
    return true;
  } catch (err) {
    console.error("[zukai] Couldn't install the application menu:", err);
    return false;
  }
}

/** The Zukai file commands, in menu order. */
async function fileCommands(
  opts: MenuOptions,
): Promise<Array<MenuItem | Submenu>> {
  const { files } = opts;
  return [
    await MenuItem.new({
      id: "zukai-new",
      text: "New",
      accelerator: "CmdOrCtrl+N",
      action: () => files.onNew(),
    }),
    await MenuItem.new({
      id: "zukai-open",
      text: "Open…",
      accelerator: "CmdOrCtrl+O",
      action: () => files.onOpen(),
    }),
    await recentSubmenu(opts),
    await MenuItem.new({
      id: "zukai-save",
      text: "Save",
      accelerator: "CmdOrCtrl+S",
      action: () => files.onSave(),
    }),
    await MenuItem.new({
      id: "zukai-save-as",
      text: "Save As…",
      accelerator: "CmdOrCtrl+Shift+S",
      action: () => files.onSaveAs(),
    }),
  ];
}

/**
 * Zukai's Undo/Redo, replacing the Edit submenu's predefined pair. Kept always
 * enabled — they no-op at the ends of the history stacks, and the toolbar
 * buttons carry the disabled affordance without a per-flip IPC round trip.
 */
async function historyCommands(opts: MenuOptions): Promise<MenuItem[]> {
  return [
    await MenuItem.new({
      id: "zukai-undo",
      text: "Undo",
      accelerator: "CmdOrCtrl+Z",
      action: () => opts.onUndo(),
    }),
    await MenuItem.new({
      id: "zukai-redo",
      text: "Redo",
      accelerator: "CmdOrCtrl+Shift+Z",
      action: () => opts.onRedo(),
    }),
  ];
}

/** "Open Recent", or a single disabled item when nothing is remembered yet. */
async function recentSubmenu({
  recents,
  onOpenRecent,
}: MenuOptions): Promise<Submenu> {
  const items = recents.length
    ? await Promise.all(
        recents.map((path, i) =>
          MenuItem.new({
            id: `zukai-recent-${i}`,
            text: recentLabel(path, recents),
            action: () => onOpenRecent(path),
          }),
        ),
      )
    : [
        await MenuItem.new({
          id: "zukai-recent-none",
          text: "No recent files",
          enabled: false,
        }),
      ];
  return Submenu.new({ id: "zukai-open-recent", text: "Open Recent", items });
}

/**
 * File name for a remembered path, or the whole path when another entry shares
 * that name — two `intersection.zkai`s in different folders must be tellable
 * apart from the menu alone.
 */
function recentLabel(path: string, recents: string[]): string {
  const name = fileLabel(path);
  const shared = recents.filter((p) => fileLabel(p) === name).length > 1;
  return shared ? path : name;
}

/** The submenu with the given (English, Tauri-assigned) title, if present. */
async function findSubmenu(menu: Menu, title: string): Promise<Submenu | null> {
  for (const item of await menu.items()) {
    if (item instanceof Submenu && (await item.text()) === title) return item;
  }
  return null;
}
