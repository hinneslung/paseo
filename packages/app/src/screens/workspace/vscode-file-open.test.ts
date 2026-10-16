import { describe, expect, it, vi } from "vitest";
import { tryOpenWorkspaceFileInVscode } from "./vscode-file-open";

describe("tryOpenWorkspaceFileInVscode", () => {
  it("opens a dot-path in the native editor with its complete line range", async () => {
    const openTarget = vi.fn(async () => undefined);
    const onError = vi.fn();

    expect(
      tryOpenWorkspaceFileInVscode({
        isVscode: true,
        location: { path: ".github/qa-example.ts", lineStart: 3, lineEnd: 5 },
        workspaceDirectory: "/workspace/project",
        failedOpenFileMessage: "failed",
        onError,
        openTarget,
      }),
    ).toBe(true);
    await vi.waitFor(() =>
      expect(openTarget).toHaveBeenCalledWith({
        editorId: "vscode-self",
        workspacePath: "/workspace/project",
        filePath: "/workspace/project/.github/qa-example.ts",
        line: 3,
        lineEnd: 5,
      }),
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it("leaves non-VS Code file opens to the in-app disposition handler", () => {
    const openTarget = vi.fn(async () => undefined);

    expect(
      tryOpenWorkspaceFileInVscode({
        isVscode: false,
        location: { path: "src/app.ts", lineStart: 7 },
        workspaceDirectory: "/workspace/project",
        failedOpenFileMessage: "failed",
        onError: vi.fn(),
        openTarget,
      }),
    ).toBe(false);
    expect(openTarget).not.toHaveBeenCalled();
  });

  it("consumes invalid VS Code targets and reports the existing error", () => {
    const onError = vi.fn();

    expect(
      tryOpenWorkspaceFileInVscode({
        isVscode: true,
        location: { path: "../outside.ts", lineStart: 3 },
        workspaceDirectory: "/workspace/project",
        failedOpenFileMessage: "failed",
        onError,
      }),
    ).toBe(true);
    expect(onError).toHaveBeenCalledWith("failed");
  });
});
