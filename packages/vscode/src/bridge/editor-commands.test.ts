import { describe, expect, it } from "vitest";
import { parseEditorOpenTargetInput, parseOpenUrlInput } from "./editor-commands";

describe("editor bridge command parsing", () => {
  it("parses editor open targets with line ranges", () => {
    expect(
      parseEditorOpenTargetInput({
        editorId: "vscode-self",
        path: " /workspace/src/app.ts ",
        mode: "open",
        lineStart: 12.8,
        lineEnd: 14,
      }),
    ).toEqual({
      editorId: "vscode-self",
      path: "/workspace/src/app.ts",
      mode: "open",
      lineStart: 12,
      lineEnd: 14,
    });
  });

  it("rejects unsupported editor targets", () => {
    expect(() =>
      parseEditorOpenTargetInput({
        editorId: "external-editor",
        path: "/workspace/src/app.ts",
      }),
    ).toThrow("editor.openTarget only supports the VS Code editor target.");
  });

  it("rejects inverted line ranges", () => {
    expect(() =>
      parseEditorOpenTargetInput({
        editorId: "vscode-self",
        path: "/workspace/src/app.ts",
        lineStart: 8,
        lineEnd: 4,
      }),
    ).toThrow("lineEnd must be greater than or equal to lineStart.");
  });

  it("parses external URL inputs", () => {
    expect(parseOpenUrlInput({ url: " https://paseo.sh/docs " })).toEqual({
      url: "https://paseo.sh/docs",
    });
  });
});
