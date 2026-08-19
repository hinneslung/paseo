import { describe, expect, it } from "vitest";
import { withMermaidRuntimeCspNonce } from "./csp-nonce";
import { mermaidRuntimeHtml } from "./html.gen";

describe("withMermaidRuntimeCspNonce", () => {
  it("applies the host document nonce to the runtime script", () => {
    expect(withMermaidRuntimeCspNonce(mermaidRuntimeHtml, "webview-nonce")).toContain(
      '<script nonce="webview-nonce">',
    );
  });

  it("leaves the runtime unchanged outside a nonce-protected host", () => {
    expect(withMermaidRuntimeCspNonce("<script>run()</script>")).toBe("<script>run()</script>");
  });

  it("escapes a nonce before placing it in HTML", () => {
    expect(withMermaidRuntimeCspNonce("<script>run()</script>", 'a&"<')).toContain(
      'nonce="a&amp;&quot;&lt;"',
    );
  });
});
