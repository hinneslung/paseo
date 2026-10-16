import { describe, expect, it } from "vitest";
import { resolveRootRecoveryLocation } from "./root-error-recovery";

describe("resolveRootRecoveryLocation", () => {
  it("lets the router choose its normal initial location before recovery", () => {
    expect(resolveRootRecoveryLocation({ generation: 0, isVscodeRuntime: true })).toBeUndefined();
  });

  it("routes VS Code recovery through folder startup selection", () => {
    expect(resolveRootRecoveryLocation({ generation: 1, isVscodeRuntime: true })).toBe("/");
  });

  it("keeps ordinary recovery away from the workspace that crashed", () => {
    expect(resolveRootRecoveryLocation({ generation: 1, isVscodeRuntime: false })).toBe(
      "/open-project",
    );
  });
});
