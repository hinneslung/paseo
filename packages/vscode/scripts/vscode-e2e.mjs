import { chromium } from "playwright";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startDaemon } from "./lib/daemon-harness.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const vscodeVersion = process.env.PASEO_VSCODE_TEST_VERSION ?? "1.124.2";
const daemonPort = Number(process.env.PASEO_VSCODE_E2E_DAEMON_PORT ?? 6788);
const cdpPort = Number(process.env.PASEO_VSCODE_E2E_CDP_PORT ?? 9230);
const artifactDir =
  process.env.PASEO_VSCODE_E2E_ARTIFACT_DIR ?? path.join(packageRoot, "artifacts", "vscode-e2e");
const workspaceMarkerSelector = '[data-testid="workspace-header-title"]';
const splashSelector = '[data-testid="startup-splash"]';

const log = (...args) => console.log("[vscode-e2e]", ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const allPages = (browser) => browser.contexts().flatMap((context) => context.pages());
const allFrames = (browser) => allPages(browser).flatMap((page) => page.frames());

async function waitForCdp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return await response.json();
    } catch {
      // VS Code is still starting the remote debugging server.
    }
    await sleep(300);
  }
  throw new Error(`CDP endpoint did not become ready on port ${port}.`);
}

async function findWorkbench(browser) {
  for (const page of allPages(browser)) {
    const isWorkbench = await page
      .evaluate(() => !!document.querySelector(".monaco-workbench"))
      .catch(() => false);
    if (isWorkbench) return page;
  }
  return null;
}

async function waitForWorkbench(browser, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const workbench = await findWorkbench(browser);
    if (workbench) return workbench;
    await sleep(300);
  }
  throw new Error("VS Code workbench page was not found.");
}

async function findAppFrame(browser) {
  for (const frame of allFrames(browser)) {
    const isPaseoFrame = await frame
      .evaluate(
        () =>
          typeof window.paseoVscode !== "undefined" ||
          (location.protocol === "vscode-webview:" && !!document.querySelector("#root")),
      )
      .catch(() => false);
    if (isPaseoFrame) return frame;
  }
  return null;
}

async function waitForAppFrame(browser, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = await findAppFrame(browser);
    if (frame) return frame;
    await sleep(300);
  }
  const report = [];
  for (const frame of allFrames(browser)) {
    report.push({
      url: frame.url(),
      probe: await frame
        .evaluate(() => ({
          hasPaseoVscode: typeof window.paseoVscode !== "undefined",
          protocol: location.protocol,
          hasRoot: !!document.querySelector("#root"),
          rootChildren: document.querySelector("#root")?.childElementCount ?? -1,
          title: document.title,
          bodyTextHead: (document.body?.innerText ?? "").slice(0, 300),
        }))
        .catch((error) => ({ error: String(error) })),
    });
  }
  console.log(`[vscode-e2e] frame report: ${JSON.stringify(report, null, 2)}`);
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(path.join(artifactDir, "frame-report.json"), JSON.stringify(report, null, 2));
  throw new Error("Paseo app webview frame was not found.");
}

async function openPaseo(workbench) {
  // Reveal the persistent Paseo activity-bar view first; it renders the webview app reliably in
  // headless CI. (The cdp-screenshot.mjs manual harness does the same.) The command palette alone
  // opens a panel that may not become the focused/rendered editor.
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
  await workbench.waitForTimeout(1500);
  await workbench.keyboard.press(
    process.platform === "darwin" ? "Meta+Shift+P" : "Control+Shift+P",
  );
  const quickInput = workbench.locator(".quick-input-widget input").first();
  await quickInput.waitFor({ state: "visible", timeout: 10_000 });
  // Ctrl+Shift+P seeds the palette with the ">" command-mode prefix. Type real key events (NOT
  // fill()) so VS Code's quick input tracks the active item and Enter activates the highlighted
  // command. fill() only shows the filtered list; Enter then does not fire the command.
  await workbench.keyboard.type("Paseo: Open");
  await workbench.waitForTimeout(700);
  await workbench.keyboard.press("Enter");
  await quickInput.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
}

async function answerPasswordPrompt(workbench, password) {
  const passwordInput = workbench.locator(".quick-input-widget input[type='password']").first();
  const appeared = await passwordInput
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) {
    log("password quick input did not appear; using PASEO_VSCODE_TEST_PASSWORD path");
    return false;
  }
  await passwordInput.fill(password);
  await workbench.keyboard.press("Enter");
  return true;
}

async function readWorkspaceState(frame) {
  return frame.evaluate(
    (selectors) => {
      const workspaceMarker = document.querySelector(selectors.workspaceMarker);
      return {
        bodyTextHead: (document.body?.innerText ?? "").slice(0, 1200),
        hasMessageInputRoot: !!document.querySelector('[data-testid="message-input-root"]'),
        hasSplash: !!document.querySelector(selectors.splash),
        hasWorkspaceMarker: !!workspaceMarker,
        hasWorkspaceTabsRow: !!document.querySelector('[data-testid="workspace-tabs-row"]'),
        rootChildCount: document.querySelector("#root")?.childElementCount ?? -1,
        url: location.href,
        workspaceTitle: workspaceMarker?.textContent?.trim() ?? "",
      };
    },
    { splash: splashSelector, workspaceMarker: workspaceMarkerSelector },
  );
}

async function waitForWorkspace(frame, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    lastState = await readWorkspaceState(frame).catch((error) => ({ error: error.message }));
    if (
      !lastState.hasSplash &&
      (lastState.hasWorkspaceMarker || lastState.hasMessageInputRoot || lastState.hasWorkspaceTabsRow)
    ) {
      return lastState;
    }
    await sleep(300);
  }
  throw new Error(
    `Paseo workspace did not render before timeout. Last state: ${JSON.stringify(lastState)}`,
  );
}

function launchVsCode(executable, { userDataDir, workspaceDir, daemonListen, password }) {
  const env = {
    ...process.env,
    DISPLAY: process.env.DISPLAY || ":0",
    PASEO_VSCODE_ENDPOINT: daemonListen,
    PASEO_VSCODE_TEST_PASSWORD: password,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const key of Object.keys(env)) {
    if (key.startsWith("VSCODE_")) delete env[key];
  }

  const args = [
    workspaceDir,
    `--extensionDevelopmentPath=${packageRoot}`,
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-updates",
    "--password-store=basic",
  ];

  log("launching VS Code", { workspaceDir, cdpPort, daemonListen });
  const child = spawn(executable, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => process.stdout.write(`[code] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[code-err] ${chunk}`));
  return child;
}

async function screenshot(workbench, name) {
  mkdirSync(artifactDir, { recursive: true });
  const file = path.join(artifactDir, `${name}.png`);
  await workbench.screenshot({ path: file }).catch((error) => {
    log("screenshot failed", error.message);
  });
  log("screenshot", file);
}

function writeArtifact(name, data) {
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(path.join(artifactDir, name), `${data}\n`);
}

async function terminateVsCode(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(5_000).then(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      return undefined;
    }),
  ]);
}

async function runWorkspaceOpenSpec() {
  log("playwright resolves to", import.meta.resolve("playwright"));

  const password = randomBytes(16).toString("hex");
  const daemonHome = mkdtempSync(path.join(os.tmpdir(), "paseo-vscode-e2e-home-"));
  const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "paseo-vscode-e2e-workspace-"));
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), "paseo-vscode-e2e-user-"));
  const daemon = startDaemon({
    port: daemonPort,
    password,
    home: daemonHome,
    logPrefix: "[vscode-e2e-daemon]",
  });
  let browser = null;
  let workbench = null;
  let vscodeProcess = null;

  try {
    log(`starting password-protected daemon on ${daemon.listen}`);
    await daemon.waitForHealth({ timeoutMs: 30_000 });

    const executable = await downloadAndUnzipVSCode(vscodeVersion);
    vscodeProcess = launchVsCode(executable, {
      userDataDir,
      workspaceDir,
      daemonListen: daemon.listen,
      password,
    });
    const cdpVersion = await waitForCdp(cdpPort, 60_000);
    log("CDP ready", cdpVersion.Browser);

    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    workbench = await waitForWorkbench(browser, 30_000);
    workbench.on("console", (message) => log(`workbench:${message.type()}`, message.text()));
    workbench.on("pageerror", (error) => log("workbench pageerror", error.message));

    await openPaseo(workbench);
    await answerPasswordPrompt(workbench, password);
    const appFrame = await waitForAppFrame(browser, 45_000);
    const state = await waitForWorkspace(appFrame, 45_000);

    log("workspace-open passed", JSON.stringify(state));
  } catch (error) {
    if (workbench) await screenshot(workbench, "workspace-open-failure");
    writeArtifact("workspace-open-error.txt", error.stack || error.message || String(error));
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
    await terminateVsCode(vscodeProcess);
    await daemon.terminate();
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
    rmSync(daemonHome, { recursive: true, force: true });
  }
}

async function runFileLinkClickSpec() {
  // TODO(WS4 spec2): add this once the test can seed a durable agent timeline fixture through
  // the daemon's supported JSON persistence/API. The manual CDP harness assumes an already-seeded
  // live daemon; guessing at private agent/timeline files here would make the CI job flaky.
  log("skipping file-link click spec; deterministic agent seeding fixture is not available yet");
}

await runWorkspaceOpenSpec();
await runFileLinkClickSpec();
