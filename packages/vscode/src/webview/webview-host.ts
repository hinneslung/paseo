import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { buildWebviewHtml, type VscodeRuntimeConfig } from "./html-rewrite";

interface BuildWebviewDocumentInput {
  extensionUri: vscode.Uri;
  webview: vscode.Webview;
}

const textDecoder = new TextDecoder();

function createNonce(): string {
  return randomBytes(16).toString("hex");
}

function getConfiguredEndpoint(): string | null {
  const setting = vscode.workspace.getConfiguration("paseo").get<string>("endpoint")?.trim();
  if (setting) {
    return setting;
  }
  const envEndpoint = process.env.PASEO_VSCODE_ENDPOINT?.trim();
  return envEndpoint || null;
}

function getRuntimeConfig(): VscodeRuntimeConfig {
  return {
    endpoint: getConfiguredEndpoint(),
    hasPassword: false,
    bridgeProtocol: 1,
    workspaceFolders: vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [],
  };
}

function buildAssetUri(appDistRoot: vscode.Uri, assetPath: string): vscode.Uri {
  if (assetPath === "." || assetPath.length === 0) {
    return appDistRoot;
  }
  return vscode.Uri.joinPath(appDistRoot, ...assetPath.split("/").filter(Boolean));
}

export async function buildWebviewDocument(input: BuildWebviewDocumentInput): Promise<string> {
  const appDistRoot = vscode.Uri.joinPath(input.extensionUri, "media", "app-dist");
  const indexUri = vscode.Uri.joinPath(appDistRoot, "index.html");
  const indexHtml = textDecoder.decode(await vscode.workspace.fs.readFile(indexUri));
  const bootstrapUri = input.webview.asWebviewUri(
    vscode.Uri.joinPath(input.extensionUri, "dist", "webview-bootstrap.js"),
  );

  return buildWebviewHtml({
    indexHtml,
    toWebviewUri: (assetPath) =>
      input.webview.asWebviewUri(buildAssetUri(appDistRoot, assetPath)).toString(),
    cspSource: input.webview.cspSource,
    nonce: createNonce(),
    bootstrapUri: bootstrapUri.toString(),
    runtimeConfig: getRuntimeConfig(),
  });
}
