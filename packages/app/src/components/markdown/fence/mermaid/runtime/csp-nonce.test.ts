/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withMermaidRuntimeCspNonce } from "./csp-nonce";
import { mermaidRuntimeHtml } from "./html.gen";

describe("withMermaidRuntimeCspNonce", () => {
  it("applies the host document nonce to the runtime script", () => {
    expect(withMermaidRuntimeCspNonce(mermaidRuntimeHtml, "webview-nonce")).toContain(
      '<script nonce="webview-nonce">',
    );
  });

  it("reads the script nonce through its IDL property", () => {
    const script = document.createElement("script");
    script.setAttribute("nonce", "webview-nonce");
    document.head.append(script);
    expect(document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce).toBe("webview-nonce");
    script.remove();
  });

  it("leaves the runtime unchanged outside a nonce-protected host", () => {
    expect(withMermaidRuntimeCspNonce("<script>run()</script>")).toBe("<script>run()</script>");
  });

  it("escapes a nonce before placing it in HTML", () => {
    expect(withMermaidRuntimeCspNonce("<script>run()</script>", 'a&"<')).toContain(
      'nonce="a&amp;&quot;&lt;"',
    );
  });

  it("keeps inline and fullscreen diagrams on the shared IDL-nonce runtime", () => {
    const mermaidDirectory = path.resolve(import.meta.dirname, "..");
    const inlineSource = readFileSync(path.join(mermaidDirectory, "host.web.tsx"), "utf8");
    const fullscreenSource = readFileSync(
      path.join(mermaidDirectory, "fullscreen-viewer.web.tsx"),
      "utf8",
    );
    const runtimeSource = readFileSync(
      path.join(mermaidDirectory, "iframe-runtime.web.tsx"),
      "utf8",
    );

    for (const source of [inlineSource, fullscreenSource]) {
      expect(source).toContain('from "./iframe-runtime.web"');
      expect(source).toContain("<MermaidIframeRuntime");
    }
    expect(runtimeSource).toContain('querySelector<HTMLScriptElement>("script[nonce]")?.nonce');
    expect(runtimeSource).not.toContain("getAttribute");
    expect(runtimeSource).not.toContain("unsafe-eval");
  });
});
