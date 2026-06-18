import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(scriptDir, "../../..");
const home = path.join(os.homedir(), ".paseo");
const port = 6788;
const host = "127.0.0.1";
const listen = `${host}:${port}`;
const password = randomBytes(16).toString("hex");
const daemonLogLimit = 200_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writeDaemonConfig() {
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(home, "config.json"), `${JSON.stringify({ daemon: { listen } })}\n`);
}

function captureDaemonLog(child) {
  let log = "";
  const append = (chunk) => {
    log += chunk.toString();
    if (log.length > daemonLogLimit) {
      log = log.slice(log.length - daemonLogLimit);
    }
  };

  child.stdout?.on("data", append);
  child.stderr?.on("data", append);

  return () => log;
}

function dumpDaemonLog(getLog) {
  const log = getLog();
  console.error("----- Paseo daemon log start -----");
  console.error(log.trimEnd() || "(empty)");
  console.error("----- Paseo daemon log end -----");
}

function startDaemon() {
  const cli = path.join(repoRoot, "packages", "cli", "dist", "cli.js");
  const child = spawn(
    process.execPath,
    [
      cli,
      "daemon",
      "start",
      "--foreground",
      "--no-relay",
      "--no-mcp",
      "--listen",
      listen,
      "--home",
      home,
    ],
    {
      cwd: repoRoot,
      detached: process.platform !== "win32",
      env: { ...process.env, PASEO_PASSWORD: password },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  return child;
}

function getHttpStatus(url) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (status) => {
      if (settled) return;
      settled = true;
      resolve(status);
    };

    const request = http.get(url, (response) => {
      response.resume();
      response.on("end", () => done(response.statusCode ?? 0));
    });

    request.setTimeout(2_000, () => {
      request.destroy();
      done(0);
    });
    request.on("error", () => done(0));
  });
}

async function waitForHealth(child, getLog) {
  const healthUrl = `http://${listen}/api/health`;
  const deadline = Date.now() + 30_000;
  let daemonExit = null;
  let daemonError = null;

  child.once("exit", (code, signal) => {
    daemonExit = { code, signal };
  });
  child.once("error", (error) => {
    daemonError = error;
  });

  while (Date.now() < deadline) {
    if (daemonError) {
      console.error(`[vscode-smoke-daemon] Daemon process failed to start: ${daemonError.message}`);
      dumpDaemonLog(getLog);
      throw daemonError;
    }

    if (daemonExit) {
      console.error(
        `[vscode-smoke-daemon] Daemon exited before health check passed (code ${daemonExit.code}, signal ${daemonExit.signal}).`,
      );
      dumpDaemonLog(getLog);
      throw new Error("Paseo daemon exited before becoming healthy");
    }

    if ((await getHttpStatus(healthUrl)) === 200) {
      return;
    }

    await sleep(300);
  }

  console.error(`[vscode-smoke-daemon] Timed out waiting for ${healthUrl} to return HTTP 200.`);
  dumpDaemonLog(getLog);
  throw new Error("Paseo daemon health check timed out");
}

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

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child, timeoutMs) {
  if (hasExited(child)) return Promise.resolve(true);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      cleanup();
      resolve(true);
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("exit", onExit);
    };

    child.once("exit", onExit);
  });
}

async function runTaskkill(pid) {
  const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
    shell: false,
    stdio: "ignore",
  });
  let timer;

  try {
    await Promise.race([
      once(killer, "exit").catch(() => undefined),
      once(killer, "error"),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          killer.kill();
          resolve();
        }, 10_000);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function terminateDaemon(child) {
  if (!child.pid || hasExited(child)) return;

  if (process.platform === "win32") {
    await runTaskkill(child.pid);
    await waitForExit(child, 5_000);
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") {
      console.warn(
        `[vscode-smoke-daemon] Failed to SIGTERM daemon process group: ${error.message}`,
      );
    }
  }

  if (await waitForExit(child, 5_000)) return;

  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") {
      console.warn(
        `[vscode-smoke-daemon] Failed to SIGKILL daemon process group: ${error.message}`,
      );
    }
  }

  await waitForExit(child, 2_000);
}

async function main() {
  writeDaemonConfig();
  console.log(`[vscode-smoke-daemon] Starting Paseo daemon on ${listen}.`);

  const daemon = startDaemon();
  const getDaemonLog = captureDaemonLog(daemon);

  try {
    await waitForHealth(daemon, getDaemonLog);
    console.log("[vscode-smoke-daemon] Paseo daemon is healthy; running VS Code smoke.");
    return await runSmoke();
  } finally {
    await terminateDaemon(daemon);
  }
}

process.exitCode = await main().catch((error) => {
  console.error(`[vscode-smoke-daemon] ${error.stack || error.message}`);
  return 1;
});
