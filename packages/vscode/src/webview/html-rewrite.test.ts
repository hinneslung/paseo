import { describe, expect, it } from "vitest";
import { buildWebviewHtml } from "./html-rewrite";

describe("buildWebviewHtml", () => {
  it("rewrites bundled assets and injects the VS Code bootstrap before app scripts", () => {
    const html = buildWebviewHtml({
      indexHtml: `<!doctype html>
<html>
  <head>
    <link rel="icon" href="/favicon.png">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <link rel="stylesheet" href="/_expo/static/css/main.css">
  </head>
  <body>
    <img src="/assets/logo.png">
    <script src="/_expo/static/js/main.js"></script>
  </body>
</html>`,
      toWebviewUri: (assetPath) => `vscode-webview://paseo/${assetPath}`,
      cspSource: "vscode-webview://paseo",
      nonce: "test-nonce",
      bootstrapUri: "vscode-webview://paseo/dist/webview-bootstrap.js",
      runtimeConfig: {
        endpoint: "127.0.0.1:6768",
        hasPassword: false,
        bridgeProtocol: 1,
        workspaceFolders: ["/workspace/paseo"],
      },
    });

    // No <base href> is injected: it would make Expo Router write cross-origin history URLs.
    expect(html).not.toContain("<base href");
    expect(html).toContain('href="vscode-webview://paseo/favicon.png"');
    expect(html).toContain('href="vscode-webview://paseo/apple-touch-icon.png"');
    expect(html).toContain('href="vscode-webview://paseo/_expo/static/css/main.css"');
    expect(html).toContain('src="vscode-webview://paseo/assets/logo.png"');
    expect(html).toContain('src="vscode-webview://paseo/_expo/static/js/main.js"');
    expect(html).toContain(
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; base-uri vscode-webview://paseo;',
    );
    expect(html).toContain("script-src vscode-webview://paseo 'nonce-test-nonce'");
    expect(html).toContain(
      '<script nonce="test-nonce">window.paseoVscode = {"endpoint":"127.0.0.1:6768","hasPassword":false,"bridgeProtocol":1,"workspaceFolders":["/workspace/paseo"]};</script>',
    );
    expect(html).toContain(
      '<script nonce="test-nonce" src="vscode-webview://paseo/dist/webview-bootstrap.js"></script>',
    );
    expect(html.indexOf("window.paseoVscode")).toBeLessThan(html.indexOf("/_expo/static/js"));
  });
});
