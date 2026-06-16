import { describe, expect, it } from "vitest";
import {
  resolveVscodeWorkspaceMatch,
  type VscodeWorkspaceMatchAgent,
  type VscodeWorkspaceMatchHost,
  type VscodeWorkspaceMatchWorkspace,
} from "./initial-target";

function workspace(
  id: string,
  projectId: string,
  projectRootPath: string,
): VscodeWorkspaceMatchWorkspace {
  return { id, projectId, projectRootPath };
}

function agent(cwd: string, workspaceId?: string): VscodeWorkspaceMatchAgent {
  return { cwd, ...(workspaceId ? { workspaceId } : {}) };
}

function host(input: {
  serverId?: string;
  workspaces?: VscodeWorkspaceMatchWorkspace[];
  agents?: VscodeWorkspaceMatchAgent[];
}): VscodeWorkspaceMatchHost {
  return {
    serverId: input.serverId ?? "server-1",
    hasHydratedAgents: true,
    hasHydratedWorkspaces: true,
    workspaces: input.workspaces ?? [],
    agents: input.agents ?? [],
  };
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
