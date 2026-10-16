import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, ReactElement, SetStateAction } from "react";
import { Redirect } from "expo-router";
import { useTranslation } from "react-i18next";
import { getIsVscode } from "@/constants/platform";
import { useOpenProjectWorkspace } from "@/hooks/use-open-project";
import type { OpenProjectResult } from "@/hooks/open-project";
import { useHostRuntimeConnectionStatus, useHostRuntimeLastError } from "@/runtime/host-runtime";
import { StartupSplashScreen, type VscodeStartupError } from "@/screens/startup-splash-screen";
import { useSessionStore, type SessionState } from "@/stores/session-store";
import type { HostProfile } from "@/types/host-connection";
import { getVscodeRuntimeConfig } from "./host";
import {
  buildVscodeWorkspaceMatchHref,
  resolveVscodeStartupAction,
  resolveVscodeWorkspaceMatchState,
  type VscodeAutoOpenState,
  type VscodeStartupAction,
  type VscodeStartupStatus,
  type VscodeWorkspaceMatchHost,
  type VscodeWorkspaceMatchState,
} from "./initial-target";

const EMPTY_WORKSPACE_FOLDERS: readonly string[] = [];
const EMPTY_SESSIONS: Record<string, SessionState> = {};
const IDLE_AUTO_OPEN: VscodeAutoOpenState = { status: "idle", folder: null, message: null };

export interface VscodeStartupGateState {
  workspaceMatchState: VscodeWorkspaceMatchState | undefined;
  startupElement: ReactElement | null;
}

function statusKeyFor(status: VscodeStartupStatus): string {
  if (status === "connecting") return "startup.status.connecting";
  if (status === "loading-workspaces") return "startup.status.loadingWorkspaces";
  return "startup.status.opening";
}

function getActionStatus(action: VscodeStartupAction | undefined): VscodeStartupStatus | null {
  if (action?.kind === "open") return "opening";
  if (action?.kind === "wait") return action.status;
  return null;
}

function getRelevantHosts(
  hosts: readonly HostProfile[],
  onlineServerId: string | null,
): readonly HostProfile[] {
  return onlineServerId ? hosts.filter((host) => host.serverId === onlineServerId) : hosts;
}

function buildMatchHosts(input: {
  hosts: readonly HostProfile[];
  sessions: Record<string, SessionState>;
  onlineServerId: string | null;
}): VscodeWorkspaceMatchHost[] {
  return getRelevantHosts(input.hosts, input.onlineServerId).map((host) => {
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

async function openVscodeFolder(input: {
  folder: string;
  autoOpenFolderRef: MutableRefObject<string | null>;
  openProject: (folder: string) => Promise<OpenProjectResult>;
  setAutoOpen: Dispatch<SetStateAction<VscodeAutoOpenState>>;
}): Promise<void> {
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
    input.setAutoOpen({
      status: "error",
      folder: input.folder,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (input.autoOpenFolderRef.current === input.folder) {
      input.autoOpenFolderRef.current = null;
    }
  }
}

function renderStartupAction(input: {
  action: VscodeStartupAction | undefined;
  statusMessage: string | null;
  vscodeError: VscodeStartupError | null;
}): ReactElement | null {
  const action = input.action;
  if (!action || action.kind === "none") return null;
  if (action.kind === "redirect") {
    return <Redirect href={buildVscodeWorkspaceMatchHref(action.match)} />;
  }
  if (action.kind === "error") {
    return input.vscodeError ? <StartupSplashScreen vscodeError={input.vscodeError} /> : null;
  }
  return (
    <StartupSplashScreen
      statusMessage={input.statusMessage}
      statusDetail={action.kind === "wait" ? action.detail : null}
    />
  );
}

export function useVscodeStartupGate(input: {
  anyOnlineHostServerId: string | null;
  hosts: readonly HostProfile[];
}): VscodeStartupGateState {
  const { t } = useTranslation();
  const isVscodeRuntime = getIsVscode();
  const firstKnownHostServerId = input.hosts[0]?.serverId ?? "";
  const connectionStatus = useHostRuntimeConnectionStatus(firstKnownHostServerId);
  const connectionLastError = useHostRuntimeLastError(firstKnownHostServerId);
  const openProject = useOpenProjectWorkspace(input.anyOnlineHostServerId);
  const autoOpenFolderRef = useRef<string | null>(null);
  const [autoOpen, setAutoOpen] = useState<VscodeAutoOpenState>(IDLE_AUTO_OPEN);
  const retryAutoOpen = useCallback(() => setAutoOpen(IDLE_AUTO_OPEN), []);
  const sessions = useSessionStore((state) => (isVscodeRuntime ? state.sessions : EMPTY_SESSIONS));
  const folders = isVscodeRuntime
    ? (getVscodeRuntimeConfig()?.workspaceFolders ?? EMPTY_WORKSPACE_FOLDERS)
    : EMPTY_WORKSPACE_FOLDERS;
  const matchHosts = isVscodeRuntime
    ? buildMatchHosts({
        hosts: input.hosts,
        sessions,
        onlineServerId: input.anyOnlineHostServerId,
      })
    : [];
  const action = isVscodeRuntime
    ? resolveVscodeStartupAction({
        folders,
        hosts: matchHosts,
        hasConnectedHost: input.anyOnlineHostServerId !== null,
        connectionDetail: connectionStatus === "error" ? connectionLastError : null,
        autoOpen,
      })
    : undefined;
  const workspaceMatchState = isVscodeRuntime
    ? resolveVscodeWorkspaceMatchState({ folders, hosts: matchHosts })
    : undefined;
  const openFolder = action?.kind === "open" ? action.folder : null;
  const status = getActionStatus(action);
  const errorMessage = action?.kind === "error" ? action.message : null;
  const vscodeError = useMemo<VscodeStartupError | null>(
    () => (errorMessage === null ? null : { message: errorMessage, onRetry: retryAutoOpen }),
    [errorMessage, retryAutoOpen],
  );

  useEffect(() => {
    if (!isVscodeRuntime || !openFolder || autoOpenFolderRef.current === openFolder) return;
    autoOpenFolderRef.current = openFolder;
    setAutoOpen({ status: "pending", folder: openFolder, message: null });
    void openVscodeFolder({ folder: openFolder, autoOpenFolderRef, openProject, setAutoOpen });
  }, [isVscodeRuntime, openFolder, openProject]);

  return {
    workspaceMatchState,
    startupElement: renderStartupAction({
      action,
      statusMessage: status ? t(statusKeyFor(status)) : null,
      vscodeError,
    }),
  };
}
