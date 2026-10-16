# VS Code v0.11.4 rebase plan

Approved by the user on 2026-10-16 with decisions D1–D5 as recommended and D6
declined. This is the source of truth for the round. Record progress, evidence, and
approved deviations in [the scratchpad](vscode-v0.11.4-scratchpad.md), not here.

## Objective and boundary

Move the VS Code extension from upstream `v0.8.0` onto upstream `v0.11.4`
(`dc5b02f7d`, tagged 2026-10-15) as a clean, modular commit stack. Preserve the
fork contract from [the v0.8.0 plan](vscode-v0.8.0-plan.md) (working rules 3–9
carry over unchanged). Build VSIX `0.11.4` and open a PR into `vscode-extension`.
This round ends with that PR ready for review, CI green, and QA evidence attached.
Merging, tagging `vscode-v0.11.4`, and Marketplace publishing need separate approval.

Upstream delta: 433 commits, 2,270 files. A trial merge of `origin/vscode-extension`
(`ba307199d`) with the tag reports 15 content conflicts.

## Git strategy

The v0.8.0 round merged upstream. This round returns to the v0.4.0 shape: rebuild
the fork as modules on the tag, then join the old history so `vscode-extension`
fast-forwards without a force push.

1. Tag the current tip: `vscode-extension-pre-v0.11.4` → `ba307199d`.
2. Branch `release/vscode-v0.11.4` from `refs/tags/upstream-release/v0.11.4`.
3. Build each module from the net diff
   (`git diff upstream v0.8.0..origin/vscode-extension -- <files>`), not by
   replaying commits. Much of the surface hiding exists only in merge `76f4bae05`'s
   conflict resolutions, so commit-by-commit replay would lose it.
4. Each module commit typechecks and passes its own tests on its own.
5. Final commit: `chore(vscode): join pre-rebase branch history`, a merge with
   `origin/vscode-extension` as second parent and the rebuilt tree unchanged
   (`git merge -s ours`), matching `094adc754`.

## Module stack

| #   | Commit                                                                    | Scope                                                                                                                |
| --- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| M1  | `feat(app): add VS Code webview host seam and platform gate`              | `desktop/vscode/host.ts`, `desktop/host.ts`, `constants/platform.ts`, layout and panel-store gates                   |
| M2  | `feat(app): connect through a directTcpBridge over the desktop transport` | `types/host-connection.ts`, desktop transport, `test-daemon-connection.ts`, `host-runtime.ts`, `local-credential.ts` |
| M3  | `fix(app): move only the bridge connection that reported another daemon`  | PR #12 identity recovery; still needed, upstream rekeys only placeholder IDs                                         |
| M4  | `i18n(app): add VS Code startup and file-open strings`                    | 9 locale files                                                                                                       |
| M5  | `feat(app): open the VS Code folder's workspace on startup`               | `initial-target.ts`, splash, bootstrap, open-project; move the 270-line `app/index.tsx` block behind one hook        |
| M6  | `feat(app): hide unsupported workspace surfaces in VS Code`               | surface capabilities, launcher, layout store, command center, panels, plugin client gate, voice                      |
| M7  | `feat(app): open files and transcript links in the VS Code editor`        | `vscode-file-open.ts`, open-in-editor planner, link resolver                                                         |
| M8  | `feat(app): mention dropped files and attach images from VS Code`         | file-drop mentions, `attachments/store.web.ts`, image picker                                                         |
| M9  | `fix(app): run Mermaid under a nonce-only CSP`                            | `csp-nonce.ts`, iframe runtime                                                                                       |
| M10 | `feat(app): keep the chat outline rail visible in narrow panels`          | `rail.web.tsx` + e2e spec                                                                                            |
| M11 | `feat(vscode): add the VS Code extension package`                         | `packages/vscode/**`, workspace entry, `build:vscode`, regenerated lockfile, `knip.json`                             |
| M12 | `ci(vscode): build, e2e and Marketplace publish workflows`                | `vscode.yml`, `vscode-publish.yml`, npm-install action, `!vscode-v*` exclusions, `ci-workflow.test.mjs`              |
| M13 | `docs(vscode): document the extension and its CI`                         | `vscode-extension.md`, `vscode-ci.md`, CLAUDE.md rows, README banner, `development.md`                               |

Order: M1 → M2 → M3, M4, then M5–M10 in any order, then M11 → M12 → M13 → M14 → M15.

Do not replay:

- `docs/vscode-v0.8.0-{plan,scratchpad}.md` and `docs/screenshots/vscode-v0.8.0/**`
  (about 4 MB). They stay reachable through the pre-rebase tag.
- `daa262d64`'s `npm --prefix` rewrite of root and client build scripts, unless CI
  proves it still needed. Upstream now builds relay inside the client build
  (`15f143141`); keep upstream's scripts and build per package locally under Node 22.
- Any remaining terminal or agent-visibility `COMPAT` fallback that typecheck proves
  is dead. Its tag expires 2026-12-18.

Seams to adopt while rebuilding, to cut future conflicts: launcher skips any panel kind
with no registration (drops `presentations.ts` and the launcher conflict); a
`useWorkspaceSurface()` hook for `workspace-screen.tsx`; drop the duplicate VS Code
branch in `attachments/store.ts` and the `open-project-screen.tsx` gate.

## Known integration hazards

| Risk   | Hazard                                                                                                                                                            | Required handling                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| High   | Composer drop path renamed (`46529146a`): `droppedItemsToSelectedFiles` treats `file-uri` items as host paths, so dropped files become rejected uploads.          | Split mentions before upload; rewrite `addFileMentions` on `textSource`/`replaceUserInput`. Regression test the VS Code drop. |
| High   | `desktop/daemon/local-credential.ts` switch has no `directTcpBridge` case (typecheck).                                                                            | Return `null` for the bridge. Never route `desktop_local_credential` to the bridge router.                                    |
| High   | Daemon password auth moved to `hello.auth` (`e1c769c01`); the bridge's `paseo.bearer.<pw>` subprotocol survives only under `COMPAT(headerAuth)` until 2027-03-24. | Decision D3.                                                                                                                  |
| High   | `@getpaseo/relay` is dist-only (`15f143141`).                                                                                                                     | `build:vscode` and `vscode.yml` build relay before the web export; prove on a clean CI checkout.                              |
| Medium | Automatic PR tab (`4f710d993`) defaults to the hidden Explorer; at ≥500 px it lands in the chat pane.                                                             | Decision D4.                                                                                                                  |
| Medium | Layout restore now goes through `restoreWorkspaceLayout` (`c3bcad687`); launcher dropped `toggleTarget` (`d3c76be9c`).                                            | Sanitize hidden surfaces before restore; test restored layouts in VS Code.                                                    |
| Medium | Chat Find (Ctrl/Cmd+F) listens on `document` in capture phase; the webview preload also handles Find keys.                                                        | CDP and CUA: one Find, no workbench side effect.                                                                              |
| Medium | Usage became built-in plugins (`792715e76`); the fork's plugin client gate hides them.                                                                            | Decision D5.                                                                                                                  |
| Low    | Root error boundary (`4006f974f`) remounts at `/open-project`, skipping folder auto-selection.                                                                    | Route VS Code recovery through the initial target, or record as deferred.                                                     |
| Low    | `catalog-sync.tsx` now also waits for the audio engine.                                                                                                           | Keep the fork gate; merge dependencies.                                                                                       |

CSP scan: no new runtime `import()`, workers, iframes, or `eval`. Expo, React Native
0.81.5, and Node 22 are unchanged. New deps: `react-freeze`, lucide 1.50, and the
`plugins` workspace.

## Decisions

- **D1 Target (approved).** Pin `v0.11.4`. A later patch is adopted only by explicit re-pin.
- **D2 History (approved).** Modular rebuild plus history join (above).
- **D3 Auth (approved).** Move the bridge to `hello.auth` this round, keeping the
  subprotocol for daemons that predate it. Reading `$PASEO_HOME/local-credential` for
  a password-free local connect is out of scope.
- **D4 PR auto-open (approved).** Suppress auto-open in VS Code; a user-opened PR
  goes to the main pane.
- **D5 Usage (approved).** Plugin-delivered Usage is unsupported in VS Code this round
  and must fail safely; native app UI that is not plugin-delivered stays.
- **D6 Hotfix (declined).** No `0.8.1`.

## QA

Unit and regression: each module's own tests, run per file. Typecheck and lint per
module. Broad suites run in CI.

CDP e2e: the existing Linux/Windows smoke and CDP jobs in `vscode.yml`.

Windows CUA smoke on the VMware Win11 VM `192.168.1.150` (`g4-vmware-win11`):

- Access: `ssh hinne@192.168.1.150` (key auth, cmd shell). Its cua-driver daemon runs
  in console session 1. Drive it with `cua-driver call <tool>` over SSH, JSON on stdin.
  Never pass JSON as a cmd or PowerShell argument; quoting breaks.
- Launch everything through `launch_app`. SSH-spawned processes do not reach the
  desktop. `launch_app` refuses Chromium remote-debugging flags; for CDP on the VM,
  launch a Node control script through `launch_app` and spawn VS Code from it, as the
  PR #12 harness did.
- Scratch kit per run: portable VS Code (1.124.2 zip), Node, MinGit, the `@getpaseo/*`
  tarballs packed from the release branch, a scratch daemon on an unused loopback port
  with its own `PASEO_HOME`, and an isolated `--user-data-dir`/`--extensions-dir` with
  `paseo.endpoint` set. Check the kit into `packages/vscode/scripts/vm-qa/` this round.
- Input: the Electron UIA tree is empty, so use pixel targets from the screenshot.
  Background clicks land. Keystrokes need a foreground click on the field, then
  foreground `type_text`.
- VS Code launched by the driver runs as Administrator. Windows blocks drag-and-drop
  from a non-elevated Explorer into an elevated window, so file-drop QA needs a
  non-elevated launch path. Solve this before the drop gate.
- Provider: the VM has no agent providers. Send/stream gates need a deterministic
  fixture provider on the VM or a real provider on another host.

Gates: same as v0.8.0, plus Find, PR tab, Usage per D5, reconnect toast, and
`hello.auth` against both a 0.8.0 and a 0.11.4 daemon (D3). Screenshots go under
`docs/screenshots/vscode-v0.11.4/`.

## Housekeeping

- Work happens in isolated worktrees. The root checkout's uncommitted edits (the
  Mermaid rename at `mermaid/host.web.tsx:36`, which breaks typecheck, and the v0.8.0
  scratchpad notes) stay untouched for the user to decide.
- Build from `origin/vscode-extension` (`ba307199d`), not local `release/vscode-v0.8.0`,
  which lacks PR #12.
- Tag `vscode-extension-pre-v0.11.4` at `ba307199d` locally now; push it with the PR.

## Team

| Agent  | Profile                         | Role                                                                             |
| ------ | ------------------------------- | -------------------------------------------------------------------------------- |
| Biru   | Claude (this session)           | PIC: plan, assignments, adjudication, integration, CUA/CDP QA, PR and CI         |
| Fattie | Codex, implementation           | App modules M1–M10 in its own worktree, one commit per module                    |
| Taco   | OpenCode, implementation        | Extension, CI and docs modules M11–M13, plus D3 `hello.auth` in its own worktree |
| Pillow | Codex, PIC and review           | Independent review against this plan                                             |
| Coco   | OpenCode, review/implementation | Independent review (UI, CSP, security); backup implementer                       |

Biru adjudicates every review finding as accepted-now, deferred, or rejected, with a
reason, in the scratchpad. Implementers report commit IDs and the exact checks they
ran. Keep credentials out of tracked files, prompts, logs, and screenshots.
