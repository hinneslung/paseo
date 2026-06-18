import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ATTACHMENTS_DIRNAME = "attachments";
const ATTACHMENT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const EXTENSION_PATTERN = /^\.[A-Za-z0-9]{1,16}$/;
export interface AttachmentFileResult {
  path: string;
  byteSize: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function attachmentsDirPath(storageRoot: string): string {
  return path.join(storageRoot, ATTACHMENTS_DIRNAME);
}

async function ensureAttachmentsDir(storageRoot: string): Promise<string> {
  const dirPath = attachmentsDirPath(storageRoot);
  await mkdir(dirPath, { recursive: true });
  return dirPath;
}

function normalizeAttachmentId(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Attachment id is required.");
  }
  const normalized = value.trim();
  if (!ATTACHMENT_ID_PATTERN.test(normalized)) {
    throw new Error(`Invalid attachment id: ${value}`);
  }
  return normalized;
}

function normalizeExtension(value: unknown): string {
  if (value == null || value === "") {
    return ".bin";
  }
  if (typeof value !== "string") {
    throw new Error("Attachment extension must be a string.");
  }
  const normalized = value.trim().toLowerCase();
  if (!EXTENSION_PATTERN.test(normalized)) {
    throw new Error(`Invalid attachment extension: ${value}`);
  }
  return normalized;
}

function normalizeBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }
  throw new Error("Attachment byte payload is required.");
}

async function assertRegularAttachmentSourceFile(sourcePath: string): Promise<void> {
  const sourceInfo = await stat(sourcePath);
  if (!sourceInfo.isFile()) {
    throw new Error("Attachment source path must be a regular file.");
  }
}

async function buildManagedAttachmentPath(
  storageRoot: string,
  input: { attachmentId: unknown; extension: unknown },
): Promise<string> {
  const dirPath = await ensureAttachmentsDir(storageRoot);
  const attachmentId = normalizeAttachmentId(input.attachmentId);
  const extension = normalizeExtension(input.extension);
  return path.join(dirPath, `${attachmentId}${extension}`);
}

function resolveManagedAttachmentPath(storageRoot: string, inputPath: unknown): string {
  if (typeof inputPath !== "string" || inputPath.trim().length === 0) {
    throw new Error("Attachment path is required.");
  }
  const resolvedDir = `${path.resolve(attachmentsDirPath(storageRoot))}${path.sep}`;
  const resolvedPath = path.resolve(inputPath.trim());
  if (!resolvedPath.startsWith(resolvedDir)) {
    throw new Error("Attachment path must stay within VS Code-managed storage.");
  }
  return resolvedPath;
}

function requireRecord(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) {
    throw new Error("Attachment command input is required.");
  }
  return input;
}

export async function writeAttachmentBase64(
  storageRoot: string,
  input: unknown,
): Promise<AttachmentFileResult> {
  const record = requireRecord(input);
  const base64 = typeof record.base64 === "string" ? record.base64.trim() : "";
  if (base64.length === 0) {
    throw new Error("Attachment base64 payload is required.");
  }

  const targetPath = await buildManagedAttachmentPath(storageRoot, {
    attachmentId: record.attachmentId,
    extension: record.extension,
  });
  await writeFile(targetPath, Buffer.from(base64, "base64"));
  const fileInfo = await stat(targetPath);
  return { path: targetPath, byteSize: fileInfo.size };
}

export async function writeAttachmentBytes(
  storageRoot: string,
  input: unknown,
): Promise<AttachmentFileResult> {
  const record = requireRecord(input);
  const bytes = normalizeBytes(record.bytes);
  const targetPath = await buildManagedAttachmentPath(storageRoot, {
    attachmentId: record.attachmentId,
    extension: record.extension,
  });
  await writeFile(targetPath, bytes);
  const fileInfo = await stat(targetPath);
  return { path: targetPath, byteSize: fileInfo.size };
}

export async function copyAttachmentFileToManagedStorage(
  storageRoot: string,
  input: unknown,
): Promise<AttachmentFileResult> {
  const record = requireRecord(input);
  if (typeof record.sourcePath !== "string" || record.sourcePath.trim().length === 0) {
    throw new Error("Attachment source path is required.");
  }

  const sourcePath = path.resolve(record.sourcePath.trim());
  await assertRegularAttachmentSourceFile(sourcePath);
  const targetPath = await buildManagedAttachmentPath(storageRoot, {
    attachmentId: record.attachmentId,
    extension: record.extension,
  });
  if (sourcePath !== targetPath) {
    await copyFile(sourcePath, targetPath);
  }

  const fileInfo = await stat(targetPath);
  return { path: targetPath, byteSize: fileInfo.size };
}

export async function readManagedFileBase64(storageRoot: string, input: unknown): Promise<string> {
  const record = requireRecord(input);
  const filePath = resolveManagedAttachmentPath(storageRoot, record.path);
  const bytes = await readFile(filePath);
  return bytes.toString("base64");
}

export async function deleteManagedAttachmentFile(
  storageRoot: string,
  input: unknown,
): Promise<boolean> {
  const record = requireRecord(input);
  const filePath = resolveManagedAttachmentPath(storageRoot, record.path);
  await rm(filePath, { force: true });
  return true;
}

export async function garbageCollectManagedAttachmentFiles(
  storageRoot: string,
  input: unknown,
): Promise<number> {
  const record = requireRecord(input);
  const dirPath = await ensureAttachmentsDir(storageRoot);
  const referencedIds = Array.isArray(record.referencedIds)
    ? new Set(
        record.referencedIds
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter((value) => ATTACHMENT_ID_PATTERN.test(value)),
      )
    : new Set<string>();

  const entries = await readdir(dirPath, { withFileTypes: true });
  const toDelete = entries.filter(
    (entry) => entry.isFile() && !referencedIds.has(path.parse(entry.name).name),
  );
  await Promise.all(toDelete.map((entry) => rm(path.join(dirPath, entry.name), { force: true })));
  return toDelete.length;
}
