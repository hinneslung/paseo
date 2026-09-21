import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "../..");

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function allPages(browser) {
  return browser.contexts().flatMap((context) => context.pages());
}

export function allFrames(browser) {
  return allPages(browser).flatMap((page) => page.frames());
}

export async function waitForCdp(port, timeoutMs, { errorMessage } = {}) {
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

  if (typeof errorMessage === "function") {
    throw new Error(errorMessage(port));
  }
  throw new Error(errorMessage ?? "CDP endpoint never came up");
}

export async function findWorkbench(browser) {
  for (const page of allPages(browser)) {
    const isWorkbench = await page
      .evaluate(() => !!document.querySelector(".monaco-workbench"))
      .catch(() => false);
    if (isWorkbench) return page;
  }
  return null;
}

export async function waitForWorkbench(
  browser,
  timeoutMs,
  {
    errorMessage = "VS Code workbench page was not found.",
    intervalMs = 300,
    returnNullOnTimeout = false,
  } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const workbench = await findWorkbench(browser);
    if (workbench) return workbench;
    await sleep(intervalMs);
  }
  if (returnNullOnTimeout) return null;
  throw new Error(errorMessage);
}

export async function findAppFrame(browser, { requireVscodeWebviewForRoot = true } = {}) {
  for (const frame of allFrames(browser)) {
    const isPaseoFrame = await frame
      .evaluate(
        (options) =>
          typeof window.paseoVscode !== "undefined" ||
          ((!options.requireVscodeWebviewForRoot || location.protocol === "vscode-webview:") &&
            !!document.querySelector("#root")),
        { requireVscodeWebviewForRoot },
      )
      .catch(() => false);
    if (isPaseoFrame) return frame;
  }
  return null;
}

export async function waitForAppFrame(
  browser,
  timeoutMs,
  {
    artifactDir,
    findOptions,
    frameReportName = "frame-report.json",
    logPrefix = "[vscode-e2e]",
  } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frame = await findAppFrame(browser, findOptions);
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

  console.log(`${logPrefix} frame report: ${JSON.stringify(report, null, 2)}`);
  if (artifactDir) {
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(path.join(artifactDir, frameReportName), JSON.stringify(report, null, 2));
  }
  throw new Error("Paseo app webview frame was not found.");
}

export function attachConsole(browser, prefix, log = console.log) {
  for (const page of allPages(browser)) {
    page.on("console", (message) => log(`${prefix}[${message.type()}]:`, message.text()));
    page.on("pageerror", (error) => log(`${prefix}-pageerror:`, error.message));
  }
}

async function getActivityLabels(workbench) {
  return workbench
    .evaluate(() =>
      Array.from(
        document.querySelectorAll(".activitybar .action-label, .activitybar [role='tab']"),
      ).map((element) => element.getAttribute("aria-label")),
    )
    .catch(() => []);
}

async function clickPaseoActivityItem(workbench) {
  return workbench
    .evaluate(() => {
      const items = Array.from(
        document.querySelectorAll(".activitybar .action-label, .activitybar [role='tab']"),
      );
      const element = items.find((item) =>
        (item.getAttribute("aria-label") || "").toLowerCase().includes("paseo"),
      );
      element?.click();
      return element ? element.getAttribute("aria-label") : null;
    })
    .catch(() => null);
}

export async function openPaseo(
  workbench,
  {
    activityWaitMs = 1500,
    afterEnterWaitMs = 0,
    commandTypedWaitMs = 700,
    log,
    logActivityLabels = false,
    logClickedActivity = false,
    paletteOpenWaitMs = 0,
    shortcut = process.platform === "darwin" ? "Meta+Shift+P" : "Control+Shift+P",
    waitForQuickInput = true,
    waitForQuickInputHidden = true,
  } = {},
) {
  // Headless CI renders the webview reliably only after revealing the activity-bar view first.
  if (logActivityLabels) {
    log?.("activity bar labels:", JSON.stringify(await getActivityLabels(workbench)));
  }
  const clicked = await clickPaseoActivityItem(workbench);
  if (logClickedActivity) {
    log?.("clicked activity item:", clicked);
  }

  await sleep(activityWaitMs);
  await workbench.keyboard.press(shortcut);
  const quickInput = workbench.locator(".quick-input-widget input").first();
  if (waitForQuickInput) {
    await quickInput.waitFor({ state: "visible", timeout: 10_000 });
  } else {
    await sleep(paletteOpenWaitMs);
  }
  // Type real key events so VS Code keeps the command-mode prefix and active item state intact.
  await workbench.keyboard.type("Paseo: Open");
  await sleep(commandTypedWaitMs);
  await workbench.keyboard.press("Enter");
  if (waitForQuickInputHidden) {
    await quickInput.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
  }
  await sleep(afterEnterWaitMs);
}

export async function answerPasswordPrompt(
  workbench,
  password,
  {
    afterKeyboardTypeWaitMs = 250,
    keyboardDelay = 20,
    log,
    missingMessage = "password quick input did not appear; using PASEO_VSCODE_TEST_PASSWORD path",
    selector = ".quick-input-widget input[type='password']",
    timeoutMs = 15_000,
    typedMessage,
    useKeyboard = false,
  } = {},
) {
  if (!password) return false;

  const input = workbench.locator(selector).first();
  const appeared = await input
    .waitFor({ state: "visible", timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
  if (!appeared) {
    if (missingMessage) log?.(missingMessage);
    return false;
  }

  if (useKeyboard) {
    await input.focus().catch(() => undefined);
    await workbench.keyboard.type(password, { delay: keyboardDelay });
    await sleep(afterKeyboardTypeWaitMs);
  } else {
    await input.fill(password);
  }
  await workbench.keyboard.press("Enter");
  if (typedMessage) log?.(typedMessage);
  return true;
}

export function launchVsCode(
  executable,
  {
    cdpPort,
    env: envOverrides = {},
    extensionDevelopmentPath = packageRoot,
    extraArgs = [],
    extraArgsAfterGpu = [],
    logLaunch,
    userDataDir,
    workspaceDir,
  },
) {
  const env = { ...process.env, ...envOverrides };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const key of Object.keys(env)) {
    if (key.startsWith("VSCODE_")) delete env[key];
  }
  env.DISPLAY = env.DISPLAY || ":0";

  const args = [
    workspaceDir,
    `--extensionDevelopmentPath=${extensionDevelopmentPath}`,
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    "--no-sandbox",
    "--disable-gpu",
    ...extraArgsAfterGpu,
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-updates",
    ...extraArgs,
  ];

  logLaunch?.({ args, cdpPort, env, workspaceDir });
  const child = spawn(executable, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => process.stdout.write(`[code] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[code-err] ${chunk}`));
  return child;
}
