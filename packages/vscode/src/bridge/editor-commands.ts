export interface EditorOpenTargetInput {
  editorId: string;
  path: string;
  cwd?: string;
  mode: "open" | "reveal";
  lineStart?: number;
  lineEnd?: number;
}

export interface OpenUrlInput {
  url: string;
}

export const VSCODE_EDITOR_TARGETS = [
  { id: "vscode-self", label: "VS Code", kind: "editor" as const },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseLineNumber(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return Math.floor(value);
}

export function parseEditorOpenTargetInput(args: unknown): EditorOpenTargetInput {
  if (!isRecord(args)) {
    throw new Error("editor.openTarget requires an input object.");
  }
  const editorId = typeof args.editorId === "string" ? args.editorId.trim() : "";
  if (editorId !== "vscode-self") {
    throw new Error("editor.openTarget only supports the VS Code editor target.");
  }
  const filePath = typeof args.path === "string" ? args.path.trim() : "";
  if (!filePath) {
    throw new Error("editor.openTarget requires a file path.");
  }
  const mode = args.mode === "reveal" ? "reveal" : "open";
  const lineStart = parseLineNumber(args.lineStart, "lineStart");
  const lineEnd = parseLineNumber(args.lineEnd, "lineEnd");
  if (lineStart !== undefined && lineEnd !== undefined && lineEnd < lineStart) {
    throw new Error("lineEnd must be greater than or equal to lineStart.");
  }
  const cwd = typeof args.cwd === "string" && args.cwd.trim() ? args.cwd.trim() : undefined;
  return {
    editorId,
    path: filePath,
    mode,
    ...(cwd ? { cwd } : {}),
    ...(lineStart !== undefined ? { lineStart } : {}),
    ...(lineEnd !== undefined ? { lineEnd } : {}),
  };
}

export function parseOpenUrlInput(args: unknown): OpenUrlInput {
  if (!isRecord(args) || typeof args.url !== "string" || args.url.trim().length === 0) {
    throw new Error("opener.openUrl requires a URL.");
  }
  return { url: args.url.trim() };
}
