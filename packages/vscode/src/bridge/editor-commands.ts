export interface EditorOpenTargetInput {
  editorId: string;
  workspacePath: string;
  filePath?: string;
  line?: number;
  column?: number;
  lineEnd?: number;
}

export interface OpenUrlInput {
  url: string;
}

export const VSCODE_EDITOR_TARGETS = [
  { id: "vscode-self", label: "VS Code", kind: "editor" as const },
];

const ALLOWED_OPEN_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

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
  const workspacePath = typeof args.workspacePath === "string" ? args.workspacePath.trim() : "";
  if (!workspacePath) {
    throw new Error("editor.openTarget requires a workspace path.");
  }
  const filePath =
    typeof args.filePath === "string" && args.filePath.trim() ? args.filePath.trim() : undefined;
  const line = parseLineNumber(args.line, "line");
  const column = parseLineNumber(args.column, "column");
  const lineEnd = parseLineNumber(args.lineEnd, "lineEnd");
  if (line !== undefined && lineEnd !== undefined && lineEnd < line) {
    throw new Error("lineEnd must be greater than or equal to line.");
  }
  return {
    editorId,
    workspacePath,
    ...(filePath ? { filePath } : {}),
    ...(line !== undefined ? { line } : {}),
    ...(column !== undefined ? { column } : {}),
    ...(lineEnd !== undefined ? { lineEnd } : {}),
  };
}

export function parseOpenUrlInput(args: unknown): OpenUrlInput {
  if (!isRecord(args) || typeof args.url !== "string" || args.url.trim().length === 0) {
    throw new Error("opener.openUrl requires a URL.");
  }
  const url = args.url.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("opener.openUrl requires a valid URL.");
  }
  if (!ALLOWED_OPEN_URL_PROTOCOLS.has(parsed.protocol)) {
    throw new Error("opener.openUrl only supports http:, https:, and mailto: URLs.");
  }
  return { url };
}
