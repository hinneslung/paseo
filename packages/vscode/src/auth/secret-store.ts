import * as vscode from "vscode";
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
}): Promise<string> {
  const password = await vscode.window.showInputBox({
    password: true,
    ignoreFocusOut: true,
    prompt: "Paseo daemon password",
  });
  if (!password) {
    throw new Error("Paseo daemon password is required.");
  }
  const valid = await validateDaemonPassword({
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
