import type { PanelPresentation } from "@/panels/panel-registry";
import type { WorkspaceSurfaceConfig } from "@/workspace/surface-capabilities";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export function resolveBuiltInLaunchPresentations(
  surface: WorkspaceSurfaceConfig,
  resolve: (kind: WorkspaceTabTarget["kind"]) => PanelPresentation,
) {
  return {
    changes: surface.showGitChanges ? resolve("changes_tree") : null,
    diff: surface.showDiff ? resolve("working_diff") : null,
    files: surface.showFileExplorer ? resolve("files") : null,
    pullRequest: resolve("pull_request"),
  };
}
