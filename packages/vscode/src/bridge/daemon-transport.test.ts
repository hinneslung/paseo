import type { RawData } from "ws";
import { describe, expect, it, vi } from "vitest";
import {
  DaemonTransport,
  DaemonTransportAuthError,
  parseOpenTcpTransportSessionInput,
  verifyDaemonHelloAuth,
  type TransportEventPayload,
  type WebSocketFactory,
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

async function waitForSent(socket: FakeWebSocket, count: number): Promise<void> {
  while (socket.sent.length < count) {
    await new Promise((resolve) => setTimeout(resolve, 1));
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
  it("validates caller-owned open input and pins the resolved endpoint", () => {
    expect(
      parseOpenTcpTransportSessionInput(
        {
          sessionId: " client-session_1 ",
          target: {
            transportType: "tcp",
            endpoint: "attacker.example:9999",
            protocols: ["paseo.extra"],
          },
        },
        "127.0.0.1:6767",
      ),
    ).toEqual({
      sessionId: "client-session_1",
      target: {
        transportType: "tcp",
        endpoint: "127.0.0.1:6767",
        protocols: ["paseo.extra"],
      },
    });
  });

  it("drops webview-supplied bearer subprotocols and keeps unrelated ones", () => {
    expect(
      parseOpenTcpTransportSessionInput(
        {
          sessionId: "client-session_1",
          target: {
            transportType: "tcp",
            protocols: ["paseo.extra", "paseo.bearer.smuggled", "paseo.bearer."],
          },
        },
        "127.0.0.1:6767",
      ),
    ).toEqual({
      sessionId: "client-session_1",
      target: {
        transportType: "tcp",
        endpoint: "127.0.0.1:6767",
        protocols: ["paseo.extra"],
      },
    });
    expect(
      parseOpenTcpTransportSessionInput(
        {
          sessionId: "client-session_2",
          target: { transportType: "tcp", protocols: ["paseo.bearer.smuggled"] },
        },
        "127.0.0.1:6767",
      ),
    ).toEqual({
      sessionId: "client-session_2",
      target: { transportType: "tcp", endpoint: "127.0.0.1:6767" },
    });
  });

  it.each([
    [null, "requires a payload"],
    [{ sessionId: "bad id", target: { transportType: "tcp" } }, "sessionId is invalid"],
    [{ sessionId: "valid", target: null }, "requires a transport target"],
    [
      { sessionId: "valid", target: { transportType: "socket", transportPath: "/tmp/x" } },
      "Only TCP daemon transport",
    ],
    [
      { sessionId: "valid", target: { transportType: "tcp", protocols: ["ok", 7] } },
      "protocols must be strings",
    ],
  ])("rejects invalid open input %#", (input, message) => {
    expect(() => parseOpenTcpTransportSessionInput(input, "127.0.0.1:6767")).toThrow(message);
  });

  it("opens a bearer-authenticated TCP WebSocket and proxies text, binary, and close events", async () => {
    const { transport, events, sockets } = createTransport();
    const sessionId = "vscode-session-test";

    const sessionPromise = transport.openLocalTransportSession({
      sessionId,
      target: {
        transportType: "tcp",
        endpoint: "192.168.1.194:6768",
        protocols: ["paseo.extra"],
      },
      password: "test-password",
    });
    const socket = sockets[0];
    socket.open();
    await sessionPromise;

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

  it("injects the bridge password into the client hello and overwrites webview auth", async () => {
    const { transport, events, sockets } = createTransport();
    const sessionId = "vscode-session-hello-auth";

    const sessionPromise = transport.openLocalTransportSession({
      sessionId,
      target: { transportType: "tcp", endpoint: "127.0.0.1:6767" },
      password: "p@ss word/with spaces",
    });
    const socket = sockets[0];
    socket.open();
    await sessionPromise;

    expect(socket.input.protocols).toBeUndefined();

    await transport.sendLocalTransportMessage({
      sessionId,
      text: JSON.stringify({
        type: "hello",
        clientId: "webview-client",
        clientType: "browser",
        protocolVersion: 1,
        auth: { kind: "password", password: "webview-supplied" },
      }),
    });

    expect(JSON.parse(String(socket.sent[0]))).toEqual({
      type: "hello",
      clientId: "webview-client",
      clientType: "browser",
      protocolVersion: 1,
      auth: { kind: "password", password: "p@ss word/with spaces" },
    });
    expect(String(socket.sent[0])).not.toContain("webview-supplied");
    expect(events).toEqual([{ sessionId, kind: "open" }]);
  });

  it("inspects only the first hello and passes later frames through untouched", async () => {
    const { transport, sockets } = createTransport();
    const sessionId = "vscode-session-first-hello-only";

    const sessionPromise = transport.openLocalTransportSession({
      sessionId,
      target: { transportType: "tcp", endpoint: "127.0.0.1:6767" },
      password: "test-password",
    });
    sockets[0].open();
    await sessionPromise;

    await transport.sendLocalTransportMessage({
      sessionId,
      text: JSON.stringify({
        type: "hello",
        clientId: "webview-client",
        clientType: "browser",
        protocolVersion: 1,
      }),
    });
    expect(JSON.parse(String(sockets[0].sent[0])).auth).toEqual({
      kind: "password",
      password: "test-password",
    });

    const parseSpy = vi.spyOn(JSON, "parse");
    try {
      const lateHello = JSON.stringify({
        type: "hello",
        clientId: "webview-client",
        clientType: "browser",
        protocolVersion: 1,
        auth: { kind: "password", password: "smuggled" },
      });
      const parsesBefore = parseSpy.mock.calls.length;
      await transport.sendLocalTransportMessage({ sessionId, text: lateHello });
      expect(parseSpy.mock.calls.length).toBe(parsesBefore);
      expect(sockets[0].sent[1]).toBe(lateHello);
      expect(String(sockets[0].sent[1])).toContain("smuggled");
    } finally {
      parseSpy.mockRestore();
    }
  });

  it("leaves non-hello frames untouched", async () => {
    const { transport, sockets } = createTransport();
    const sessionId = "vscode-session-non-hello";

    const sessionPromise = transport.openLocalTransportSession({
      sessionId,
      target: { transportType: "tcp", endpoint: "127.0.0.1:6767" },
      password: "test-password",
    });
    sockets[0].open();
    await sessionPromise;

    const sessionFrame = JSON.stringify({
      type: "session",
      message: { type: "ping" },
    });
    await transport.sendLocalTransportMessage({ sessionId, text: sessionFrame });
    await transport.sendLocalTransportMessage({ sessionId, text: "not json" });
    const helloish = JSON.stringify({ type: "hello.rejected", reason: "password_required" });
    await transport.sendLocalTransportMessage({ sessionId, text: helloish });

    expect(sockets[0].sent).toEqual([sessionFrame, "not json", helloish]);
  });

  it("omits auth when the bridge has no password and strips a smuggled one", async () => {
    const { transport, sockets } = createTransport();
    const sessionId = "vscode-session-no-password";

    const sessionPromise = transport.openLocalTransportSession({
      sessionId,
      target: { transportType: "tcp", endpoint: "127.0.0.1:6767" },
      password: null,
    });
    sockets[0].open();
    await sessionPromise;

    await transport.sendLocalTransportMessage({
      sessionId,
      text: JSON.stringify({
        type: "hello",
        clientId: "webview-client",
        clientType: "browser",
        protocolVersion: 1,
        auth: { kind: "password", password: "smuggled" },
      }),
    });
    expect(JSON.parse(String(sockets[0].sent[0]))).toEqual({
      type: "hello",
      clientId: "webview-client",
      clientType: "browser",
      protocolVersion: 1,
    });
    expect(String(sockets[0].sent[0])).not.toContain("smuggled");

    const helloWithoutAuth = JSON.stringify({
      type: "hello",
      clientId: "webview-client",
      clientType: "browser",
      protocolVersion: 1,
    });
    await transport.sendLocalTransportMessage({ sessionId, text: helloWithoutAuth });
    expect(sockets[0].sent[1]).toBe(helloWithoutAuth);
  });

  it("keeps token-safe passwords on the legacy bearer subprotocol", async () => {
    const { transport, sockets } = createTransport();

    const sessionPromise = transport.openLocalTransportSession({
      sessionId: "vscode-session-legacy-bearer",
      target: { transportType: "tcp", endpoint: "127.0.0.1:6767" },
      password: "token-safe-password",
    });
    sockets[0].open();
    await sessionPromise;

    expect(sockets[0].input.protocols).toEqual(["paseo.bearer.token-safe-password"]);
  });

  it("reports password-required closes after the session is ready", async () => {
    const { transport, events, sockets } = createTransport();
    const sessionId = "vscode-session-auth-after-open";

    const sessionPromise = transport.openLocalTransportSession({
      sessionId,
      target: { transportType: "tcp", endpoint: "127.0.0.1:6767" },
      password: "test-password",
    });
    sockets[0].open();
    await sessionPromise;

    sockets[0].closeFromServer(4401, "Incorrect password");

    expect(events).toEqual([
      { sessionId, kind: "open" },
      { sessionId, kind: "error", error: "Incorrect password", code: 4401 },
      { sessionId, kind: "close", code: 4401, reason: "Incorrect password" },
    ]);
  });

  it("verifies whitespace passwords over hello.auth", async () => {
    const sockets: FakeWebSocket[] = [];
    const probing = verifyDaemonHelloAuth({
      endpoint: "127.0.0.1:6767",
      password: "p@ss word/with spaces",
      timeoutMs: 500,
      webSocketFactory: (input) => {
        const socket = new FakeWebSocket(input);
        sockets.push(socket);
        return socket;
      },
    });

    const socket = sockets[0];
    socket.open();
    await waitForSent(socket, 1);

    expect(socket.input.protocols).toBeUndefined();
    expect(JSON.parse(String(socket.sent[0]))).toMatchObject({
      type: "hello",
      auth: { kind: "password", password: "p@ss word/with spaces" },
    });

    socket.message(
      Buffer.from(
        JSON.stringify({
          type: "session",
          message: { type: "status", payload: { status: "server_info" } },
        }),
      ),
      false,
    );

    await expect(probing).resolves.toBe(true);
  });

  it("fails verification on hello rejection", async () => {
    const sockets: FakeWebSocket[] = [];
    const probing = verifyDaemonHelloAuth({
      endpoint: "127.0.0.1:6767",
      password: "p@ss word",
      timeoutMs: 500,
      webSocketFactory: (input) => {
        const socket = new FakeWebSocket(input);
        sockets.push(socket);
        return socket;
      },
    });

    const socket = sockets[0];
    socket.open();
    await waitForSent(socket, 1);
    socket.message(
      Buffer.from(
        JSON.stringify({
          type: "hello.rejected",
          reason: "incorrect_password",
          accepts: ["password"],
        }),
      ),
      false,
    );

    await expect(probing).resolves.toBe(false);
  });

  it("fails verification when the daemon refuses the socket", async () => {
    const sockets: FakeWebSocket[] = [];
    const probing = verifyDaemonHelloAuth({
      endpoint: "127.0.0.1:6767",
      password: "p@ss word",
      timeoutMs: 500,
      webSocketFactory: (input) => {
        const socket = new FakeWebSocket(input);
        sockets.push(socket);
        return socket;
      },
    });

    sockets[0].closeFromServer(4401, "Password required");

    await expect(probing).resolves.toBe(false);
  });

  it("fails verification when the daemon never answers", async () => {
    const sockets: FakeWebSocket[] = [];
    const probing = verifyDaemonHelloAuth({
      endpoint: "127.0.0.1:6767",
      password: "p@ss word",
      timeoutMs: 20,
      webSocketFactory: (input) => {
        const socket = new FakeWebSocket(input);
        sockets.push(socket);
        return socket;
      },
    });

    sockets[0].open();
    await waitForSent(sockets[0], 1);

    await expect(probing).resolves.toBe(false);
  });

  it("runs concurrent password probes without colliding", async () => {
    const sockets: FakeWebSocket[] = [];
    const webSocketFactory: WebSocketFactory = (input) => {
      const socket = new FakeWebSocket(input);
      sockets.push(socket);
      return socket;
    };

    const first = verifyDaemonHelloAuth({
      endpoint: "127.0.0.1:6767",
      password: "p@ss word",
      timeoutMs: 500,
      webSocketFactory,
    });
    const second = verifyDaemonHelloAuth({
      endpoint: "127.0.0.1:6767",
      password: "p@ss word",
      timeoutMs: 500,
      webSocketFactory,
    });

    expect(sockets).toHaveLength(2);
    for (const socket of sockets) {
      socket.open();
      await waitForSent(socket, 1);
    }

    const clientIds = sockets.map(
      (socket) => (JSON.parse(String(socket.sent[0])) as { clientId: string }).clientId,
    );
    expect(new Set(clientIds).size).toBe(2);

    const serverInfo = Buffer.from(
      JSON.stringify({
        type: "session",
        message: { type: "status", payload: { status: "server_info" } },
      }),
    );
    sockets[0].message(serverInfo, false);
    sockets[1].message(serverInfo, false);

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
  });

  it("buffers messages during auth grace and emits open first", async () => {
    const { transport, events, sockets } = createTransport({ openAuthGraceMs: 10 });
    const sessionId = "vscode-session-race";

    const sessionPromise = transport.openLocalTransportSession({
      sessionId,
      target: { transportType: "tcp", endpoint: "192.168.1.194:6768" },
      password: "test-password",
    });
    const socket = sockets[0];

    socket.open();
    socket.message(Buffer.from("server info"), false);
    expect(events).toEqual([]);

    await sessionPromise;
    expect(events).toEqual([
      { sessionId, kind: "open" },
      { sessionId, kind: "message", text: "server info" },
    ]);
  });

  it("rejects auth-failed closes before the session is ready", async () => {
    const { transport, sockets } = createTransport();

    const sessionPromise = transport.openLocalTransportSession({
      sessionId: "vscode-session-auth",
      target: { transportType: "tcp", endpoint: "192.168.1.194:6768" },
      password: null,
    });
    sockets[0].closeFromServer(4401, "Password required");

    await expect(sessionPromise).rejects.toBeInstanceOf(DaemonTransportAuthError);
  });

  it("rejects a duplicate caller-owned session id without replacing the first socket", async () => {
    const { transport, sockets } = createTransport({ openAuthGraceMs: 10 });
    const input = {
      sessionId: "vscode-session-duplicate",
      target: { transportType: "tcp" as const, endpoint: "192.168.1.194:6768" },
      password: null,
    };

    const firstOpen = transport.openLocalTransportSession(input);

    expect(() => transport.openLocalTransportSession(input)).toThrow(
      "Local transport session already exists: vscode-session-duplicate",
    );
    expect(sockets).toHaveLength(1);

    sockets[0].open();
    await firstOpen;
  });

  it("keeps events correlated to their caller-owned sessions", async () => {
    const { transport, events, sockets } = createTransport();
    const firstOpen = transport.openLocalTransportSession({
      sessionId: "vscode-session-first",
      target: { transportType: "tcp", endpoint: "192.168.1.194:6768" },
      password: null,
    });
    const secondOpen = transport.openLocalTransportSession({
      sessionId: "vscode-session-second",
      target: { transportType: "tcp", endpoint: "192.168.1.194:6768" },
      password: null,
    });

    sockets[1].open();
    await secondOpen;
    sockets[1].message(Buffer.from("second"), false);
    sockets[0].open();
    await firstOpen;
    sockets[0].message(Buffer.from("first"), false);

    expect(events).toEqual([
      { sessionId: "vscode-session-second", kind: "open" },
      { sessionId: "vscode-session-second", kind: "message", text: "second" },
      { sessionId: "vscode-session-first", kind: "open" },
      { sessionId: "vscode-session-first", kind: "message", text: "first" },
    ]);
  });
});
