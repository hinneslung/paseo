import { describe, expect, it } from "vitest";
import { parseDroppedFilePaths, resolveDroppedFileMentionPath } from "./file-drop-mentions";

describe("parseDroppedFilePaths", () => {
  it("parses text/uri-list file entries and ignores comments", () => {
    expect(
      parseDroppedFilePaths({
        uriList: [
          "# dragged from VS Code",
          "file:///home/dev/repo/packages/app/src/foo.tsx",
          "file:///home/dev/repo/packages/app/src/bar%20baz.ts",
          "https://example.com/not-a-file",
        ].join("\n"),
      }),
    ).toEqual([
      "/home/dev/repo/packages/app/src/foo.tsx",
      "/home/dev/repo/packages/app/src/bar baz.ts",
    ]);
  });

  it("deduplicates repeated file URIs", () => {
    expect(
      parseDroppedFilePaths({
        uriList:
          "file:///home/dev/repo/a.ts\nfile:///home/dev/repo/a.ts\nfile:///home/dev/repo/b.ts",
      }),
    ).toEqual(["/home/dev/repo/a.ts", "/home/dev/repo/b.ts"]);
  });

  it("normalizes Windows file URIs", () => {
    expect(
      parseDroppedFilePaths({
        uriList: "file:///C:/Users/dev/repo/packages/app/src/foo.tsx",
      }),
    ).toEqual(["C:/Users/dev/repo/packages/app/src/foo.tsx"]);
  });

  it("normalizes VS Code Remote WSL URIs to Linux paths", () => {
    expect(
      parseDroppedFilePaths({
        uriList: "vscode-remote://wsl+Ubuntu/home/dev/repo/packages/app/src/foo.tsx",
      }),
    ).toEqual(["/home/dev/repo/packages/app/src/foo.tsx"]);
  });

  it("normalizes WSL UNC file URIs to Linux paths", () => {
    expect(
      parseDroppedFilePaths({
        uriList: [
          "file://wsl.localhost/Ubuntu/home/dev/repo/packages/app/src/foo.tsx",
          "file://wsl$/Ubuntu/home/dev/repo/packages/app/src/bar.tsx",
          "file://///wsl.localhost/Ubuntu/home/dev/repo/packages/app/src/baz.tsx",
          "file:/wsl.localhost/Ubuntu/home/dev/repo/packages/app/src/qux.tsx",
        ].join("\n"),
      }),
    ).toEqual([
      "/home/dev/repo/packages/app/src/foo.tsx",
      "/home/dev/repo/packages/app/src/bar.tsx",
      "/home/dev/repo/packages/app/src/baz.tsx",
      "/home/dev/repo/packages/app/src/qux.tsx",
    ]);
  });
});

describe("resolveDroppedFileMentionPath", () => {
  it("resolves an absolute dropped path to a cwd-relative mention path", () => {
    expect(
      resolveDroppedFileMentionPath({
        cwd: "/home/dev/repo",
        path: "/home/dev/repo/packages/app/src/foo.tsx",
      }),
    ).toBe("packages/app/src/foo.tsx");
  });

  it("returns null for files outside the current cwd", () => {
    expect(
      resolveDroppedFileMentionPath({
        cwd: "/home/dev/repo",
        path: "/home/dev/other/foo.tsx",
      }),
    ).toBeNull();
  });
});
