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
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  answerPasswordPrompt,
  attachConsole,
  findAppFrame,
  launchVsCode,
  openPaseo,
  sleep,
  waitForCdp,
  waitForWorkbench,
} from "./lib/cdp-harness.mjs";

const PKG_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CDP_PORT = Number(process.env.PASEO_CDP_PORT ?? 9222);
const PASSWORD = process.env.PASEO_VSCODE_TEST_PASSWORD ?? "";
const LABEL = process.env.PASEO_SHOT_LABEL ?? "shot";
const SHOT_DIR = process.env.PASEO_SHOT_DIR ?? path.resolve(PKG_ROOT, "../../.tmp");

const log = (...args) => console.log("[cdp]", ...args);

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
  const proc = launchVsCode(exe, {
    cdpPort: CDP_PORT,
    logLaunch: () => log("launching VS Code on folder:", workspaceDir),
    userDataDir,
    workspaceDir,
  });
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
    attachConsole(browser, "console", log);

    const workbench = await waitForWorkbench(browser, 20_000, {
      intervalMs: 500,
      returnNullOnTimeout: true,
    });
    if (!workbench) {
      log("ERROR: workbench page not found");
      return;
    }
    workbench.on("console", (msg) => log(`wb-console[${msg.type()}]:`, msg.text()));

    await openPaseo(workbench, {
      afterEnterWaitMs: 2500,
      commandTypedWaitMs: 800,
      paletteOpenWaitMs: 800,
      shortcut: "Control+Shift+P",
      waitForQuickInput: false,
      waitForQuickInputHidden: false,
    });
    await answerPasswordPrompt(workbench, PASSWORD, {
      log,
      missingMessage: null,
      selector: ".quick-input-widget input",
      typedMessage: "typed password into quick input",
      useKeyboard: true,
    });

    let found = null;
    for (let i = 0; i < 60 && !found; i++) {
      found = await findAppFrame(browser, { requireVscodeWebviewForRoot: false });
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
