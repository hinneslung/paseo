// Validation harness: launch real VS Code on a chosen folder, open the Paseo webview,
// answer the password prompt, then screenshot the workbench (which renders the webview)
// and dump the app frame's body text + console. Used to validate the "folder not known to
// the daemon" loading fix with before/after screenshots.
//
// Usage (node 22):
//   PASEO_VSCODE_ENDPOINT=192.168.1.194:6768 PASEO_VSCODE_TEST_PASSWORD=blandori \
//   PASEO_SHOT_LABEL=before PASEO_CDP_WORKSPACE=/some/folder \
//   node scripts/cdp-screenshot.mjs
import { chromium } from "playwright";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PKG_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CDP_PORT = Number(process.env.PASEO_CDP_PORT ?? 9222);
const PASSWORD = process.env.PASEO_VSCODE_TEST_PASSWORD ?? "";
const LABEL = process.env.PASEO_SHOT_LABEL ?? "shot";
const SHOT_DIR = process.env.PASEO_SHOT_DIR ?? path.resolve(PKG_ROOT, "../../.tmp");

const log = (...args) => console.log("[cdp]", ...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const allPages = (b) => b.contexts().flatMap((c) => c.pages());
const allFrames = (b) => allPages(b).flatMap((p) => p.frames());

async function waitForCdp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      // not up yet
    }
    await sleep(300);
  }
  throw new Error("CDP endpoint never came up");
}

async function findAppFrame(browser) {
  for (const frame of allFrames(browser)) {
    const has = await frame
      .evaluate(
        () => typeof window.paseoVscode !== "undefined" || !!document.querySelector("#root"),
      )
      .catch(() => false);
    if (has) return frame;
  }
  return null;
}

async function findWorkbench(browser) {
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const page of allPages(browser)) {
      const isWb = await page
        .evaluate(() => !!document.querySelector(".monaco-workbench"))
        .catch(() => false);
      if (isWb) return page;
    }
    await sleep(500);
  }
  return null;
}

function attachConsole(browser, prefix) {
  for (const page of allPages(browser)) {
    page.on("console", (msg) => log(`${prefix}[${msg.type()}]:`, msg.text()));
    page.on("pageerror", (err) => log(`${prefix}-pageerror:`, err.message));
  }
}

function dumpFrame(frame) {
  return frame.evaluate(() => {
    const root = document.querySelector("#root") || document.body;
    return {
      url: location.href,
      bodyTextHead: (document.body?.innerText ?? "").slice(0, 1200),
      rootChildCount: root ? root.childElementCount : -1,
    };
  });
}

async function openPaseo(workbench) {
  await workbench
    .evaluate(() => {
      const items = Array.from(
        document.querySelectorAll(".activitybar .action-label, .activitybar [role='tab']"),
      );
      const el = items.find((a) =>
        (a.getAttribute("aria-label") || "").toLowerCase().includes("paseo"),
      );
      el?.click();
    })
    .catch(() => {});
  await sleep(1500);
  await workbench.keyboard.press("Control+Shift+P");
  await sleep(800);
  await workbench.keyboard.type("Paseo: Open");
  await sleep(800);
  await workbench.keyboard.press("Enter");
  await sleep(2500);
}

async function answerPasswordPrompt(workbench) {
  if (!PASSWORD) return;
  for (let i = 0; i < 30; i++) {
    const visible = await workbench
      .evaluate(() => {
        const input = document.querySelector(".quick-input-widget input");
        return !!(input && input.offsetParent !== null);
      })
      .catch(() => false);
    if (visible) {
      await workbench
        .evaluate(() => document.querySelector(".quick-input-widget input")?.focus())
        .catch(() => {});
      await workbench.keyboard.type(PASSWORD, { delay: 20 });
      await sleep(250);
      await workbench.keyboard.press("Enter");
      log("typed password into quick input");
      return;
    }
    await sleep(500);
  }
}

function launchVsCode(exe, userDataDir, workspaceDir) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const k of Object.keys(env)) if (k.startsWith("VSCODE_")) delete env[k];
  env.DISPLAY = env.DISPLAY || ":0";
  const args = [
    workspaceDir,
    `--extensionDevelopmentPath=${PKG_ROOT}`,
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--no-sandbox",
    "--disable-gpu",
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-updates",
  ];
  log("launching VS Code on folder:", workspaceDir);
  const proc = spawn(exe, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  proc.stdout.on("data", (d) => process.stdout.write(`[code] ${d}`));
  proc.stderr.on("data", (d) => process.stderr.write(`[code-err] ${d}`));
  return proc;
}

async function shoot(workbench, name) {
  mkdirSync(SHOT_DIR, { recursive: true });
  const file = path.join(SHOT_DIR, `vscode-${LABEL}-${name}.png`);
  await workbench.screenshot({ path: file }).catch((e) => log("screenshot failed:", e.message));
  log("screenshot:", file);
}

async function main() {
  const exe = await downloadAndUnzipVSCode("1.124.2");
  const userDataDir = mkdtempSync(path.join(tmpdir(), "paseo-cdp-user-"));
  const externalWorkspace = process.env.PASEO_CDP_WORKSPACE;
  const workspaceDir = externalWorkspace || mkdtempSync(path.join(tmpdir(), "paseo-cdp-ws-"));
  const proc = launchVsCode(exe, userDataDir, workspaceDir);
  const cleanup = () => {
    try {
      proc.kill("SIGKILL");
    } catch {
      // already gone
    }
    rmSync(userDataDir, { recursive: true, force: true });
    if (!externalWorkspace) rmSync(workspaceDir, { recursive: true, force: true });
  };

  try {
    const version = await waitForCdp(CDP_PORT, 60_000);
    log("CDP up:", version.Browser);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    attachConsole(browser, "console");

    const workbench = await findWorkbench(browser);
    if (!workbench) {
      log("ERROR: workbench page not found");
      return;
    }
    workbench.on("console", (msg) => log(`wb-console[${msg.type()}]:`, msg.text()));

    await openPaseo(workbench);
    await answerPasswordPrompt(workbench);

    let found = null;
    for (let i = 0; i < 60 && !found; i++) {
      found = await findAppFrame(browser);
      if (!found) await sleep(700);
    }
    if (!found) {
      log("ERROR: app frame not found");
      await shoot(workbench, "no-frame");
      return;
    }
    log("app frame found:", found.url());

    await sleep(4000);
    log("=== APP FRAME DUMP (t=4s) ===");
    console.log(JSON.stringify(await dumpFrame(found), null, 2));
    await shoot(workbench, "t4s");

    await sleep(8000);
    const dump2 = await dumpFrame(found);
    log("=== APP FRAME DUMP (t=12s) ===");
    console.log(JSON.stringify(dump2, null, 2));
    await shoot(workbench, "t12s");
  } finally {
    await sleep(500);
    cleanup();
  }
}

main()
  .then(() => {
    log("done");
    process.exit(0);
  })
  .catch((e) => {
    log("FATAL:", e?.stack ?? e);
    process.exit(1);
  });
