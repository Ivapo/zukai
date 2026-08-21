/**
 * One dismissible line, for errors that have nowhere else to go.
 *
 * The desktop shows failures in a native dialog. A browser tab had nothing, so
 * every error — including the deliberate "not available yet" replies the web
 * build gives for Open, Save and Import — would have been visible only in
 * devtools (`specs/web_demo_spec.md` §2.7). This is the surface the browser host
 * writes to.
 *
 * Rendered unconditionally: it draws nothing when there is no notice, and the
 * desktop host never posts one, so it needs no host gate and cannot flicker on
 * a desktop launch.
 */

import { useSyncExternalStore } from "react";
import {
  dismissNotice,
  getNotice,
  subscribeNotices,
} from "../editor/notices";

export function Banner() {
  const notice = useSyncExternalStore(subscribeNotices, getNotice);
  if (notice === null) return null;

  return (
    <div className="banner" role="alert">
      <span className="banner-text">
        <strong>{notice.title}.</strong> {notice.detail}
      </span>
      <button
        className="banner-dismiss"
        onClick={dismissNotice}
        title="Dismiss"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
