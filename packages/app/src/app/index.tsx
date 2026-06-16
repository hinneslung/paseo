import React from "react";
import { Redirect, usePathname } from "expo-router";
import { StartupSplashScreen } from "@/screens/startup-splash-screen";
import { useEarliestOnlineHostServerId, useHostRuntimeBootstrapState } from "@/app/_layout";
import {
  resolveStartupRoute,
  resolveWorkspaceSelectionStatus,
} from "@/navigation/host-runtime-bootstrap";
import { useHostRegistryStatus, useHosts } from "@/runtime/host-runtime";
import { useHasHydratedWorkspaces, useWorkspaceExists } from "@/stores/session-store-hooks";
import {
  useIsLastWorkspaceSelectionHydrated,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import { getVscodeRuntimeConfig } from "@/desktop/vscode/host";
import {
  resolveVscodeWorkspaceMatchState,
  type VscodeWorkspaceMatchHost,
} from "@/desktop/vscode/initial-target";
import { getIsVscode } from "@/constants/platform";
import { useSessionStore, type SessionState } from "@/stores/session-store";
import type { HostProfile } from "@/types/host-connection";

const isDesktop = shouldUseDesktopDaemon();
const EMPTY_WORKSPACE_FOLDERS: readonly string[] = [];
const EMPTY_SESSIONS: Record<string, SessionState> = {};

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
      workspaces: session?.workspaces.values() ?? [],
      agents: session?.agents.values() ?? [],
    };
  });
}

export default function Index() {
  const pathname = usePathname();
  const bootstrapState = useHostRuntimeBootstrapState();
  const anyOnlineHostServerId = useEarliestOnlineHostServerId();
  const hosts = useHosts();
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
  const sessions = useSessionStore((state) => (isVscodeRuntime ? state.sessions : EMPTY_SESSIONS));
  const vscodeRuntimeConfig = isVscodeRuntime ? getVscodeRuntimeConfig() : null;
  const vscodeWorkspaceMatchState = isVscodeRuntime
    ? resolveVscodeWorkspaceMatchState({
        folders: vscodeRuntimeConfig?.workspaceFolders ?? EMPTY_WORKSPACE_FOLDERS,
        hosts: buildVscodeWorkspaceMatchHosts({
          hosts,
          sessions,
          anyOnlineHostServerId,
        }),
      })
    : undefined;

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

  if (startupRoute.kind === "redirect") {
    return <Redirect href={startupRoute.href} />;
  }

  return <StartupSplashScreen bootstrapState={isDesktop ? bootstrapState : undefined} />;
}
