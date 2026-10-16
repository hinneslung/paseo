import type { RawData } from "ws";
import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";
import type {
  WebSocketFactory,
  WebSocketFactoryInput,
  WebSocketLike,
} from "../bridge/daemon-transport";

const vscodeMock = vi.hoisted(() => ({
  showInputBox: vi.fn(),
}));

vi.mock("vscode", () => ({
  window: {
    showInputBox: vscodeMock.showInputBox,
  },
}));

import { promptForDaemonPassword } from "./secret-store";

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
    this.readyState = 3;
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
}

async function waitForSent(socket: FakeWebSocket): Promise<void> {
  while (socket.sent.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe("daemon password prompt", () => {
  it("verifies whitespace passwords over hello.auth instead of the HTTP bearer probe", async () => {
    const sockets: FakeWebSocket[] = [];
    const webSocketFactory: WebSocketFactory = (input) => {
      const socket = new FakeWebSocket(input);
      sockets.push(socket);
      return socket;
    };
    const fetch = vi.fn(() => Promise.reject(new Error("HTTP probe must not run")));
    vscodeMock.showInputBox.mockResolvedValue("p@ss word/with spaces");
    const secrets = {
      get: vi.fn(async () => undefined),
      store: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };

    const prompting = promptForDaemonPassword({
      context: { secrets } as unknown as vscode.ExtensionContext,
      endpoint: "127.0.0.1:6767",
      fetch,
      webSocketFactory,
    });

    await vi.waitFor(() => {
      expect(sockets).toHaveLength(1);
    });
    const socket = sockets[0];
    socket.open();
    await waitForSent(socket);

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

    await expect(prompting).resolves.toBe("p@ss word/with spaces");
    expect(fetch).not.toHaveBeenCalled();
    expect(secrets.store).toHaveBeenCalledWith(
      "paseo.daemonPassword.127.0.0.1:6767",
      "p@ss word/with spaces",
    );
  });
});
