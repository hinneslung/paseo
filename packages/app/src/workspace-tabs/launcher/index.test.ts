import { describe, expect, it, vi } from "vitest";
import type { PanelPresentation } from "@/panels/panel-registry";
import { resolveBuiltInLaunchPresentations } from "./presentations";

describe("resolveBuiltInLaunchPresentations", () => {
  it("does not resolve unregistered VS Code panel metadata", () => {
    const presentation = {} as PanelPresentation;
    const resolve = vi.fn(() => presentation);

    const result = resolveBuiltInLaunchPresentations(
      {
        showFileExplorer: false,
        showDiff: false,
        showGitChanges: false,
        showBrowser: false,
        showVoice: false,
        showPluginClientUi: false,
      },
      resolve,
    );

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith("pull_request");
    expect(result).toEqual({
      changes: null,
      diff: null,
      files: null,
      pullRequest: presentation,
    });
  });
});
