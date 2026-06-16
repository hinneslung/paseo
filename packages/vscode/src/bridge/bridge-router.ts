import * as vscode from "vscode";
import { clearPassword, getPassword, promptForDaemonPassword } from "../auth/secret-store";
import { type FetchLike, type ResolvedDaemonEndpoint } from "../daemon/discovery";
import { createEventEnvelope, type HostToWebviewEnvelope } from "../webview/messaging";
import {
  DaemonTransport,
  DaemonTransportAuthError,
  type TcpTransportTarget,
  type TransportEventPayload,
} from "./daemon-transport";
import {
  parseEditorOpenTargetInput,
  parseOpenUrlInput,
  VSCODE_EDITOR_TARGETS,
  type EditorOpenTargetInput,
} from "./editor-commands";

export interface BridgeRouterInput {
  context: vscode.ExtensionContext;
  resolvedEndpoint: ResolvedDaemonEndpoint;
  sendMessage: (message: HostToWebviewEnvelope) => PromiseLike<boolean>;
  fetch?: FetchLike;
  transport?: DaemonTransport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTransportTarget(args: unknown, fallbackEndpoint: string): TcpTransportTarget {
  if (!isRecord(args)) {
    throw new Error("open_local_daemon_transport requires a transport target.");
  }
  if (args.transportType !== "tcp") {
    throw new Error("Only TCP daemon transport is supported in VS Code v1.");
  }
  const endpoint =
    typeof args.endpoint === "string" && args.endpoint.trim()
      ? args.endpoint.trim()
      : fallbackEndpoint;
  const protocols = Array.isArray(args.protocols)
    ? args.protocols.filter((protocol): protocol is string => typeof protocol === "string")
    : [];
  return {
    transportType: "tcp",
    endpoint,
    ...(protocols.length > 0 ? { protocols } : {}),
  };
}

function parseSessionId(args: unknown): string {
  if (!isRecord(args) || typeof args.sessionId !== "string" || args.sessionId.trim().length === 0) {
    throw new Error("Local transport sessionId is required.");
  }
  return args.sessionId;
}

function parseSendInput(args: unknown): {
  sessionId: string;
  text?: string;
  binaryBase64?: string;
} {
  if (!isRecord(args)) {
    throw new Error("send_local_daemon_transport_message requires a payload.");
  }
  const sessionId = parseSessionId(args);
  const text = typeof args.text === "string" ? args.text : undefined;
  const binaryBase64 = typeof args.binaryBase64 === "string" ? args.binaryBase64 : undefined;
  return {
    sessionId,
    ...(text !== undefined ? { text } : {}),
    ...(binaryBase64 !== undefined ? { binaryBase64 } : {}),
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clampLineIndex(lineNumber: number, documentLineCount: number): number {
  return Math.max(0, Math.min(Math.floor(lineNumber) - 1, Math.max(0, documentLineCount - 1)));
}

export class BridgeRouter {
  private readonly context: vscode.ExtensionContext;
  private readonly resolvedEndpoint: ResolvedDaemonEndpoint;
  private readonly sendMessage: (message: HostToWebviewEnvelope) => PromiseLike<boolean>;
  private readonly fetch: FetchLike | undefined;
  private readonly transport: DaemonTransport;

  constructor(input: BridgeRouterInput) {
    this.context = input.context;
    this.resolvedEndpoint = input.resolvedEndpoint;
    this.sendMessage = input.sendMessage;
    this.fetch = input.fetch;
    this.transport =
      input.transport ??
      new DaemonTransport({
        emitEvent: (payload) => this.emitTransportEvent(payload),
      });
  }

  async dispatch(command: string, args: unknown): Promise<unknown> {
    switch (command) {
      case "open_local_daemon_transport":
        return this.openTransport(args);
      case "send_local_daemon_transport_message":
        await this.transport.sendLocalTransportMessage(parseSendInput(args));
        return null;
      case "close_local_daemon_transport":
        this.transport.closeLocalTransportSession(parseSessionId(args));
        return null;
      case "editor.listTargets":
        return VSCODE_EDITOR_TARGETS;
      case "editor.openTarget":
        await this.openEditorTarget(args);
        return null;
      case "opener.openUrl":
        await this.openUrl(args);
        return null;
      default:
        throw new Error(`VS Code bridge command not implemented: ${command}`);
    }
  }

  closeAll(): void {
    this.transport.closeAll();
  }

  private emitTransportEvent(payload: TransportEventPayload): void {
    void this.sendMessage(createEventEnvelope("local-daemon-transport-event", payload));
  }

  private async resolvePassword(endpoint: string): Promise<string | null> {
    const stored = await getPassword(this.context, endpoint);
    if (stored) {
      return stored;
    }
    // Test/automation seam (never set in production): authenticate from the env var directly,
    // without touching SecretStorage or prompting. Keeps the E2E/CDP harness non-interactive.
    const testPassword = process.env.PASEO_VSCODE_TEST_PASSWORD?.trim();
    if (testPassword) {
      return testPassword;
    }
    if (!this.resolvedEndpoint.requiresPassword) {
      return null;
    }
    return promptForDaemonPassword({ context: this.context, endpoint, fetch: this.fetch });
  }

  private async openTransport(args: unknown): Promise<string> {
    const target = parseTransportTarget(args, this.resolvedEndpoint.endpoint);
    const password = await this.resolvePassword(target.endpoint);
    try {
      return await this.transport.openLocalTransportSession({ target, password });
    } catch (error) {
      if (!(error instanceof DaemonTransportAuthError)) {
        throw error;
      }
      await clearPassword(this.context, target.endpoint);
      const nextPassword = await promptForDaemonPassword({
        context: this.context,
        endpoint: target.endpoint,
        fetch: this.fetch,
      });
      return this.transport.openLocalTransportSession({ target, password: nextPassword });
    }
  }

  private async openEditorTarget(args: unknown): Promise<void> {
    const target = parseEditorOpenTargetInput(args);
    try {
      if (!target.filePath) {
        const targetUri = vscode.Uri.file(target.workspacePath);
        const isOpenWorkspace = vscode.workspace.workspaceFolders?.some(
          (folder) => folder.uri.fsPath === targetUri.fsPath,
        );
        if (!isOpenWorkspace) {
          await vscode.commands.executeCommand("vscode.openFolder", targetUri, false);
        }
        return;
      }
      await openTextEditorTarget(target);
    } catch (error) {
      const targetPath = target.filePath ?? target.workspacePath;
      throw new Error(`Failed to open ${targetPath} in VS Code: ${getErrorMessage(error)}`, {
        cause: error,
      });
    }
  }

  private async openUrl(args: unknown): Promise<void> {
    const input = parseOpenUrlInput(args);
    try {
      await vscode.env.openExternal(vscode.Uri.parse(input.url));
    } catch (error) {
      throw new Error(`Failed to open external URL in VS Code: ${getErrorMessage(error)}`, {
        cause: error,
      });
    }
  }
}

async function openTextEditorTarget(target: EditorOpenTargetInput): Promise<void> {
  if (!target.filePath) {
    return;
  }
  const uri = vscode.Uri.file(target.filePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);
  if (target.line === undefined) {
    return;
  }

  const startLine = clampLineIndex(target.line, doc.lineCount);
  const endLine =
    target.lineEnd === undefined ? startLine : clampLineIndex(target.lineEnd, doc.lineCount);
  const start = new vscode.Position(startLine, Math.max(0, (target.column ?? 1) - 1));
  const end = new vscode.Position(endLine, doc.lineAt(endLine).range.end.character);
  const range = new vscode.Range(start, end);
  editor.selection = new vscode.Selection(start, target.lineEnd === undefined ? start : end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}
