// Seed a deterministic mock-provider agent for VM QA screenshots.
//
//   node seed-agent.mjs <port> <workspace-dir> [title]
//
// Reads an optional daemon password from PASEO_QA_PASSWORD. Creates the workspace if needed,
// writes a small linked source file, then streams a transcript with Markdown, a Mermaid diagram,
// a code block and a native file link through the daemon's built-in `mock` provider.
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [portArg, workspaceDir, title = "VM QA rich transcript"] = process.argv.slice(2);
if (!portArg || !workspaceDir) {
  console.error("usage: node seed-agent.mjs <port> <workspace-dir> [title]");
  process.exit(2);
}

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i, "$1"));
const modules = path.join(here, "node_modules");
const { DaemonClient } = await import(
  pathToFileURL(path.join(modules, "@getpaseo/client/dist/daemon-client.js")).href
);
const { WebSocket } = await import(pathToFileURL(path.join(modules, "ws/wrapper.mjs")).href);
const { version } = JSON.parse(
  (await import("node:fs")).readFileSync(
    path.join(modules, "@getpaseo/client/package.json"),
    "utf8",
  ),
);

const linkedRelative = "src/bridge-sample.ts";
const linkedFile = path.join(workspaceDir, linkedRelative);
mkdirSync(path.dirname(linkedFile), { recursive: true });
writeFileSync(
  linkedFile,
  [
    "export const first = 1;",
    "export const second = 2;",
    "export const selectedByNativeLink = 3;",
    "export const fourth = 4;",
    "",
  ].join("\n"),
);

const transcript = [
  "## Bridge check",
  "",
  "The extension host pins the daemon endpoint and relays the webview session.",
  "",
  "```mermaid",
  "flowchart LR",
  "  Webview --> Bridge",
  "  Bridge --> Daemon",
  "  Daemon --> Agent",
  "```",
  "",
  "```ts",
  "export const selectedByNativeLink = 3;",
  "```",
  "",
  `Open [${linkedRelative}:3](${linkedRelative}#L3) to jump to the line.`,
].join("\n");

const client = new DaemonClient({
  url: `ws://127.0.0.1:${Number(portArg)}/ws`,
  clientId: `vm-qa-seed-${randomUUID()}`,
  clientType: "cli",
  appVersion: version,
  password: process.env.PASEO_QA_PASSWORD || undefined,
  reconnect: { enabled: false },
  webSocketFactory: (url, options) => new WebSocket(url, options?.protocols, options),
});
await client.connect();
try {
  const opened = await client.openProject(workspaceDir);
  if (!opened.workspace) throw new Error(opened.error ?? "openProject returned no workspace");
  const agent = await client.createAgent({
    provider: "mock",
    cwd: workspaceDir,
    workspaceId: opened.workspace.id,
    title,
    modeId: "load-test",
    model: "e2e-fast-stream",
    featureValues: {
      mockStreamingAssistantResponse: transcript,
      mockStreamingAssistantIntervalMs: 40,
    },
  });
  await client.sendAgentMessage(agent.id, "Show the bridge diagram and link the sample file.");
  await client.waitForFinish(agent.id, 60_000);
  console.log(JSON.stringify({ workspaceId: opened.workspace.id, agentId: agent.id }));
} finally {
  await client.close?.();
}
