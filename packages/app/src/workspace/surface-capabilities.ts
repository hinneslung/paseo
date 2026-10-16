import { useMemo, type ReactNode } from "react";
import { getIsElectron, getIsVscode } from "@/constants/platform";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export interface WorkspaceSurfaceConfig {
  showFileExplorer: boolean;
  showDiff: boolean;
  showGitChanges: boolean;
  showBrowser: boolean;
  showVoice: boolean;
  showPluginClientUi: boolean;
}

export interface WorkspaceSurface {
  config: WorkspaceSurfaceConfig;
  showExplorer: boolean;
  showBrowserLauncher: boolean;
  showChangesLauncher: boolean;
  autoOpenPullRequest: boolean;
}

export function getWorkspaceSurfaceConfig(): WorkspaceSurfaceConfig {
  const isVscode = getIsVscode();
  return {
    showFileExplorer: !isVscode,
    showDiff: !isVscode,
    showGitChanges: !isVscode,
    showBrowser: !isVscode,
    showVoice: !isVscode,
    showPluginClientUi: !isVscode,
  };
}

export function supportsWorkspaceExplorer(config: WorkspaceSurfaceConfig): boolean {
  return config.showFileExplorer || config.showGitChanges;
}

export function shouldRenderWorkspaceExplorer(input: {
  config: WorkspaceSurfaceConfig;
  explorerPaneVisible: boolean;
  focusModeEnabled: boolean;
}): boolean {
  return (
    supportsWorkspaceExplorer(input.config) && input.explorerPaneVisible && !input.focusModeEnabled
  );
}

export function useWorkspaceSurface(isGitCheckout: boolean): WorkspaceSurface {
  const config = useMemo(getWorkspaceSurfaceConfig, []);
  return {
    config,
    showExplorer: supportsWorkspaceExplorer(config),
    showBrowserLauncher: getIsElectron() && config.showBrowser,
    showChangesLauncher: config.showGitChanges && isGitCheckout,
    autoOpenPullRequest: !getIsVscode(),
  };
}

export function WorkspaceExplorerSurface(input: {
  visible: boolean;
  children: ReactNode;
}): ReactNode {
  return input.visible ? input.children : null;
}

export function isWorkspaceTabTargetSupported(
  target: WorkspaceTabTarget,
  config: WorkspaceSurfaceConfig = getWorkspaceSurfaceConfig(),
): boolean {
  if (target.kind === "browser") return config.showBrowser;
  if (target.kind === "changes_tree") return config.showGitChanges;
  if (target.kind === "files" || target.kind === "file") return config.showFileExplorer;
  if (target.kind === "working_diff" || target.kind === "commit_diff") return config.showDiff;
  if (target.kind === "plugin") return config.showPluginClientUi;
  return true;
}

export function shouldAutoOpenWorkspacePullRequest(
  canDetectPullRequest: boolean,
  autoOpenPullRequest: boolean,
): boolean {
  return canDetectPullRequest && autoOpenPullRequest;
}
