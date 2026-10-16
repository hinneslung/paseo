// Basic editing shortcuts (select all / copy / cut / paste / undo / redo) inside
// the webview cannot rely on VS Code's own handling: react-native-web's TextInput
// calls stopPropagation() on every keydown, so keystrokes typed in any Paseo text
// field never reach the bubble-phase window listener VS Code's webview host uses
// to forward keys to the workbench ("did-keydown"). On macOS the renderer has no
// native fallback for Cmd+A/C/V/X/Z — Cocoa treats them as menu key equivalents
// and VS Code suppresses menu shortcuts while a webview is focused — so basic
// editing in the composer dies entirely. The bootstrap therefore handles these
// combos itself in a capture-phase window listener, which runs before React can
// swallow the event, and executes them via document.execCommand so real
// input/paste events still fire (image paste and controlled inputs keep working).

export type EditingCommand = "selectAll" | "copy" | "cut" | "paste" | "undo" | "redo";

export interface EditingShortcutEventLike {
  key?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
}

export interface EditingShortcutTargetLike {
  tagName?: unknown;
  type?: unknown;
  isContentEditable?: unknown;
  closest?: (selector: string) => unknown;
}

const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "tel", "password", "email"]);

export function resolveEditingCommand(
  event: EditingShortcutEventLike,
  isMac: boolean,
): EditingCommand | null {
  if (event.defaultPrevented === true || event.isComposing === true) {
    return null;
  }
  if (event.altKey === true) {
    return null;
  }
  // Only the platform's primary editing modifier: Cmd on macOS (plain Ctrl+A there
  // is the native move-to-line-start binding and must stay untouched), Ctrl elsewhere.
  const hasPrimaryModifier =
    isMac === true
      ? event.metaKey === true && event.ctrlKey !== true
      : event.ctrlKey === true && event.metaKey !== true;
  if (!hasPrimaryModifier) {
    return null;
  }
  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  if (event.shiftKey === true) {
    return key === "z" ? "redo" : null;
  }
  switch (key) {
    case "a":
      return "selectAll";
    case "c":
      return "copy";
    case "v":
      return "paste";
    case "x":
      return "cut";
    case "z":
      return "undo";
    case "y":
      return isMac ? null : "redo";
    default:
      return null;
  }
}

export function isEditingShortcutTarget(target: unknown): boolean {
  if (typeof target !== "object" || target === null) {
    return false;
  }
  const element = target as EditingShortcutTargetLike;
  // The terminal owns its keystrokes (Ctrl+C is SIGINT there); xterm's hidden
  // helper textarea must never be treated as a regular text field.
  if (typeof element.closest === "function" && element.closest(".xterm")) {
    return false;
  }
  const tagName = typeof element.tagName === "string" ? element.tagName.toUpperCase() : "";
  if (tagName === "TEXTAREA") {
    return true;
  }
  if (tagName === "INPUT") {
    return TEXT_INPUT_TYPES.has(String(element.type ?? "").toLowerCase());
  }
  return element.isContentEditable === true;
}
