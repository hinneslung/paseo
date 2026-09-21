import { build } from "esbuild";

const shared = {
  bundle: true,
  logLevel: "info",
  sourcemap: true,
  target: "es2022",
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    external: ["vscode"],
  }),
  build({
    ...shared,
    entryPoints: ["src/webview-preload/bootstrap.ts"],
    outfile: "dist/webview-bootstrap.js",
    platform: "browser",
    format: "iife",
    globalName: "PaseoVscodeBootstrap",
  }),
  build({
    ...shared,
    entryPoints: ["src/test/vscode-smoke.ts"],
    outfile: "dist/test/vscode-smoke.js",
    platform: "node",
    format: "cjs",
    external: ["vscode"],
  }),
]);
