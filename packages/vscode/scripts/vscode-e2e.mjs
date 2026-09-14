import { chromium } from "playwright";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  answerPasswordPrompt,
  launchVsCode,
  openPaseo,
  sleep,
  waitForAppFrame,
  waitForCdp,
  waitForWorkbench,
} from "./lib/cdp-harness.mjs";
import { connectSeedClient } from "./lib/daemon-seed.mjs";
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
const linkedFileRelativePath = ".github/paseo-vscode-cdp.ts";
const linkedFileLine = 3;
const linkedFileTarget = `${linkedFileRelativePath}:${linkedFileLine}`;
// Keep the provider active after the valid diagram has rendered. The mock provider emits each
// tokenizer chunk at the configured interval, so this creates a bounded observation window even
// when CI iframe rendering is slower than local rendering.
const streamingHoldSuffix = Array.from(
  { length: 80 },
  (_, index) => `hold-${String(index + 1).padStart(2, "0")}`,
).join(" ");
const streamedTranscript = [
  "```mermaid",
  "flowchart LR",
  "  Bridge --> Runtime",
  "  Runtime --> NativeLink",
  "```",
  "",
  streamingHoldSuffix,
  "",
  `[${linkedFileTarget}](${linkedFileRelativePath}#L${linkedFileLine})`,
].join("\n");

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

async function screenshot(workbench, name, { required = false } = {}) {
  mkdirSync(artifactDir, { recursive: true });
  const file = path.join(artifactDir, `${name}.png`);
  try {
    await workbench.screenshot({ path: file });
  } catch (error) {
    log("screenshot failed", error.message);
    if (required) throw error;
  }
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

async function waitForProbe(label, probe, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await probe();
    if (lastValue?.ready) return lastValue;
    await sleep(200);
  }
  throw new Error(`${label} did not become ready. Last probe: ${JSON.stringify(lastValue)}`);
}

function buildAgentRoute(frameUrl, serverId, workspaceId, agentId) {
  const route = new URL(frameUrl);
  route.pathname = `/h/${encodeURIComponent(serverId)}/workspace/${encodeURIComponent(workspaceId)}`;
  route.search = `?open=${encodeURIComponent(`agent:${agentId}`)}`;
  route.hash = "";
  return route.href;
}

async function openSeededAgent(appFrame, seed) {
  const route = buildAgentRoute(appFrame.url(), seed.serverId, seed.workspaceId, seed.agentId);
  await appFrame.evaluate((url) => {
    history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  }, route);
  await appFrame.waitForURL(
    (url) =>
      url.pathname.includes(`/workspace/${seed.workspaceId}`) && !url.searchParams.has("open"),
    { timeout: 30_000 },
  );
  await appFrame.getByTestId("message-input-root").waitFor({ state: "visible", timeout: 30_000 });
}

async function runFileUriDropProbe(appFrame, linkedFile) {
  const textarea = appFrame.getByTestId("message-input-root").locator("textarea").first();
  await textarea.fill("");
  const dataTransfer = await appFrame.evaluateHandle((fileUri) => {
    const transfer = new DataTransfer();
    transfer.setData("text/uri-list", fileUri);
    return transfer;
  }, pathToFileURL(linkedFile).href);
  try {
    await textarea.dispatchEvent("dragenter", { dataTransfer });
    await textarea.dispatchEvent("dragover", { dataTransfer });
    await textarea.dispatchEvent("drop", { dataTransfer });
    const mention = `"${linkedFileRelativePath}"`;
    await waitForProbe(
      "file URI drop mention",
      async () => {
        const value = await textarea.inputValue();
        return { ready: value === mention, value };
      },
      10_000,
    );
    log("file-uri-drop passed", mention);
    await textarea.fill("");
  } finally {
    await dataTransfer.dispose();
  }
}

async function assertDiagramLabels(svg, labels) {
  await svg.waitFor({ state: "visible", timeout: 30_000 });
  await waitForProbe(
    `Mermaid labels ${labels.join(", ")}`,
    async () => {
      const text = await svg.textContent().catch(() => "");
      return { ready: labels.every((label) => text?.includes(label)), text };
    },
    30_000,
  );
}

async function assertDiagramWhileAgentRuns(appFrame, svg, labels) {
  await svg.waitFor({ state: "visible", timeout: 30_000 });
  const stopButton = appFrame.getByRole("button", { name: "Stop agent" });
  await waitForProbe(
    `streaming Mermaid labels ${labels.join(", ")}`,
    async () => {
      const [text, running] = await Promise.all([
        svg.textContent().catch(() => ""),
        stopButton.isVisible().catch(() => false),
      ]);
      return { ready: running && labels.every((label) => text?.includes(label)), running, text };
    },
    30_000,
  );
}

async function assertNativeEditorLocation(workbench, fileName, line) {
  return waitForProbe(
    `VS Code editor ${fileName}:${line}`,
    () =>
      workbench.evaluate(
        ({ expectedFileName, expectedLine }) => {
          const activeTab = document.querySelector(".tabs-container .tab.active");
          const tabText = `${activeTab?.getAttribute("aria-label") ?? ""} ${activeTab?.textContent ?? ""}`;
          const statusItems = Array.from(document.querySelectorAll(".statusbar-item")).map((item) =>
            `${item.getAttribute("aria-label") ?? ""} ${item.textContent ?? ""}`.trim(),
          );
          const activeLineNumbers = Array.from(
            document.querySelectorAll(".monaco-editor.focused .line-numbers.active-line-number"),
          ).map((item) => item.textContent?.trim() ?? "");
          const linePattern = new RegExp(`(?:Ln|Line)\\s*${expectedLine}(?:\\D|$)`, "i");
          return {
            activeLineNumbers,
            ready:
              tabText.includes(expectedFileName) &&
              (activeLineNumbers.includes(String(expectedLine)) ||
                statusItems.some((item) => linePattern.test(item))),
            statusItems,
            tabText,
          };
        },
        { expectedFileName: fileName, expectedLine: line },
      ),
    30_000,
  );
}

function parseWorkspaceRoute(frameUrl) {
  const match = new URL(frameUrl).pathname.match(/^\/h\/([^/]+)\/workspace\/([^/]+)$/);
  if (!match?.[1] || !match[2]) {
    throw new Error(`Cannot seed an agent from non-workspace route ${frameUrl}.`);
  }
  return { serverId: decodeURIComponent(match[1]), workspaceId: decodeURIComponent(match[2]) };
}

async function runRichTranscriptAndFileLinkSpec({
  appFrame,
  password,
  port,
  workbench,
  workspaceDir,
}) {
  const linkedFile = path.join(workspaceDir, linkedFileRelativePath);
  mkdirSync(path.dirname(linkedFile), { recursive: true });
  writeFileSync(
    linkedFile,
    [
      "export const first = 1;",
      "export const second = 2;",
      "export const selectedByNativeLink = 3;",
      "export const fourth = 4;",
    ].join("\n"),
  );

  const route = parseWorkspaceRoute(appFrame.url());
  const client = await connectSeedClient({ port, password });
  try {
    const serverInfo = client.getLastServerInfoMessage();
    if (serverInfo?.serverId !== route.serverId) {
      throw new Error(
        `Seed client resolved server ${serverInfo?.serverId ?? "unknown"}, expected ${route.serverId}.`,
      );
    }
    const agent = await client.createAgent({
      provider: "mock",
      cwd: workspaceDir,
      workspaceId: route.workspaceId,
      title: "VS Code rich transcript fixture",
      modeId: "load-test",
      model: "e2e-fast-stream",
      featureValues: {
        mockStreamingAssistantResponse: streamedTranscript,
        mockStreamingAssistantIntervalMs: 100,
      },
    });
    const seed = { ...route, agentId: agent.id };
    await openSeededAgent(appFrame, seed);
    await runFileUriDropProbe(appFrame, linkedFile);
    await client.sendAgentMessage(agent.id, "Render the diagram and link the generated file.");

    const inlineDiagram = appFrame.getByRole("img", { name: "Diagram" }).last();
    const inlineSvg = inlineDiagram.locator("iframe").contentFrame().locator("#diagram svg");
    await assertDiagramWhileAgentRuns(appFrame, inlineSvg, ["Bridge", "Runtime"]);
    log("Mermaid streaming active-turn check passed");
    await client.waitForFinish(agent.id, 30_000);
    await assertDiagramLabels(inlineSvg, ["Bridge", "Runtime", "NativeLink"]);
    const fileLink = appFrame.getByText(linkedFileTarget, { exact: true }).last();
    await fileLink.waitFor({ state: "visible", timeout: 30_000 });
    await screenshot(workbench, "rich-transcript-inline-success", { required: true });

    await appFrame.getByTestId("mermaid-viewport-canvas").last().hover();
    await appFrame.getByTestId("mermaid-fullscreen").last().click();
    const fullscreenViewport = appFrame.getByTestId("mermaid-fullscreen-viewport");
    await fullscreenViewport.waitFor({ state: "visible", timeout: 30_000 });
    const fullscreenSvg = fullscreenViewport
      .getByTestId("mermaid-fullscreen-viewport-canvas")
      .locator("iframe")
      .contentFrame()
      .locator("#diagram svg");
    await assertDiagramLabels(fullscreenSvg, ["Bridge", "Runtime", "NativeLink"]);
    await screenshot(workbench, "rich-transcript-fullscreen-success", { required: true });
    await appFrame.getByTestId("mermaid-fullscreen-close").click();
    await fullscreenViewport.waitFor({ state: "detached", timeout: 10_000 });

    await fileLink.click();
    const editor = await assertNativeEditorLocation(
      workbench,
      path.basename(linkedFile),
      linkedFileLine,
    );
    await screenshot(workbench, "native-file-link-success", { required: true });
    log("rich-transcript-file-link passed", JSON.stringify(editor));
  } finally {
    await client.close().catch(() => undefined);
  }
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
    environment: {
      NODE_ENV: "development",
      PASEO_NODE_ENV: "development",
    },
  });
  let browser = null;
  let workbench = null;
  let vscodeProcess = null;
  const relevantCspViolations = [];

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
    workbench.on("console", (message) => {
      const text = message.text();
      log(`workbench:${message.type()}`, text);
      if (/content security policy|script-src|unsafe-eval/i.test(text)) {
        relevantCspViolations.push(text);
      }
    });
    workbench.on("pageerror", (error) => log("workbench pageerror", error.message));

    await openPaseo(workbench);
    await answerPasswordPrompt(workbench, password, { log });
    const appFrame = await waitForAppFrame(browser, 45_000, { artifactDir });
    const state = await waitForWorkspace(appFrame, 45_000);

    log("workspace-open passed", JSON.stringify(state));

    await runEditingShortcutsProbe(appFrame);
    await screenshot(workbench, "workspace-open-success", { required: true });
    await runRichTranscriptAndFileLinkSpec({
      appFrame,
      password,
      port: daemonPort,
      workbench,
      workspaceDir,
    });
    if (relevantCspViolations.length > 0) {
      throw new Error(
        `Relevant CSP violations were logged: ${JSON.stringify(relevantCspViolations)}`,
      );
    }
    log("CSP console check passed");
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

await runWorkspaceOpenSpec();
