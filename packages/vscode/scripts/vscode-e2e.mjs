import { chromium } from "playwright";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  answerPasswordPrompt,
  launchVsCode,
  openPaseo,
  sleep,
  waitForAppFrame,
  waitForCdp,
  waitForWorkbench,
} from "./lib/cdp-harness.mjs";
import { startDaemon } from "./lib/daemon-harness.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const vscodeVersion = process.env.PASEO_VSCODE_TEST_VERSION ?? "1.124.2";
const daemonPort = Number(process.env.PASEO_VSCODE_E2E_DAEMON_PORT ?? 6788);
const cdpPort = Number(process.env.PASEO_VSCODE_E2E_CDP_PORT ?? 9230);
const runHeadless = process.env.PASEO_VSCODE_E2E_HEADLESS === "1";
const artifactDir =
  process.env.PASEO_VSCODE_E2E_ARTIFACT_DIR ?? path.join(packageRoot, "artifacts", "vscode-e2e");
const workspaceMarkerSelector = '[data-testid="workspace-header-title"]';
const splashSelector = '[data-testid="startup-splash"]';

const log = (...args) => console.log("[vscode-e2e]", ...args);

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
      (lastState.hasWorkspaceMarker ||
        lastState.hasMessageInputRoot ||
        lastState.hasWorkspaceTabsRow)
    ) {
      return lastState;
    }
    await sleep(300);
  }
  throw new Error(
    `Paseo workspace did not render before timeout. Last state: ${JSON.stringify(lastState)}`,
  );
}

async function readMessageInputState(frame) {
  return frame.evaluate(() => {
    const textarea = Array.from(
      document.querySelectorAll('[data-testid="message-input-root"] textarea'),
    ).find(
      (candidate) =>
        candidate instanceof HTMLTextAreaElement &&
        candidate.getClientRects().length > 0 &&
        getComputedStyle(candidate).visibility !== "hidden",
    );
    if (!(textarea instanceof HTMLTextAreaElement)) {
      return { present: false };
    }
    return {
      present: true,
      focused: document.activeElement === textarea,
      value: textarea.value,
      selectionStart: textarea.selectionStart,
      selectionEnd: textarea.selectionEnd,
    };
  });
}

async function waitForMessageInputState(frame, timeoutMs, predicate, label) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    lastState = await readMessageInputState(frame).catch((error) => ({ error: error.message }));
    if (predicate(lastState)) {
      return lastState;
    }
    await sleep(150);
  }
  throw new Error(
    `editing-shortcuts: ${label} not reached. Last state: ${JSON.stringify(lastState)}`,
  );
}

// Guards the bootstrap's capture-phase editing-shortcut handler
// (webview-preload/editing-shortcuts.ts). Uses Ctrl combos, which exercise the
// same handler the mac Cmd combos hit; the modifier mapping is unit-tested.
async function runEditingShortcutsProbe(appFrame) {
  const probeText = `paseo edit probe ${Date.now()}`;
  const textarea = appFrame.locator('[data-testid="message-input-root"] textarea:visible').first();
  await textarea.click();
  await waitForMessageInputState(appFrame, 10_000, (s) => s.present && s.focused, "composer focus");

  const keyboard = appFrame.page().keyboard;
  await keyboard.type(probeText);
  await waitForMessageInputState(
    appFrame,
    10_000,
    (s) => s.value === probeText,
    "typed probe text",
  );

  // A synthetic (untrusted) Ctrl+A cannot trigger the browser's native
  // select-all, so a full selection here proves the bootstrap handler itself
  // handled the combo. This is what fails if the capture listener is removed.
  await appFrame.evaluate(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true }),
    );
  });
  await waitForMessageInputState(
    appFrame,
    5_000,
    (s) => s.selectionStart === 0 && s.selectionEnd === probeText.length,
    "select-all selection",
  );

  // Real keystrokes: the handler preventDefaults the native editing path, so a
  // successful cut/paste round-trip proves document.execCommand("cut"/"paste")
  // works against the real clipboard inside the webview.
  await keyboard.press("Control+x");
  await waitForMessageInputState(appFrame, 5_000, (s) => s.value === "", "cut emptied composer");

  await keyboard.press("Control+v");
  await waitForMessageInputState(
    appFrame,
    5_000,
    (s) => s.value === probeText,
    "paste restored probe text",
  );

  log("editing-shortcuts passed");
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
      cdpPort,
      env: {
        PASEO_VSCODE_ENDPOINT: daemon.listen,
        PASEO_VSCODE_TEST_PASSWORD: password,
      },
      extraArgs: ["--password-store=basic"],
      extraArgsAfterGpu: [
        "--disable-dev-shm-usage",
        ...(runHeadless
          ? ["--headless", "--ozone-platform=headless", "--window-size=1440,900"]
          : []),
      ],
      logLaunch: () =>
        log("launching VS Code", { workspaceDir, cdpPort, daemonListen: daemon.listen }),
      userDataDir,
      workspaceDir,
    });
    const cdpVersion = await waitForCdp(cdpPort, 60_000, {
      errorMessage: (port) => `CDP endpoint did not become ready on port ${port}.`,
    });
    log("CDP ready", cdpVersion.Browser);

    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    workbench = await waitForWorkbench(browser, 30_000);
    if (runHeadless) {
      await workbench.setViewportSize({ width: 1440, height: 900 });
    }
    workbench.on("console", (message) => log(`workbench:${message.type()}`, message.text()));
    workbench.on("pageerror", (error) => log("workbench pageerror", error.message));

    await openPaseo(workbench);
    await answerPasswordPrompt(workbench, password, { log });
    const appFrame = await waitForAppFrame(browser, 45_000, { artifactDir });
    const state = await waitForWorkspace(appFrame, 45_000);

    log("workspace-open passed", JSON.stringify(state));

    await runEditingShortcutsProbe(appFrame);
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
