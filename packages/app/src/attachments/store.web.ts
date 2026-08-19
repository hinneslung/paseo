import type { AttachmentStore } from "@/attachments/types";
import { createIndexedDbAttachmentStore } from "@/attachments/web/indexeddb-attachment-store";
import { createDesktopAttachmentBridge } from "@/desktop/attachments/desktop-attachment-bridge";
import { createDesktopAttachmentStore } from "@/desktop/attachments/desktop-attachment-store";
import { getDesktopHost, isElectronRuntime } from "@/desktop/host";

let attachmentStorePromise: Promise<AttachmentStore> | null = null;

function createAttachmentStore(): AttachmentStore {
  if (isElectronRuntime() || getDesktopHost()?.platform === "vscode") {
    return createDesktopAttachmentStore(createDesktopAttachmentBridge());
  }

  return createIndexedDbAttachmentStore();
}

export async function getAttachmentStore(): Promise<AttachmentStore> {
  if (!attachmentStorePromise) {
    attachmentStorePromise = Promise.resolve(createAttachmentStore());
  }
  return await attachmentStorePromise;
}

/** Test-only hook to inject a deterministic store implementation. */
export function __setAttachmentStoreForTests(store: AttachmentStore | null): void {
  attachmentStorePromise = store ? Promise.resolve(store) : null;
}
