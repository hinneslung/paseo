import { describe, expect, it } from "vitest";
import {
  resolveVscodeWorkspaceMatch,
  resolveVscodeWorkspaceMatchState,
  resolveVscodeStartupAction,
  type VscodeAutoOpenState,
  type VscodeStartupAction,
  type VscodeWorkspaceMatchAgent,
  type VscodeWorkspaceMatchHost,
  type VscodeWorkspaceMatchWorkspace,
} from "./initial-target";

const IDLE_AUTO_OPEN: VscodeAutoOpenState = { status: "idle", folder: null, message: null };

function workspace(
  id: string,
  projectId: string,
  projectRootPath: string,
  workspaceDirectory = projectRootPath,
): VscodeWorkspaceMatchWorkspace {
  return { id, projectId, projectRootPath, workspaceDirectory };
}

function agent(cwd: string, workspaceId?: string): VscodeWorkspaceMatchAgent {
  return { cwd, ...(workspaceId ? { workspaceId } : {}) };
}

function host(input: {
  serverId?: string;
  hasHydratedAgents?: boolean;
  hasHydratedWorkspaces?: boolean;
  workspaces?: VscodeWorkspaceMatchWorkspace[];
  agents?: VscodeWorkspaceMatchAgent[];
}): VscodeWorkspaceMatchHost {
  return {
    serverId: input.serverId ?? "server-1",
    hasHydratedAgents: input.hasHydratedAgents ?? true,
    hasHydratedWorkspaces: input.hasHydratedWorkspaces ?? true,
    workspaces: input.workspaces ?? [],
    agents: input.agents ?? [],
  };
}

interface StartupActionCase {
  name: string;
  folders: readonly string[];
  hosts: readonly VscodeWorkspaceMatchHost[];
  hasConnectedHost: boolean;
  connectionDetail?: string | null;
  autoOpen?: VscodeAutoOpenState;
  expected: VscodeStartupAction;
}

describe("resolveVscodeWorkspaceMatch", () => {
  it("matches a VS Code folder to a single workspace by project root", () => {
    expect(
      resolveVscodeWorkspaceMatch({
        folders: ["/repo/app/"],
        hosts: [
          host({
            workspaces: [workspace("workspace-main", "project-app", "/repo/app")],
          }),
        ],
      }),
    ).toEqual({ serverId: "server-1", workspaceId: "workspace-main" });
  });

  it("normalizes Windows path case and slashes for project root matches", () => {
    expect(
      resolveVscodeWorkspaceMatch({
        folders: ["C:\\Users\\Dev\\App\\"],
        hosts: [
          host({
            workspaces: [workspace("workspace-win", "project-win", "c:/users/dev/app")],
          }),
        ],
      }),
    ).toEqual({ serverId: "server-1", workspaceId: "workspace-win" });
  });

  it("returns the host when the matching project has multiple workspaces", () => {
    expect(
      resolveVscodeWorkspaceMatch({
        folders: ["/repo/app"],
        hosts: [
          host({
            workspaces: [
              workspace("workspace-main", "project-app", "/repo/app"),
              workspace("workspace-branch", "project-app", "/repo/app"),
            ],
          }),
        ],
      }),
    ).toEqual({ serverId: "server-1" });
  });

  it("falls back to an agent cwd match when no project root matches", () => {
    expect(
      resolveVscodeWorkspaceMatch({
        folders: ["/repo/app"],
        hosts: [
          host({
            workspaces: [workspace("workspace-agent", "project-other", "/repo/other")],
            agents: [agent("/repo/app", "workspace-agent")],
          }),
        ],
      }),
    ).toEqual({ serverId: "server-1", workspaceId: "workspace-agent" });
  });

  it("matches a VS Code folder to a worktree workspace by workspace directory", () => {
    expect(
      resolveVscodeWorkspaceMatch({
        folders: ["/repo/worktrees/feature"],
        hosts: [
          host({
            workspaces: [
              workspace("workspace-main", "project-app", "/repo/main", "/repo/main"),
              workspace(
                "workspace-worktree",
                "project-app",
                "/repo/main",
                "/repo/worktrees/feature",
              ),
            ],
          }),
        ],
      }),
    ).toEqual({ serverId: "server-1", workspaceId: "workspace-worktree" });
  });

  it("selects the main checkout when opening the main repo root while a worktree exists", () => {
    expect(
      resolveVscodeWorkspaceMatch({
        folders: ["/repo/main"],
        hosts: [
          host({
            workspaces: [
              workspace("workspace-main", "project-app", "/repo/main", "/repo/main"),
              workspace(
                "workspace-worktree",
                "project-app",
                "/repo/main",
                "/repo/worktrees/feature",
              ),
            ],
          }),
        ],
      }),
    ).toEqual({ serverId: "server-1", workspaceId: "workspace-main" });
  });

  it("returns the host when multiple workspaces share the matching workspace directory", () => {
    expect(
      resolveVscodeWorkspaceMatch({
        folders: ["/repo/worktrees/shared"],
        hosts: [
          host({
            workspaces: [
              workspace("workspace-one", "project-app", "/repo/main", "/repo/worktrees/shared"),
              workspace("workspace-two", "project-app", "/repo/main", "/repo/worktrees/shared"),
            ],
          }),
        ],
      }),
    ).toEqual({ serverId: "server-1" });
  });

  it("prefers a workspace directory match over an agent cwd match", () => {
    expect(
      resolveVscodeWorkspaceMatch({
        folders: ["/repo/worktrees/feature"],
        hosts: [
          host({
            workspaces: [
              workspace(
                "workspace-worktree",
                "project-app",
                "/repo/main",
                "/repo/worktrees/feature",
              ),
              workspace("workspace-agent", "project-app", "/repo/main", "/repo/worktrees/other"),
            ],
            agents: [agent("/repo/worktrees/feature/src", "workspace-agent")],
          }),
        ],
      }),
    ).toEqual({ serverId: "server-1", workspaceId: "workspace-worktree" });
  });

  it("does not treat a Paseo worktree cwd as a different open folder match", () => {
    expect(
      resolveVscodeWorkspaceMatch({
        folders: ["/home/dev/projects/app"],
        hosts: [
          host({
            workspaces: [workspace("workspace-worktree", "project-other", "/home/dev/other")],
            agents: [agent("/home/dev/.paseo/worktrees/app-branch", "workspace-worktree")],
          }),
        ],
      }),
    ).toBeNull();
  });

  it("returns null when neither project roots nor agent cwd values match", () => {
    expect(
      resolveVscodeWorkspaceMatch({
        folders: ["/repo/app"],
        hosts: [
          host({
            workspaces: [workspace("workspace-other", "project-other", "/repo/other")],
            agents: [agent("/repo/other", "workspace-other")],
          }),
        ],
      }),
    ).toBeNull();
  });
});

describe("resolveVscodeWorkspaceMatchState", () => {
  it("selects the main checkout when opening the main repo root while a worktree exists", () => {
    expect(
      resolveVscodeWorkspaceMatchState({
        folders: ["/repo/main"],
        hosts: [
          host({
            workspaces: [
              workspace("workspace-main", "project-app", "/repo/main", "/repo/main"),
              workspace(
                "workspace-worktree",
                "project-app",
                "/repo/main",
                "/repo/worktrees/feature",
              ),
            ],
          }),
        ],
      }),
    ).toEqual({
      status: "ready",
      match: { serverId: "server-1", workspaceId: "workspace-main" },
    });
  });

  it("returns a workspace directory match without waiting for agents to hydrate", () => {
    expect(
      resolveVscodeWorkspaceMatchState({
        folders: ["/repo/worktrees/feature"],
        hosts: [
          host({
            hasHydratedAgents: false,
            workspaces: [
              workspace(
                "workspace-worktree",
                "project-app",
                "/repo/main",
                "/repo/worktrees/feature",
              ),
            ],
          }),
        ],
      }),
    ).toEqual({
      status: "ready",
      match: { serverId: "server-1", workspaceId: "workspace-worktree" },
    });
  });
});

describe("resolveVscodeStartupAction", () => {
  const cases: StartupActionCase[] = [
    {
      name: "returns none when VS Code did not provide a usable folder",
      folders: ["", "   "],
      hosts: [],
      hasConnectedHost: false,
      expected: { kind: "none" },
    },
    {
      name: "waits for a connected host before reading workspaces",
      folders: ["/repo/app"],
      hosts: [],
      hasConnectedHost: false,
      connectionDetail: "Dialing 127.0.0.1:6767",
      expected: { kind: "wait", status: "connecting", detail: "Dialing 127.0.0.1:6767" },
    },
    {
      name: "waits for workspaces to hydrate",
      folders: ["/repo/app"],
      hosts: [host({ hasHydratedWorkspaces: false })],
      hasConnectedHost: true,
      expected: { kind: "wait", status: "loading-workspaces", detail: null },
    },
    {
      name: "redirects when the folder matches a project root",
      folders: ["/repo/app"],
      hosts: [
        host({
          hasHydratedAgents: false,
          workspaces: [workspace("workspace-main", "project-app", "/repo/app")],
        }),
      ],
      hasConnectedHost: true,
      expected: {
        kind: "redirect",
        match: { serverId: "server-1", workspaceId: "workspace-main" },
      },
    },
    {
      name: "opens the original folder path when no workspace matches",
      folders: ["C:\\Users\\Dev\\App\\"],
      hosts: [host({ workspaces: [] })],
      hasConnectedHost: true,
      expected: { kind: "open", folder: "C:\\Users\\Dev\\App\\" },
    },
    {
      name: "waits while the current folder is being opened",
      folders: ["/repo/app"],
      hosts: [],
      hasConnectedHost: false,
      autoOpen: { status: "pending", folder: "/repo/app/", message: null },
      expected: { kind: "wait", status: "opening", detail: null },
    },
    {
      name: "surfaces an error for the current folder",
      folders: ["/repo/app"],
      hosts: [],
      hasConnectedHost: false,
      autoOpen: { status: "error", folder: "/repo/app/", message: "Cannot open workspace" },
      expected: { kind: "error", message: "Cannot open workspace" },
    },
  ];

  it.each(cases)("$name", (testCase) => {
    expect(
      resolveVscodeStartupAction({
        folders: testCase.folders,
        hosts: testCase.hosts,
        hasConnectedHost: testCase.hasConnectedHost,
        connectionDetail: testCase.connectionDetail ?? null,
        autoOpen: testCase.autoOpen ?? IDLE_AUTO_OPEN,
      }),
    ).toEqual(testCase.expected);
  });
});
