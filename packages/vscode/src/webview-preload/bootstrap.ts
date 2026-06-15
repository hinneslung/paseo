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
}

const bridgeErrorMessage = "paseo bridge not implemented (phase 1)";

function rejectBridgeCall(): Promise<never> {
  return Promise.reject(new Error(bridgeErrorMessage));
}

function noop(): void {}

window.paseoDesktop = {
  platform: "vscode",
  invoke: () => rejectBridgeCall(),
  getPendingOpenProject: () => Promise.resolve(null),
  events: {
    on: () => noop,
  },
  window: {
    openNew: () => rejectBridgeCall(),
    getCurrentWindow: () => ({
      label: "VS Code",
      toggleMaximize: () => rejectBridgeCall(),
      isFullscreen: () => Promise.resolve(false),
      updateWindowControls: () => Promise.resolve(),
      onResized: () => noop,
      setBadgeCount: () => Promise.resolve(),
      onDragDropEvent: () => noop,
    }),
  },
  dialog: {
    ask: () => rejectBridgeCall(),
    askWithCheckbox: () => rejectBridgeCall(),
    open: () => rejectBridgeCall(),
  },
  notification: {
    isSupported: () => Promise.resolve(false),
    sendNotification: () => rejectBridgeCall(),
  },
  opener: {
    openUrl: () => rejectBridgeCall(),
  },
  editor: {
    listTargets: () => rejectBridgeCall(),
    openTarget: () => rejectBridgeCall(),
  },
  webUtils: {
    getPathForFile: () => "",
  },
  menu: {
    showContextMenu: () => Promise.resolve(),
  },
  browser: {
    setWorkspaceActiveBrowser: () => Promise.resolve(),
    openDevTools: () => rejectBridgeCall(),
    clearPartition: () => Promise.resolve(),
  },
};

export type { DesktopHostBridge };
