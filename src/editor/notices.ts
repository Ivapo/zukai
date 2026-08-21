/**
 * The one line of text the browser build has to say something in.
 *
 * `files.ts:report` writes a console line and then asks the host to show the
 * error. On the desktop that is a native dialog; in a browser tab there was
 * nothing at all, and every failure — including the deliberate "not available
 * yet" replies — would have been visible only with devtools open
 * (`specs/web_demo_spec.md` §2.7). `alert()` is not the answer: a modal blocks
 * the page for something the reader never asked about.
 *
 * So: one notice, replaced rather than queued, read through
 * `useSyncExternalStore`. The snapshot is a **stable reference** — `get` returns
 * the same object until something replaces it — because React re-renders forever
 * if `getSnapshot` mints a new value each call.
 */

/** One line: what failed, and why. */
export interface Notice {
  title: string;
  detail: string;
}

let current: Notice | null = null;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

/** The notice on screen, or `null`. Stable between changes — see the note above. */
export function getNotice(): Notice | null {
  return current;
}

/** Show a notice, replacing any other. §2.7 asks for one line, not a queue. */
export function showNotice(notice: Notice): void {
  current = notice;
  announce();
}

/** Dismiss whatever is showing. */
export function dismissNotice(): void {
  if (current === null) return;
  current = null;
  announce();
}

/** Subscribe to changes; call the result to unsubscribe. */
export function subscribeNotices(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
