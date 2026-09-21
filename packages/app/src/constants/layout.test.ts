import { describe, expect, it } from "vitest";
import { resolveIsCompactFormFactor } from "./layout";

describe("resolveIsCompactFormFactor", () => {
  it("uses compact breakpoints outside VS Code", () => {
    expect(resolveIsCompactFormFactor({ breakpoint: "xs", isVscode: false })).toBe(true);
    expect(resolveIsCompactFormFactor({ breakpoint: "sm", isVscode: false })).toBe(true);
    expect(resolveIsCompactFormFactor({ breakpoint: "md", isVscode: false })).toBe(false);
    expect(resolveIsCompactFormFactor({ breakpoint: undefined, isVscode: false })).toBe(false);
  });

  it("always uses wide layout inside VS Code", () => {
    expect(resolveIsCompactFormFactor({ breakpoint: "xs", isVscode: true })).toBe(false);
    expect(resolveIsCompactFormFactor({ breakpoint: "sm", isVscode: true })).toBe(false);
    expect(resolveIsCompactFormFactor({ breakpoint: "md", isVscode: true })).toBe(false);
  });
});
