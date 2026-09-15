import { describe, expect, it } from "vitest";
import { defaultHostAppearance } from "@/hosts/appearance";
import {
  createRemoteSshHostConnection,
  moveHostConnectionToServer,
  normalizeStoredHostProfile,
  orderHostsLocalFirst,
  resolveActiveHostServerId,
  upsertHostConnectionInProfiles,
  type HostConnection,
  type HostProfile,
} from "./host-connection";

function makeHost(serverId: string): HostProfile {
  return {
    serverId,
    label: serverId,
    appearance: defaultHostAppearance(),
    lifecycle: {},
    connections: [],
    preferredConnectionId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("orderHostsLocalFirst", () => {
  it("moves the local host to the first position", () => {
    const remote = makeHost("srv_remote");
    const local = makeHost("srv_local");
    const anotherRemote = makeHost("srv_another_remote");

    expect(orderHostsLocalFirst([remote, local, anotherRemote], "srv_local")).toEqual([
      local,
      remote,
      anotherRemote,
    ]);
  });

  it("preserves host order when the local host is missing", () => {
    const hosts = [makeHost("srv_remote"), makeHost("srv_another_remote")];

    expect(orderHostsLocalFirst(hosts, "srv_local")).toBe(hosts);
  });

  it("preserves host order when there is no local host", () => {
    const hosts = [makeHost("srv_remote"), makeHost("srv_another_remote")];

    expect(orderHostsLocalFirst(hosts, null)).toBe(hosts);
  });
});

describe("normalizeStoredHostProfile", () => {
  it("loads direct TCP connections stored before TLS and password fields existed", () => {
    const profile = normalizeStoredHostProfile({
      serverId: "srv_old",
      label: "Old Host",
      connections: [
        {
          id: "direct:127.0.0.1:6767",
          type: "directTcp",
          endpoint: "127.0.0.1:6767",
        },
      ],
      preferredConnectionId: "direct:127.0.0.1:6767",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(profile).not.toBeNull();
    expect(profile?.connections[0]).toEqual({
      id: "direct:localhost:6767",
      type: "directTcp",
      endpoint: "localhost:6767",
      useTls: false,
    });
    expect(profile?.connections[0]).not.toHaveProperty("password");
  });

  it("preserves legacy relay ids when TLS is absent", () => {
    const profile = normalizeStoredHostProfile({
      serverId: "srv_relay",
      connections: [
        {
          id: "relay:relay.example.com:80",
          type: "relay",
          relayEndpoint: "relay.example.com:80",
          daemonPublicKeyB64: "pubkey",
        },
      ],
    });

    expect(profile?.connections[0]).toEqual({
      id: "relay:relay.example.com:80",
      type: "relay",
      relayEndpoint: "relay.example.com:80",
      daemonPublicKeyB64: "pubkey",
    });
  });

  it("namespaces relay ids only when TLS is true", () => {
    const profile = normalizeStoredHostProfile({
      serverId: "srv_relay",
      connections: [
        {
          id: "relay:relay.example.com:443",
          type: "relay",
          relayEndpoint: "relay.example.com:443",
          useTls: true,
          daemonPublicKeyB64: "pubkey",
        },
      ],
    });

    expect(profile?.connections[0]).toEqual({
      id: "relay:wss:relay.example.com:443",
      type: "relay",
      relayEndpoint: "relay.example.com:443",
      useTls: true,
      daemonPublicKeyB64: "pubkey",
    });
  });

  it("loads direct TCP bridge connections without loopback rewriting", () => {
    const profile = normalizeStoredHostProfile({
      serverId: "srv_vscode",
      connections: [
        {
          id: "bridge:localhost:6767",
          type: "directTcpBridge",
          endpoint: "127.0.0.1:6767",
        },
      ],
    });

    expect(profile?.connections[0]).toEqual({
      id: "bridge:127.0.0.1:6767",
      type: "directTcpBridge",
      endpoint: "127.0.0.1:6767",
    });
  });

  it("rejects passwords in renderer-owned bridge connections", () => {
    expect(
      normalizeStoredHostProfile({
        serverId: "srv_vscode",
        connections: [
          {
            type: "directTcpBridge",
            endpoint: "127.0.0.1:6767",
            password: "must-stay-in-extension-host",
          },
        ],
      }),
    ).toBeNull();
  });

  it("drops invalid direct TCP bridge connections", () => {
    const profile = normalizeStoredHostProfile({
      serverId: "srv_vscode",
      connections: [
        {
          id: "bridge:missing-port",
          type: "directTcpBridge",
          endpoint: "missing-port",
        },
      ],
    });

    expect(profile).toBeNull();
  });

  it("gives a host stored before appearance existed the default appearance", () => {
    const profile = normalizeStoredHostProfile({
      serverId: "srv_old",
      connections: [
        { id: "socket:/tmp/paseo.sock", type: "directSocket", path: "/tmp/paseo.sock" },
      ],
    });

    expect(profile?.appearance).toEqual({ color: "none", badgeDisplay: null });
  });

  it("loads a stored appearance the user chose", () => {
    const profile = normalizeStoredHostProfile({
      serverId: "srv_new",
      appearance: { color: "teal", badgeDisplay: "icon" },
      connections: [
        { id: "socket:/tmp/paseo.sock", type: "directSocket", path: "/tmp/paseo.sock" },
      ],
    });

    expect(profile?.appearance).toEqual({ color: "teal", badgeDisplay: "icon" });
  });

  it("normalizes stored Remote SSH connection parameters", () => {
    const profile = normalizeStoredHostProfile({
      serverId: "srv_ssh",
      connections: [
        {
          type: "remoteSsh",
          host: " deploy@example.com ",
          sshPort: 2222,
          daemonPort: 7777,
        },
      ],
    });

    expect(profile?.connections[0]).toEqual({
      id: "ssh:deploy%40example.com:2222:7777",
      type: "remoteSsh",
      host: "deploy@example.com",
      sshPort: 2222,
      daemonPort: 7777,
    });
  });
});

describe("createRemoteSshHostConnection", () => {
  it("keeps optional SSH settings absent", () => {
    expect(createRemoteSshHostConnection({ host: "build-box" })).toEqual({
      id: "ssh:build-box::",
      type: "remoteSsh",
      host: "build-box",
    });
  });

  it("rejects invalid SSH destinations and ports", () => {
    expect(() => createRemoteSshHostConnection({ host: "" })).toThrow("SSH host is required");
    expect(() => createRemoteSshHostConnection({ host: "bad host" })).toThrow(
      "SSH host is invalid",
    );
    expect(() => createRemoteSshHostConnection({ host: "build-box", sshPort: 70000 })).toThrow(
      "SSH port must be between 1 and 65535",
    );
    expect(() => createRemoteSshHostConnection({ host: "build-box", daemonPort: 0 })).toThrow(
      "Daemon port must be between 1 and 65535",
    );
  });
});

describe("upsertHostConnectionInProfiles", () => {
  const connection: HostConnection = {
    id: "socket:/tmp/paseo.sock",
    type: "directSocket",
    path: "/tmp/paseo.sock",
  };

  it("gives a newly discovered host the default appearance", () => {
    const [profile] = upsertHostConnectionInProfiles({
      profiles: [],
      serverId: "srv_new",
      connection,
    });

    expect(profile.appearance).toEqual({ color: "none", badgeDisplay: null });
  });

  it("keeps the appearance the user chose when the host reconnects", () => {
    const existing: HostProfile = {
      ...makeHost("srv_known"),
      appearance: { color: "amber", badgeDisplay: "hidden" },
      connections: [],
    };

    const [profile] = upsertHostConnectionInProfiles({
      profiles: [existing],
      serverId: "srv_known",
      connection,
    });

    expect(profile.appearance).toEqual({ color: "amber", badgeDisplay: "hidden" });
  });

  it("replaces a direct connection when its settings change", () => {
    const existingConnection: HostConnection = {
      id: "direct:example.test:6767",
      type: "directTcp",
      endpoint: "example.test:6767",
      useTls: false,
      password: "old-secret",
    };
    const existing: HostProfile = {
      ...makeHost("srv_known"),
      connections: [existingConnection],
      preferredConnectionId: existingConnection.id,
    };
    const replacement: HostConnection = {
      ...existingConnection,
      useTls: true,
      password: "new-secret",
    };

    const [profile] = upsertHostConnectionInProfiles({
      profiles: [existing],
      serverId: "srv_known",
      connection: replacement,
    });

    expect(profile.connections).toEqual([replacement]);
    expect(profile.preferredConnectionId).toBe(replacement.id);
  });

  it("uses the reported hostname when a bridge connection re-keys to another daemon", () => {
    const existing: HostProfile = {
      ...makeHost("srv_machine_a"),
      label: "machine-a",
      connections: [connection],
      preferredConnectionId: connection.id,
    };

    const [profile] = upsertHostConnectionInProfiles({
      profiles: [existing],
      serverId: "srv_machine_b",
      label: "machine-b",
      connection,
    });

    expect(profile.serverId).toBe("srv_machine_b");
    expect(profile.label).toBe("machine-b");
  });

  it("keeps a custom label when the same daemon reconnects", () => {
    const existing: HostProfile = {
      ...makeHost("srv_known"),
      label: "my laptop",
      connections: [connection],
      preferredConnectionId: connection.id,
    };

    const [profile] = upsertHostConnectionInProfiles({
      profiles: [existing],
      serverId: "srv_known",
      label: "hostname-from-daemon",
      connection,
    });

    expect(profile.label).toBe("my laptop");
  });
});

describe("moveHostConnectionToServer", () => {
  const direct: HostConnection = {
    id: "direct:machine-a:6767",
    type: "directTcp",
    endpoint: "machine-a:6767",
  };
  const bridge: HostConnection = {
    id: "bridge:127.0.0.1:6767",
    type: "directTcpBridge",
    endpoint: "127.0.0.1:6767",
  };

  it("leaves the other connections of the source profile alone", () => {
    const source: HostProfile = {
      ...makeHost("srv_machine_a"),
      label: "machine-a",
      connections: [direct, bridge],
      preferredConnectionId: direct.id,
    };

    const profiles = moveHostConnectionToServer({
      profiles: [source],
      fromServerId: "srv_machine_a",
      serverId: "srv_machine_b",
      label: "machine-b",
      connection: bridge,
    });

    expect(profiles).toHaveLength(2);
    expect(profiles[0].serverId).toBe("srv_machine_a");
    expect(profiles[0].label).toBe("machine-a");
    expect(profiles[0].connections).toEqual([direct]);
    expect(profiles[0].preferredConnectionId).toBe(direct.id);
    expect(profiles[1].serverId).toBe("srv_machine_b");
    expect(profiles[1].label).toBe("machine-b");
    expect(profiles[1].connections).toEqual([bridge]);
    expect(profiles[1].preferredConnectionId).toBe(bridge.id);
  });

  it("drops a source profile that had nothing but the moved connection", () => {
    const source: HostProfile = {
      ...makeHost("srv_machine_a"),
      label: "machine-a",
      connections: [bridge],
      preferredConnectionId: bridge.id,
    };
    const other = makeHost("srv_other");

    const profiles = moveHostConnectionToServer({
      profiles: [source, other],
      fromServerId: "srv_machine_a",
      serverId: "srv_machine_b",
      label: "machine-b",
      connection: bridge,
    });

    expect(profiles.map((profile) => profile.serverId)).toEqual(["srv_machine_b", "srv_other"]);
    expect(profiles[0].label).toBe("machine-b");
  });

  it("picks a new preferred connection when the moved one was preferred", () => {
    const source: HostProfile = {
      ...makeHost("srv_machine_a"),
      connections: [direct, bridge],
      preferredConnectionId: bridge.id,
    };

    const [remaining] = moveHostConnectionToServer({
      profiles: [source],
      fromServerId: "srv_machine_a",
      serverId: "srv_machine_b",
      connection: bridge,
    });

    expect(remaining.preferredConnectionId).toBe(direct.id);
  });

  it("keeps the target label a user chose", () => {
    const source: HostProfile = {
      ...makeHost("srv_machine_a"),
      connections: [direct, bridge],
      preferredConnectionId: direct.id,
    };
    const target: HostProfile = {
      ...makeHost("srv_machine_b"),
      label: "my mac",
    };

    const profiles = moveHostConnectionToServer({
      profiles: [source, target],
      fromServerId: "srv_machine_a",
      serverId: "srv_machine_b",
      label: "machine-b",
      connection: bridge,
    });

    expect(profiles[1].label).toBe("my mac");
    expect(profiles[1].connections).toEqual([bridge]);
  });

  it("does nothing when the source profile never held the connection", () => {
    const profiles = [makeHost("srv_machine_a")];

    expect(
      moveHostConnectionToServer({
        profiles,
        fromServerId: "srv_machine_a",
        serverId: "srv_machine_b",
        connection: bridge,
      }),
    ).toBe(profiles);
  });
});

describe("resolveActiveHostServerId", () => {
  it("uses the selected host when one is set", () => {
    expect(
      resolveActiveHostServerId({
        selectedServerId: "srv_selected",
        localServerId: "srv_local",
        hosts: [makeHost("srv_local"), makeHost("srv_selected")],
        orderedHosts: [makeHost("srv_local"), makeHost("srv_selected")],
      }),
    ).toBe("srv_selected");
  });

  it("falls back to the local host when it is connected", () => {
    expect(
      resolveActiveHostServerId({
        selectedServerId: null,
        localServerId: "srv_local",
        hosts: [makeHost("srv_local"), makeHost("srv_remote")],
        orderedHosts: [makeHost("srv_local"), makeHost("srv_remote")],
      }),
    ).toBe("srv_local");
  });

  it("skips a stopped local daemon and uses the first connected host", () => {
    // Regression: a stopped local daemon's serverId persists but isn't in `hosts`.
    // Falling back to it would resolve the section to an unknown id ("host not found").
    expect(
      resolveActiveHostServerId({
        selectedServerId: null,
        localServerId: "srv_local_stopped",
        hosts: [makeHost("srv_remote")],
        orderedHosts: [makeHost("srv_remote")],
      }),
    ).toBe("srv_remote");
  });

  it("returns null when no hosts are connected", () => {
    expect(
      resolveActiveHostServerId({
        selectedServerId: null,
        localServerId: "srv_local_stopped",
        hosts: [],
        orderedHosts: [],
      }),
    ).toBeNull();
  });

  it("ignores a selected host that is not connected", () => {
    // A stale selection (e.g. the host was removed) must not be used unless it is
    // currently connected, or the section resolves to an unknown id ("host not found").
    expect(
      resolveActiveHostServerId({
        selectedServerId: "srv_stale_selection",
        localServerId: null,
        hosts: [makeHost("srv_remote")],
        orderedHosts: [makeHost("srv_remote")],
      }),
    ).toBe("srv_remote");
  });

  it("falls through a disconnected selection to the connected local host", () => {
    expect(
      resolveActiveHostServerId({
        selectedServerId: "srv_stale_selection",
        localServerId: "srv_local",
        hosts: [makeHost("srv_local"), makeHost("srv_remote")],
        orderedHosts: [makeHost("srv_local"), makeHost("srv_remote")],
      }),
    ).toBe("srv_local");
  });
});
