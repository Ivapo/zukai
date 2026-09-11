/** Shortcut prefixes, shown in tooltips: ⌘ on macOS, Ctrl elsewhere. */

const MAC =
  typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

export const MOD = MAC ? "⌘" : "Ctrl+";
export const SHIFT_MOD = MAC ? "⇧⌘" : "Ctrl+Shift+";
