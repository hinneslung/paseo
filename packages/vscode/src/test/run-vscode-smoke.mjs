import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const workspacePath = mkdtempSync(path.join(tmpdir(), "paseo-vscode-workspace-"));
const userDataDir = mkdtempSync(path.join(tmpdir(), "paseo-vscode-user-data-"));

delete process.env.ELECTRON_RUN_AS_NODE;
for (const key of Object.keys(process.env)) {
  if (key.startsWith("VSCODE_")) {
    delete process.env[key];
  }
}

try {
  await runTests({
    extensionDevelopmentPath: packageRoot,
    extensionTestsPath: path.join(packageRoot, "dist", "test", "vscode-smoke.js"),
    launchArgs: [
      workspacePath,
      "--disable-extensions",
      "--disable-workspace-trust",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--headless",
      "--no-sandbox",
      "--ozone-platform=headless",
      `--user-data-dir=${userDataDir}`,
    ],
  });
} finally {
  rmSync(workspacePath, { recursive: true, force: true });
  rmSync(userDataDir, { recursive: true, force: true });
}
