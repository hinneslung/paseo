import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Redirect, usePathname } from "expo-router";
import { useTranslation } from "react-i18next";
import { StartupSplashScreen, type VscodeStartupError } from "@/screens/startup-splash-screen";
import { useEarliestOnlineHostServerId, useHostRuntimeBootstrapState } from "@/app/_layout";
import {
  resolveStartupRoute,
  resolveWorkspaceSelectionStatus,
} from "@/navigation/host-runtime-bootstrap";
import {
  useHostRegistryStatus,
  useHostRuntimeConnectionStatus,
  useHostRuntimeLastError,
  useHosts,
} from "@/runtime/host-runtime";
import { useHasHydratedWorkspaces, useWorkspaceExists } from "@/stores/session-store-hooks";
import {
  useIsLastWorkspaceSelectionHydrated,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import { getVscodeRuntimeConfig } from "@/desktop/vscode/host";
import {
  buildVscodeWorkspaceMatchHref,
  resolveVscodeStartupAction,
  resolveVscodeWorkspaceMatchState,
  type VscodeAutoOpenState,
  type VscodeStartupAction,
  type VscodeStartupStatus,
  type VscodeWorkspaceMatchHost,
} from "@/desktop/vscode/initial-target";
import { getIsVscode } from "@/constants/platform";
import { useSessionStore, type SessionState } from "@/stores/session-store";
import type { HostProfile } from "@/types/host-connection";
import { useOpenProject } from "@/hooks/use-open-project";
import type { OpenProjectResult } from "@/hooks/open-project";

const isDesktop = shouldUseDesktopDaemon();
const EMPTY_WORKSPACE_FOLDERS: readonly string[] = [];
const EMPTY_SESSIONS: Record<string, SessionState> = {};
const IDLE_AUTO_OPEN: VscodeAutoOpenState = { status: "idle", folder: null, message: null };

function statusKeyFor(status: VscodeStartupStatus): string {
  if (status === "connecting") {
    return "startup.status.connecting";
  }
  if (status === "loading-workspaces") {
    return "startup.status.loadingWorkspaces";
  }
  return "startup.status.opening";
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getVscodeActionStatus(
  action: VscodeStartupAction | undefined,
): VscodeStartupStatus | null {
  if (!action) {
    return null;
  }
  if (action.kind === "open") {
    return "opening";
  }
  if (action.kind === "wait") {
    return action.status;
  }
  return null;
}

interface VscodeAutoOpenEffectInput {
  isVscodeRuntime: boolean;
  folder: string | null;
  autoOpenFolderRef: React.MutableRefObject<string | null>;
  openProject: (folder: string) => Promise<OpenProjectResult>;
  setAutoOpen: React.Dispatch<React.SetStateAction<VscodeAutoOpenState>>;
}

interface OpenVscodeFolderInput {
  folder: string;
  autoOpenFolderRef: React.MutableRefObject<string | null>;
  openProject: (folder: string) => Promise<OpenProjectResult>;
  setAutoOpen: React.Dispatch<React.SetStateAction<VscodeAutoOpenState>>;
}

interface RenderVscodeStartupActionInput {
  action: VscodeStartupAction | undefined;
  statusMessage: string | null;
  vscodeError: VscodeStartupError | null;
}

function startVscodeAutoOpen(input: VscodeAutoOpenEffectInput): void {
  if (!input.isVscodeRuntime || !input.folder) {
    return;
  }
  if (input.autoOpenFolderRef.current === input.folder) {
    return;
  }

  const folder = input.folder;
  input.autoOpenFolderRef.current = folder;
  input.setAutoOpen({ status: "pending", folder, message: null });

  void openVscodeFolder({
    folder,
    autoOpenFolderRef: input.autoOpenFolderRef,
    openProject: input.openProject,
    setAutoOpen: input.setAutoOpen,
  });
}

async function openVscodeFolder(input: OpenVscodeFolderInput): Promise<void> {
  try {
    const result = await input.openProject(input.folder);
    if (result.ok) {
      input.setAutoOpen(IDLE_AUTO_OPEN);
      return;
    }
    input.setAutoOpen({
      status: "error",
      folder: input.folder,
      message: result.error ?? "Couldn't open this folder.",
    });
  } catch (error: unknown) {
    input.setAutoOpen({ status: "error", folder: input.folder, message: toErrorMessage(error) });
  } finally {
    if (input.autoOpenFolderRef.current === input.folder) {
      input.autoOpenFolderRef.current = null;
    }
  }
}

function renderVscodeStartupAction(
  input: RenderVscodeStartupActionInput,
): React.ReactElement | null {
  const action = input.action;
  if (!action || action.kind === "none") {
    return null;
  }
  if (action.kind === "redirect") {
    return <Redirect href={buildVscodeWorkspaceMatchHref(action.match)} />;
  }
  if (action.kind === "error") {
    return input.vscodeError ? <StartupSplashScreen vscodeError={input.vscodeError} /> : null;
  }

  const detail = action.kind === "wait" ? action.detail : null;
  return <StartupSplashScreen statusMessage={input.statusMessage} statusDetail={detail} />;
}

function getRelevantVscodeHosts(input: {
  hosts: readonly HostProfile[];
  anyOnlineHostServerId: string | null;
}): readonly HostProfile[] {
  if (!input.anyOnlineHostServerId) {
    return input.hosts;
  }
  return input.hosts.filter((host) => host.serverId === input.anyOnlineHostServerId);
}

function buildVscodeWorkspaceMatchHosts(input: {
  hosts: readonly HostProfile[];
  sessions: Record<string, SessionState>;
  anyOnlineHostServerId: string | null;
}): VscodeWorkspaceMatchHost[] {
  return getRelevantVscodeHosts(input).map((host) => {
    const session = input.sessions[host.serverId];
    return {
      serverId: host.serverId,
      hasHydratedAgents: session?.hasHydratedAgents ?? false,
      hasHydratedWorkspaces: session?.hasHydratedWorkspaces ?? false,
      workspaces: Array.from(session?.workspaces.values() ?? [], (workspace) => ({
        id: workspace.id,
        projectId: workspace.projectId,
        projectRootPath: workspace.projectRootPath,
        workspaceDirectory: workspace.workspaceDirectory,
      })),
      agents: session?.agents.values() ?? [],
    };
  });
}

export default function Index() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const bootstrapState = useHostRuntimeBootstrapState();
  const anyOnlineHostServerId = useEarliestOnlineHostServerId();
  const hosts = useHosts();
  const firstKnownHostServerId = hosts[0]?.serverId ?? "";
  const connectionStatus = useHostRuntimeConnectionStatus(firstKnownHostServerId);
  const connectionLastError = useHostRuntimeLastError(firstKnownHostServerId);
  const hostRegistryStatus = useHostRegistryStatus();
  const workspaceSelection = useLastWorkspaceSelection();
  const isWorkspaceSelectionLoaded = useIsLastWorkspaceSelectionHydrated();
  const workspaceSelectionServerId = workspaceSelection?.serverId ?? null;
  const workspaceSelectionWorkspaceId = workspaceSelection?.workspaceId ?? null;
  const hasHydratedWorkspaceSelectionHost = useHasHydratedWorkspaces(workspaceSelectionServerId);
  const workspaceSelectionExists = useWorkspaceExists(
    workspaceSelectionServerId,
    workspaceSelectionWorkspaceId,
  );
  const isVscodeRuntime = getIsVscode();
  const openProject = useOpenProject(anyOnlineHostServerId);
  const autoOpenFolderRef = useRef<string | null>(null);
  const [autoOpen, setAutoOpen] = useState<VscodeAutoOpenState>(IDLE_AUTO_OPEN);
  const retryAutoOpen = useCallback(() => setAutoOpen(IDLE_AUTO_OPEN), []);
  const sessions = useSessionStore((state) => (isVscodeRuntime ? state.sessions : EMPTY_SESSIONS));
  const vscodeRuntimeConfig = isVscodeRuntime ? getVscodeRuntimeConfig() : null;
  const folders = vscodeRuntimeConfig?.workspaceFolders ?? EMPTY_WORKSPACE_FOLDERS;
  const vscodeMatchHosts = isVscodeRuntime
    ? buildVscodeWorkspaceMatchHosts({
        hosts,
        sessions,
        anyOnlineHostServerId,
      })
    : [];
  const connectionDetail =
    isVscodeRuntime && connectionStatus === "error" ? connectionLastError : null;
  const vscodeAction = isVscodeRuntime
    ? resolveVscodeStartupAction({
        folders,
        hosts: vscodeMatchHosts,
        hasConnectedHost: anyOnlineHostServerId != null,
        connectionDetail,
        autoOpen,
      })
    : undefined;
  const vscodeWorkspaceMatchState = isVscodeRuntime
    ? resolveVscodeWorkspaceMatchState({
        folders,
        hosts: vscodeMatchHosts,
      })
    : undefined;
  const vscodeOpenFolder = vscodeAction?.kind === "open" ? vscodeAction.folder : null;
  const vscodeStatus = getVscodeActionStatus(vscodeAction);
  const vscodeStatusMessage = vscodeStatus ? t(statusKeyFor(vscodeStatus)) : null;
  const vscodeErrorMessage = vscodeAction?.kind === "error" ? vscodeAction.message : null;
  const vscodeError = useMemo<VscodeStartupError | null>(() => {
    if (vscodeErrorMessage === null) {
      return null;
    }
    return { message: vscodeErrorMessage, onRetry: retryAutoOpen };
  }, [retryAutoOpen, vscodeErrorMessage]);

  useEffect(() => {
    startVscodeAutoOpen({
      isVscodeRuntime,
      folder: vscodeOpenFolder,
      autoOpenFolderRef,
      openProject,
      setAutoOpen,
    });
  }, [isVscodeRuntime, openProject, vscodeOpenFolder]);

  const startupRoute = resolveStartupRoute({
    route: { kind: "index", pathname },
    startupBlocker: bootstrapState.startupBlocker,
    hostRegistryStatus,
    hosts,
    anyOnlineHostServerId,
    workspaceSelection,
    workspaceSelectionStatus: resolveWorkspaceSelectionStatus({
      hasHydratedWorkspaces: hasHydratedWorkspaceSelectionHost,
      workspaceExists: workspaceSelectionExists,
    }),
    isWorkspaceSelectionLoaded,
    hasGivenUpWaitingForHost: bootstrapState.hasGivenUpWaitingForHost,
    isVscodeRuntime,
    vscodeWorkspaceMatchState,
  });

  const vscodeStartupElement = renderVscodeStartupAction({
    action: vscodeAction,
    statusMessage: vscodeStatusMessage,
    vscodeError,
  });
  if (isVscodeRuntime && vscodeStartupElement) {
    return vscodeStartupElement;
  }

  if (startupRoute.kind === "redirect") {
    return <Redirect href={startupRoute.href} />;
  }

  return <StartupSplashScreen bootstrapState={isDesktop ? bootstrapState : undefined} />;
}
