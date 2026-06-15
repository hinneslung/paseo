import { Platform } from "react-native";
import { isElectronRuntime, isElectronRuntimeMac } from "@/desktop/host";
import { isVscodeRuntime } from "@/desktop/vscode/host";

// ---------------------------------------------------------------------------
// Runtime environment constants
//
// These are the ONLY platform gates in the app. See CLAUDE.md for the
// decision matrix on when to use each one.
//
// Default is cross-platform. Gate only when you must:
//   isWeb      → DOM APIs (document, window, <div>, addEventListener)
//   isNative   → Native-only APIs (Haptics, StatusBar, push tokens, camera)
//   isDev      → Development-only diagnostics and instrumentation
//   isElectron → Desktop wrapper features (file dialogs, titlebar, updates)
//   isVscode   → VS Code webview host features
//
// For layout decisions, use useIsCompactFormFactor() from constants/layout.ts.
// For hover-tracking, see docs/hover.md — the short answer is `onPointerEnter`/
// `onPointerLeave` on a plain `View`, with any press behavior on a separate
// inner `Pressable`. No platform gate needed.
// ---------------------------------------------------------------------------

/** Browser, Electron, or VS Code — the JS runtime has access to the DOM. */
export const isWeb = Platform.OS === "web";

/** iOS or Android — the JS runtime is React Native. */
export const isNative = Platform.OS !== "web";

/** Development build/runtime — true in Metro dev bundles, false in production. */
export const isDev = Boolean((globalThis as { __DEV__?: boolean }).__DEV__);

// ---------------------------------------------------------------------------
// Electron detection (cached — only caches `true`, keeps checking if false
// because the desktop bridge may load after initial module evaluation)
// ---------------------------------------------------------------------------

let _isElectronCached: boolean | null = null;
let _isElectronMacCached: boolean | null = null;
let _isVscodeCached: boolean | null = null;

/** Running inside the Electron desktop wrapper (any OS). */
export function getIsElectron(): boolean {
  if (_isElectronCached === true) return true;
  if (!isWeb) return false;
  const result = isElectronRuntime();
  if (result) _isElectronCached = true;
  return result;
}

/** Running inside the Electron desktop wrapper on macOS. */
export function getIsElectronMac(): boolean {
  if (_isElectronMacCached === true) return true;
  if (!isWeb) return false;
  const result = isElectronRuntimeMac();
  if (result) _isElectronMacCached = true;
  return result;
}

/** Running inside the VS Code extension webview host. */
export function getIsVscode(): boolean {
  if (_isVscodeCached === true) return true;
  if (!isWeb) return false;
  const result = isVscodeRuntime();
  if (result) _isVscodeCached = true;
  return result;
}
