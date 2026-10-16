export interface InvokeEnvelope {
  kind: "invoke";
  id: string;
  command: string;
  args?: unknown;
}

export interface ResultEnvelope {
  kind: "result";
  id: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

export interface EventEnvelope {
  kind: "event";
  event: string;
  payload?: unknown;
}

export type WebviewToHostEnvelope = InvokeEnvelope;
export type HostToWebviewEnvelope = ResultEnvelope | EventEnvelope;

export interface BridgeDispatcher {
  dispatch(command: string, args: unknown): Promise<unknown>;
}

export type HostMessageSender = (message: HostToWebviewEnvelope) => PromiseLike<boolean> | boolean;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isInvokeEnvelope(value: unknown): value is InvokeEnvelope {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.kind === "invoke" && typeof value.id === "string" && typeof value.command === "string"
  );
}

export function createEventEnvelope(event: string, payload: unknown): EventEnvelope {
  return { kind: "event", event, payload };
}

export async function dispatchWebviewMessage(input: {
  message: unknown;
  dispatcher: BridgeDispatcher;
  sendMessage: HostMessageSender;
}): Promise<boolean> {
  if (!isInvokeEnvelope(input.message)) {
    return false;
  }

  const { id, command, args } = input.message;
  try {
    const value = await input.dispatcher.dispatch(command, args);
    await input.sendMessage({ kind: "result", id, ok: true, value });
  } catch (error) {
    await input.sendMessage({ kind: "result", id, ok: false, error: getErrorMessage(error) });
  }

  return true;
}
