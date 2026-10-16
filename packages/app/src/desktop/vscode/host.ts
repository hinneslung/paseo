import type { DesktopHostBridge, VscodeRuntimeConfig } from "@/desktop/host";

export function isVscodeRuntime(): boolean {
  return typeof window !== "undefined" && window.paseoVscode != null;
}

export function getVscodeRuntimeConfig(): VscodeRuntimeConfig | null {
  if (!isVscodeRuntime()) {
    return null;
  }
  const config = window.paseoVscode;
  return config && typeof config === "object" ? config : null;
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
