import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  copyAttachmentFileToManagedStorage,
  deleteManagedAttachmentFile,
  garbageCollectManagedAttachmentFiles,
  readManagedFileBase64,
  writeAttachmentBase64,
} from "./attachment-commands";

let tempDir: string;

describe("attachment bridge commands", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "paseo-vscode-attachments-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("copies selected files into managed storage and reads them back", async () => {
    const sourcePath = path.join(tempDir, "source.PNG");
    await writeFile(sourcePath, "image-bytes");

    const result = await copyAttachmentFileToManagedStorage(tempDir, {
      attachmentId: "picked_image",
      sourcePath,
      extension: ".png",
    });

    expect(result.byteSize).toBe(11);
    expect(result.path).toBe(path.join(tempDir, "attachments", "picked_image.png"));
    expect(await readFile(result.path, "utf8")).toBe("image-bytes");
    expect(await readManagedFileBase64(tempDir, { path: result.path })).toBe(
      Buffer.from("image-bytes").toString("base64"),
    );
  });

  it("copies selected non-image files into managed storage", async () => {
    const sourcePath = path.join(tempDir, "notes.txt");
    await writeFile(sourcePath, "note-bytes");

    const result = await copyAttachmentFileToManagedStorage(tempDir, {
      attachmentId: "notes",
      sourcePath,
      extension: ".txt",
    });

    expect(result.byteSize).toBe(10);
    expect(result.path).toBe(path.join(tempDir, "attachments", "notes.txt"));
    expect(await readFile(result.path, "utf8")).toBe("note-bytes");
  });

  it("rejects directories as attachment sources", async () => {
    const sourcePath = path.join(tempDir, "source-directory");
    await mkdir(sourcePath);

    await expect(
      copyAttachmentFileToManagedStorage(tempDir, {
        attachmentId: "directory",
        sourcePath,
        extension: ".txt",
      }),
    ).rejects.toThrow("Attachment source path must be a regular file.");
    await expect(readFile(path.join(tempDir, "attachments", "directory.txt"))).rejects.toThrow();
  });

  it("keeps managed file reads inside the attachment directory", async () => {
    await expect(
      readManagedFileBase64(tempDir, { path: path.join(tempDir, "source.png") }),
    ).rejects.toThrow("Attachment path must stay within VS Code-managed storage.");
  });

  it("writes base64 payloads and garbage collects unreferenced files", async () => {
    const keep = await writeAttachmentBase64(tempDir, {
      attachmentId: "keep",
      base64: Buffer.from("keep").toString("base64"),
      extension: ".jpg",
    });
    const remove = await writeAttachmentBase64(tempDir, {
      attachmentId: "remove",
      base64: Buffer.from("remove").toString("base64"),
      extension: ".jpg",
    });

    expect(await garbageCollectManagedAttachmentFiles(tempDir, { referencedIds: ["keep"] })).toBe(
      1,
    );
    expect(await readFile(keep.path, "utf8")).toBe("keep");
    await expect(readFile(remove.path, "utf8")).rejects.toThrow();
  });

  it("deletes managed files", async () => {
    const result = await writeAttachmentBase64(tempDir, {
      attachmentId: "delete_me",
      base64: Buffer.from("delete").toString("base64"),
      extension: ".png",
    });

    expect(await deleteManagedAttachmentFile(tempDir, { path: result.path })).toBe(true);
    await expect(readFile(result.path, "utf8")).rejects.toThrow();
  });
});
