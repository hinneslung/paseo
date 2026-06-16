import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function expandHomePath(input: string, home = homedir()): string {
  if (input === "~") {
    return home;
  }
  if (input.startsWith(`~${path.sep}`)) {
    return path.join(home, input.slice(2));
  }
  return input;
}

export async function readDaemonListen(
  configPath = expandHomePath("~/.paseo/config.json"),
): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || !isRecord(parsed.daemon)) {
    return null;
  }

  const listen = parsed.daemon.listen;
  if (typeof listen !== "string") {
    return null;
  }

  const trimmed = listen.trim();
  return trimmed.length > 0 ? trimmed : null;
}
