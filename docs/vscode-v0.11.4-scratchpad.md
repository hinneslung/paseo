# VS Code v0.11.4 round scratchpad

PIC: **Biru**. Source of truth: [the plan](vscode-v0.11.4-plan.md).

## Current state

- Base: `origin/vscode-extension` `ba307199d`, tagged locally `vscode-extension-pre-v0.11.4`.
- Target: upstream `v0.11.4` `dc5b02f7d` (`refs/tags/upstream-release/v0.11.4`).
- Phase: QA complete; PR preparation.

## Worktrees

Paseo-managed worktrees under project `hinneslung/paseo`:

| Workspace              | Path                                                          | Branch                    | Owner  |
| ---------------------- | ------------------------------------------------------------- | ------------------------- | ------ |
| `wks_221577fa487b0192` | `/home/hinnes/.paseo/worktrees/0hezhjfw/vscode-v0114-app`     | `work/vscode-v0.11.4-app` | Fattie |
| `wks_15e23f92005f390f` | `/home/hinnes/.paseo/worktrees/0hezhjfw/vscode-v0114-ext`     | `work/vscode-v0.11.4-ext` | Taco   |
| `wks_8a87d08bdb3bd086` | `/home/hinnes/.paseo/worktrees/0hezhjfw/vscode-v0114-release` | `release/vscode-v0.11.4`  | Biru   |

The first dispatch used manually added worktrees registered as separate projects. The user
asked for workspaces under this project; both agents were stopped, their uncommitted work
saved as `wip(...)` commits (`4f784cb21`, `c15f86ca0`, hooks skipped), and the strays removed.
Re-dispatched in the new workspaces: Fattie `96f3509b`, Taco `9a59c3b5`.

## Progress

| Item        | Owner        | Status                                                                                    | Evidence                                                                                                                     |
| ----------- | ------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| M1–M10 app  | Fattie       | M1–M9 committed (`ba6c44ea5`..`975a23c6b`); M10 in progress                               |                                                                                                                              |
| M11–M14 ext | Taco         | done: M11 `8c2e97634`, M12 `95be3730e`, M13 `1e4f0aa7b`, M14 `de5bdec0d`                  | ext vitest 65/65, ext typecheck, ci-workflow 12/12; commits used `LEFTHOOK=0` (hook typecheck recurses; checks run manually) |
| Integration | Biru         | pre-fix stack built on `release/vscode-v0.11.4` (VSIX 5.47 MB); final rebuild after fixes | build log `/tmp/v0114-build.log`                                                                                             |
| Review      | Pillow, Coco | Pillow `70f7b237` reviewing M1–M9; Coco `becbfd7f` reviewing M11–M14                      |                                                                                                                              |
| CDP QA      | Biru         | pass (local WSLg; GUI runs moved to VM/CI after user request)                             | `final-verify/`                                                                                                              |
| Windows CUA | Biru         | pass except OS file drop (unverified)                                                     | screenshots/vscode-v0.11.4                                                                                                   |
| PR and CI   | Biru         | pending                                                                                   |                                                                                                                              |

## CUA trial (2026-10-16, before implementation)

Released 0.8.0 VSIX on VS Code 1.124.2 in the Win11 VM, scratch 0.8.0 daemon on
`127.0.0.1:18761`. The Paseo view connected and opened an unknown folder as a usable
workspace; composer typing landed after a foreground click. Background keystrokes
were dropped. The VS Code window ran as Administrator.

## Review ledger

R1: Pillow `70f7b237` on M1–M9 (static), Coco `becbfd7f` on M11–M14 (static, M14 tests run).
Coco: M11, M12, M13 clean; M14 security verified (password stays host-side, webview cannot
override auth, endpoint or bearer subprotocol).

| ID  | Finding                                                         | Sev   | Decision    | Reason                                                                  |
| --- | --------------------------------------------------------------- | ----- | ----------- | ----------------------------------------------------------------------- |
| C1  | M14 JSON-parses every outbound frame                            | major | accept now  | Inspect only until the first hello per session; daemon rejects a second |
| C2  | M14 fixed probe session id; probe skips the factory seam        | minor | accept now  | Concurrent prompts report a correct password as wrong                   |
| C3  | Non-token passwords cannot work against pre-hello.auth daemons  | minor | accept docs | Not a regression; document the daemon requirement                       |
| P1  | M3 bridge-only rekey rejected when destination profile exists   | major | accept now  | Inherited from fork, but M3 owns identity recovery; reuse move path     |
| P2  | M6 restored Explorer holding a PR survives sanitize, defeats D4 | major | accept now  | D4 is new this round                                                    |
| P3  | M8 drop mention can overwrite unpublished composer text         | minor | accept now  | Data loss; read live input first                                        |
| P4  | M2 bridge clients inherit renderer `host.password`              | minor | accept now  | App-side contract: bridge auth belongs to the extension host            |
| P5  | M8 outside-workspace image URI drop yields nothing              | minor | defer       | Inherited from the 0.8.0 fork, not a regression                         |

Fixes dispatched as autosquashed fixups: P1–P4 to Fattie, C1–C3 to Taco.

R2 (Pillow, static, through `82ab9a84d`): P1, P3, P4 fixed with real-path regressions; P2's
original case fixed; M10 matches the fork (width gate removed, zero offsets); M10b reachable
(`workspaceId` optional on the wire; legacy subscription routes terminals by cwd).

| ID  | Finding                                                                                                        | Sev   | Decision   | Reason                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------- | ----- | ---------- | ------------------------------------------------------------------------------------------------- |
| P6  | M6 restore with hidden `main` drops Explorer's supported tabs                                                  | major | accept now | Data loss introduced by the P2 fix this round                                                     |
| P6b | M6 fallback reachable (hidden main + visible secondary); retained Explorer renders or is revealed by a PR open | major | accept now | Exposes a hidden surface; fix destination choice and gate Explorer rendering/PR reveal in VS Code |

R3 (Pillow): P6's two data-loss cases fixed in M6 `fc3f8c2d3` (real `persist.rehydrate()` tests);
M7–M10b unchanged by range-diff. P6b dispatched to Fattie with a defense-in-depth requirement.

R4 (Pillow): P6b closed in M6 `82582fda5` — only visible ordinary destinations; Explorer
removed only after every move; VS Code-only render gate in `split-container.tsx`; stale
Explorer evacuated on explicit PR open. Covered through real `persist.rehydrate()` +
`openTab`. M7–M10b `=` by range-diff. No open app findings.

Final app stack: M1 `ba6c44ea5`, M2 `96e115e56`, M3 `ef0ad507f`, M4 `5d32d1d39`,
M5 `531d98736`, M6 `82582fda5`, M7 `ecba9a570`, M8 `d47064230`, M9 `bb6c555a4`,
M10 `193ec6c0b`, M10b `7d44c0613`. Final extension stack: M11 `5eb155c24`, M12 `582b04282`,
M13 `4ce583418`, M14 `9cfc02370`. Integrated on `release/vscode-v0.11.4` with Biru's
`test(vscode): add Windows VM CUA smoke kit` (`e2ce86fb3`). Coco reviewing the
integrated branch.

R-final (Coco, integrated `e2ce86fb3`, static): app↔extension contracts clean (bridge auth
split, endpoint pinning, runtime config shape, editor-open verbs, attachment commands, drop
split order); CSP clean; modularity clean (no app commit touches `packages/vscode/`, no
extension commit touches `packages/app/`); kit safe.

| ID  | Finding                                                     | Sev   | Decision   | Reason                                                         |
| --- | ----------------------------------------------------------- | ----- | ---------- | -------------------------------------------------------------- |
| C4  | Kit `stage.sh` assumes the VM SSH shell is cmd              | minor | accept now | Fail fast on an unexpanded `%USERPROFILE%`; amended kit commit |
| C5  | 1-based line contract app→extension is implicit, not tested | minor | defer      | No defect; CDP e2e and VM link both open the right line        |

Taco closed C1–C3: M13 `0ac6eb69a`, M14 `6c1adc530` (M11 `8c2e97634`, M12 `95be3730e`
unchanged). `helloHandled` per session stops parsing after the first hello; probe ids are
unique and the prompt passes `webSocketFactory`; docs state the daemon requirement for
non-token passwords. Extension vitest 11 files / 68 tests, typecheck, lint and format clean
(fixups with `LEFTHOOK=0`, hook jobs run manually). Biru inspected the `de5bdec0d..6c1adc530`
delta and accepts C1–C3 as closed.

Fattie closed P1–P4 (autosquashed): M1 `ba6c44ea5`, M2 `96e115e56`, M3 `ef0ad507f`,
M4 `5d32d1d39`, M5 `531d98736`, M6 `adf2c337b`, M7 `4b9e7121e`, M8 `5a78d6f8a`,
M9 `8ecc0ca32`, M10 `a8b1e2ebf`, M10b `82ab9a84d`. App typecheck green at every commit;
focused suites pass; branch lint/format clean. Pillow R2 (fix verification + M10/M10b)
dispatched; Fattie investigating I1.

## Integration findings

- I1 (pre-fix build, local CDP e2e, VS Code 1.124.2 on WSLg): workspace-open and
  editing-shortcuts passed. The rich-transcript spec timed out in `openSeededAgent`: after the
  harness pushes `?open=agent:<id>` and dispatches popstate, the agent tab opens but the webview
  URL keeps `?open=` for 12 s+ (probe `/home/hinnes/projects/vscode-v0114-round/_probe-open.mjs`).
  0.8.0 stripped it. Fattie's root cause: upstream v0.11.4 plain web reproduces it — the
  route consumes the intent and strips the URL, then React Navigation issues two
  `replaceState` calls restoring the stale `?open` after a synthetic `popstate`. Not our
  modules. A reload with the stale query re-consumes the intent (refocuses the agent); in
  VS Code a webview reload starts from `/`, so exposure is low. Decision: fix the harness
  (wait for the active agent tab, then canonicalize the URL) as an M11 fixup by Taco;
  record the upstream race under deferred work. Taco: M11 `5eb155c24` waits for the
  selected `workspace-tab-agent_<id>` tab plus composer, then strips `open` itself.
- Local CDP e2e on the re-integrated stack (app tip `82ab9a84d`, ext tip `9cfc02370`,
  VS Code 1.124.2, WSLg): all specs passed — workspace-open, editing-shortcuts,
  file-uri-drop, Mermaid while streaming, inline + fullscreen diagram, native link to
  line 3, CSP console check. The "Unable to watch for file changes" toast is this host's
  inotify limit (`ENOSPC`), not the extension.

- VM kit rehearsal (pre-fix build, `C:\Users\hinne\paseo-qa\rehearsal-20261016`): staged,
  0.11.4 daemon on 18771 (dev mode, mock provider), VS Code 1.124.2 non-elevated. The
  seeded rich transcript rendered (Mermaid inline, code, file link) and the link opened
  `src/bridge-sample.ts` at line 3. Kit fixes during rehearsal: `npm pack --ignore-scripts`,
  VM setup moved to `vm-setup.ps1`, npm/VS Code CLI run through `cmd /c` (PowerShell 5 turns
  native stderr into errors), and a clean retry after a half-written esbuild binary.

- Final verification on `e2ce86fb3` (`/home/hinnes/projects/vscode-v0114-round/final-verify/`):
  build, app typecheck, extension typecheck, lint, format check, extension vitest, ci-workflow
  tests and the CDP e2e all PASS. The local CDP runs used WSLg, which put VS Code windows on
  the user's host desktop; the user asked for GUI runs on the VM. No more local GUI runs:
  Windows QA uses the VM kit, CDP e2e runs in CI.

## Windows VM CUA QA (final build)

Build `e2ce86fb3` (kit commit later amended to `9859eab5e`, `stage.sh` only; scripts are not
in the VSIX). VSIX `paseo-vscode` 0.11.4, sha256 `5f871517…c528f`. VM `g4-vmware-win11`,
VS Code 1.124.2 non-elevated, run `%USERPROFILE%\paseo-qa\final-e2ce86f`, 0.11.4 daemons
in dev mode (mock provider): open `127.0.0.1:18781`, password `127.0.0.1:18782`.
Screenshots: [docs/screenshots/vscode-v0.11.4](screenshots/vscode-v0.11.4/).

| #   | Scenario                                                                                                                                          | Result       | Evidence                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Unknown folder leaves the splash and opens a usable workspace                                                                                     | pass         | `01`                                                                                                                                                                                 |
| 2   | Rich transcript in the wide panel (heading, inline Mermaid, code, link)                                                                           | pass         | `02`                                                                                                                                                                                 |
| 3   | Mermaid fullscreen                                                                                                                                | pass         | `03`                                                                                                                                                                                 |
| 4   | Composer send → mock stream; Mermaid renders mid-stream with Stop                                                                                 | pass         | `04`,`05`                                                                                                                                                                            |
| 5   | Transcript link opens the file in a native editor at line 3                                                                                       | pass         | `06`                                                                                                                                                                                 |
| 6   | New-tab menu: Agent, Terminal, profiles only (no Files/Changes/Browser)                                                                           | pass         | `07`                                                                                                                                                                                 |
| 7   | Ctrl+F opens chat Find in the webview (1 of 10), not VS Code find                                                                                 | pass         | `08`                                                                                                                                                                                 |
| 8   | Password with spaces → prompt → `hello.auth`; daemon log: 15 sessions "connected via hello", password never logged; unauthenticated seed rejected | pass         | `09`,`10`                                                                                                                                                                            |
| 9   | Daemon restart → reconnect; new agent appears live; transcript loads                                                                              | pass         | `11`                                                                                                                                                                                 |
| 10  | 0.8.0 extension against a 0.11.4 daemon (old-client compatibility)                                                                                | pass         | baseline run                                                                                                                                                                         |
| 11  | OS file drop from Explorer into the composer                                                                                                      | not verified | CUA synthetic drag reaches VS Code (editor opens the file) but not the webview; identical on the 0.8.0 baseline. CDP synthetic `text/uri-list` drop passes. Needs a real-mouse check |

Observations (not regressions from this round):

- Ctrl+Shift+P inside the Paseo webview runs upstream "Pin chat" (Windows/Linux binding in
  v0.8.0 and v0.11.4) instead of VS Code's Command Palette. UX follow-up.
- After a daemon restart the mock agent's earlier transcript is empty: the mock keeps
  history in memory. Real-provider history reload is unverified on the VM.

## Toolchain finding

Nested `npm run … --workspace` recursion on this machine comes from `~/package.json`
(`npx@^10.2.2`), which installs npm 5.1.0 at `~/node_modules/.bin/npm`; npm prepends
ancestor `.bin` dirs to script PATH. It also breaks the lefthook `typecheck` pre-commit job.
Removing it is the user's call; until then agents commit with `LEFTHOOK=0` and run the hook's
lint, format and typecheck jobs manually.

## Deferred work

- Ctrl+Shift+P "Pin chat" shadows VS Code's Command Palette inside the webview (pre-existing).
- Real-mouse OS file drop into the webview on Windows; real-provider transcript reload after daemon restart.

- C5: pin the 1-based line contract in `vscode-file-open.test.ts`.

- Upstream: after a synthetic `pushState` + `popstate` to `?open=agent:<id>`, React Navigation restores the stale query; a reload re-consumes it. Candidate upstream issue, not fixed in the fork.

- P5: outside-workspace image `text/uri-list` drops produce neither mention nor attachment (fork behavior since 0.8.0).

- Heartbeat `4fa6297b` (every 30 min, expires 2026-10-17 15:55 HKT) checks this round; delete when the PR is ready.
