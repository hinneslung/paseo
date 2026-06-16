// Autonomous VS Code webview debug harness.
// Launches the downloaded VS Code with the dev extension + remote-debugging-port, connects
// Playwright over CDP, opens the Paseo webview, answers the password prompt, and dumps the
// webview's real DOM + console so we can debug the extension without a human in the loop.
//
// Usage (node 22):
//   PASEO_VSCODE_ENDPOINT=192.168.1.194:6768 PASEO_VSCODE_TEST_PASSWORD=blandori \
//   node scripts/cdp-debug.mjs
import { chromium } from "playwright";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PKG_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CDP_PORT = Number(process.env.PASEO_CDP_PORT ?? 9222);
const PASSWORD = process.env.PASEO_VSCODE_TEST_PASSWORD ?? "";

const log = (...args) => console.log("[cdp]", ...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function allPages(browser) {
  return browser.contexts().flatMap((context) => context.pages());
}

function allFrames(browser) {
  return allPages(browser).flatMap((page) => page.frames());
}

async function waitForCdp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      // CDP endpoint not up yet
    }
    await sleep(300);
  }
  throw new Error("CDP endpoint never came up");
}

// Scan every page+frame for the one that defines window.paseoVscode (our injected marker).
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
      title: document.title,
      url: location.href,
      hasPaseoVscode: typeof window.paseoVscode !== "undefined",
      hasPaseoDesktop: typeof window.paseoDesktop !== "undefined",
      paseoVscode: typeof window.paseoVscode !== "undefined" ? window.paseoVscode : null,
      bodyTextHead: (document.body?.innerText ?? "").slice(0, 800),
      rootChildCount: root ? root.childElementCount : -1,
    };
  });
}

async function openPaseo(workbench) {
  const labels = await workbench
    .evaluate(() =>
      Array.from(
        document.querySelectorAll(".activitybar .action-label, .activitybar [role='tab']"),
      ).map((a) => a.getAttribute("aria-label")),
    )
    .catch(() => []);
  log("activity bar labels:", JSON.stringify(labels));
  const clicked = await workbench
    .evaluate(() => {
      const items = Array.from(
        document.querySelectorAll(".activitybar .action-label, .activitybar [role='tab']"),
      );
      const el = items.find((a) =>
        (a.getAttribute("aria-label") || "").toLowerCase().includes("paseo"),
      );
      el?.click();
      return el ? el.getAttribute("aria-label") : null;
    })
    .catch(() => null);
  log("clicked activity item:", clicked);
  await sleep(2500);
  // Also open the full-tab panel via command palette as a second path.
  await workbench.keyboard.press("Control+Shift+P");
  await sleep(800);
  await workbench.keyboard.type("Paseo: Open");
  await sleep(800);
  await workbench.keyboard.press("Enter");
  await sleep(2500);
}

// VS Code's quick input ignores a programmatically-set .value, so drive it with real keys.
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
  log("launching VS Code:", args.join(" "));
  const proc = spawn(exe, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  proc.stdout.on("data", (d) => process.stdout.write(`[code] ${d}`));
  proc.stderr.on("data", (d) => process.stderr.write(`[code-err] ${d}`));
  return proc;
}

async function main() {
  const exe = await downloadAndUnzipVSCode("1.124.2");
  log("vscode exe:", exe);
  const userDataDir = mkdtempSync(path.join(tmpdir(), "paseo-cdp-user-"));
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "paseo-cdp-ws-"));
  const proc = launchVsCode(exe, userDataDir, workspaceDir);
  const cleanup = () => {
    try {
      proc.kill("SIGKILL");
    } catch {
      // already gone
    }
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  };

  try {
    const version = await waitForCdp(CDP_PORT, 60_000);
    log("CDP up:", version.Browser);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    log("connected over CDP");
    attachConsole(browser, "console");

    const workbench = await findWorkbench(browser);
    if (!workbench) {
      log(
        "ERROR: workbench page not found. Pages:",
        allPages(browser).map((p) => p.url()),
      );
      return;
    }
    log("workbench found:", workbench.url());
    workbench.on("console", (msg) => log(`wb-console[${msg.type()}]:`, msg.text()));

    await openPaseo(workbench);
    await answerPasswordPrompt(workbench);

    // The webview HTML is only set after the password prompt resolves, so poll for the frame.
    let found = null;
    for (let i = 0; i < 60 && !found; i++) {
      found = await findAppFrame(browser);
      if (!found) await sleep(700);
    }
    if (!found) {
      log(
        "ERROR: app frame not found. Frames:",
        allFrames(browser).map((f) => f.url()),
      );
      return;
    }
    log("app frame found:", found.url());
    log("=== APP FRAME DUMP ===");
    console.log(JSON.stringify(await dumpFrame(found), null, 2));

    await sleep(6000);
    const dump2 = await dumpFrame(found);
    log("=== APP FRAME DUMP (after connect wait) ===");
    console.log(
      JSON.stringify(
        { bodyTextHead: dump2.bodyTextHead, rootChildCount: dump2.rootChildCount },
        null,
        2,
      ),
    );

    // Optional: exercise the editor.openTarget bridge command end-to-end (drives the same
    // path a chat file-link uses) and report whether VS Code actually opened the file.
    const editorProbePath = process.env.PASEO_CDP_EDITOR_PROBE;
    if (editorProbePath) {
      const invokeResult = await found.evaluate(async (p) => {
        try {
          await window.paseoDesktop.editor.openTarget({
            editorId: "vscode-self",
            path: p,
            mode: "open",
            lineStart: 5,
          });
          return "invoked";
        } catch (e) {
          return `error: ${e?.message ?? e}`;
        }
      }, editorProbePath);
      log("editor.openTarget invoke result:", invokeResult);
      await sleep(2000);
      const editorState = await workbench.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll(".tabs-container .tab")).map(
          (t) => t.getAttribute("aria-label") || t.textContent,
        );
        const hasEditor = !!document.querySelector(".editor-instance .monaco-editor");
        return { tabs, hasEditor };
      });
      log("workbench editor state after openTarget:", JSON.stringify(editorState));
    }
  } finally {
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
