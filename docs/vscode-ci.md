# VS Code Extension CI & E2E

How the VS Code extension is built, tested, and guarded against regression in
CI. This is the source of truth for the `vscode.yml` workflow shape and the
end-to-end test layers. Code-level facts live next to the code; this doc holds
the system/process decisions.

## Workflow organization

The repo convention: one big [ci.yml](../.github/workflows/ci.yml) holds **all**
per-package test jobs; standalone workflow files are reserved for **deploy /
release** concerns. The VS Code extension is the deliberate exception — it keeps
a **dedicated `vscode.yml`** so it remains an isolated, separately-required
status check that iterates independently of the main suite.

Because it is standalone, `vscode.yml` must still match `ci.yml`'s conventions:

- **Triggers:** `push` / `pull_request` on `branches: [main, vscode-extension]`,
  plus `merge_group` (so the merge queue gates on it) and
  `workflow_dispatch`. `vscode-extension` is transitional; narrow this back to
  `main` once the extension lands there.
- **No `paths:` filter.** `ci.yml` does not use them, and `paths` combined with
  `merge_group` can hang the merge queue (a path-filtered required check that
  never runs in the queue blocks the merge).
- **Concurrency:** `ci-${{ github.workflow }}-${{ github.ref }}`,
  `cancel-in-progress` on pull requests.
- **Shared install:** a `.github/actions/npm-install` composite action wraps the
  Electron-retry `npm ci` for bash and pwsh, so the cross-platform retry loop is
  defined once instead of copy-pasted per job.

## Publish workflow

`.github/workflows/vscode-publish.yml` is a deploy workflow, not part of the
required test gate. It publishes `packages/vscode` from namespaced extension tags
like `vscode-v0.1.0`, keeping the extension's independent version track separate
from the monorepo's `v*` release tags.

Publish tags must satisfy all of the workflow's guards:

- The tag name matches `vscode-v*` and the concrete package version in
  `packages/vscode/package.json`.
- The tagged commit is reachable from `origin/vscode-extension`.
- The `marketplace` environment is approved by a human before `vsce publish`
  receives `VSCE_PAT`.

Use a tag push for extension releases. `workflow_dispatch` exists only to rerun a
specific already-created `vscode-v*` tag through the same validation path.

### Jobs

| Job            | Runner(s)                     | Purpose                                                                      |
| -------------- | ----------------------------- | ---------------------------------------------------------------------------- |
| `vscode-build` | ubuntu                        | `build:vscode`, extension typecheck, vitest unit tests, upload VSIX artifact |
| `vscode-smoke` | ubuntu **+ windows** (matrix) | Layers 1 + 2: real-VS-Code smoke plus daemon bridge round-trip               |
| `vscode-e2e`   | ubuntu                        | Layer 3: Playwright/CDP workspace-open spec against a real daemon            |

## Why these tests: the regression map

The recent extension regressions all sit at the **extension ↔ app ↔ daemon
bridge** boundary or in **platform path handling** — exactly the seams unit
tests miss. Each e2e layer exists to guard a class of regression we already
shipped:

| Commit     | Regression                                                                                                                      | Guarded by                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `da0be24d` | `~/.paseo/config.json` never expanded on Windows (`path.sep` is `\`) → discovery fell back to 127.0.0.1, LAN daemon unreachable | Layer 2 bridge round-trip **on Windows** |
| `a46672ad` | Folder unknown to daemon → startup splash hangs forever                                                                         | Layer 3 workspace-open spec              |
| `517948bf` | Assistant links to hidden dot-paths (`.github/...`) did not resolve                                                             | Layer 3 file-link-click spec (deferred)  |
| `455e18d5` | Wrong left-nav panel state on first open                                                                                        | Layer 1 smoke ("first open renders")     |
| (v0.1.4)   | macOS Cmd+A/C/V dead in composer — react-native-web swallows keydown before VS Code's webview key forwarder                     | Layer 3 editing-shortcuts probe          |

## E2E layers

### Layer 1 — extension-host smoke (CI: ubuntu + windows)

Runs inside `vscode-smoke` through
[run-smoke-with-daemon.mjs](../packages/vscode/scripts/run-smoke-with-daemon.mjs),
which invokes the existing `@vscode/test-electron` smoke
([run-vscode-smoke.mjs](../packages/vscode/src/test/run-vscode-smoke.mjs) →
[vscode-smoke.ts](../packages/vscode/src/test/vscode-smoke.ts)). The smoke
launches real VS Code, activates the extension, opens the Paseo webview, and
asserts the webview HTML, CSP, runtime config, and bootstrap script. This catches
activation, render, and first-open-state regressions. Windows coverage also
catches Electron-launch and path issues.

Linux runs the smoke under `xvfb-run -a`; Windows runs the same script directly.
The job caches the `@vscode/test-electron` VS Code download at
`packages/vscode/.vscode-test`.

### Layer 2 — bridge round-trip vs a real daemon (CI: ubuntu + windows)

Also runs inside `vscode-smoke`. The wrapper
[run-smoke-with-daemon.mjs](../packages/vscode/scripts/run-smoke-with-daemon.mjs)
uses the shared
[daemon-harness.mjs](../packages/vscode/scripts/lib/daemon-harness.mjs) helper to
boot a real password-protected Paseo daemon on `127.0.0.1:6788`. The helper
writes `~/.paseo/config.json` with the daemon listen target and starts the daemon
with `PASEO_PASSWORD` set. The wrapper then runs the smoke with
`PASEO_VSCODE_TEST_PASSWORD` set so `runBridgeRoundTrip`
([vscode-smoke.ts](../packages/vscode/src/test/vscode-smoke.ts)) executes.

This exercises **config discovery (the `~` expansion path) + the authenticated
transport handshake end-to-end** on Linux and Windows. Windows directly guards
the `da0be24d` class because the fixture writes the real home-relative config
path that `expandHomePath` must resolve.

### Layer 3 — workspace-open + file-link e2e (CI: ubuntu)

Runs in `vscode-e2e` via
[vscode-e2e.mjs](../packages/vscode/scripts/vscode-e2e.mjs). The script launches
real VS Code, connects Playwright over CDP with `connectOverCDP`, and runs
against a real password-protected daemon from the shared daemon harness.

Spec 1, **workspace-open**, is implemented and deterministic: open VS Code on a
fresh folder unknown to the daemon, assert the app leaves the splash, and assert
the workspace rendered. It uses the `startup-splash`, `workspace-header-title`,
`message-input-root`, and `workspace-tabs-row` `data-testid` markers, and treats
the workspace as ready when the splash is gone and any core workspace chrome is
present. This guards `a46672ad`.

Spec 2, **file-link click**, is deferred with `TODO(WS4 spec2)` in the spec. It
needs a deterministic way to seed an agent timeline fixture through the daemon's
supported persistence/API; guessing private agent JSON would make CI flaky. The
manual [cdp-filelink-click.mjs](../packages/vscode/scripts/cdp-filelink-click.mjs)
harness remains useful for ad-hoc local debugging, but it is not a CI gate.

The job uploads `packages/vscode/artifacts/vscode-e2e` on failure.

## Implementation order

1. **WS1 — done.** `.github/actions/npm-install` composite; `vscode.yml` has
   aligned triggers, three jobs, and the shared install action.
2. **WS2 — done.** `vscode-smoke` runs on ubuntu and windows; Linux uses
   `xvfb-run -a`; the VS Code test download is cached.
3. **WS3 — done.** The daemon helper boots a password-protected daemon, writes
   `~/.paseo/config.json`, wires `PASEO_PASSWORD`, and the smoke wires
   `PASEO_VSCODE_TEST_PASSWORD` for the bridge round-trip.
4. **WS4 — done for the current CI gate.** `vscode-e2e` runs the CDP/Playwright
   harness on ubuntu and implements the deterministic workspace-open spec with
   failure artifacts.
5. **Remaining.** Add Spec 2 once a supported deterministic agent timeline
   fixture exists, and optionally add Windows coverage for Layer 3 after proving
   the CDP workflow is stable there.
6. **Docs.** Keep this doc and [testing.md](testing.md) current as the remaining
   items land.

## Risk flags

- Linux display is resolved by using `xvfb-run -a` for both smoke and Layer 3;
  keep that wrapper unless a replacement is proven in CI.
- Windows home-path layout for `config.json` is covered by Layer 2. Do not move
  the fixture away from `~/.paseo/config.json`; that path is the thing under
  test.
- The deferred file-link spec still needs a supported deterministic agent
  timeline fixture, not the manual scripts' live LAN daemon or guessed private
  JSON.
- Optional Windows coverage for Layer 3 remains unproven and should be added only
  after validating VS Code CDP stability on the Windows runner.

## CI gotchas

- The smoke/e2e daemon harness spawns the worker entry directly:
  `node packages/server/dist/server/server/daemon-worker.js` with
  `PASEO_HOME`, `PASEO_LISTEN`, `PASEO_PASSWORD`,
  `PASEO_LOCAL_SPEECH_AUTO_DOWNLOAD=0`, `PASEO_DICTATION_ENABLED=0`,
  `PASEO_VOICE_MODE_ENABLED=0`, and `ONNXRUNTIME_NODE_INSTALL=skip`. Do not use
  `paseo daemon start`: `--foreground` exits code 0 almost immediately, and the
  detached start discards worker stderr so health cannot be detected. Running the
  worker directly serves `/api/health` in about 1s and logs to stdout; it requires
  `npm run build:server` first so the worker dist exists.
- In `packages/vscode/scripts/vscode-e2e.mjs` `openPaseo`, headless CI renders
  the webview reliably only after revealing the activity-bar Paseo view by
  clicking the `.activitybar` item whose `aria-label` contains `paseo`. Drive the
  command palette with real keystrokes after `Ctrl+Shift+P`:
  `keyboard.type("Paseo: Open")`; do not use Playwright `fill()`, which clobbers
  the `>` command prefix and can leave Enter unable to activate the highlighted
  command.
- On `app-frame-not-found`, start with
  `packages/vscode/artifacts/vscode-e2e/frame-report.json` and the screenshot.
  The report lists every frame URL plus whether `window.paseoVscode` and `#root`
  are present.
