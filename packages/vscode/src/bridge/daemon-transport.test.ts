import type { RawData } from "ws";
import { describe, expect, it } from "vitest";
import {
  DaemonTransport,
  DaemonTransportAuthError,
  type TransportEventPayload,
  type WebSocketFactoryInput,
  type WebSocketLike,
} from "./daemon-transport";

class FakeWebSocket implements WebSocketLike {
  readyState = 0;
  readonly sent: Array<string | Buffer> = [];
  private openHandlers: Array<() => void> = [];
  private messageHandlers: Array<(data: RawData, isBinary: boolean) => void> = [];
  private closeHandlers: Array<(code: number, reason?: Buffer | string) => void> = [];
  private errorHandlers: Array<(error: Error) => void> = [];

  constructor(readonly input: WebSocketFactoryInput) {}

  send(data: string | Buffer, callback: (error?: Error) => void): void {
    this.sent.push(data);
    callback();
  }

  close(): void {
    this.closeFromServer(1000, "closed");
  }

  terminate(): void {
    this.readyState = 3;
  }

  onOpen(handler: () => void): void {
    this.openHandlers.push(handler);
  }

  onMessage(handler: (data: RawData, isBinary: boolean) => void): void {
    this.messageHandlers.push(handler);
  }

  onClose(handler: (code: number, reason?: Buffer | string) => void): void {
    this.closeHandlers.push(handler);
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  open(): void {
    this.readyState = 1;
    const handlers = this.openHandlers;
    this.openHandlers = [];
    for (const handler of handlers) {
      handler();
    }
  }

  message(data: RawData, isBinary: boolean): void {
    for (const handler of this.messageHandlers) {
      handler(data, isBinary);
    }
  }

  closeFromServer(code: number, reason: string): void {
    this.readyState = 3;
    for (const handler of this.closeHandlers) {
      handler(code, reason);
    }
  }

  fail(error: Error): void {
    for (const handler of this.errorHandlers) {
      handler(error);
    }
  }
}

function createTransport(options?: { openAuthGraceMs?: number }): {
  transport: DaemonTransport;
  events: TransportEventPayload[];
  sockets: FakeWebSocket[];
} {
  const events: TransportEventPayload[] = [];
  const sockets: FakeWebSocket[] = [];
  const transport = new DaemonTransport({
    openAuthGraceMs: options?.openAuthGraceMs ?? 0,
    emitEvent: (event) => events.push(event),
    webSocketFactory: (input) => {
      const socket = new FakeWebSocket(input);
      sockets.push(socket);
      return socket;
    },
  });
  return { transport, events, sockets };
}

describe("daemon transport", () => {
  it("opens a bearer-authenticated TCP WebSocket and proxies text, binary, and close events", async () => {
    const { transport, events, sockets } = createTransport();

    const sessionPromise = transport.openLocalTransportSession({
      target: {
        transportType: "tcp",
        endpoint: "192.168.1.194:6768",
        protocols: ["paseo.extra"],
      },
      password: "test-password",
    });
    const socket = sockets[0];
    socket.open();
    const sessionId = await sessionPromise;

    expect(socket.input).toEqual({
      url: "ws://192.168.1.194:6768/ws",
      protocols: ["paseo.extra", "paseo.bearer.test-password"],
    });
    expect(events).toEqual([{ sessionId, kind: "open" }]);

    await transport.sendLocalTransportMessage({ sessionId, text: "hello" });
    await transport.sendLocalTransportMessage({ sessionId, binaryBase64: "aGk=" });
    expect(socket.sent[0]).toBe("hello");
    expect(Buffer.isBuffer(socket.sent[1])).toBe(true);
    expect(socket.sent[1]?.toString()).toBe("hi");

    socket.message(Buffer.from("server text"), false);
    socket.message(Buffer.from("server binary"), true);
    socket.closeFromServer(1000, "done");

    expect(events).toEqual([
      { sessionId, kind: "open" },
      { sessionId, kind: "message", text: "server text" },
      { sessionId, kind: "message", binaryBase64: Buffer.from("server binary").toString("base64") },
      { sessionId, kind: "close", code: 1000, reason: "done" },
    ]);
  });

  it("buffers messages during auth grace and emits open first", async () => {
    const { transport, events, sockets } = createTransport({ openAuthGraceMs: 10 });

    const sessionPromise = transport.openLocalTransportSession({
      target: { transportType: "tcp", endpoint: "192.168.1.194:6768" },
      password: "test-password",
    });
    const socket = sockets[0];

    socket.open();
    socket.message(Buffer.from("server info"), false);
    expect(events).toEqual([]);

    const sessionId = await sessionPromise;
    expect(events).toEqual([
      { sessionId, kind: "open" },
      { sessionId, kind: "message", text: "server info" },
    ]);
  });

  it("rejects auth-failed closes before the session is ready", async () => {
    const { transport, sockets } = createTransport();

    const sessionPromise = transport.openLocalTransportSession({
      target: { transportType: "tcp", endpoint: "192.168.1.194:6768" },
      password: null,
    });
    sockets[0].closeFromServer(4401, "Password required");

    await expect(sessionPromise).rejects.toBeInstanceOf(DaemonTransportAuthError);
  });
});
