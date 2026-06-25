import { describe, expect, it } from "vitest";
import { openProjectDirectly, openProjectWorkspaceDirectly } from "@/hooks/open-project";
import type { EmptyProjectDescriptor as ProjectWithoutWorkspacesDescriptor } from "@/stores/session-store";

const SERVER_ID = "server-1";
const PROJECT_PATH = "/repo/project";

function buildProjectPayload() {
  return {
    projectId: "project-1",
    projectDisplayName: "project",
    projectRootPath: PROJECT_PATH,
    projectKind: "git" as const,
  };
}

function buildWorkspacePayload() {
  return {
    id: "workspace-1",
    projectId: "project-1",
    projectDisplayName: "project",
    projectCustomName: null,
    projectRootPath: PROJECT_PATH,
    workspaceDirectory: PROJECT_PATH,
    projectKind: "git" as const,
    workspaceKind: "local_checkout" as const,
    name: "main",
    title: null,
    status: "done" as const,
    statusEnteredAt: null,
    activityAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
    gitRuntime: null,
    githubRuntime: null,
  };
}

interface RecordedProject {
  serverId: string;
  project: ProjectWithoutWorkspacesDescriptor;
}

interface RecordedHydrated {
  serverId: string;
  hydrated: boolean;
}

interface RecordedWorkspace {
  serverId: string;
  workspaceIds: string[];
}

function createFakeSession() {
  const projects: RecordedProject[] = [];
  const workspaces: RecordedWorkspace[] = [];
  const hydrated: RecordedHydrated[] = [];
  const draftWorkspaceKeys: string[] = [];
  const navigations: Array<{ serverId: string; workspaceId: string }> = [];
  return {
    projects,
    workspaces,
    hydrated,
    draftWorkspaceKeys,
    navigations,
    addEmptyProject: (serverId: string, project: ProjectWithoutWorkspacesDescriptor) => {
      projects.push({ serverId, project });
    },
    mergeWorkspaces: (serverId: string, incoming: Iterable<{ id: string }>) => {
      workspaces.push({
        serverId,
        workspaceIds: Array.from(incoming, (workspace) => workspace.id),
      });
    },
    setHasHydratedWorkspaces: (serverId: string, value: boolean) => {
      hydrated.push({ serverId, hydrated: value });
    },
    openDraftTab: (workspaceKey: string) => {
      draftWorkspaceKeys.push(workspaceKey);
      return "tab-1";
    },
    navigateToWorkspace: (serverId: string, workspaceId: string) => {
      navigations.push({ serverId, workspaceId });
    },
  };
}

describe("openProjectDirectly", () => {
  it("adds the project and marks workspaces hydrated without opening a workspace", async () => {
    const session = createFakeSession();
    const projectPayload = buildProjectPayload();

    const result = await openProjectDirectly({
      serverId: SERVER_ID,
      projectPath: PROJECT_PATH,
      isConnected: true,
      canAddProject: true,
      client: {
        addProject: async () => ({
          requestId: "request-1",
          error: null,
          project: projectPayload,
        }),
      },
      addEmptyProject: session.addEmptyProject,
      setHasHydratedWorkspaces: session.setHasHydratedWorkspaces,
    });

    expect(result).toEqual({ ok: true });
    expect(session.projects).toEqual([
      {
        serverId: SERVER_ID,
        project: {
          projectId: "project-1",
          projectDisplayName: "project",
          projectCustomName: null,
          projectKind: "git",
          projectRootPath: PROJECT_PATH,
        },
      },
    ]);
    expect(session.hydrated).toEqual([{ serverId: SERVER_ID, hydrated: true }]);
  });

  it("fails before sending when the host does not support adding projects without workspaces", async () => {
    const session = createFakeSession();
    const result = await openProjectDirectly({
      serverId: SERVER_ID,
      projectPath: PROJECT_PATH,
      isConnected: true,
      canAddProject: false,
      client: {
        addProject: async () => ({
          requestId: "request-unsupported",
          error: null,
          project: buildProjectPayload(),
        }),
      },
      addEmptyProject: session.addEmptyProject,
      setHasHydratedWorkspaces: session.setHasHydratedWorkspaces,
    });

    expect(result).toEqual({
      ok: false,
      errorCode: null,
      error: "Update the host to add projects without creating a workspace.",
    });
    expect(session.projects).toEqual([]);
    expect(session.hydrated).toEqual([]);
  });

  it("does not add a project when addProject fails", async () => {
    const session = createFakeSession();

    const result = await openProjectDirectly({
      serverId: SERVER_ID,
      projectPath: PROJECT_PATH,
      isConnected: true,
      canAddProject: true,
      client: {
        addProject: async () => ({
          requestId: "request-2",
          error: "Directory not found: /repo/project",
          errorCode: "directory_not_found" as const,
          project: null,
        }),
      },
      addEmptyProject: session.addEmptyProject,
      setHasHydratedWorkspaces: session.setHasHydratedWorkspaces,
    });

    expect(result).toEqual({
      ok: false,
      errorCode: "directory_not_found",
      error: "Directory not found: /repo/project",
    });
    expect(session.projects).toEqual([]);
    expect(session.hydrated).toEqual([]);
  });

  it("opens a workspace when requested by VS Code startup", async () => {
    const session = createFakeSession();

    const result = await openProjectWorkspaceDirectly({
      serverId: SERVER_ID,
      projectPath: PROJECT_PATH,
      isConnected: true,
      client: {
        openProject: async () => ({
          requestId: "request-workspace",
          error: null,
          workspace: buildWorkspacePayload(),
        }),
      },
      mergeWorkspaces: session.mergeWorkspaces,
      setHasHydratedWorkspaces: session.setHasHydratedWorkspaces,
      openDraftTab: session.openDraftTab,
      navigateToWorkspace: session.navigateToWorkspace,
    });

    expect(result).toEqual({ ok: true });
    expect(session.workspaces).toEqual([{ serverId: SERVER_ID, workspaceIds: ["workspace-1"] }]);
    expect(session.hydrated).toEqual([{ serverId: SERVER_ID, hydrated: true }]);
    expect(session.draftWorkspaceKeys).toEqual([`${SERVER_ID}:workspace-1`]);
    expect(session.navigations).toEqual([{ serverId: SERVER_ID, workspaceId: "workspace-1" }]);
  });
});
