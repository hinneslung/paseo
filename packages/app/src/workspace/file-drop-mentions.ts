import { resolveWorkspaceFilePaths } from "@/workspace/file-open";

export interface ParseDroppedFilePathsInput {
  uriList?: string | null;
}

function decodeUriComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function normalizeDroppedPath(value: string): string | null {
  const normalized = value.trim().replace(/\\/g, "/");
  return normalized.length > 0 ? normalized : null;
}

function parseFileUri(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith("file:")) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "file:") {
    return null;
  }

  const decodedPath = decodeUriComponent(url.pathname);
  if (!decodedPath) {
    return null;
  }

  const decodedHost = decodeUriComponent(url.hostname) ?? "";
  if (decodedHost && decodedHost !== "localhost") {
    return normalizeDroppedPath(`//${decodedHost}${decodedPath}`);
  }

  const windowsPath = /^\/[A-Za-z]:\//.test(decodedPath) ? decodedPath.slice(1) : decodedPath;
  return normalizeDroppedPath(windowsPath);
}

function parseUriList(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .flatMap((line) => {
      const path = parseFileUri(line);
      return path ? [path] : [];
    });
}

export function parseDroppedFilePaths(input: ParseDroppedFilePathsInput): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const path of parseUriList(input.uriList)) {
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

export function resolveDroppedFileMentionPath(input: { path: string; cwd: string }): string | null {
  const resolved = resolveWorkspaceFilePaths({
    path: input.path,
    workspaceRoot: input.cwd,
  });
  return resolved?.relativePath ?? null;
}
