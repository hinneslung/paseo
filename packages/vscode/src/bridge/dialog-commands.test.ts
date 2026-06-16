import { describe, expect, it } from "vitest";
import {
  formatDialogOpenResult,
  getVscodeOpenDialogFilters,
  parseDialogOpenInput,
  parseDialogOpenSelectionOverride,
} from "./dialog-commands";

describe("dialog bridge command parsing", () => {
  it("parses wrapped open dialog options", () => {
    expect(
      parseDialogOpenInput({
        options: {
          title: " Attach images ",
          defaultPath: " /workspace ",
          directory: false,
          multiple: true,
          filters: [
            {
              name: " Images ",
              extensions: [" png ", "jpg"],
            },
          ],
        },
      }),
    ).toEqual({
      title: "Attach images",
      defaultPath: "/workspace",
      directory: false,
      multiple: true,
      filters: [{ name: "Images", extensions: ["png", "jpg"] }],
    });
  });

  it("rejects malformed filters", () => {
    expect(() =>
      parseDialogOpenInput({
        options: {
          filters: [{ name: "Images", extensions: [] }],
        },
      }),
    ).toThrow("dialog.open filters[0].extensions must not be empty.");
  });

  it("formats VS Code dialog filters", () => {
    expect(
      getVscodeOpenDialogFilters([
        { name: "Images", extensions: ["png", "jpg"] },
        { name: "Documents", extensions: ["pdf"] },
      ]),
    ).toEqual({
      Images: ["png", "jpg"],
      Documents: ["pdf"],
    });
  });

  it("formats open dialog selections", () => {
    expect(formatDialogOpenResult(undefined, true)).toBeNull();
    expect(formatDialogOpenResult([], false)).toBeNull();
    expect(formatDialogOpenResult(["/tmp/one.png", "/tmp/two.jpg"], true)).toEqual([
      "/tmp/one.png",
      "/tmp/two.jpg",
    ]);
    expect(formatDialogOpenResult(["/tmp/one.png", "/tmp/two.jpg"], false)).toBe("/tmp/one.png");
  });

  it("parses the test open dialog selection override", () => {
    expect(parseDialogOpenSelectionOverride(undefined)).toBeNull();
    expect(parseDialogOpenSelectionOverride('["/tmp/one.png","/tmp/two.jpg"]')).toEqual([
      "/tmp/one.png",
      "/tmp/two.jpg",
    ]);
    expect(() => parseDialogOpenSelectionOverride('{"path":"/tmp/one.png"}')).toThrow(
      "PASEO_VSCODE_TEST_DIALOG_OPEN_PATHS must be a JSON string array.",
    );
  });
});
