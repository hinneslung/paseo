import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";

export type VscodeWorkspaceMatch = { serverId: string; workspaceId: string } | { serverId: string };

export interface VscodeWorkspaceMatchWorkspace {
  id: WorkspaceDescriptor["id"];
  projectId: WorkspaceDescriptor["projectId"];
  projectRootPath: WorkspaceDescriptor["projectRootPath"];
}

export interface VscodeWorkspaceMatchAgent {
  cwd: Agent["cwd"];
  workspaceId?: Agent["workspaceId"];
}

export interface VscodeWorkspaceMatchHost {
  serverId: string;
  hasHydratedAgents: boolean;
  hasHydratedWorkspaces: boolean;
  workspaces: Iterable<VscodeWorkspaceMatchWorkspace>;
  agents: Iterable<VscodeWorkspaceMatchAgent>;
}

export type VscodeWorkspaceMatchState =
  | { status: "loading" }
  | { status: "ready"; match: VscodeWorkspaceMatch | null };

export interface ResolveVscodeWorkspaceMatchInput {
  folders: readonly string[];
  hosts: readonly VscodeWorkspaceMatchHost[];
}

function normalizePathForMatch(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return null;
  }

  const withUnixSeparators = trimmed.replace(/\\/g, "/");
  let normalized = withUnixSeparators.replace(/\/+$/, "");
  if (!normalized && withUnixSeparators.startsWith("/")) {
    normalized = "/";
  }
  if (/^[A-Za-z]:$/.test(normalized)) {
    normalized = `${normalized}/`;
  }
  if (!normalized) {
    return null;
  }

  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")) {
    return normalized.toLowerCase();
  }
  return normalized;
}

function getFirstFolderPath(folders: readonly string[]): string | null {
  for (const folder of folders) {
    const normalized = normalizePathForMatch(folder);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function getWorkspaceId(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
}

function getFirstSetValue(values: Set<string>): string | null {
  for (const value of values) {
    return value;
  }
  return null;
}

function isSameOrDescendantPath(child: string, parent: string): boolean {
  if (child === parent) {
    return true;
  }
  if (parent === "/") {
    return child.startsWith("/");
  }
  if (/^[a-z]:\/$/.test(parent)) {
    return child.startsWith(parent);
  }
  return child.startsWith(`${parent}/`);
}

function resolveProjectRootMatch(
  folderPath: string,
  host: VscodeWorkspaceMatchHost,
): VscodeWorkspaceMatch | null {
  const workspaces = Array.from(host.workspaces);
  const projectIds = new Set<string>();
  for (const workspace of workspaces) {
    if (normalizePathForMatch(workspace.projectRootPath) === folderPath) {
      projectIds.add(workspace.projectId);
    }
  }

  if (projectIds.size === 0) {
    return null;
  }
  if (projectIds.size > 1) {
    return { serverId: host.serverId };
  }

  const projectId = getFirstSetValue(projectIds);
  if (!projectId) {
    return { serverId: host.serverId };
  }
  const projectWorkspaces = workspaces.filter((workspace) => workspace.projectId === projectId);
  const workspace = projectWorkspaces[0];
  if (projectWorkspaces.length === 1 && workspace) {
    return { serverId: host.serverId, workspaceId: workspace.id };
  }
  return { serverId: host.serverId };
}

function resolveAgentCwdMatch(
  folderPath: string,
  host: VscodeWorkspaceMatchHost,
): VscodeWorkspaceMatch | null {
  const workspaceIds = new Set(Array.from(host.workspaces, (workspace) => workspace.id));
  const matchedWorkspaceIds = new Set<string>();
  let matchedAgent = false;

  for (const agent of host.agents) {
    const cwd = normalizePathForMatch(agent.cwd);
    if (!cwd || !isSameOrDescendantPath(cwd, folderPath)) {
      continue;
    }
    matchedAgent = true;
    const workspaceId = getWorkspaceId(agent.workspaceId);
    if (workspaceId && workspaceIds.has(workspaceId)) {
      matchedWorkspaceIds.add(workspaceId);
    }
  }

  if (!matchedAgent) {
    return null;
  }
  if (matchedWorkspaceIds.size === 1) {
    const workspaceId = getFirstSetValue(matchedWorkspaceIds);
    return workspaceId ? { serverId: host.serverId, workspaceId } : { serverId: host.serverId };
  }
  return { serverId: host.serverId };
}

function resolveProjectRootMatchForHosts(
  folderPath: string,
  hosts: readonly VscodeWorkspaceMatchHost[],
): VscodeWorkspaceMatch | null {
  for (const host of hosts) {
    const match = resolveProjectRootMatch(folderPath, host);
    if (match) {
      return match;
    }
  }
  return null;
}

function resolveAgentCwdMatchForHosts(
  folderPath: string,
  hosts: readonly VscodeWorkspaceMatchHost[],
): VscodeWorkspaceMatch | null {
  for (const host of hosts) {
    const match = resolveAgentCwdMatch(folderPath, host);
    if (match) {
      return match;
    }
  }
  return null;
}

export function resolveVscodeWorkspaceMatch(
  input: ResolveVscodeWorkspaceMatchInput,
): VscodeWorkspaceMatch | null {
  const folderPath = getFirstFolderPath(input.folders);
  if (!folderPath) {
    return null;
  }

  return (
    resolveProjectRootMatchForHosts(folderPath, input.hosts) ??
    resolveAgentCwdMatchForHosts(folderPath, input.hosts)
  );
}

export function resolveVscodeWorkspaceMatchState(
  input: ResolveVscodeWorkspaceMatchInput,
): VscodeWorkspaceMatchState {
  const folderPath = getFirstFolderPath(input.folders);
  if (!folderPath || input.hosts.length === 0) {
    return { status: "ready", match: null };
  }

  if (input.hosts.some((host) => !host.hasHydratedWorkspaces)) {
    return { status: "loading" };
  }

  const projectRootMatch = resolveProjectRootMatchForHosts(folderPath, input.hosts);
  if (projectRootMatch) {
    return { status: "ready", match: projectRootMatch };
  }

  if (input.hosts.some((host) => !host.hasHydratedAgents)) {
    return { status: "loading" };
  }

  return { status: "ready", match: resolveAgentCwdMatchForHosts(folderPath, input.hosts) };
}
