import * as vscode from "vscode";
import { buildWebviewDocument } from "./webview/webview-host";

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

async function renderWebview(
  webview: vscode.Webview,
  context: vscode.ExtensionContext,
): Promise<void> {
  webview.options = {
    enableScripts: true,
    localResourceRoots: getLocalResourceRoots(context),
  };
  const html = await buildWebviewDocument({
    extensionUri: context.extensionUri,
    webview,
  });
  webview.html = html;
  lastWebviewHtml = html;
}

class PaseoWebviewViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    await renderWebview(webviewView.webview, this.context);
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
  await renderWebview(panel.webview, context);
}

export function activate(context: vscode.ExtensionContext): PaseoExtensionApi {
  const provider = new PaseoWebviewViewProvider(context);
  disposables = [
    vscode.window.registerWebviewViewProvider("paseo.webview", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("paseo.open", () => openPaseoPanel(context)),
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
