import { getIsVscode } from "@/constants/platform";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export interface WorkspaceSurfaceConfig {
  showFileExplorer: boolean;
  showDiff: boolean;
  showGitChanges: boolean;
  showBrowser: boolean;
  showVoice: boolean;
  showPluginClientUi: boolean;
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
