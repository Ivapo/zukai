/**
 * Where an exported picture goes, and what it is called.
 *
 * This decision is *host-shaped*, not drawing-shaped. `export.tsx` builds the
 * picture and deliberately says nothing about its destination; a save dialog and
 * a browser download then disagree about what a destination even is — one hands
 * back a path the user chose, the other has no filesystem to name. So the two
 * answers live here rather than beside the renderer.
 *
 * It is a leaf on purpose: it imports no host and no render tree, which is what
 * lets the browser's half be tested with no DOM.
 */

import { basename, withExtension } from "../model/document";
import type { ExportFormat } from "./export";

/**
 * Where the bytes go.
 *
 * `destination` is **host-opaque** — an absolute filesystem path on the desktop,
 * a bare download name in a browser. It is produced and consumed by the same
 * host and must never be re-derived by the other: running a desktop path through
 * {@link basename} is exactly how an export dialog loses the document's own
 * folder.
 */
export interface ExportTarget {
  destination: string;
  format: ExportFormat;
  /**
   * For the browser's `Blob`. The desktop writes bytes through
   * `write_text_file`/`write_binary_file`, neither of which takes a MIME type,
   * so on that host this field is nominal and unread.
   */
  mime: string;
}

/** What a command knows before any host has decided anything. */
export interface ExportRequest {
  /**
   * The format the command asked for. `null` means "the host chooses" — the
   * desktop reads it off the name the save dialog returns, which is the only
   * way a single Export… command can offer both.
   */
  format: ExportFormat | null;
  currentPath: string | null;
  /** `doc.metadata.name`: the fallback for a document with no file yet. */
  name: string;
}

/** The MIME type a format is delivered as. */
export function exportMime(format: ExportFormat): string {
  return format === "png" ? "image/png" : "image/svg+xml";
}

/**
 * The name a browser download is given.
 *
 * A browser has no save dialog, so the format comes from the command (Export SVG
 * or Export PNG) rather than from a name the user typed, and the name comes from
 * whatever the document is already called. The path is reduced to its
 * **basename**: a `download` attribute names a file, not a location, and a
 * document opened from `/home/ivan/Roads/interchange.zkai` should land as
 * `interchange.svg`.
 *
 * `withExtension` *replaces* rather than appends, so the `.zkai` goes. It splits
 * on the last dot in the basename, which is the desktop dialog's behaviour too:
 * a document called `v1.2 interchange` proposes `v1.svg` on both hosts. That is
 * worth knowing (in a browser there is no dialog to correct it) but it is not
 * worth diverging over — one rule, both hosts.
 */
export function browserExportTarget(
  format: ExportFormat,
  currentPath: string | null,
  name: string,
): ExportTarget {
  return {
    destination: basename(withExtension(currentPath ?? name, format)),
    format,
    mime: exportMime(format),
  };
}
