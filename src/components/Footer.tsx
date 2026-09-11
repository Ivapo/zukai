/** Bottom bar: the open document's name, and the file commands. */

import { isTauri } from "@tauri-apps/api/core";
import { EXAMPLES, exampleLabel } from "../editor/examples";
import { EditorState } from "../editor/state";
import { fileLabel } from "../model/document";
import { MOD, SHIFT_MOD } from "./shortcuts";

/**
 * The file commands, wired to the host glue by `App`.
 *
 * The shared command surface: the native menu calls these, and the footer's
 * row is deliberately a *subset* — see {@link FILE_COMMANDS}.
 */
export interface FileActions {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  /** The desktop's one dialog-driven Export…; the name chooses the format. */
  onExport: () => void;
  /** Import an Assimilator `network.yaml`. */
  onImport: () => void;
  /** The browser's two explicit Export commands: a download has no dialog. */
  onExportSvg: () => void;
  onExportPng: () => void;
}

interface FooterProps {
  state: EditorState;
  files: FileActions;
  /**
   * Open one of the bundled examples, by stem.
   *
   * Deliberately **not** a member of {@link FileActions}: the row renders
   * `onClick={files[c.key]}` against `keyof FileActions`, so a
   * `(stem: string) => void` in that interface widens the union and fails to
   * assign — and `menu.ts` shares it, while the native menu wants nothing here.
   */
  onOpenExample: (stem: string) => void;
}

interface FileCommand {
  label: string;
  /** The accelerator, for the tooltip. Absent where the command has none. */
  hint?: string;
  key: keyof FileActions;
}

/**
 * The row's plain buttons, the same on both hosts. Export ends the row, and is
 * the one command whose control differs by host ({@link ExportCommand}).
 *
 * Save As is the command left out. In the browser it downloads exactly what
 * Save does — `host-browser.ts:save` has no location to ask for, so both hand it
 * the same name — and both hosts keep it on Shift+Cmd/Ctrl+S, the desktop in its
 * File menu too. Import is in on both, because the browser has no native menu to
 * reach it from.
 */
const FILE_COMMANDS: FileCommand[] = [
  { label: "New", hint: `${MOD}N`, key: "onNew" },
  { label: "Open…", hint: `${MOD}O`, key: "onOpen" },
  { label: "Import…", key: "onImport" },
  { label: "Save", hint: `${MOD}S`, key: "onSave" },
];

export function Footer({ state, files, onOpenExample }: FooterProps) {
  const status = docStatus(state);
  return (
    <footer className="footer">
      <span
        className={`doc-name${status ? ` is-${status}` : ""}`}
        title={status ? STATUS_TITLE[status] : undefined}
      >
        {fileLabel(state.currentPath)}
      </span>

      <div className="file-actions">
        {!isTauri() && <ExampleSelect onOpen={onOpenExample} />}
        {FILE_COMMANDS.map((c) => (
          <button
            key={c.label}
            className="file-btn"
            title={
              c.hint
                ? `${c.label.replace("…", "")} (${c.hint})`
                : c.label.replace("…", "")
            }
            onClick={files[c.key]}
          >
            {c.label}
          </button>
        ))}
        <ExportCommand files={files} />
      </div>
    </footer>
  );
}

type DocStatus = "dirty" | "saved";

const STATUS_TITLE: Record<DocStatus, string> = {
  dirty: "Unsaved changes",
  saved: "Saved",
};

/**
 * What the dot before the file name says: yellow for unsaved changes, green for
 * a document that matches its file, and nothing for one with no file yet — a new
 * Untitled document has no changes, and is still saved nowhere.
 *
 * **Green is desktop-only.** A browser tab cannot write a file in place: Save
 * downloads a copy and leaves the document dirty, and the name held after Open or
 * an example is a bare `File.name`, not a location. So a clean document there
 * matches no file it could be saved back to, and says nothing.
 */
function docStatus(state: EditorState): DocStatus | null {
  if (state.dirty) return "dirty";
  if (state.currentPath !== null && isTauri()) return "saved";
  return null;
}

/**
 * Export, labelled the same on both hosts and doing a different thing on each.
 *
 * The desktop's is one button, and its save dialog reads the format off the name
 * typed into it (`export.tsx:exportFormat`). A browser download has no dialog, so
 * there the format has to be the command (`specs/web_demo_spec.md` §2.7) — and
 * the two commands sit behind the one label as a menu rather than beside it.
 *
 * Read synchronously at render: `App`'s `menuInstalled` only turns true once
 * `installMenu` resolves over IPC, so a control gated on that would show the
 * browser's shape for the first frames of a desktop launch.
 */
function ExportCommand({ files }: { files: FileActions }) {
  if (isTauri()) {
    return (
      <button
        className="file-btn"
        title={`Export (${MOD}E)`}
        onClick={files.onExport}
      >
        Export…
      </button>
    );
  }
  return (
    <CommandSelect
      label="Export"
      title={`Export as SVG (${MOD}E) or PNG (${SHIFT_MOD}E)`}
      placeholder="Export…"
      options={[
        { value: "svg", label: "SVG" },
        { value: "png", label: "PNG" },
      ]}
      onChoose={(format) =>
        format === "png" ? files.onExportPng() : files.onExportSvg()
      }
    />
  );
}

/**
 * The browser's Examples menu: the one way to get a drawing onto the canvas
 * without a repo checkout.
 *
 * **Browser-only**, gated on the synchronous `isTauri()` at the call site for
 * the reason {@link ExportCommand} gives — a desktop user has Open and a
 * filesystem.
 *
 * Never showing its last pick (see {@link CommandSelect}) also keeps it from
 * claiming to show which document is open; `.doc-name` has that job, and after
 * a *declined* discard the open document is not the one just chosen.
 */
function ExampleSelect({ onOpen }: { onOpen: (stem: string) => void }) {
  return (
    <CommandSelect
      label="Open an example"
      title="Open an example schematic"
      placeholder="Examples…"
      options={Object.keys(EXAMPLES).map((stem) => ({
        value: stem,
        label: exampleLabel(stem),
      }))}
      onChoose={onOpen}
    />
  );
}

interface CommandSelectProps {
  label: string;
  title: string;
  placeholder: string;
  options: { value: string; label: string }[];
  onChoose: (value: string) => void;
}

/**
 * A native `<select>` used as a menu: choosing an entry runs a command.
 *
 * Native rather than a bespoke dropdown: the chrome is provisional, and this is
 * keyboard- and screen-reader-reachable for free.
 *
 * **It is controlled at `""` and never moves off its placeholder**, which is
 * what makes choosing the same entry twice work at all. Left displaying its last
 * pick, choosing that entry again fires no `change` event, and the command is
 * unreachable until a different entry is chosen first — so React's
 * controlled-state restore, which resets the element after the change event even
 * with no re-render, is load-bearing rather than tidiness.
 */
function CommandSelect({
  label,
  title,
  placeholder,
  options,
  onChoose,
}: CommandSelectProps) {
  return (
    <select
      className="command-select"
      aria-label={label}
      title={title}
      value=""
      onChange={(e) => onChoose(e.target.value)}
    >
      <option value="" disabled>
        {placeholder}
      </option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
