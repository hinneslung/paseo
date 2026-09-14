import { describe, expect, it } from "vitest";
import {
  discoverDaemonEndpoint,
  parseDaemonEndpointCandidate,
  validateDaemonPassword,
  type FetchLike,
  type ProbeRequestInit,
  type ProbeResponseLike,
} from "./discovery";

interface FetchCall {
  url: string;
  init?: ProbeRequestInit;
}

interface FetchStep {
  status?: number;
  body?: unknown;
  error?: Error;
}

class FakeResponse implements ProbeResponseLike {
  constructor(
    readonly status: number,
    private readonly body: unknown,
  ) {}

  async json(): Promise<unknown> {
    return this.body;
  }
}

function createFetch(steps: FetchStep[]): { fetch: FetchLike; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const queue = [...steps];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const next = queue.shift();
      if (!next) {
        throw new Error("Unexpected fetch call");
      }
      if (next.error) {
        throw next.error;
      }
      return new FakeResponse(next.status ?? 200, next.body ?? {});
    },
  };
}

describe("daemon discovery", () => {
  it("resolves an explicit endpoint that returns /api/status 200", async () => {
    const { fetch, calls } = createFetch([
      { status: 200, body: { serverId: "server-1", version: "0.1.96" } },
    ]);

    const result = await discoverDaemonEndpoint({
      settingEndpoint: "192.168.1.194:6768",
      fetch,
    });

    expect(result).toMatchObject({
      endpoint: "192.168.1.194:6768",
      source: "setting",
      requiresPassword: false,
      available: true,
      serverId: "server-1",
      version: "0.1.96",
    });
    expect(calls).toEqual([{ url: "http://192.168.1.194:6768/api/status", init: undefined }]);
  });

  it("marks a live 401 endpoint as requiring a password", async () => {
    const { fetch } = createFetch([{ status: 401 }]);

    const result = await discoverDaemonEndpoint({
      envEndpoint: "127.0.0.1:6768",
      fetch,
    });

    expect(result).toMatchObject({
      endpoint: "127.0.0.1:6768",
      source: "env",
      requiresPassword: true,
      available: true,
    });
  });

  it("tries the next candidate after a connection failure", async () => {
    const { fetch, calls } = createFetch([
      { error: new Error("ECONNREFUSED") },
      { status: 200, body: { serverId: "server-config", version: "0.1.97" } },
    ]);

    const result = await discoverDaemonEndpoint({
      settingEndpoint: "127.0.0.1:6767",
      configListen: "192.168.1.194:6768",
      fetch,
    });

    expect(result).toMatchObject({
      endpoint: "192.168.1.194:6768",
      source: "config",
      available: true,
      serverId: "server-config",
      version: "0.1.97",
    });
    expect(calls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:6767/api/status",
      "http://192.168.1.194:6768/api/status",
    ]);
  });

  it("normalizes wildcard listen hosts to loopback and rejects socket paths", () => {
    expect(parseDaemonEndpointCandidate({ source: "config", value: "0.0.0.0:6767" })).toEqual({
      source: "config",
      endpoint: "127.0.0.1:6767",
    });
    expect(parseDaemonEndpointCandidate({ source: "config", value: "/tmp/paseo.sock" })).toEqual({
      source: "config",
      message: "Socket/pipe daemon listen targets are not supported in VS Code v1.",
    });
  });

  it("validates passwords with an Authorization bearer header", async () => {
    const { fetch, calls } = createFetch([
      { status: 200, body: { serverId: "server-1", version: "0.1.96" } },
    ]);

    await expect(
      validateDaemonPassword({ endpoint: "192.168.1.194:6768", password: "test-password", fetch }),
    ).resolves.toBe(true);
    expect(calls[0]).toEqual({
      url: "http://192.168.1.194:6768/api/status",
      init: { headers: { Authorization: "Bearer test-password" } },
    });
  });
});
