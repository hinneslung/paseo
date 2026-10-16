import * as vscode from "vscode";
import { verifyDaemonHelloAuth, type WebSocketFactory } from "../bridge/daemon-transport";
import { type FetchLike, validateDaemonPassword } from "../daemon/discovery";

function passwordKey(endpoint: string): string {
  return `paseo.daemonPassword.${endpoint}`;
}

export async function getPassword(
  context: vscode.ExtensionContext,
  endpoint: string,
): Promise<string | null> {
  return (await context.secrets.get(passwordKey(endpoint))) ?? null;
}

export async function setPassword(
  context: vscode.ExtensionContext,
  endpoint: string,
  password: string,
): Promise<void> {
  await context.secrets.store(passwordKey(endpoint), password);
}

export async function clearPassword(
  context: vscode.ExtensionContext,
  endpoint: string,
): Promise<void> {
  await context.secrets.delete(passwordKey(endpoint));
}

export async function promptForDaemonPassword(input: {
  context: vscode.ExtensionContext;
  endpoint: string;
  fetch?: FetchLike;
  webSocketFactory?: WebSocketFactory;
}): Promise<string> {
  const password = await vscode.window.showInputBox({
    password: true,
    ignoreFocusOut: true,
    prompt: "Paseo daemon password",
  });
  if (!password) {
    throw new Error("Paseo daemon password is required.");
  }
  // The daemon parses HTTP bearer tokens by splitting on whitespace, so only
  // hello.auth can verify a password with spaces.
  const valid = /\s/u.test(password)
    ? await verifyDaemonHelloAuth({
        endpoint: input.endpoint,
        password,
        ...(input.webSocketFactory ? { webSocketFactory: input.webSocketFactory } : {}),
      })
    : await validateDaemonPassword({
        endpoint: input.endpoint,
        password,
        fetch: input.fetch,
      });
  if (!valid) {
    throw new Error("Incorrect Paseo daemon password.");
  }
  await setPassword(input.context, input.endpoint, password);
  return password;
}
