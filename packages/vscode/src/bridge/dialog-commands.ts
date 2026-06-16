export interface DialogOpenFilter {
  name: string;
  extensions: string[];
}

export interface DialogOpenInput {
  title?: string;
  defaultPath?: string;
  directory: boolean;
  multiple: boolean;
  filters?: DialogOpenFilter[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`dialog.open ${fieldName} must be a string.`);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseOptionalBoolean(value: unknown, fieldName: string): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value !== "boolean") {
    throw new Error(`dialog.open ${fieldName} must be a boolean.`);
  }
  return value;
}

function parseRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`dialog.open ${fieldName} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`dialog.open ${fieldName} must not be empty.`);
  }
  return trimmed;
}

function parseFilters(value: unknown): DialogOpenFilter[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("dialog.open filters must be an array.");
  }

  const filters: DialogOpenFilter[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      throw new Error(`dialog.open filters[${index}] must be an object.`);
    }
    if (!Array.isArray(entry.extensions)) {
      throw new Error(`dialog.open filters[${index}].extensions must be an array.`);
    }

    const extensions = entry.extensions.map((extension, extensionIndex) =>
      parseRequiredString(extension, `filters[${index}].extensions[${extensionIndex}]`),
    );
    if (extensions.length === 0) {
      throw new Error(`dialog.open filters[${index}].extensions must not be empty.`);
    }

    filters.push({
      name: parseRequiredString(entry.name, `filters[${index}].name`),
      extensions,
    });
  }

  return filters.length > 0 ? filters : undefined;
}

function getWrappedOptions(args: unknown): Record<string, unknown> {
  if (!isRecord(args)) {
    throw new Error("dialog.open requires an options object.");
  }
  const options = args.options;
  if (options === undefined || options === null) {
    return {};
  }
  if (!isRecord(options)) {
    throw new Error("dialog.open options must be an object.");
  }
  return options;
}

export function parseDialogOpenInput(args: unknown): DialogOpenInput {
  const options = getWrappedOptions(args);
  const title = parseOptionalString(options.title, "title");
  const defaultPath = parseOptionalString(options.defaultPath, "defaultPath");
  const filters = parseFilters(options.filters);

  return {
    ...(title !== undefined ? { title } : {}),
    ...(defaultPath !== undefined ? { defaultPath } : {}),
    directory: parseOptionalBoolean(options.directory, "directory"),
    multiple: parseOptionalBoolean(options.multiple, "multiple"),
    ...(filters !== undefined ? { filters } : {}),
  };
}

export function getVscodeOpenDialogFilters(
  filters: readonly DialogOpenFilter[] | undefined,
): Record<string, string[]> | undefined {
  if (!filters) {
    return undefined;
  }

  const vscodeFilters: Record<string, string[]> = {};
  for (const filter of filters) {
    vscodeFilters[filter.name] = [...filter.extensions];
  }
  return vscodeFilters;
}

export function formatDialogOpenResult(
  paths: readonly string[] | undefined,
  multiple: boolean,
): string | string[] | null {
  if (!paths || paths.length === 0) {
    return null;
  }
  return multiple ? [...paths] : paths[0];
}

export function parseDialogOpenSelectionOverride(value: string | undefined): string[] | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (
    !Array.isArray(parsed) ||
    !parsed.every((entry): entry is string => typeof entry === "string")
  ) {
    throw new Error("PASEO_VSCODE_TEST_DIALOG_OPEN_PATHS must be a JSON string array.");
  }
  return parsed;
}
