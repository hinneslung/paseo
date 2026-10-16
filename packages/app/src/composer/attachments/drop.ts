import {
  getMimeTypeFromPath,
  isRasterImageFile,
  isRasterImagePath,
} from "@/attachments/file-types";
import { readDesktopFileBytes, type SelectedFile } from "@/attachments/selected-file";
import type { DroppedItem } from "@/components/file-drop/types";
import { appendFileMentionPaths } from "@/utils/file-mention-autocomplete";
import { splitDroppedItemsForMentions } from "@/workspace/file-drop-mentions";

interface DroppedAttachmentsRuntime {
  readDesktopFileBytes(path: string): Promise<Uint8Array>;
}

const defaultRuntime: DroppedAttachmentsRuntime = {
  readDesktopFileBytes,
};

function fileNameFromPath(path: string): string {
  const segments = path.split(/[/\\]/);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment) {
      return segment;
    }
  }
  return path;
}

export function droppedItemsToSelectedFiles(
  items: DroppedItem[],
  runtime: DroppedAttachmentsRuntime = defaultRuntime,
): SelectedFile[] {
  const files: SelectedFile[] = [];

  for (const item of items) {
    if (item.kind === "web-file") {
      if (isRasterImageFile(item.file)) {
        continue;
      }
      const file = item.file;
      files.push({
        fileName: file.name,
        mimeType: file.type || getMimeTypeFromPath(file.name),
        readBytes: async () => new Uint8Array(await file.arrayBuffer()),
      });
      continue;
    }

    if (isRasterImagePath(item.path)) {
      continue;
    }
    const path = item.path;
    files.push({
      fileName: fileNameFromPath(path),
      mimeType: getMimeTypeFromPath(path),
      readBytes: () => runtime.readDesktopFileBytes(path),
    });
  }

  return files;
}

export function prepareComposerDroppedItems(
  input: {
    items: DroppedItem[];
    cwd: string;
    getLiveText(): string | undefined;
    getPublishedText(): string;
  },
  runtime: DroppedAttachmentsRuntime = defaultRuntime,
): { currentInput: string; nextInput: string; files: SelectedFile[] } {
  const { mentionPaths, uploadItems } = splitDroppedItemsForMentions({
    items: input.items,
    cwd: input.cwd,
  });
  const currentInput = input.getLiveText() ?? input.getPublishedText();
  return {
    currentInput,
    nextInput: appendFileMentionPaths({ text: currentInput, relativePaths: mentionPaths }),
    files: droppedItemsToSelectedFiles(uploadItems, runtime),
  };
}
