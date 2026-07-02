import * as vscode from "vscode";
import { getPassword, clearPassword, promptForDaemonPassword } from "./auth/secret-store";
import { BridgeRouter } from "./bridge/bridge-router";
import { readDaemonListen } from "./daemon/config-reader";
import { discoverDaemonEndpoint, type ResolvedDaemonEndpoint } from "./daemon/discovery";
import { dispatchWebviewMessage } from "./webview/messaging";
import { buildWebviewDocument } from "./webview/webview-host";
import type { VscodeRuntimeConfig } from "./webview/html-rewrite";

interface PaseoExtensionApi {
  getActivePanelCountForTest: () => number;
  getLastWebviewHtmlForTest: () => string | null;
}

let lastWebviewHtml: string | null = null;
let activePanelCount = 0;
let disposables: vscode.Disposable[] = [];

function getLocalResourceRoots(context: vscode.ExtensionContext): vscode.Uri[] {
  return [
    vscode.Uri.joinPath(context.extensionUri, "media", "app-dist"),
    vscode.Uri.joinPath(context.extensionUri, "dist"),
  ];
}

function getConfiguredEndpoint(): string | null {
  const setting = vscode.workspace.getConfiguration("paseo").get<string>("endpoint")?.trim();
  return setting || null;
}

function getWorkspaceFolders(): string[] {
  return vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
}

async function resolveDaemonEndpoint(): Promise<ResolvedDaemonEndpoint> {
  const resolved = await discoverDaemonEndpoint({
    settingEndpoint: getConfiguredEndpoint(),
    envEndpoint: process.env.PASEO_VSCODE_ENDPOINT,
    configListen: await readDaemonListen(),
  });
  if (resolved.unsupportedMessage) {
    void vscode.window.showWarningMessage(resolved.unsupportedMessage);
  }
  return resolved;
}

async function buildRuntimeConfig(
  context: vscode.ExtensionContext,
  resolved: ResolvedDaemonEndpoint,
): Promise<VscodeRuntimeConfig> {
  const storedPassword = await getPassword(context, resolved.endpoint);
  return {
    endpoint: resolved.endpoint,
    hasPassword: resolved.requiresPassword || storedPassword !== null,
    bridgeProtocol: 1,
    workspaceFolders: getWorkspaceFolders(),
  };
}

async function renderWebview(
  webview: vscode.Webview,
  context: vscode.ExtensionContext,
): Promise<vscode.Disposable> {
  webview.options = {
    enableScripts: true,
    localResourceRoots: getLocalResourceRoots(context),
  };
  const resolvedEndpoint = await resolveDaemonEndpoint();
  // Resolve the daemon password BEFORE loading the webview app. The app's bootstrap
  // connection probe has a short (~2.5s) timeout; if the bridge prompted lazily during that
  // probe the interactive input box would outlive the timeout and the probe would fail. So we
  // prompt up-front (storing the secret). EXCEPTION: when PASEO_VSCODE_TEST_PASSWORD is set
  // (CDP/E2E harness only — never production) we skip the prompt AND the secrets write
  // entirely; the bridge reads that env var directly. Touching SecretStorage here can hang in
  // a headless host with no keyring, which would block the render.
  if (
    resolvedEndpoint.requiresPassword &&
    !process.env.PASEO_VSCODE_TEST_PASSWORD?.trim() &&
    (await getPassword(context, resolvedEndpoint.endpoint)) === null
  ) {
    try {
      await promptForDaemonPassword({ context, endpoint: resolvedEndpoint.endpoint });
    } catch {
      // User dismissed or entered a wrong password; render the app anyway (it will show a
      // not-connected state). They can retry via the "Paseo: Set Daemon Password" command.
    }
  }
  const runtimeConfig = await buildRuntimeConfig(context, resolvedEndpoint);
  const sendToWebview = webview.postMessage.bind(webview);
  const router = new BridgeRouter({
    context,
    resolvedEndpoint,
    sendMessage: sendToWebview,
  });
  const messageDisposable = webview.onDidReceiveMessage((message) => {
    void dispatchWebviewMessage({
      message,
      dispatcher: router,
      sendMessage: sendToWebview,
    });
  });
  const html = await buildWebviewDocument({
    extensionUri: context.extensionUri,
    webview,
    runtimeConfig,
  });
  webview.html = html;
  lastWebviewHtml = html;
  return vscode.Disposable.from(messageDisposable, { dispose: () => router.closeAll() });
}

class PaseoWebviewViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    const disposable = await renderWebview(webviewView.webview, this.context);
    webviewView.onDidDispose(() => disposable.dispose());
  }
}

async function openPaseoPanel(context: vscode.ExtensionContext): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    "paseo.webviewPanel",
    "Paseo",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: getLocalResourceRoots(context),
    },
  );
  activePanelCount += 1;
  panel.onDidDispose(() => {
    activePanelCount -= 1;
  });
  const disposable = await renderWebview(panel.webview, context);
  panel.onDidDispose(() => disposable.dispose());
}

async function setDaemonPassword(context: vscode.ExtensionContext): Promise<void> {
  const resolved = await resolveDaemonEndpoint();
  await promptForDaemonPassword({ context, endpoint: resolved.endpoint });
  await vscode.window.showInformationMessage("Paseo daemon password saved.");
}

async function clearDaemonPassword(context: vscode.ExtensionContext): Promise<void> {
  const resolved = await resolveDaemonEndpoint();
  await clearPassword(context, resolved.endpoint);
  await vscode.window.showInformationMessage("Paseo daemon password cleared.");
}

export function activate(context: vscode.ExtensionContext): PaseoExtensionApi {
  const provider = new PaseoWebviewViewProvider(context);
  disposables = [
    vscode.window.registerWebviewViewProvider("paseo.webview", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("paseo.open", () => openPaseoPanel(context)),
    vscode.commands.registerCommand("paseo.setPassword", () => setDaemonPassword(context)),
    vscode.commands.registerCommand("paseo.clearPassword", () => clearDaemonPassword(context)),
  ];
  context.subscriptions.push(...disposables);

  return {
    getActivePanelCountForTest: () => activePanelCount,
    getLastWebviewHtmlForTest: () => lastWebviewHtml,
  };
}

export function deactivate(): void {
  for (const disposable of disposables) {
    disposable.dispose();
  }
  disposables = [];
  lastWebviewHtml = null;
  activePanelCount = 0;
}
