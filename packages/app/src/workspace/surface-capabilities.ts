import { getIsVscode } from "@/constants/platform";

export interface WorkspaceSurfaceConfig {
  showFileExplorer: boolean;
  showDiff: boolean;
  showGitChanges: boolean;
  showBrowser: boolean;
  showVoice: boolean;
}

export function getWorkspaceSurfaceConfig(): WorkspaceSurfaceConfig {
  const isVscode = getIsVscode();
  return {
    showFileExplorer: !isVscode,
    showDiff: !isVscode,
    showGitChanges: !isVscode,
    showBrowser: !isVscode,
    showVoice: !isVscode,
  };
}
