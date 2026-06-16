export interface VscodeRuntimeConfig {
  endpoint: string | null;
  hasPassword: boolean;
  bridgeProtocol: number;
  workspaceFolders: string[];
}

export interface BuildWebviewHtmlInput {
  indexHtml: string;
  toWebviewUri: (assetPath: string) => string;
  cspSource: string;
  nonce: string;
  bootstrapUri: string;
  runtimeConfig: VscodeRuntimeConfig;
}

const LOCAL_ASSET_PREFIXES = ["/_expo/", "/assets/", "/favicon", "/manifest.json"];
const RELATIVE_ASSET_PREFIXES = ["_expo/", "assets/", "favicon", "manifest.json"];

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function splitAssetUrl(value: string): { path: string; suffix: string } {
  const separatorIndex = value.search(/[?#]/);
  if (separatorIndex === -1) {
    return { path: value, suffix: "" };
  }
  return {
    path: value.slice(0, separatorIndex),
    suffix: value.slice(separatorIndex),
  };
}

function isRewriteableAssetPath(path: string): boolean {
  if (LOCAL_ASSET_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return true;
  }
  if (path.startsWith("/") && /\.[a-z0-9]+$/i.test(path)) {
    return true;
  }
  return RELATIVE_ASSET_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function normalizeAssetPath(path: string): string {
  if (path.startsWith("./")) {
    return normalizeAssetPath(path.slice(2));
  }
  return path.replace(/^\/+/, "");
}

function rewriteAssetUrl(value: string, toWebviewUri: (assetPath: string) => string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }
  if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(trimmed)) {
    return value;
  }

  const { path, suffix } = splitAssetUrl(trimmed);
  const pathWithoutDot = path.startsWith("./") ? path.slice(2) : path;
  if (!isRewriteableAssetPath(path) && !isRewriteableAssetPath(pathWithoutDot)) {
    return value;
  }

  return `${toWebviewUri(normalizeAssetPath(path))}${suffix}`;
}

function rewriteAssetAttributes(html: string, toWebviewUri: (assetPath: string) => string): string {
  return html.replace(
    /\b(src|href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (
      match,
      attribute: string,
      _rawValue: string,
      doubleQuoted?: string,
      singleQuoted?: string,
      bare?: string,
    ) => {
      let quote = "";
      if (doubleQuoted !== undefined) {
        quote = '"';
      } else if (singleQuoted !== undefined) {
        quote = "'";
      }
      const value = doubleQuoted ?? singleQuoted ?? bare ?? "";
      const rewritten = rewriteAssetUrl(value, toWebviewUri);
      if (rewritten === value) {
        return match;
      }
      if (!quote) {
        return `${attribute}=${escapeAttribute(rewritten)}`;
      }
      return `${attribute}=${quote}${escapeAttribute(rewritten)}${quote}`;
    },
  );
}

function removeExistingCsp(html: string): string {
  return html.replace(/<meta\s+[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>\s*/i, "");
}

function serializeRuntimeConfig(config: VscodeRuntimeConfig): string {
  return JSON.stringify(config).replace(/</g, "\\u003c");
}

function buildCsp(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `base-uri ${cspSource}`,
    `img-src ${cspSource} https: data: blob:`,
    `font-src ${cspSource} data:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src ${cspSource} 'nonce-${nonce}'`,
    `connect-src ${cspSource} https:`,
  ].join("; ");
}

function injectHeadTags(html: string, headTags: string): string {
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (headTag) => `${headTag}\n${headTags}`);
  }
  return `${headTags}\n${html}`;
}

function injectBeforeAppScripts(html: string, scripts: string): string {
  const firstScriptIndex = html.search(/<script\b/i);
  if (firstScriptIndex !== -1) {
    return `${html.slice(0, firstScriptIndex)}${scripts}\n${html.slice(firstScriptIndex)}`;
  }
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${scripts}\n</body>`);
  }
  return `${html}\n${scripts}`;
}

export function buildWebviewHtml(input: BuildWebviewHtmlInput): string {
  const assetHtml = rewriteAssetAttributes(input.indexHtml, input.toWebviewUri);
  const html = removeExistingCsp(assetHtml);
  const csp = buildCsp(input.cspSource, input.nonce);
  // NOTE: we deliberately do NOT inject a <base href> pointing at the asWebviewUri
  // resource origin. Doing so makes Expo Router resolve browser-history URLs against
  // that cross-origin base and call history.replaceState() with a URL whose origin
  // differs from the webview document origin (vscode-webview://...), which throws and
  // halts the React mount. Asset <script>/<link> tags are already rewritten to absolute
  // resource URLs, so no base is needed for them.
  const headTags = [
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">`,
  ].join("\n");
  const withHeadTags = injectHeadTags(html, headTags);
  const scripts = [
    `<script nonce="${escapeAttribute(input.nonce)}">window.paseoVscode = ${serializeRuntimeConfig(input.runtimeConfig)};</script>`,
    `<script nonce="${escapeAttribute(input.nonce)}" src="${escapeAttribute(input.bootstrapUri)}"></script>`,
  ].join("\n");
  return injectBeforeAppScripts(withHeadTags, scripts);
}
