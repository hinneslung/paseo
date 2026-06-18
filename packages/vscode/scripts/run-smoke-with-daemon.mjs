import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startDaemon } from "./lib/daemon-harness.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const home = path.join(os.homedir(), ".paseo");
const port = 6788;
const host = "127.0.0.1";
const listen = `${host}:${port}`;
const password = randomBytes(16).toString("hex");

function runSmoke() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["src/test/run-vscode-smoke.mjs"], {
      cwd: packageRoot,
      env: { ...process.env, PASEO_VSCODE_TEST_PASSWORD: password },
      shell: false,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        console.error(`[vscode-smoke-daemon] Smoke process exited by signal ${signal}.`);
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

async function main() {
  console.log(`[vscode-smoke-daemon] Starting Paseo daemon on ${listen}.`);

  const daemon = startDaemon({ port, password, home, host });

  try {
    await daemon.waitForHealth();
    console.log("[vscode-smoke-daemon] Paseo daemon is healthy; running VS Code smoke.");
    return await runSmoke();
  } finally {
    await daemon.terminate();
  }
}

process.exitCode = await main().catch((error) => {
  console.error(`[vscode-smoke-daemon] ${error.stack || error.message}`);
  return 1;
});
