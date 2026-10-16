import { openDesktopTarget, type OpenDesktopTargetInput } from "@/workspace/desktop-open-targets";
import {
  normalizeWorkspaceFileLocation,
  resolveWorkspaceFilePaths,
  type WorkspaceFileLocation,
} from "@/workspace/file-open";

interface TryOpenWorkspaceFileInVscodeInput {
  isVscode: boolean;
  location: WorkspaceFileLocation;
  workspaceDirectory: string | null;
  failedOpenFileMessage: string;
  onError: (message: string) => void;
  openTarget?: (target: OpenDesktopTargetInput) => Promise<void>;
}

export function tryOpenWorkspaceFileInVscode(input: TryOpenWorkspaceFileInVscodeInput): boolean {
  if (!input.isVscode) return false;

  const location = normalizeWorkspaceFileLocation(input.location);
  if (!location || !input.workspaceDirectory) {
    input.onError(input.failedOpenFileMessage);
    return true;
  }
  const resolvedFile = resolveWorkspaceFilePaths({
    path: location.path,
    workspaceRoot: input.workspaceDirectory,
  });
  if (!resolvedFile) {
    input.onError(input.failedOpenFileMessage);
    return true;
  }

  const openTarget = input.openTarget ?? openDesktopTarget;
  void openTarget({
    editorId: "vscode-self",
    workspacePath: input.workspaceDirectory,
    filePath: resolvedFile.absolutePath,
    ...(location.lineStart !== undefined ? { line: location.lineStart } : {}),
    ...(location.lineEnd !== undefined ? { lineEnd: location.lineEnd } : {}),
  }).catch((error: unknown) => {
    input.onError(error instanceof Error ? error.message : input.failedOpenFileMessage);
  });
  return true;
}
