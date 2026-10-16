export const PRIMARY_LAUNCH_ORDER = [
  "agent",
  "terminal",
  "changes",
  "diff",
  "files",
  "browser",
  "pullRequest",
] as const;

export const SUPPORTING_LAUNCH_ORDER = [
  "changes",
  "terminal",
  "diff",
  "files",
  "agent",
  "browser",
  "pullRequest",
] as const;

export type BuiltInLaunchItemId = (typeof PRIMARY_LAUNCH_ORDER)[number];

export function getBuiltInLaunchOrder(purpose: "primary" | "supporting") {
  return purpose === "supporting" ? SUPPORTING_LAUNCH_ORDER : PRIMARY_LAUNCH_ORDER;
}
import { getPanelRegistration, type PanelPresentation } from "@/panels/panel-registry";

export function resolveRegisteredLaunchPresentations(
  resolve: typeof getPanelRegistration = getPanelRegistration,
): Record<"changes" | "diff" | "files" | "pullRequest", PanelPresentation | null> {
  return {
    changes: resolve("changes_tree")?.presentation ?? null,
    diff: resolve("working_diff")?.presentation ?? null,
    files: resolve("files")?.presentation ?? null,
    pullRequest: resolve("pull_request")?.presentation ?? null,
  };
}
