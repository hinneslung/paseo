// Validation: open the seeded dot-paths workspace in the extension, open the seeded agent chat
// (whose message links .github/workflows/ci.yml etc.), click the hidden-path file link, and
// screenshot VS Code opening the file. Proves the assistant file-link fix in the real UI.
import { chromium } from "playwright";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PKG_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CDP_PORT = Number(process.env.PASEO_CDP_PORT ?? 9226);
const SHOT_DIR = process.env.PASEO_SHOT_DIR ?? path.resolve(PKG_ROOT, "../../.tmp");
const LABEL = process.env.PASEO_SHOT_LABEL ?? "filelink-click";
const WS = process.env.PASEO_CDP_WORKSPACE ?? "/tmp/paseo-dotlinks-ws";
const LINK = process.env.PASEO_LINK_TEXT ?? ".github/workflows/ci.yml";

const log = (...a) => console.log("[cdp]", ...a);
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
  log("launching VS Code on", workspaceDir);
  const proc = spawn(exe, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  proc.stdout.on("data", (d) => process.stdout.write(`[code] ${d}`));
  proc.stderr.on("data", (d) => process.stderr.write(`[code-err] ${d}`));
  return proc;
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

async function shoot(workbench, name) {
  mkdirSync(SHOT_DIR, { recursive: true });
  const file = path.join(SHOT_DIR, `vscode-${LABEL}-${name}.png`);
  await workbench.screenshot({ path: file }).catch((e) => log("shot failed", e.message));
  log("screenshot:", file);
}

function bodyText(frame) {
  return frame.evaluate(() => (document.body?.innerText ?? "").slice(0, 1500)).catch(() => "");
}

// Real Playwright click (dispatches actual mouse events, which RN-web Pressables require).
async function clickByText(frame, needle, { which = "last" } = {}) {
  const base = frame.getByText(needle, { exact: false });
  const count = await base.count().catch(() => 0);
  if (count === 0) return false;
  const locator = which === "first" ? base.first() : base.last();
  await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  const ok = await locator
    .click({ timeout: 5000, force: true })
    .then(() => true)
    .catch(() => false);
  return ok;
}

async function editorTabs(workbench) {
  return workbench
    .evaluate(() =>
      Array.from(document.querySelectorAll(".tabs-container .tab")).map(
        (t) => t.getAttribute("aria-label") || t.textContent,
      ),
    )
    .catch(() => []);
}

async function main() {
  const exe = await downloadAndUnzipVSCode("1.124.2");
  const userDataDir = mkdtempSync(path.join(tmpdir(), "paseo-cdp-user-"));
  const proc = launchVsCode(exe, userDataDir, WS);
  const cleanup = () => {
    try {
      proc.kill("SIGKILL");
    } catch {
      // gone
    }
    rmSync(userDataDir, { recursive: true, force: true });
  };

  try {
    const version = await waitForCdp(CDP_PORT, 60_000);
    log("CDP up:", version.Browser);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    const workbench = await findWorkbench(browser);
    if (!workbench) return log("ERROR: no workbench");
    workbench.on("console", (m) => {
      if (m.type() === "error") log("wb-err:", m.text());
    });

    await openPaseo(workbench);

    let frame = null;
    for (let i = 0; i < 60 && !frame; i++) {
      frame = await findAppFrame(browser);
      if (!frame) await sleep(700);
    }
    if (!frame) return log("ERROR: no app frame");
    log("app frame:", frame.url());
    await sleep(4000);
    await shoot(workbench, "1-loaded");
    log("body@loaded:", JSON.stringify(await bodyText(frame)));

    // Open the workspace, then the seeded agent, to reveal the chat message with file links.
    await clickByText(frame, "paseo-dotlinks-ws");
    await sleep(2500);
    await shoot(workbench, "2-workspace");
    let body = await bodyText(frame);
    log("body@workspace:", JSON.stringify(body));

    // If the seeded message isn't visible yet, click the agent entry again.
    if (!body.includes("Files:") && !body.includes(LINK)) {
      await clickByText(frame, "paseo-dotlinks-ws");
      await sleep(2500);
      body = await bodyText(frame);
      log("body@agent:", JSON.stringify(body));
      await shoot(workbench, "3-agent");
    }

    // Click the hidden-path file link.
    const clicked = await clickByText(frame, LINK);
    log("clicked link?", clicked);
    await sleep(3500);
    await shoot(workbench, "4-after-click");
    const tabs = await editorTabs(workbench);
    log("editor tabs after click:", JSON.stringify(tabs));
    log("body@after:", JSON.stringify((await bodyText(frame)).slice(0, 600)));
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
    log("FATAL", e?.stack ?? e);
    process.exit(1);
  });
