import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocket } from "ws";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../../..");

function loadAppVersion() {
  const packageJson = JSON.parse(
    readFileSync(path.join(repoRoot, "packages/app/package.json"), "utf8"),
  );
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error("The app package version is unavailable.");
  }
  return packageJson.version;
}

export async function connectSeedClient({ port, password }) {
  const moduleUrl = pathToFileURL(
    path.join(repoRoot, "packages/client/dist/daemon-client.js"),
  ).href;
  const { DaemonClient } = await import(moduleUrl);
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${port}/ws`,
    clientId: `vscode-e2e-seed-${randomUUID()}`,
    clientType: "cli",
    appVersion: loadAppVersion(),
    password,
    providerSnapshots: "wire",
    reconnect: { enabled: false },
    webSocketFactory: (url, options) => new WebSocket(url, options?.protocols, options),
  });
  await client.connect();
  return client;
}
