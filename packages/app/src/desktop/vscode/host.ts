import type { DesktopHostBridge } from "@/desktop/host";

export function isVscodeRuntime(): boolean {
  return typeof window !== "undefined" && window.paseoVscode != null;
}

export function getVscodeHost(): DesktopHostBridge | null {
  if (!isVscodeRuntime()) {
    return null;
  }
  const host = window.paseoDesktop;
  if (!host || typeof host !== "object") {
    return null;
  }
  return host;
}
