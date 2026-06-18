# VS Code Extension CI & E2E Plan

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

- **Triggers:** `push` / `pull_request` on `branches: [main]`, plus
  `merge_group` (so the merge queue gates on it) and `workflow_dispatch`.
- **No `paths:` filter.** `ci.yml` does not use them, and `paths` combined with
  `merge_group` can hang the merge queue (a path-filtered required check that
  never runs in the queue blocks the merge).
- **Concurrency:** `ci-${{ github.workflow }}-${{ github.ref }}`,
  `cancel-in-progress` on pull requests.
- **Shared install:** a `.github/actions/npm-install` composite action wraps the
  Electron-retry `npm ci` (bash + pwsh) so the loop is defined once instead of
  copy-pasted per job.

### Jobs

| Job            | Runner(s)                     | Purpose                                                            |
| -------------- | ----------------------------- | ------------------------------------------------------------------ |
| `vscode-build` | ubuntu                        | `build:vscode`, typecheck, vitest unit tests, upload VSIX artifact |
| `vscode-smoke` | ubuntu **+ windows** (matrix) | Layers 1 + 2: real-VS-Code smoke against a real in-process daemon  |
| `vscode-e2e`   | ubuntu (windows optional)     | Layer 3: Playwright/CDP workspace-open + file-link specs           |

## Why these tests: the regression map

The recent extension regressions all sit at the **extension ↔ app ↔ daemon
bridge** boundary or in **platform path handling** — exactly the seams unit
tests miss. Each e2e layer exists to guard a class of regression we already
shipped:

| Commit     | Regression                                                                                                                      | Guarded by                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `da0be24d` | `~/.paseo/config.json` never expanded on Windows (`path.sep` is `\`) → discovery fell back to 127.0.0.1, LAN daemon unreachable | Layer 2 bridge round-trip **on Windows** |
| `a46672ad` | Folder unknown to daemon → startup splash hangs forever                                                                         | Layer 3 workspace-open spec              |
| `517948bf` | Assistant links to hidden dot-paths (`.github/...`) did not resolve                                                             | Layer 3 file-link-click spec             |
| `455e18d5` | Wrong left-nav panel state on first open                                                                                        | Layer 1 smoke ("first open renders")     |

## E2E layers

### Layer 1 — extension-host smoke (CI: ubuntu + windows)

Runs the existing `@vscode/test-electron` smoke
([run-vscode-smoke.mjs](../packages/vscode/src/test/run-vscode-smoke.mjs) →
[vscode-smoke.ts](../packages/vscode/src/test/vscode-smoke.ts)): launches real
VS Code headless, activates the extension, opens the Paseo webview, and asserts
the webview HTML, CSP, runtime config, and bootstrap script. Catches activation,
render, and first-open-state regressions. Windows coverage also catches
Electron-launch / path issues.

- **Linux:** wrap in `xvfb-run` if the existing `--headless
--ozone-platform=headless` flags are insufficient (the previous CI skipped the
  smoke citing a display requirement — verify which is needed).
- Cache the `@vscode/test-electron` VS Code download; upload logs on failure.

### Layer 2 — bridge round-trip vs a real daemon (CI: ubuntu + windows)

Highest regression value. Boot a real Paseo daemon on `127.0.0.1` with a known
password, write a `config.json` at the home path, then run the smoke with
`PASEO_VSCODE_TEST_PASSWORD` set so `runBridgeRoundTrip`
([vscode-smoke.ts](../packages/vscode/src/test/vscode-smoke.ts)) executes. This
exercises **config discovery (the `~` expansion path) + the transport handshake
end-to-end**, and on Windows it directly guards the `da0be24d` class.

- Reuse the harness in [ad-hoc-daemon-testing.md](ad-hoc-daemon-testing.md) to
  boot the daemon.
- The Windows fixture must write `%USERPROFILE%\.paseo\config.json` exactly as
  `expandHomePath` resolves it — do not paper over the path under test.
- Add an explicit "discovery reads config → server_info round-trip" assertion.

### Layer 3 — workspace-open + file-link e2e (CI: ubuntu; windows optional)

Promote the manual CDP harnesses into deterministic Playwright specs running
against the in-process daemon:

- [cdp-screenshot.mjs](../packages/vscode/scripts/cdp-screenshot.mjs) → spec:
  open VS Code on a fresh folder unknown to the daemon, assert the app leaves
  the splash and reaches a workspace (guards `a46672ad`).
- [cdp-filelink-click.mjs](../packages/vscode/scripts/cdp-filelink-click.mjs) →
  spec: seed an agent message linking a `.github/...` dot-path, click it, assert
  VS Code opens the file (guards `517948bf`).

These need seeded, deterministic fixtures (a known workspace + a pre-seeded
agent message) rather than the live LAN daemon the manual scripts assume. Mirror
the `playwright` job's "upload artifacts on failure".

## Implementation order

1. **WS1 — structure.** `.github/actions/npm-install` composite; rewrite
   `vscode.yml` (aligned triggers, three jobs, adopt composite).
2. **WS2 — Layer 1 in CI.** `vscode-smoke` matrix; resolve xvfb vs headless;
   cache VS Code download; upload logs on failure.
3. **WS3 — Layer 2.** CI helper to boot a daemon + write `config.json`; wire
   `PASEO_VSCODE_TEST_PASSWORD`; add discovery-from-config assertion. Front-load
   attention here — highest value, riskiest plumbing (Windows home-path layout).
4. **WS4 — Layer 3.** Convert the two CDP scripts to deterministic Playwright
   specs; upload artifacts on failure. Heaviest lift, so last.
5. **WS5 — docs.** Keep this doc and [testing.md](testing.md) current.

## Risk flags

- Does `@vscode/test-electron` run displayless on Linux with the ozone flags, or
  is `xvfb-run` still required? The prior CI skip suggests a display was the
  blocker.
- Windows home-path layout for `config.json` must match `expandHomePath` output
  — that path is the thing under test.
- CDP specs need deterministic fixtures, not the manual scripts' live LAN daemon.
