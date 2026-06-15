import assert from "node:assert/strict";
import * as vscode from "vscode";

interface PaseoExtensionApi {
  getActivePanelCountForTest: () => number;
  getLastWebviewHtmlForTest: () => string | null;
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

  const baseMatch = html.match(/<base href="([^"]+)">/);
  assert.ok(baseMatch, "webview HTML contains a base href");
  const baseHref = baseMatch[1];
  assert.match(baseHref, /^[a-z][a-z0-9+.-]*:/i, "base href is a resolved VS Code URI");
  assert.match(baseHref, /\/media\/app-dist\/$/, "base href points at the copied app dist");

  const cspMatch = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(cspMatch, "webview HTML contains a CSP meta tag");
  assert.match(cspMatch[1], /default-src 'none'/);
  assert.match(cspMatch[1], /script-src .*'nonce-[a-f0-9]+'/);

  const runtimeMatch = html.match(
    /<script nonce="([a-f0-9]+)">window\.paseoVscode = ([^<]+);<\/script>/,
  );
  assert.ok(runtimeMatch, "webview HTML injects the VS Code runtime config");
  const nonce = runtimeMatch[1];
  const runtimeConfig = JSON.parse(runtimeMatch[2]) as { bridgeProtocol?: unknown };
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
}
