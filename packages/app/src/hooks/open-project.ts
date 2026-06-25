import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { OpenProjectResponseMessage, ProjectAddResponse } from "@getpaseo/protocol/messages";
import {
  normalizeEmptyProjectDescriptor as normalizeProjectWithoutWorkspacesDescriptor,
  normalizeWorkspaceDescriptor,
  type EmptyProjectDescriptor as ProjectWithoutWorkspacesDescriptor,
  type WorkspaceDescriptor,
} from "@/stores/session-store";
import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-tabs-store";

type ProjectAddPayload = ProjectAddResponse["payload"];
type WorkspaceOpenPayload = OpenProjectResponseMessage["payload"];
type OpenProjectErrorCode = NonNullable<
  ProjectAddPayload["errorCode"] | WorkspaceOpenPayload["errorCode"]
>;

export interface OpenProjectSuccess {
  ok: true;
}

export interface OpenProjectFailure {
  ok: false;
  errorCode: OpenProjectErrorCode | null;
  error: string | null;
}

export type OpenProjectResult = OpenProjectSuccess | OpenProjectFailure;

export interface OpenProjectDirectlyInput {
  serverId: string;
  projectPath: string;
  isConnected: boolean;
  canAddProject: boolean;
  client: Pick<DaemonClient, "addProject"> | null;
  addEmptyProject: (serverId: string, project: ProjectWithoutWorkspacesDescriptor) => void;
  setHasHydratedWorkspaces: (serverId: string, hydrated: boolean) => void;
}

export interface OpenProjectWorkspaceDirectlyInput {
  serverId: string;
  projectPath: string;
  isConnected: boolean;
  client: Pick<DaemonClient, "openProject"> | null;
  mergeWorkspaces: (serverId: string, workspaces: Iterable<WorkspaceDescriptor>) => void;
  setHasHydratedWorkspaces: (serverId: string, hydrated: boolean) => void;
  openDraftTab: (workspaceKey: string) => string | null;
  navigateToWorkspace: (serverId: string, workspaceId: string) => void;
}

export async function openProjectDirectly(
  input: OpenProjectDirectlyInput,
): Promise<OpenProjectResult> {
  const normalizedServerId = input.serverId.trim();
  const trimmedPath = input.projectPath.trim();
  if (!normalizedServerId || !trimmedPath || !input.client || !input.isConnected) {
    return { ok: false, errorCode: null, error: null };
  }

  if (!input.canAddProject) {
    return {
      ok: false,
      errorCode: null,
      error: "Update the host to add projects without creating a workspace.",
    };
  }

  const payload = await input.client.addProject(trimmedPath);
  if (payload.error || !payload.project) {
    return {
      ok: false,
      errorCode: payload.errorCode ?? null,
      error: payload.error,
    };
  }

  input.addEmptyProject(
    normalizedServerId,
    normalizeProjectWithoutWorkspacesDescriptor(payload.project),
  );
  input.setHasHydratedWorkspaces(normalizedServerId, true);
  return { ok: true };
}

export async function openProjectWorkspaceDirectly(
  input: OpenProjectWorkspaceDirectlyInput,
): Promise<OpenProjectResult> {
  const normalizedServerId = input.serverId.trim();
  const trimmedPath = input.projectPath.trim();
  if (!normalizedServerId || !trimmedPath || !input.client || !input.isConnected) {
    return { ok: false, errorCode: null, error: null };
  }

  const payload = await input.client.openProject(trimmedPath);
  if (payload.error || !payload.workspace) {
    return {
      ok: false,
      errorCode: payload.errorCode ?? null,
      error: payload.error,
    };
  }

  const workspace = normalizeWorkspaceDescriptor(payload.workspace);
  input.mergeWorkspaces(normalizedServerId, [workspace]);
  input.setHasHydratedWorkspaces(normalizedServerId, true);

  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: normalizedServerId,
    workspaceId: workspace.id,
  });
  if (!workspaceKey) {
    return { ok: false, errorCode: null, error: null };
  }

  input.openDraftTab(workspaceKey);
  input.navigateToWorkspace(normalizedServerId, workspace.id);
  return { ok: true };
}
