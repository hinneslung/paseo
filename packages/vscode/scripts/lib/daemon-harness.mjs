import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../../..");
const daemonLogLimit = 200_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writeDaemonConfig(home, listen) {
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

async function terminateDaemon(child, logPrefix) {
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
      console.warn(`${logPrefix} Failed to SIGTERM daemon process group: ${error.message}`);
    }
  }

  if (await waitForExit(child, 5_000)) return;

  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") {
      console.warn(`${logPrefix} Failed to SIGKILL daemon process group: ${error.message}`);
    }
  }

  await waitForExit(child, 2_000);
}

export function startDaemon({
  port,
  password,
  home,
  host = "127.0.0.1",
  logPrefix = "[vscode-smoke-daemon]",
}) {
  if (!port) throw new Error("startDaemon requires a port.");
  if (!password) throw new Error("startDaemon requires a password.");
  if (!home) throw new Error("startDaemon requires a home directory.");

  const listen = `${host}:${port}`;
  writeDaemonConfig(home, listen);

  const worker = path.join(
    repoRoot,
    "packages",
    "server",
    "dist",
    "server",
    "server",
    "daemon-worker.js",
  );
  if (!existsSync(worker)) {
    throw new Error(
      `Paseo daemon worker not found at ${worker}; run "npm run build:server" first.`,
    );
  }

  const child = spawn(process.execPath, [worker, "--no-relay", "--no-mcp"], {
    cwd: repoRoot,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      PASEO_HOME: home,
      PASEO_LISTEN: listen,
      PASEO_PASSWORD: password,
      // Match the cli-tests CI env: keep daemon startup fast and headless-safe
      // (no speech model download / onnxruntime native init).
      PASEO_LOCAL_SPEECH_AUTO_DOWNLOAD: "0",
      PASEO_DICTATION_ENABLED: "0",
      PASEO_VOICE_MODE_ENABLED: "0",
      ONNXRUNTIME_NODE_INSTALL: "skip",
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const getLog = captureDaemonLog(child);
  let daemonExit = null;
  let daemonError = null;
  child.once("exit", (code, signal) => {
    daemonExit = { code, signal };
  });
  child.once("error", (error) => {
    daemonError = error;
  });

  return {
    child,
    getLog,
    home,
    host,
    listen,
    password,
    port,
    async waitForHealth({ timeoutMs = 30_000 } = {}) {
      const healthUrl = `http://${listen}/api/health`;
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        if (daemonError) {
          console.error(`${logPrefix} Daemon process failed to start: ${daemonError.message}`);
          dumpDaemonLog(getLog);
          throw daemonError;
        }

        if (daemonExit) {
          console.error(
            `${logPrefix} Daemon exited before health check passed (code ${daemonExit.code}, signal ${daemonExit.signal}).`,
          );
          dumpDaemonLog(getLog);
          throw new Error("Paseo daemon exited before becoming healthy");
        }

        if ((await getHttpStatus(healthUrl)) === 200) {
          return;
        }

        await sleep(300);
      }

      console.error(`${logPrefix} Timed out waiting for ${healthUrl} to return HTTP 200.`);
      dumpDaemonLog(getLog);
      throw new Error("Paseo daemon health check timed out");
    },
    terminate: () => terminateDaemon(child, logPrefix),
  };
}
