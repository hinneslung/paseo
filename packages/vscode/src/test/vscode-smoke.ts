import assert from "node:assert/strict";
import * as vscode from "vscode";
import { DaemonTransport, type TransportEventPayload } from "../bridge/daemon-transport";

interface PaseoExtensionApi {
  getActivePanelCountForTest: () => number;
  getLastWebviewHtmlForTest: () => string | null;
}

interface RuntimeConfig {
  endpoint?: unknown;
  bridgeProtocol?: unknown;
}

interface ServerInfoPayload {
  serverId: string;
}

function readServerInfoPayload(text: string): ServerInfoPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const envelope = parsed as {
    type?: unknown;
    message?: {
      type?: unknown;
      payload?: {
        status?: unknown;
        serverId?: unknown;
      };
    };
  };
  const payload = envelope.message?.payload;
  if (
    envelope.type !== "session" ||
    envelope.message?.type !== "status" ||
    payload?.status !== "server_info" ||
    typeof payload.serverId !== "string" ||
    payload.serverId.length === 0
  ) {
    return null;
  }
  return { serverId: payload.serverId };
}

function createTransportEventCollector(): {
  emit: (event: TransportEventPayload) => void;
  waitFor: (
    predicate: (event: TransportEventPayload) => boolean,
    timeoutMs: number,
  ) => Promise<TransportEventPayload>;
} {
  const events: TransportEventPayload[] = [];
  const waiters: Array<{
    predicate: (event: TransportEventPayload) => boolean;
    resolve: (event: TransportEventPayload) => void;
  }> = [];
  return {
    emit(event) {
      events.push(event);
      const index = waiters.findIndex((waiter) => waiter.predicate(event));
      if (index === -1) {
        return;
      }
      const [waiter] = waiters.splice(index, 1);
      waiter?.resolve(event);
    },
    waitFor(predicate, timeoutMs) {
      const existing = events.find(predicate);
      if (existing) {
        return Promise.resolve(existing);
      }
      return new Promise((resolve, reject) => {
        let waiter: {
          predicate: (event: TransportEventPayload) => boolean;
          resolve: (event: TransportEventPayload) => void;
        } | null = null;
        const timer = setTimeout(() => {
          if (!waiter) {
            reject(new Error("Timed out waiting for daemon transport event."));
            return;
          }
          const index = waiters.indexOf(waiter);
          if (index !== -1) {
            waiters.splice(index, 1);
          }
          reject(new Error("Timed out waiting for daemon transport event."));
        }, timeoutMs);
        waiter = {
          predicate,
          resolve: (event) => {
            clearTimeout(timer);
            resolve(event);
          },
        };
        waiters.push(waiter);
      });
    },
  };
}

async function runBridgeRoundTrip(input: { endpoint: string; password: string }): Promise<void> {
  const events = createTransportEventCollector();
  const transport = new DaemonTransport({ emitEvent: events.emit, openAuthGraceMs: 0 });
  const sessionId = await transport.openLocalTransportSession({
    target: { transportType: "tcp", endpoint: input.endpoint },
    password: input.password,
  });
  try {
    await transport.sendLocalTransportMessage({
      sessionId,
      text: JSON.stringify({
        type: "hello",
        clientId: "vscode-smoke",
        clientType: "browser",
        protocolVersion: 1,
      }),
    });
    const event = await events.waitFor((candidate) => {
      if (candidate.sessionId !== sessionId || candidate.kind !== "message" || !candidate.text) {
        return false;
      }
      return readServerInfoPayload(candidate.text) !== null;
    }, 2_000);
    assert.ok(event.text, "daemon bridge returned a text server_info message");
    assert.ok(
      readServerInfoPayload(event.text),
      "daemon bridge completed a server_info round-trip",
    );
  } finally {
    transport.closeLocalTransportSession(sessionId);
  }
}

function findPaseoExtension(): vscode.Extension<PaseoExtensionApi> {
  const extension = vscode.extensions.all.find(
    (candidate) => candidate.packageJSON.name === "paseo-vscode",
  );
  assert.ok(extension, "Paseo VS Code extension is installed in the development host");
  return extension as vscode.Extension<PaseoExtensionApi>;
}

export async function run(): Promise<void> {
  const extension = findPaseoExtension();
  const api = await extension.activate();
  await vscode.commands.executeCommand("paseo.open");

  assert.equal(api.getActivePanelCountForTest(), 1);
  const html = api.getLastWebviewHtmlForTest();
  assert.ok(html, "paseo.open creates webview HTML");

  // No <base href>: it would make Expo Router write cross-origin history URLs and crash the
  // React mount. Asset URLs are rewritten to absolute resource URIs instead (covered in detail
  // by the html-rewrite unit test, which controls the toWebviewUri mapping).
  assert.ok(!/<base href=/.test(html), "webview HTML does not inject a <base href>");

  const cspMatch = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(cspMatch, "webview HTML contains a CSP meta tag");
  assert.match(cspMatch[1], /default-src 'none'/);
  assert.match(cspMatch[1], /script-src .*'nonce-[a-f0-9]+'/);

  const runtimeMatch = html.match(
    /<script nonce="([a-f0-9]+)">window\.paseoVscode = ([^<]+);<\/script>/,
  );
  assert.ok(runtimeMatch, "webview HTML injects the VS Code runtime config");
  const nonce = runtimeMatch[1];
  const runtimeConfig = JSON.parse(runtimeMatch[2]) as RuntimeConfig;
  assert.equal(runtimeConfig.bridgeProtocol, 1);

  const bootstrapPattern = new RegExp(
    `<script nonce="${nonce}" src="([^"]*webview-bootstrap\\.js[^"]*)"><\\/script>`,
  );
  const bootstrapMatch = html.match(bootstrapPattern);
  assert.ok(bootstrapMatch, "webview HTML loads the bootstrap script with the runtime nonce");
  assert.match(
    bootstrapMatch[1],
    /^[a-z][a-z0-9+.-]*:/i,
    "bootstrap src is a resolved VS Code URI",
  );

  const smokePassword = process.env.PASEO_VSCODE_TEST_PASSWORD?.trim();
  if (smokePassword) {
    const endpoint =
      typeof runtimeConfig.endpoint === "string" ? runtimeConfig.endpoint.trim() : "";
    assert.ok(endpoint, "runtime config exposes daemon endpoint");
    await runBridgeRoundTrip({ endpoint, password: smokePassword });
  }
}
