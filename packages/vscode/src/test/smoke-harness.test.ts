import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("VS Code smoke harness", () => {
  it("isolates daemon discovery under a disposable user home", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../scripts/run-smoke-with-daemon.mjs"),
      "utf8",
    );

    expect(source).toContain('mkdtemp(path.join(os.tmpdir(), "paseo-vscode-smoke-home-"))');
    expect(source).toContain('home: path.join(scratchUserHome, ".paseo")');
    expect(source).toContain("HOME: scratchUserHome");
    expect(source).toContain("USERPROFILE: scratchUserHome");
    expect(source).toContain("await rm(scratchUserHome, { recursive: true, force: true })");
    expect(source).not.toContain("os.homedir()");
  });
});
