import type { HostToWebviewEnvelope, ResultEnvelope } from "../webview/messaging";

interface VscodeRuntimeConfig {
  endpoint: string | null;
  hasPassword: boolean;
  bridgeProtocol: number;
  workspaceFolders: string[];
}

type EventHandler = (payload: unknown) => void;
type Unsubscribe = () => void;

interface DesktopDialogAskOptions {
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
  kind?: "info" | "warning" | "error";
}

interface DesktopDialogOpenOptions {
  title?: string;
  defaultPath?: string;
  directory?: boolean;
  multiple?: boolean;
  filters?: Array<{
    name: string;
    extensions: string[];
  }>;
}

interface DesktopDialogAskWithCheckboxOptions extends DesktopDialogAskOptions {
  checkboxLabel: string;
  checkboxChecked?: boolean;
}

interface DesktopDialogAskWithCheckboxResult {
  confirmed: boolean;
  dontAskAgain: boolean;
}

interface DesktopWindowControlsOverlayUpdate {
  height?: number;
  backgroundColor?: string;
  foregroundColor?: string;
}

interface DesktopEditorOpenTargetInput {
  editorId: string;
  path: string;
  cwd?: string;
  mode?: "open" | "reveal";
}

interface DesktopHostBridge {
  platform?: string;
  invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  getPendingOpenProject?: () => Promise<string | null>;
  events?: {
    on?: (event: string, handler: EventHandler) => Promise<Unsubscribe> | Unsubscribe;
  };
  window?: {
    openNew?: (options?: { pendingOpenProjectPath?: string | null }) => Promise<void>;
    getCurrentWindow?: () => {
      label?: string;
      toggleMaximize?: () => Promise<void>;
      isFullscreen?: () => Promise<boolean>;
      updateWindowControls?: (update: DesktopWindowControlsOverlayUpdate) => Promise<void>;
      onResized?: (handler: EventHandler) => Promise<Unsubscribe> | Unsubscribe;
      setBadgeCount?: (count?: number) => Promise<void>;
      onDragDropEvent?: (handler: EventHandler) => Promise<Unsubscribe> | Unsubscribe;
    };
  };
  dialog?: {
    ask?: (message: string, options?: DesktopDialogAskOptions) => Promise<boolean>;
    askWithCheckbox?: (
      message: string,
      options: DesktopDialogAskWithCheckboxOptions,
    ) => Promise<DesktopDialogAskWithCheckboxResult>;
    open?: (options?: DesktopDialogOpenOptions) => Promise<string | string[] | null>;
  };
  notification?: {
    isSupported?: () => Promise<boolean>;
    sendNotification?: (
      payload: string | { title: string; body?: string; data?: Record<string, unknown> },
    ) => Promise<boolean>;
  };
  opener?: {
    openUrl?: (url: string) => Promise<void>;
  };
  editor?: {
    listTargets?: () => Promise<
      Array<{ id: string; label: string; kind: "editor" | "file-manager" }>
    >;
    openTarget?: (input: DesktopEditorOpenTargetInput) => Promise<void>;
  };
  webUtils?: {
    getPathForFile?: (file: File) => string;
  };
  menu?: {
    showContextMenu?: (input?: { kind?: "terminal"; hasSelection?: boolean }) => Promise<void>;
  };
  browser?: {
    setWorkspaceActiveBrowser?: (browserId: string | null) => Promise<void>;
    openDevTools?: (browserId: string) => Promise<unknown>;
    clearPartition?: (browserId: string) => Promise<void>;
  };
}

declare global {
  interface Window {
    paseoDesktop?: DesktopHostBridge;
    paseoVscode?: VscodeRuntimeConfig;
  }

  function acquireVsCodeApi(): { postMessage(message: unknown): void };
}

interface PendingInvoke {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function noop(): void {}

const vscodeApi = acquireVsCodeApi();
const sendToVsCode = vscodeApi.postMessage.bind(vscodeApi);
const pendingInvokes = new Map<string, PendingInvoke>();
const eventHandlers = new Map<string, Set<EventHandler>>();
let nextInvokeId = 0;

function getNextInvokeId(): string {
  nextInvokeId += 1;
  return `vscode-invoke-${nextInvokeId}`;
}

function getResultEnvelope(value: unknown): ResultEnvelope | null {
  if (!isRecord(value) || value.kind !== "result" || typeof value.id !== "string") {
    return null;
  }
  if (value.ok === true) {
    return { kind: "result", id: value.id, ok: true, value: value.value };
  }
  return {
    kind: "result",
    id: value.id,
    ok: false,
    error: typeof value.error === "string" ? value.error : "VS Code bridge command failed.",
  };
}

function getHostEnvelope(value: unknown): HostToWebviewEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.kind === "result") {
    return getResultEnvelope(value);
  }
  if (value.kind === "event" && typeof value.event === "string") {
    return { kind: "event", event: value.event, payload: value.payload };
  }
  return null;
}

function invoke(command: string, args?: unknown): Promise<unknown> {
  const id = getNextInvokeId();
  return new Promise((resolve, reject) => {
    pendingInvokes.set(id, { resolve, reject });
    sendToVsCode({ kind: "invoke", id, command, args });
  });
}

function addEventHandler(event: string, handler: EventHandler): Unsubscribe {
  let handlers = eventHandlers.get(event);
  if (!handlers) {
    handlers = new Set();
    eventHandlers.set(event, handlers);
  }
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) {
      eventHandlers.delete(event);
    }
  };
}

function parseAskWithCheckboxResult(value: unknown): DesktopDialogAskWithCheckboxResult {
  if (!isRecord(value)) {
    throw new Error("Unexpected dialog checkbox response.");
  }
  return {
    confirmed: value.confirmed === true,
    dontAskAgain: value.dontAskAgain === true,
  };
}

function parseOpenResult(value: unknown): string | string[] | null {
  if (value === null || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value;
  }
  throw new Error("Unexpected dialog open response.");
}

function parseEditorTargets(value: unknown): Array<{
  id: string;
  label: string;
  kind: "editor" | "file-manager";
}> {
  if (!Array.isArray(value)) {
    throw new Error("Unexpected editor targets response.");
  }
  const targets: Array<{ id: string; label: string; kind: "editor" | "file-manager" }> = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      throw new Error("Unexpected editor target response.");
    }
    const id = typeof entry.id === "string" ? entry.id : null;
    const label = typeof entry.label === "string" ? entry.label : null;
    let kind: "editor" | "file-manager" | null = null;
    if (entry.kind === "file-manager" || entry.kind === "editor") {
      kind = entry.kind;
    }
    if (!id || !label || !kind) {
      throw new Error("Unexpected editor target response.");
    }
    targets.push({ id, label, kind });
  }
  return targets;
}

window.addEventListener("message", (event) => {
  const envelope = getHostEnvelope(event.data);
  if (!envelope) {
    return;
  }
  if (envelope.kind === "result") {
    const pending = pendingInvokes.get(envelope.id);
    if (!pending) {
      return;
    }
    pendingInvokes.delete(envelope.id);
    if (envelope.ok) {
      pending.resolve(envelope.value);
      return;
    }
    pending.reject(new Error(envelope.error ?? "VS Code bridge command failed."));
    return;
  }

  const handlers = eventHandlers.get(envelope.event);
  if (!handlers) {
    return;
  }
  for (const handler of handlers) {
    handler(envelope.payload);
  }
});

window.paseoDesktop = {
  platform: "vscode",
  invoke,
  getPendingOpenProject: () => Promise.resolve(null),
  events: {
    on: addEventHandler,
  },
  window: {
    openNew: () => Promise.resolve(),
    getCurrentWindow: () => ({
      label: "VS Code",
      toggleMaximize: () => Promise.resolve(),
      isFullscreen: () => Promise.resolve(false),
      updateWindowControls: () => Promise.resolve(),
      onResized: () => noop,
      setBadgeCount: () => Promise.resolve(),
      onDragDropEvent: () => noop,
    }),
  },
  dialog: {
    ask: (message, options) =>
      invoke("dialog.ask", { message, options }).then((value) => value === true),
    askWithCheckbox: (message, options) =>
      invoke("dialog.askWithCheckbox", { message, options }).then(parseAskWithCheckboxResult),
    open: (options) => invoke("dialog.open", { options }).then(parseOpenResult),
  },
  notification: {
    isSupported: () => invoke("notification.isSupported").then((value) => value === true),
    sendNotification: (payload) =>
      invoke("notification.sendNotification", { payload }).then((value) => value === true),
  },
  opener: {
    openUrl: (url) => invoke("opener.openUrl", { url }).then(noop),
  },
  editor: {
    listTargets: () => invoke("editor.listTargets").then(parseEditorTargets),
    openTarget: (input) => invoke("editor.openTarget", input).then(noop),
  },
  webUtils: {
    getPathForFile: () => "",
  },
  menu: {
    showContextMenu: () => Promise.resolve(),
  },
  browser: {
    setWorkspaceActiveBrowser: () => Promise.resolve(),
    openDevTools: () => Promise.resolve(null),
    clearPartition: () => Promise.resolve(),
  },
};

export type { DesktopHostBridge };
