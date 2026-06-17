# VS Code Extension

The VS Code extension surfaces Paseo agent chat and agent management inside VS
Code. It connects from the VS Code extension host to the Paseo daemon running on
the same machine, WSL environment, SSH host, Codespace, or other remote host
where VS Code is running workspace extensions.

The package contributes a Paseo Activity Bar webview, the `Paseo: Open` panel
command, password management commands, and the `paseo.endpoint` setting.

## Install

The extension is sideload-first for now. Build the `.vsix` from the repo root:

```bash
npm run build:vscode
```

Then install it into VS Code:

```bash
code --install-extension packages/vscode/paseo.vsix
```

For Remote SSH, WSL, and Codespaces, install the extension on the **remote**
host. In VS Code, use the Extensions view and choose the remote install action
such as "Install in WSL" or "Install in SSH". The package declares
`extensionKind: ["workspace"]`, so VS Code runs the extension host where the
workspace lives. That is also where the Paseo daemon and `~/.paseo` state are
expected to live, so installing locally while editing a remote workspace puts the
extension on the wrong side of the daemon boundary.

## Daemon Discovery

The extension resolves the daemon endpoint in the Node extension host before the
webview app starts. Resolution order is:

1. `paseo.endpoint` VS Code setting.
2. `PASEO_VSCODE_ENDPOINT` environment variable.
3. `~/.paseo/config.json` `daemon.listen` value.
4. `127.0.0.1:6767`.

Each candidate is parsed as a TCP host and port, then probed with
`GET /api/status`. The first reachable daemon, including a daemon that returns
`401` because it requires a password, wins. If no candidate is reachable, the
first valid candidate is still used as the fallback endpoint for the webview.

The extension dials the resolved listen host. It does not rewrite a concrete LAN
IP to loopback; for example, `192.168.1.50:6767` remains
`192.168.1.50:6767`. VS Code v1 supports TCP daemon listens only. Socket and
pipe listen targets such as Unix sockets, Windows pipes, `unix:`, `pipe:`, and
`ws+unix:` are rejected as unsupported.

## Password Handling

If the daemon responds with `401`, the extension prompts for the daemon password
and stores it in VS Code `SecretStorage`, keyed by endpoint. Users can manage the
stored secret with these commands:

- `Paseo: Set Daemon Password`
- `Paseo: Clear Daemon Password`

The plaintext password stays in the Node extension host. It is used there to
validate the password and authenticate the daemon WebSocket connection; it is not
written into the webview HTML, runtime config, or postMessage payloads.

## VS Code-Owned Surfaces

The extension intentionally does not provide Paseo's duplicate workspace
surfaces when VS Code already owns them:

- File explorer
- Git changes
- Diff view
- Browser pane
- Voice and dictation

Chat file links open in the VS Code editor, including line navigation when a
line is present.

## Known Limitations

Dragging files from the OS or VS Code Explorer into chat works through standard
`text/uri-list` file drops. Dragging a VS Code editor tab into chat is not
supported. VS Code does not expose a supported webview API for editor-tab drag
payloads, and `microsoft/vscode#111092` is out of scope for this extension.

Socket and pipe daemon listen targets are not supported in VS Code v1. Use a TCP
listen target for the daemon endpoint.

## Security Model

Treat the webview as untrusted input to the Node extension host. Agent output and
daemon content can reach the React UI, so the bridge avoids turning webview
postMessage into an unbounded local primitive.

The bridge pins daemon transport connections to the Node-resolved endpoint and
ignores any endpoint supplied by the webview. `opener.openUrl` only accepts
`http:`, `https:`, and `mailto:` URLs. Attachment copy commands only accept
source files with supported raster image extensions. The
`PASEO_VSCODE_TEST_PASSWORD` automation seam is ignored in production extension
mode. The daemon password never enters the webview.

## Developer Notes

The extension bundles the Expo web app from `packages/app/dist` into
`packages/vscode/media/app-dist`, then serves it inside one VS Code webview
document. `webview-host.ts` rewrites the static asset URLs into same-origin VS
Code webview resource URIs and injects a small runtime config plus
`dist/webview-bootstrap.js`.

Inside the webview, the bootstrap script installs a `window.paseoDesktop` shim.
The app calls that shim the same way it calls the Electron desktop bridge. The
shim sends `postMessage` invocations to the Node extension host, where
`BridgeRouter` handles the local daemon WebSocket proxy and the editor, opener,
dialog, and attachment bridge commands.

When app web assets change, rebuild `packages/app/dist` and copy it into the
extension. From `packages/vscode`, run:

```bash
npm run copy:app-dist
```

From the repo root, `npm run build:vscode` performs the app web build, copies
`app-dist`, builds the extension/preload bundles, and packages `paseo.vsix`.

`packages/vscode/scripts/cdp-debug.mjs` launches a real VS Code instance with the
development extension and connects Playwright over CDP. Useful environment knobs
include `PASEO_VSCODE_ENDPOINT`, `PASEO_VSCODE_TEST_PASSWORD`, `PASEO_CDP_PORT`,
`PASEO_CDP_WORKSPACE`, `PASEO_CDP_RESIZE_PROBE`, `PASEO_CDP_EDITOR_PROBE`,
`PASEO_CDP_EDITOR_PROBE_LINE`, `PASEO_CDP_DIALOG_PROBE`, and
`PASEO_CDP_PICK_IMAGE_PROBE`.

The package also has an `@vscode/test-electron` smoke test at
`src/test/run-vscode-smoke.mjs`. Test VS Code must launch as Electron, not as a
Node child process. Delete `ELECTRON_RUN_AS_NODE` before launching VS Code; the
smoke test and CDP harness do this explicitly.
