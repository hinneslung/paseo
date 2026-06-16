export interface DaemonStatusInfo {
  serverId: string | null;
  version: string | null;
}

export interface ResolvedDaemonEndpoint extends DaemonStatusInfo {
  endpoint: string;
  source: "setting" | "env" | "config" | "default";
  requiresPassword: boolean;
  available: boolean;
  unsupportedMessage: string | null;
}

export interface ProbeResponseLike {
  status: number;
  json(): Promise<unknown>;
}

export interface ProbeRequestInit {
  headers?: Record<string, string>;
}

export type FetchLike = (url: string, init?: ProbeRequestInit) => Promise<ProbeResponseLike>;

interface EndpointCandidate {
  source: ResolvedDaemonEndpoint["source"];
  value: string;
}

interface ParsedEndpointCandidate {
  source: ResolvedDaemonEndpoint["source"];
  endpoint: string;
}

interface UnsupportedEndpointCandidate {
  source: ResolvedDaemonEndpoint["source"];
  message: string;
}

interface ProbeResult extends DaemonStatusInfo {
  status: "ok" | "unauthorized" | "unreachable";
}

export interface DiscoverDaemonEndpointInput {
  settingEndpoint?: string | null;
  envEndpoint?: string | null;
  configListen?: string | null;
  fetch?: FetchLike;
}

const DEFAULT_ENDPOINT = "127.0.0.1:6767";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeHost(host: string): string {
  const withoutBrackets = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (withoutBrackets === "0.0.0.0" || withoutBrackets === "::" || withoutBrackets === "*") {
    return "127.0.0.1";
  }
  return withoutBrackets.includes(":") ? `[${withoutBrackets}]` : withoutBrackets;
}

function parseHostPort(value: string): { host: string; port: string } | null {
  const urlValue = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `tcp://${value}`;
  try {
    const parsed = new URL(urlValue);
    if (!parsed.hostname || !parsed.port) {
      return null;
    }
    return {
      host: normalizeHost(parsed.hostname),
      port: parsed.port,
    };
  } catch {
    return null;
  }
}

export function parseDaemonEndpointCandidate(
  candidate: EndpointCandidate,
): ParsedEndpointCandidate | UnsupportedEndpointCandidate {
  const value = candidate.value.trim();
  if (
    value.startsWith("/") ||
    value.startsWith("\\\\") ||
    value.startsWith("unix:") ||
    value.startsWith("pipe:") ||
    value.startsWith("ws+unix:")
  ) {
    return {
      source: candidate.source,
      message: "Socket/pipe daemon listen targets are not supported in VS Code v1.",
    };
  }

  const parsed = parseHostPort(value);
  if (!parsed) {
    return {
      source: candidate.source,
      message: `Invalid daemon endpoint: ${value}`,
    };
  }

  return {
    source: candidate.source,
    endpoint: `${parsed.host}:${parsed.port}`,
  };
}

function getStatusInfo(raw: unknown): DaemonStatusInfo {
  if (!isRecord(raw)) {
    return { serverId: null, version: null };
  }
  return {
    serverId: toNonEmptyString(raw.serverId),
    version: toNonEmptyString(raw.version),
  };
}

async function defaultFetch(url: string, init?: ProbeRequestInit): Promise<ProbeResponseLike> {
  return fetch(url, init);
}

export async function probeDaemonStatus(input: {
  endpoint: string;
  password?: string | null;
  fetch?: FetchLike;
}): Promise<ProbeResult> {
  const fetchImpl = input.fetch ?? defaultFetch;
  const headers = input.password ? { Authorization: `Bearer ${input.password}` } : undefined;
  try {
    const response = await fetchImpl(
      `http://${input.endpoint}/api/status`,
      headers ? { headers } : undefined,
    );
    if (response.status === 401) {
      return { status: "unauthorized", serverId: null, version: null };
    }
    if (response.status !== 200) {
      return { status: "unreachable", serverId: null, version: null };
    }
    const info = getStatusInfo(await response.json());
    return { status: "ok", ...info };
  } catch {
    return { status: "unreachable", serverId: null, version: null };
  }
}

export async function validateDaemonPassword(input: {
  endpoint: string;
  password: string;
  fetch?: FetchLike;
}): Promise<boolean> {
  const probe = await probeDaemonStatus({
    endpoint: input.endpoint,
    password: input.password,
    fetch: input.fetch,
  });
  return probe.status === "ok";
}

function addCandidate(
  candidates: EndpointCandidate[],
  source: EndpointCandidate["source"],
  value: string | null | undefined,
): void {
  const trimmed = value?.trim();
  if (!trimmed) {
    return;
  }
  candidates.push({ source, value: trimmed });
}

function createFallback(
  endpoint: string,
  source: ResolvedDaemonEndpoint["source"],
): ResolvedDaemonEndpoint {
  return {
    endpoint,
    source,
    requiresPassword: false,
    available: false,
    serverId: null,
    version: null,
    unsupportedMessage: null,
  };
}

export async function discoverDaemonEndpoint(
  input: DiscoverDaemonEndpointInput,
): Promise<ResolvedDaemonEndpoint> {
  const candidates: EndpointCandidate[] = [];
  addCandidate(candidates, "setting", input.settingEndpoint);
  addCandidate(candidates, "env", input.envEndpoint);
  addCandidate(candidates, "config", input.configListen);
  addCandidate(candidates, "default", DEFAULT_ENDPOINT);

  const seen = new Set<string>();
  let firstParsed: ParsedEndpointCandidate | null = null;
  let firstUnsupported: UnsupportedEndpointCandidate | null = null;

  for (const candidate of candidates) {
    const parsed = parseDaemonEndpointCandidate(candidate);
    if ("message" in parsed) {
      firstUnsupported ??= parsed;
      continue;
    }
    if (seen.has(parsed.endpoint)) {
      continue;
    }
    seen.add(parsed.endpoint);
    firstParsed ??= parsed;

    const probe = await probeDaemonStatus({ endpoint: parsed.endpoint, fetch: input.fetch });
    if (probe.status === "ok" || probe.status === "unauthorized") {
      return {
        endpoint: parsed.endpoint,
        source: parsed.source,
        requiresPassword: probe.status === "unauthorized",
        available: true,
        serverId: probe.serverId,
        version: probe.version,
        unsupportedMessage: null,
      };
    }
  }

  if (!firstParsed && firstUnsupported) {
    return {
      endpoint: DEFAULT_ENDPOINT,
      source: firstUnsupported.source,
      requiresPassword: false,
      available: false,
      serverId: null,
      version: null,
      unsupportedMessage: firstUnsupported.message,
    };
  }

  if (
    firstUnsupported?.source === "config" &&
    !input.settingEndpoint?.trim() &&
    !input.envEndpoint?.trim()
  ) {
    return {
      endpoint: DEFAULT_ENDPOINT,
      source: "config",
      requiresPassword: false,
      available: false,
      serverId: null,
      version: null,
      unsupportedMessage: firstUnsupported.message,
    };
  }

  return firstParsed
    ? createFallback(firstParsed.endpoint, firstParsed.source)
    : createFallback(DEFAULT_ENDPOINT, "default");
}
