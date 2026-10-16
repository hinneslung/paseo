import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ComponentType,
  type ReactNode,
} from "react";
import { useRouter, type Href } from "expo-router";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Globe, SquarePen, SquareTerminal } from "lucide-react-native";
import invariant from "tiny-invariant";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { resolvePluginIcon } from "@/plugins/icons";
import { useInstalledPlugins } from "@/plugins/registry";
import { pluginPanelSupportsLocation } from "@/plugins/workspace-panels/locations";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import type { NewTabSelection } from "@/workspace-tabs/new-tab";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import type { TerminalProfile } from "@getpaseo/protocol/messages";
import { panelCanLaunchInPane, panelSupportsHost, type PaneHost } from "@/panels/panel-manifest";
import { type PanelIconProps } from "@/panels/panel-registry";
import { ensurePanelsRegistered } from "@/panels/register-panels";
import {
  getTerminalProfileIcon,
  resolveTerminalProfiles,
} from "@getpaseo/protocol/terminal-profiles";
import {
  getBuiltInLaunchOrder,
  resolveRegisteredLaunchPresentations,
  type BuiltInLaunchItemId,
} from "./internal/catalog";
import { getWorkspaceSurfaceConfig } from "@/workspace/surface-capabilities";

export type WorkspaceTabLaunchPurpose = "primary" | "supporting";

export type WorkspaceTabLaunchDestination =
  | { kind: "open"; paneId?: string }
  | { kind: "replace"; tabId: string };

export interface NewTabLauncher {
  showChanges: boolean;
  showPullRequest: boolean;
  showBrowser: boolean;
  terminalDisabled: boolean;
  launch: (selection: NewTabSelection, destination: WorkspaceTabLaunchDestination) => void;
}

export interface WorkspaceTabLaunchItem {
  id: string;
  label: string;
  Icon?: ComponentType<PanelIconProps>;
  terminalIconKey?: string;
  shortcutActionId?: string;
  disabled: boolean;
  panelKind: WorkspaceTabTarget["kind"];
  launch: (destination: WorkspaceTabLaunchDestination) => void;
}

export interface WorkspaceTabLaunchGroup {
  id: "tabs" | "plugin-panels" | "terminal-profiles";
  label: string | null;
  items: readonly WorkspaceTabLaunchItem[];
  accessory?: { id: string; label: string; run: () => void };
}

const EMPTY_PANE_PANEL_KINDS: readonly WorkspaceTabTarget["kind"][] = [];
const EMPTY_PLUGINS = [] as const;

const NewTabLauncherContext = createContext<NewTabLauncher | null>(null);

export function NewTabLauncherProvider({
  value,
  children,
}: {
  value: NewTabLauncher;
  children: ReactNode;
}) {
  return <NewTabLauncherContext.Provider value={value}>{children}</NewTabLauncherContext.Provider>;
}

const BUILT_IN_SELECTIONS = {
  agent: { kind: "agent" },
  terminal: { kind: "terminal" },
  changes: { kind: "target", target: { kind: "changes_tree" } },
  diff: { kind: "target", target: { kind: "working_diff" } },
  files: { kind: "target", target: { kind: "files" } },
  browser: { kind: "browser" },
  pullRequest: { kind: "target", target: { kind: "pull_request" } },
} satisfies Record<BuiltInLaunchItemId, NewTabSelection>;

function createBuiltInLaunchItems(input: {
  t: TFunction;
  isExplorerMenu: boolean;
  launcher: NewTabLauncher;
  presentations: ReturnType<typeof resolveRegisteredLaunchPresentations>;
  launchSelection: (
    selection: NewTabSelection,
  ) => (destination: WorkspaceTabLaunchDestination) => void;
}): Record<BuiltInLaunchItemId, WorkspaceTabLaunchItem & { hidden?: boolean }> {
  const { t, isExplorerMenu, launcher, presentations, launchSelection } = input;
  return {
    agent: {
      id: "agent",
      label: t("workspace.tabs.fallback.agent"),
      Icon: SquarePen,
      shortcutActionId: "workspace-tab-target-agent",
      disabled: false,
      panelKind: "draft",
      hidden: isExplorerMenu,
      launch: launchSelection(BUILT_IN_SELECTIONS.agent),
    },
    terminal: {
      id: "terminal",
      label: t("workspace.tabs.fallback.terminal"),
      Icon: SquareTerminal,
      shortcutActionId: "workspace-terminal-new",
      disabled: launcher.terminalDisabled,
      panelKind: "terminal",
      launch: launchSelection(BUILT_IN_SELECTIONS.terminal),
    },
    changes: {
      id: "changes",
      label: presentations.changes?.label(t) ?? "",
      Icon: presentations.changes?.icon,
      disabled: false,
      panelKind: "changes_tree",
      hidden: !launcher.showChanges || !presentations.changes,
      launch: launchSelection(BUILT_IN_SELECTIONS.changes),
    },
    diff: {
      id: "diff",
      label: presentations.diff?.label(t) ?? "",
      Icon: presentations.diff?.icon,
      shortcutActionId: "workspace-tab-target-changes",
      disabled: false,
      panelKind: "working_diff",
      hidden: !launcher.showChanges || !presentations.diff,
      launch: launchSelection(BUILT_IN_SELECTIONS.diff),
    },
    files: {
      id: "files",
      label: presentations.files?.label(t) ?? "",
      Icon: presentations.files?.icon,
      shortcutActionId: "workspace-tab-target-files",
      disabled: false,
      panelKind: "files",
      hidden: !presentations.files,
      launch: launchSelection(BUILT_IN_SELECTIONS.files),
    },
    browser: {
      id: "browser",
      label: t("workspace.tabs.fallback.browser"),
      Icon: Globe,
      shortcutActionId: "workspace-tab-target-browser",
      disabled: false,
      panelKind: "browser",
      hidden: !launcher.showBrowser,
      launch: launchSelection(BUILT_IN_SELECTIONS.browser),
    },
    pullRequest: {
      id: "pull-request",
      label: presentations.pullRequest?.label(t) ?? "",
      Icon: presentations.pullRequest?.icon,
      disabled: false,
      panelKind: "pull_request",
      hidden: !launcher.showPullRequest || !presentations.pullRequest,
      launch: launchSelection(BUILT_IN_SELECTIONS.pullRequest),
    },
  };
}

export function useWorkspaceTabLaunchCatalog(input: {
  serverId: string;
  purpose: WorkspaceTabLaunchPurpose;
  host: PaneHost;
  surface: "menu" | "panel";
  panePanelKinds?: readonly WorkspaceTabTarget["kind"][];
}): readonly WorkspaceTabLaunchGroup[] {
  const { serverId, purpose, host, surface, panePanelKinds = EMPTY_PANE_PANEL_KINDS } = input;
  const { t } = useTranslation();
  const router = useRouter();
  const launcher = useContext(NewTabLauncherContext);
  invariant(launcher, "NewTabLauncherProvider is required");
  const { config } = useDaemonConfig(serverId);
  const plugins = useInstalledPlugins();
  const surfaceConfig = useMemo(getWorkspaceSurfaceConfig, []);
  ensurePanelsRegistered();
  const presentations = useMemo(resolveRegisteredLaunchPresentations, []);
  const visiblePlugins = surfaceConfig.showPluginClientUi ? plugins : EMPTY_PLUGINS;

  const launchSelection = useCallback(
    (selection: NewTabSelection) => (destination: WorkspaceTabLaunchDestination) => {
      launcher.launch(selection, destination);
    },
    [launcher],
  );
  const editTerminalProfiles = useCallback(() => {
    router.push(buildSettingsHostSectionRoute(serverId, "terminals") as Href);
  }, [router, serverId]);

  return useMemo(() => {
    const isExplorerMenu = host === "explorer" && surface === "menu";
    const builtIns = createBuiltInLaunchItems({
      t,
      isExplorerMenu,
      launcher,
      presentations,
      launchSelection,
    });
    const tabItems = getBuiltInLaunchOrder(purpose).flatMap((id) => {
      const item = builtIns[id];
      return item.hidden || !panelSupportsHost(item.panelKind, host) ? [] : [item];
    });

    const pluginItems: WorkspaceTabLaunchItem[] = [];
    for (const plugin of visiblePlugins) {
      if (plugin.serverId !== serverId) continue;
      for (const panel of plugin.workspacePanels) {
        if (panel.context !== "workspace") continue;
        const location = host === "explorer" ? "explorer" : "workspace";
        if (!pluginPanelSupportsLocation(panel, location)) continue;
        const selection: NewTabSelection = {
          kind: "target",
          target: { kind: "plugin", pluginId: plugin.id, panelId: panel.id, context: "workspace" },
        };
        pluginItems.push({
          id: `plugin:${plugin.id}:${panel.id}`,
          label: panel.title,
          Icon: resolvePluginIcon(panel.icon),
          disabled: false,
          panelKind: "plugin",
          launch: launchSelection(selection),
        });
      }
    }

    const profiles = resolveTerminalProfiles(config?.terminalProfiles);
    const groups: WorkspaceTabLaunchGroup[] = [{ id: "tabs", label: null, items: tabItems }];
    if (pluginItems.length > 0) {
      groups.push({ id: "plugin-panels", label: null, items: pluginItems });
    }
    if (!isExplorerMenu && profiles.length > 0) {
      groups.push({
        id: "terminal-profiles",
        label: t("workspace.tabs.actions.terminalProfilesMenu"),
        items: profiles.map((profile: TerminalProfile) => ({
          id: `terminal-profile:${profile.id}`,
          label: profile.name,
          terminalIconKey: getTerminalProfileIcon(profile),
          disabled: launcher.terminalDisabled,
          panelKind: "terminal",
          launch: launchSelection({ kind: "terminal", profile }),
        })),
        accessory: {
          id: "edit-terminal-profiles",
          label: t("workspace.tabs.actions.editTerminalProfiles"),
          run: editTerminalProfiles,
        },
      });
    }
    if (surface !== "menu") return groups;
    return groups.flatMap((group) => {
      const items = group.items.filter((item) =>
        panelCanLaunchInPane(item.panelKind, panePanelKinds),
      );
      return items.length > 0 ? [{ ...group, items }] : [];
    });
  }, [
    config?.terminalProfiles,
    editTerminalProfiles,
    launchSelection,
    launcher,
    presentations,
    purpose,
    host,
    surface,
    panePanelKinds,
    serverId,
    t,
    visiblePlugins,
  ]);
}

export { getBuiltInLaunchOrder } from "./internal/catalog";
