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

function normalizeUrlPath(pathname: string): string | null {
  const windowsPath = /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname;
  return normalizeDroppedPath(windowsPath);
}

function normalizeWslFileUriPath(hostname: string, pathname: string): string | null {
  const host = hostname.toLowerCase();
  if (host === "wsl.localhost" || host === "wsl$") {
    const match = /^\/[^/]+(\/.*)$/.exec(pathname);
    return match ? normalizeDroppedPath(match[1]) : null;
  }

  const uncMatch = /^\/+wsl(?:\.localhost|\$)\/[^/]+(\/.*)$/i.exec(pathname);
  return uncMatch ? normalizeDroppedPath(uncMatch[1]) : null;
}

function parseFileUri(value: string): string | null {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol === "vscode-remote:") {
    const decodedPath = decodeUriComponent(url.pathname);
    return decodedPath ? normalizeUrlPath(decodedPath) : null;
  }

  if (url.protocol !== "file:") {
    return null;
  }

  const decodedPath = decodeUriComponent(url.pathname);
  if (!decodedPath) {
    return null;
  }

  const decodedHost = decodeUriComponent(url.hostname) ?? "";
  const wslPath = normalizeWslFileUriPath(decodedHost, decodedPath);
  if (wslPath) {
    return wslPath;
  }

  if (decodedHost && decodedHost !== "localhost") {
    return normalizeDroppedPath(`//${decodedHost}${decodedPath}`);
  }

  return normalizeUrlPath(decodedPath);
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
