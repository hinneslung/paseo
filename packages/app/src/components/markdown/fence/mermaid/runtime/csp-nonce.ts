const HTML_ATTRIBUTE_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  '"': "&quot;",
  "'": "&#39;",
  "<": "&lt;",
  ">": "&gt;",
};

export function withMermaidRuntimeCspNonce(html: string, nonce?: string): string {
  if (!nonce) {
    return html;
  }
  const escapedNonce = nonce.replace(/[&"'<>]/g, (character) => HTML_ATTRIBUTE_ESCAPE[character]);
  return html.replace("<script>", `<script nonce="${escapedNonce}">`);
}
