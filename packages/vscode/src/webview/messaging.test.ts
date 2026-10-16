import { describe, expect, it } from "vitest";
import {
  createEventEnvelope,
  dispatchWebviewMessage,
  type HostToWebviewEnvelope,
} from "./messaging";

describe("webview messaging", () => {
  it("posts a result envelope for successful invokes", async () => {
    const posted: HostToWebviewEnvelope[] = [];

    const handled = await dispatchWebviewMessage({
      message: {
        kind: "invoke",
        id: "request-1",
        command: "demo.command",
        args: { value: 1 },
      },
      dispatcher: {
        dispatch: async (command, args) => ({ command, args }),
      },
      sendMessage: (message) => {
        posted.push(message);
        return true;
      },
    });

    expect(handled).toBe(true);
    expect(posted).toEqual([
      {
        kind: "result",
        id: "request-1",
        ok: true,
        value: { command: "demo.command", args: { value: 1 } },
      },
    ]);
  });

  it("posts a rejected result envelope for failed invokes", async () => {
    const posted: HostToWebviewEnvelope[] = [];

    await dispatchWebviewMessage({
      message: {
        kind: "invoke",
        id: "request-2",
        command: "missing.command",
      },
      dispatcher: {
        dispatch: async () => {
          throw new Error("command not implemented");
        },
      },
      sendMessage: (message) => {
        posted.push(message);
        return true;
      },
    });

    expect(posted).toEqual([
      {
        kind: "result",
        id: "request-2",
        ok: false,
        error: "command not implemented",
      },
    ]);
  });

  it("creates event envelopes", () => {
    expect(createEventEnvelope("local-daemon-transport-event", { sessionId: "s1" })).toEqual({
      kind: "event",
      event: "local-daemon-transport-event",
      payload: { sessionId: "s1" },
    });
  });
});
