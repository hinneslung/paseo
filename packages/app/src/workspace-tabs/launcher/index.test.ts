import { describe, expect, it } from "vitest";
import type { PanelPresentation, PanelRegistration } from "@/panels/panel-registry";
import { resolveRegisteredLaunchPresentations } from "./internal/catalog";

describe("resolveRegisteredLaunchPresentations", () => {
  it("does not resolve metadata for unregistered VS Code panels", () => {
    const presentation = {} as PanelPresentation;
    const requested: string[] = [];
    const result = resolveRegisteredLaunchPresentations((kind) => {
      requested.push(kind);
      return kind === "pull_request"
        ? ({ presentation } as unknown as PanelRegistration)
        : undefined;
    });

    expect(requested).toEqual(["changes_tree", "working_diff", "files", "pull_request"]);
    expect(result).toEqual({
      changes: null,
      diff: null,
      files: null,
      pullRequest: presentation,
    });
  });
});
