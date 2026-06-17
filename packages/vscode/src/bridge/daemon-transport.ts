import { WebSocket, type RawData } from "ws";

export interface TcpTransportTarget {
  transportType: "tcp";
  endpoint: string;
  protocols?: string[];
}

export interface TransportEventPayload {
  sessionId: string;
  kind: "open" | "message" | "close" | "error";
  text?: string | null;
  binaryBase64?: string | null;
  code?: number | null;
  reason?: string | null;
  error?: string | null;
}

export interface WebSocketLike {
  readyState: number;
  send(data: string | Buffer, callback: (error?: Error) => void): void;
  close(): void;
  terminate(): void;
  onOpen(handler: () => void): void;
  onMessage(handler: (data: RawData, isBinary: boolean) => void): void;
  onClose(handler: (code: number, reason?: Buffer | string) => void): void;
  onError(handler: (error: Error) => void): void;
}

export interface WebSocketFactoryInput {
  url: string;
  protocols?: string[];
}

export type WebSocketFactory = (input: WebSocketFactoryInput) => WebSocketLike;

interface Session {
  id: string;
  ws: WebSocketLike;
  state: "opening" | "open" | "closing" | "closed";
}

export interface DaemonTransportOptions {
  emitEvent: (payload: TransportEventPayload) => void;
  webSocketFactory?: WebSocketFactory;
  openAuthGraceMs?: number;
}

export class DaemonTransportAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DaemonTransportAuthError";
  }
}

const WS_ENDPOINT_PATH = "/ws";
const WS_CLOSE_DAEMON_AUTH_FAILED = 4401;

function createWebSocket(input: WebSocketFactoryInput): WebSocketLike {
  const ws = new WebSocket(input.url, input.protocols);
  return {
    get readyState() {
      return ws.readyState;
    },
    send: (data, callback) => ws.send(data, callback),
    close: () => ws.close(),
    terminate: () => ws.terminate(),
    onOpen: (handler) => {
      ws.once("open", handler);
    },
    onMessage: (handler) => {
      ws.on("message", handler);
    },
    onClose: (handler) => {
      ws.on("close", handler);
    },
    onError: (handler) => {
      ws.on("error", handler);
    },
  };
}

function buildWebSocketUrl(target: TcpTransportTarget): string {
  return `ws://${target.endpoint}${WS_ENDPOINT_PATH}`;
}

function getCloseReason(reason?: Buffer | string): string {
  return reason ? String(reason) : "";
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return Buffer.from(data as ArrayBuffer);
}

function decodeTransportMessage(input: { text?: string; binaryBase64?: string }): string | Buffer {
  if (typeof input.text === "string") {
    return input.text;
  }
  if (typeof input.binaryBase64 === "string") {
    return Buffer.from(input.binaryBase64, "base64");
  }
  throw new Error("Local transport send requires text or binary payload.");
}

export class DaemonTransport {
  private nextSessionId = 0;
  private readonly sessions = new Map<string, Session>();
  private readonly emitEvent: (payload: TransportEventPayload) => void;
  private readonly webSocketFactory: WebSocketFactory;
  private readonly openAuthGraceMs: number;

  constructor(options: DaemonTransportOptions) {
    this.emitEvent = options.emitEvent;
    this.webSocketFactory = options.webSocketFactory ?? createWebSocket;
    this.openAuthGraceMs = options.openAuthGraceMs ?? 50;
  }

  openLocalTransportSession(input: {
    target: TcpTransportTarget;
    password: string | null;
  }): Promise<string> {
    const sessionId = `vscode-session-${++this.nextSessionId}`;
    const url = buildWebSocketUrl(input.target);
    const protocols = [
      ...(input.target.protocols ?? []),
      ...(input.password ? [`paseo.bearer.${input.password}`] : []),
    ];

    return new Promise((resolve, reject) => {
      const ws = this.webSocketFactory({
        url,
        ...(protocols.length > 0 ? { protocols } : {}),
      });
      const session: Session = {
        id: sessionId,
        ws,
        state: "opening",
      };
      this.sessions.set(sessionId, session);

      let openSettled = false;
      let openTimer: ReturnType<typeof setTimeout> | null = null;
      const pendingMessages: TransportEventPayload[] = [];

      const emitOrBuffer = (payload: TransportEventPayload): void => {
        if (!openSettled) {
          pendingMessages.push(payload);
          return;
        }
        this.emitEvent(payload);
      };

      const finalizeOpenFailure = (error: Error): void => {
        if (openSettled) {
          return;
        }
        openSettled = true;
        if (openTimer) {
          clearTimeout(openTimer);
          openTimer = null;
        }
        pendingMessages.length = 0;
        session.state = "closed";
        this.sessions.delete(sessionId);
        reject(error);
      };

      const finalizeOpenSuccess = (): void => {
        if (openSettled || session.state !== "open") {
          return;
        }
        openSettled = true;
        resolve(sessionId);
        this.emitEvent({ sessionId, kind: "open" });
        for (const message of pendingMessages) {
          this.emitEvent(message);
        }
        pendingMessages.length = 0;
      };

      ws.onOpen(() => {
        session.state = "open";
        openTimer = setTimeout(finalizeOpenSuccess, this.openAuthGraceMs);
      });

      ws.onMessage((data: RawData, isBinary: boolean) => {
        if (isBinary) {
          emitOrBuffer({
            sessionId,
            kind: "message",
            binaryBase64: toBuffer(data).toString("base64"),
          });
          return;
        }
        emitOrBuffer({ sessionId, kind: "message", text: data.toString() });
      });

      ws.onClose((code: number, reason?: Buffer | string) => {
        const reasonText = getCloseReason(reason);
        const shouldEmitClose = session.state === "open" || session.state === "closing";
        session.state = "closed";
        this.sessions.delete(sessionId);

        if (!openSettled) {
          const error =
            code === WS_CLOSE_DAEMON_AUTH_FAILED
              ? new DaemonTransportAuthError(reasonText || "Paseo daemon password required.")
              : new Error("TCP daemon transport closed before the session became ready.");
          finalizeOpenFailure(error);
          return;
        }

        if (code === WS_CLOSE_DAEMON_AUTH_FAILED) {
          this.emitEvent({
            sessionId,
            kind: "error",
            error: reasonText || "Paseo daemon password required.",
            code,
          });
        }

        if (shouldEmitClose) {
          this.emitEvent({ sessionId, kind: "close", code, reason: reasonText });
        }
      });

      ws.onError((error: Error) => {
        if (!openSettled) {
          finalizeOpenFailure(
            new Error(`Failed to connect to TCP daemon transport: ${error.message}`),
          );
          return;
        }
        this.emitEvent({ sessionId, kind: "error", error: error.message });
      });
    });
  }

  async sendLocalTransportMessage(input: {
    sessionId: string;
    text?: string;
    binaryBase64?: string;
  }): Promise<void> {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      throw new Error(`Local transport session not found: ${input.sessionId}`);
    }

    if (session.state !== "open" || session.ws.readyState !== WebSocket.OPEN) {
      throw new Error(
        session.state === "opening"
          ? "Local transport session is not open yet."
          : "Local transport session is closed.",
      );
    }

    const payload = decodeTransportMessage(input);
    await new Promise<void>((resolve, reject) => {
      session.ws.send(payload, (error) => {
        if (error) {
          reject(new Error(`Local transport write failed: ${error.message}`));
          return;
        }
        resolve();
      });
    });
  }

  closeLocalTransportSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      if (session.ws.readyState === WebSocket.CONNECTING) {
        session.state = "closed";
        session.ws.terminate();
      } else {
        session.state = "closing";
        session.ws.close();
      }
    } catch {
      // Ignore close errors; the session is being discarded either way.
    }
    this.sessions.delete(sessionId);
  }

  closeAll(): void {
    for (const [sessionId] of this.sessions) {
      this.closeLocalTransportSession(sessionId);
    }
  }
}
