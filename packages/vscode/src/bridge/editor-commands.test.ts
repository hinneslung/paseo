import { describe, expect, it } from "vitest";
import { parseEditorOpenTargetInput, parseOpenUrlInput } from "./editor-commands";

describe("editor bridge command parsing", () => {
  it("parses editor open targets with line ranges", () => {
    expect(
      parseEditorOpenTargetInput({
        editorId: "vscode-self",
        workspacePath: " /workspace ",
        filePath: " /workspace/src/app.ts ",
        line: 12.8,
        lineEnd: 14,
      }),
    ).toEqual({
      editorId: "vscode-self",
      workspacePath: "/workspace",
      filePath: "/workspace/src/app.ts",
      line: 12,
      lineEnd: 14,
    });
  });

  it("rejects unsupported editor targets", () => {
    expect(() =>
      parseEditorOpenTargetInput({
        editorId: "external-editor",
        workspacePath: "/workspace",
        filePath: "/workspace/src/app.ts",
      }),
    ).toThrow("editor.openTarget only supports the VS Code editor target.");
  });

  it("rejects inverted line ranges", () => {
    expect(() =>
      parseEditorOpenTargetInput({
        editorId: "vscode-self",
        workspacePath: "/workspace",
        filePath: "/workspace/src/app.ts",
        line: 8,
        lineEnd: 4,
      }),
    ).toThrow("lineEnd must be greater than or equal to line.");
  });

  it("allows http, https, and mailto external URL inputs", () => {
    expect(parseOpenUrlInput({ url: " https://paseo.sh/docs " })).toEqual({
      url: "https://paseo.sh/docs",
    });
    expect(parseOpenUrlInput({ url: "http://localhost:6768" })).toEqual({
      url: "http://localhost:6768",
    });
    expect(parseOpenUrlInput({ url: "mailto:hello@paseo.sh" })).toEqual({
      url: "mailto:hello@paseo.sh",
    });
  });

  it("rejects URL schemes that can invoke local capabilities", () => {
    for (const url of [
      "file:///etc/passwd",
      "command:workbench.action.openSettings",
      "vscode://file/etc/passwd",
      "javascript:alert(1)",
      "data:text/plain,hello",
    ]) {
      expect(() => parseOpenUrlInput({ url })).toThrow(
        "opener.openUrl only supports http:, https:, and mailto: URLs.",
      );
    }
  });

  it("rejects invalid external URL inputs", () => {
    expect(() => parseOpenUrlInput({ url: "/relative/path" })).toThrow(
      "opener.openUrl requires a valid URL.",
    );
  });
});
