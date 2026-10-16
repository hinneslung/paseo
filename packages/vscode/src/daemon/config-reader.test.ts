import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expandHomePath, readDaemonListen } from "./config-reader";

describe("config-reader", () => {
  it("reads daemon.listen from a persisted config file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "paseo-vscode-config-"));
    try {
      const configPath = path.join(dir, "config.json");
      await writeFile(
        configPath,
        JSON.stringify({ version: 1, daemon: { listen: "192.168.1.194:6768" } }),
      );

      await expect(readDaemonListen(configPath)).resolves.toBe("192.168.1.194:6768");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null when config or daemon.listen is missing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "paseo-vscode-config-"));
    try {
      await expect(readDaemonListen(path.join(dir, "missing.json"))).resolves.toBeNull();
      const configPath = path.join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({ version: 1, daemon: {} }));
      await expect(readDaemonListen(configPath)).resolves.toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("expands forward-slash tilde paths on every platform", () => {
    // "~/.paseo/config.json" must expand regardless of platform: on Windows path.sep is "\\",
    // so matching only `~${path.sep}` left this default unexpanded and the config went unread.
    expect(expandHomePath("~/.paseo/config.json", "/home/tester")).toBe(
      path.join("/home/tester", ".paseo/config.json"),
    );
  });

  it("expands native-separator tilde paths", () => {
    expect(expandHomePath(`~${path.sep}.paseo${path.sep}config.json`, "/home/tester")).toBe(
      path.join("/home/tester", ".paseo", "config.json"),
    );
  });
});
