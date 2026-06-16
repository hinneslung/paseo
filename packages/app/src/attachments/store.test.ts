import { afterEach, describe, expect, it, vi } from "vitest";
import { __setAttachmentStoreForTests, getAttachmentStore } from "./store";

describe("attachment store", () => {
  afterEach(() => {
    __setAttachmentStoreForTests(null);
    vi.unstubAllGlobals();
  });

  it("creates the default web attachment store without runtime module resolution errors", async () => {
    const store = await getAttachmentStore();

    expect(store.storageType).toBe("web-indexeddb");
  });

  it("uses the desktop file store inside VS Code", async () => {
    vi.stubGlobal("window", {
      paseoVscode: {
        endpoint: "127.0.0.1:6768",
        hasPassword: false,
        bridgeProtocol: 1,
        workspaceFolders: [],
      },
      paseoDesktop: {
        platform: "vscode",
        invoke: async () => null,
      },
    });

    const store = await getAttachmentStore();

    expect(store.storageType).toBe("desktop-file");
  });
});
