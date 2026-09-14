# VS Code v0.8.0 scratchpad

PIC: **Pillow**. Source of truth: [original plan](vscode-v0.8.0-plan.md).

## Current state

- Phase: runtime integrated at `2c6cd2b38`; independent QA and R4 reviews
  complete. CI-only streaming-fixture revision `98e31c321` passed both R5 reviews;
  final CI remains a gate.
- Source checkout: `/home/hinnes/projects/paseo`; initially clean.
- Base: `vscode-extension`, `52ad6cd4cce8752abb0efea75a35dced6e882e12`.
- Target: upstream `v0.8.0`, `b8e24677e12b226c7c38c1c3a40649daa9f1152f`.
- Intended branch: `release/vscode-v0.8.0`.
- PR: [#13](https://github.com/hinneslung/paseo/pull/13), draft while QA runs.
  Merge/tag/publish: outside this round.
- Existing unrelated PR: [#12](https://github.com/hinneslung/paseo/pull/12), stale
  bridge host identity fix. Inspect for release relevance; do not mutate its
  branch or claim its existing evidence covers this rebase.

## Team assignments

| Agent  | Profile/session                        | Assignment                                | Status                                           |
| ------ | -------------------------------------- | ----------------------------------------- | ------------------------------------------------ |
| Pillow | current session                        | PIC, plan, independent QA, PR/CI          | active                                           |
| Fattie | `b85693b9-8602-45ee-8ae3-59a61ffa5c9f` | implementation and targeted e2e follow-up | CI harness fixed at 98e31c321; evidence handover |
| Biru   | `084b9427-2dca-47e1-9f4f-f702f6a60b74` | original-plan and implementation review   | R5 clean at 98e31c321                            |
| Coco   | `6c832395-685d-4995-bede-4a06cb729c81` | independent UI/CSP/QA review              | R5 clean at 98e31c321                            |

## Progress

| Work                     | Status      | Evidence / next action                                                                                 |
| ------------------------ | ----------- | ------------------------------------------------------------------------------------------------------ |
| P0 plan and baseline     | complete    | Pins, plan, profiles, baseline static checks and startup screenshot recorded                           |
| I1 upstream integration  | implemented | 76f4bae05 preserves both fork and pinned upstream ancestry                                             |
| I2 transport             | complete    | Caller-owned sessions, TCP round trips, reviewed PR #12 port; CDP reconnect and stale-ID recovery pass |
| I3 UI integration        | complete    | Gates, Mermaid, rail, native routing, and file-drop verified; R4 clean                                 |
| I4 tests/build           | complete    | Version0.8 VSIX rebuilt from 2c6cd2b38; deterministic file-drop/streaming/link CDP passes              |
| R1 plan review           | complete    | Both reviewers read original plan; Pillow adjudications below                                          |
| R2 code review/revisions | complete    | R2/R3/R4 completed; final 46f3385a3..2c6cd2b38 delta accepted by both reviewers and Pillow             |
| Q1 CDP QA                | complete    | Independent QA and inspected screenshots below; physical platform limits recorded                      |
| C1 PR/manual CI          | in progress | PR13 draft; final-code dedicated VS Code and full CI/app e2e dispatched                                |

## Decisions and deviations

- Target is pinned to the v0.8.0 commit studied with the user, regardless of later
  upstream development.
- User-specified roles apply to this round; discover named Paseo profiles rather
  than repurpose agents assigned to unrelated projects.
- This machine owns `192.168.1.194`; team and PIC may share its filesystem.
  Isolated worktrees and explicit file ownership are required.
- No credential values are stored in this document.
- Git integration: preserve the released fork ancestry and merge the pinned
  upstream tag into the isolated implementation branch, then integrate it into
  the release branch. The fork has 157 commits beyond the common base and older
  release merges; replaying that history would obscure the final compatibility
  adaptations. The resulting release contains the exact upstream tag as an
  ancestor, without rewriting `vscode-extension`.
- Named profiles were read from the authorized daemon: Fattie uses its configured
  Codex profile, Biru its Claude profile, and Coco its OpenCode profile. No profile
  notes were configured.
- Harness safety: the baseline smoke wrapper wrote the real user's
  `~/.paseo/config.json`. Integration replaced this with scratch HOME/USERPROFILE
  discovery, verified by Linux and Windows CI. CDP also uses a scratch daemon home.
- Approved PR #12's stale bridge identity recovery as release-relevant: the
  current controller rejects a non-placeholder stored host ID even when the
  extension pins the bridge endpoint. The source is fetched as `origin/pr-12`
  (`11f3fcc17`). Fattie must preserve non-bridge mismatch rejection, same-server
  custom labels, and regression tests; existing PR remains untouched.
- Implementation checkout: `/home/hinnes/projects/paseo-vscode-v0.8.0-impl`, branch
  `work/vscode-v0.8.0-implementation`, based on plan commit `2429fbc0f`.
- Final CDP QA can launch extension and daemon builds from the isolated
  implementation checkout while writing screenshots here. Do not reinstall root
  dependencies merely to run QA while the team daemon may depend on this checkout.
- Full `ci.yml` has four app Playwright shards and requires manual dispatch for
  a PR targeting `vscode-extension`; the dedicated VS Code workflow is automatic.

## Review ledger

| ID     | Reviewer / commit             | Finding and evidence                                                                                          | Pillow judgment                                                                                                                                          | Action / verification                                                                                                 |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| C-R1-1 | Coco / baseline               | Smoke wrapper overwrites real config                                                                          | accepted-now; direct write confirmed. Claim that this necessarily orphans the main daemon is unsupported                                                 | Fattie to isolate discovery and preserve Windows home expansion coverage                                              |
| C-R1-2 | Coco / upstream v0.8.0        | Move Mermaid nonce handling into shared iframe                                                                | accepted-now; already I3. Helper was fork-only, not deleted by upstream                                                                                  | Inline/fullscreen runtime must share nonce handling and CDP evidence                                                  |
| C-R1-3 | Coco / upstream v0.8.0        | Plugin eval violates CSP                                                                                      | accept single client capability gate; reject proposed extra catch layer. Upstream registry.ts already catches evaluation errors and skips that plugin    | Fattie to gate client runtime without broadening CSP                                                                  |
| C-R1-4 | Coco / tag ref                | Alleged incorrect upstream pin                                                                                | rejected; e432c9b471 is an annotated tag object, peeled commit is b8e24677e. Historical commit objects were also mistaken for new implementation commits | No change; reviewer acknowledged correction                                                                           |
| C-R1-5 | Coco / baseline               | Missing final screenshots and new CDP coverage                                                                | planned gate, not a new blocker during initialization                                                                                                    | Q1/C1 must provide actual evidence before completion                                                                  |
| B-R1-1 | Biru / upstream and baseline  | TCP bridge type and build/parse arms need preservation                                                        | accepted-now; already I2. Fork-only code was not deleted upstream                                                                                        | Explicit TCP round-trip regression and bridge branch inspection                                                       |
| B-R1-2 | Biru / PR #12                 | Stale stored bridge identity requires PR #12                                                                  | accepted-now; previously approved by Pillow                                                                                                              | Carry both regression files, preserve bridge-only adoption and identity recheck                                       |
| B-R1-3 | Biru / shared Mermaid runtime | Nonce must use script.nonce IDL property and cover fullscreen                                                 | accepted-now; already I3                                                                                                                                 | Shared injection plus inline/fullscreen CDP evidence                                                                  |
| B-R1-4 | Biru / host-runtime.ts        | Bridge client could omit new shared base configuration                                                        | accept shared-base preservation; hypothetical implementation defect, not observed regression. Structural deep-equal test not mandatory                   | Inspect bridge creation and behavioral reconnect coverage                                                             |
| B-R1-5 | Biru / plugin timeline        | Unsupported client renderer needs fallback coverage                                                           | accept coverage; reject implied existing crash. Upstream already renders TimelineItemUnavailable for missing plugin/renderer                             | Preserve fallback and prove ordinary transcript stays usable                                                          |
| B-R1-6 | Biru / SecretStorage          | Possible same-endpoint password collision across remote authorities                                           | deferred; partitioning unverified and pre-existing. Reject claim PR #12 first enables SSH: fresh registries already work                                 | No speculative authentication change; remoteName alone would not identify distinct SSH hosts                          |
| B-R1-7 | Biru / PR #12 overlap         | Decide incorporation and merge order                                                                          | resolved; approved carry with attribution, existing PR left untouched                                                                                    | Reference source in release PR; no separate merge or close                                                            |
| P-I3-1 | Pillow / upstream launcher    | New launcher unconditionally requires Files/Diff/Changes registry presentations before filtering hidden items | accepted-now; retaining fork's unregistered panels alone would throw on catalog construction                                                             | Fattie must reconcile presentation lookup with visibility, dispatch, and restored-state gates; CDP open-new-tab check |

## QA evidence

Raw delta review reports: [Biru R3](screenshots/vscode-v0.8.0/biru-r3.txt),
[Coco R3](screenshots/vscode-v0.8.0/coco-r3.txt). Both used the original plan.
Pillow accepts the native-routing and harness-security assessments. Their
streaming-evidence claim is too strong: an SVG assertion before `waitForFinish`
can still run after completion. Fattie added an explicit active-stream
assertion before the final-diagram assertion; this is a coverage correction,
not a demonstrated Mermaid runtime defect.

Final reports: [Biru R4](screenshots/vscode-v0.8.0/biru-r4.txt),
[Coco R4](screenshots/vscode-v0.8.0/coco-r4.txt),
[Fattie file-drop implementation](screenshots/vscode-v0.8.0/fattie-file-drop.txt).
Pillow agrees with the clean final delta reviews after checking the setter
contract, caret handling, unchanged path boundary, and DOM-level regression.
No material review finding remains open.

Implementation checkpoint `0507f2613`: Fattie reported `npm run format`, lint
(zero warnings/errors), all-workspace typecheck, `build:server`, and `build:vscode`
passing. Targeted results: 280 integration tests in 10 files, 87 preservation
tests in 7 files, and 55 VS Code tests in 10 files. Real headless smoke and the
existing workspace/clipboard CDP harness passed. Pillow does not rerun these
already-green suites; final platform coverage comes from CI.

`packages/vscode/paseo.vsix` now contains version `0.8.0`, 5,571,751 bytes,
SHA-256 `00b95c708a45f9baa07950a790a969aa0b441a83362a458d43cca67fa0b7c648`.
Rebuilt from the file-drop fix source committed as `2c6cd2b38`, copied to the
requested root checkout path and hash-checked. No main/team daemon restart.

Final checkpoint QA at `0507f2613` uses VS Code 1.129.1, a real v0.8.0 daemon
on 6797, CDP9247, scratch home/profile/workspace, and a 1440x900 workbench.
Pillow has confirmed unknown-folder startup, a real Codex GPT-5.6-Luna reply,
Mermaid inline/fullscreen/source switching, Escape close, zoom-button scaling
(iframe1004px to1255px), and real streaming interrupted at158 of1000 requested
lines. Captured webview CSP violations: zero. A wheel-only zoom probe did not
change the measured width; it is not recorded as passing.

**Resolved release blocker P-Q1-1:** native assistant file links no-op at
`0507f2613`. Baseline same-file/line check passed; the rebase lost
`openWorkspaceFileInVscode` and the `getIsVscode()` branch in
`handleOpenWorkspaceFileFromPane`. The new in-app surface gate rejects the
resulting file target. Fattie restored it in `46f3385a3` with exact payload/range
unit coverage and a real-daemon CDP test that fails on the broken build and
passes on the fix. Both R3 reviewers independently accepted the delta; Pillow
agrees after inspecting the caller, shared path validation, and test interfaces.
[Observed failure](screenshots/vscode-v0.8.0/final/08-file-link-check.png).
[Independent corrected native editor at Ln 3, Col 1](screenshots/vscode-v0.8.0/final/13-fixed-native-file-line.png).

The earlier CDP file-link fixture deferral is obsolete: upstream's supported
mock provider accepts `mockStreamingAssistantResponse` and its interval.
Fattie added a deterministic real-daemon VS Code CDP scenario for streamed
Mermaid, fullscreen, and native dot-path/line links; no private persistence edits.

**Resolved release blocker P-Q1-2:** upstream's imperative/uncontrolled composer
did not reflect the fork's state-only file-mention insertion in the textarea.
Fattie replaced that call with the existing `replaceUserInput` boundary in
`2c6cd2b38`. The same URI-drop probe fails on v0.8 before the fix and succeeds on
the v0.4 baseline and fixed v0.8 build. Pillow independently repeated the probe
with existing text: `Review` became `Review "qa-example.ts"`; screenshot inspected.
This final revision passed 18 focused tests in two files, lint, all-workspace
typecheck, formatting, build, and the strengthened deterministic CDP scenario.
[Fixed file drop](screenshots/vscode-v0.8.0/final/26-file-drop-fixed.png).

Native-fix implementation evidence: [Fattie report](screenshots/vscode-v0.8.0/fattie-native-fix.txt),
[deterministic native link](screenshots/vscode-v0.8.0/deterministic/native-file-link-success.png),
[fullscreen](screenshots/vscode-v0.8.0/deterministic/rich-transcript-fullscreen-success.png).
Pillow inspected the copied deterministic screenshots as well as the independent
CDP captures.

| Gate                            | Revision / environment                                                     | Command or scenario                                              | Result                                                                                                                | Screenshot / log                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline static checks          | 2429fbc0f, Linux/WSL                                                       | npm run lint; npm run typecheck; doc formatting                  | pass; lint 0 warnings/errors; commit hook also green                                                                  | Local command output                                                                                                                            |
| Baseline CDP startup            | prebuilt extension 0.4.0, VS Code 1.129.1, isolated daemon 6797 / CDP 9247 | Unknown Git folder opens usable workspace; 1440x900 window       | pass; Pillow inspected screenshot                                                                                     | [Fresh workspace](screenshots/vscode-v0.8.0/baseline/01-fresh-workspace.png)                                                                    |
| Baseline real-provider response | same prebuilt extension, scratch daemon; Codex GPT-5.6-Luna                | Select provider in UI, Enter/send, receive QA_READY plus Mermaid | pass; diagram visible in inspected screenshot. Final-build repeat required                                            | [Provider and Mermaid](screenshots/vscode-v0.8.0/baseline/02-real-provider.png)                                                                 |
| Baseline native file link       | same, generated scratch qa-example.ts                                      | Click assistant link to ./qa-example.ts:3                        | pass; VS Code opens native editor at Ln 3, Col 1; screenshot inspected                                                | [Native editor](screenshots/vscode-v0.8.0/baseline/03-native-file-link.png)                                                                     |
| Baseline narrow rail            | same; 700x900 workbench, 312px webview                                     | Two real-provider turns; inspect outline rail at narrow width    | pass; rail rectangle x=0, width=36; screenshot inspected                                                              | [Narrow rail](screenshots/vscode-v0.8.0/baseline/04-narrow-rail.png)                                                                            |
| Baseline editing shortcuts      | same, Linux/WSL headless                                                   | Ctrl+A/C/X/V in composer                                         | pass; selection 0..18, cut empty, paste restores clipboard baseline                                                   | CDP values inspected                                                                                                                            |
| Native file routing restored    | 46f3385a3 source build; real Codex transcript                              | Click qa-example.ts:3                                            | pass; native tab and Ln 3, Col 1, screenshot inspected                                                                | [Fixed link](screenshots/vscode-v0.8.0/final/13-fixed-native-file-line.png)                                                                     |
| Terminal and reopened tabs      | 0507f2613 loaded bundle; scratch daemon remains running                    | Create terminal, echo TERMINAL_QA_OK, close/reopen Paseo         | pass; chat/terminal tab identities and output restored, screenshots inspected                                         | [Terminal output](screenshots/vscode-v0.8.0/final/11-terminal-output.png), [reopened](screenshots/vscode-v0.8.0/final/12-reopened-terminal.png) |
| New-tab launcher                | same                                                                       | Open New tab menu                                                | pass; Agent, Terminal, profiles only, screenshot inspected                                                            | [Launcher](screenshots/vscode-v0.8.0/final/09-new-tab-launcher.png)                                                                             |
| Clipboard and typed mention     | 46f3385a3 source build                                                     | Ctrl+A/C/X/V; @qa picker and Enter                               | pass; selection0..16, cut empty, paste exact, picker inserts quoted qa-example.ts                                     | [Mention picker](screenshots/vscode-v0.8.0/final/15-file-mention-picker.png)                                                                    |
| Stale bridge identity           | 46f3385a3; scratch-profile localStorage only                               | Replace stored host ID; Developer Reload Window                  | pass in sidebar; real daemon ID/label restored, prior completed conversation visible, no splash                       | [Recovered identity](screenshots/vscode-v0.8.0/final/16-stale-identity-recovered.png)                                                           |
| Narrow rail                     | 46f3385a3; 700x900 workbench, 312px main webview                           | Five prompt ticks                                                | pass; x=0, width=36, screenshot inspected                                                                             | [Narrow transcript](screenshots/vscode-v0.8.0/final/20-narrow-main-rail.png)                                                                    |
| Active-turn follow-up           | 46f3385a3; real Codex GPT-5.6-Luna                                         | Submit second request while Stop button is visible               | pass; follow-up reaches provider and STEER_QA_OK appears on completion; provider finished the number list first       | [Submitted](screenshots/vscode-v0.8.0/final/18-active-turn-followup.png), [completed](screenshots/vscode-v0.8.0/final/19-followup-complete.png) |
| Foreground reconnect            | 46f3385a3; own scratch bridge only                                         | Close observed local transport during real-provider response     | pass; session ID changes, RECONNECT_QA_OK received, zero CSP violations                                               | [Reconnected](screenshots/vscode-v0.8.0/final/21-bridge-reconnected.png)                                                                        |
| Hidden surfaces                 | 46f3385a3                                                                  | Command center, Ctrl+Shift+E, saved Files tab, voice controls    | pass; no duplicate explorer or voice, saved Files removed; main registry also reconciled                              | [Command center](screenshots/vscode-v0.8.0/final/22-command-center-gates.png)                                                                   |
| Explicit workspace choice       | 46f3385a3; second scratch workspace on same directory                      | Choose second workspace through command center                   | pass; selected route/header remains, no initial-selection bounce                                                      | [Second workspace](screenshots/vscode-v0.8.0/final/23-switched-workspace.png)                                                                   |
| Archived state                  | 46f3385a3; disposable second workspace                                     | Archive via supported API, close/reopen Paseo                    | pass; archived workspace shows unavailable, remains absent from active API, reopening selects original live workspace | [Unavailable](screenshots/vscode-v0.8.0/final/24-archived-workspace.png), [reopened](screenshots/vscode-v0.8.0/final/25-archive-reopen.png)     |
| File drop fixed                 | 2c6cd2b38 source build                                                     | Drop qa-example.ts into composer containing Review               | pass; exact DOM value Review followed by quoted qa-example.ts, zero CSP violations                                    | [Fixed drop](screenshots/vscode-v0.8.0/final/26-file-drop-fixed.png)                                                                            |

QA caveats: browser `location.reload()` inside the webview navigates a synthetic
route and is not the supported reload path; close/reopen and Developer Reload
Window are tested separately. A whole scratch-daemon restart removes its old
live terminal; terminal persistence above tests reopening with that daemon
still running. Do not present scratch-daemon restart as terminal persistence.
One command-palette focus miss sent the harmless text `Developer: Reload Window`
to the scratch QA agent. It replied that it could not reload the window; this
is a probe error, not a product action or a reload result. The successful reload
was separately confirmed by extension-host restart and saved-ID reconciliation.

## CI and PR ledger

Runtime is `2c6cd2b38`; the dedicated CDP harness is `98e31c321`.
Documentation/evidence-only commits do not change either. Formatting and commit
hooks verify documentation separately.

**CI revision P-C1-1:** run `34820181500` passed packaging and both platform
smokes, but the CDP test missed the live-response window. The inspected
[failure screenshot](screenshots/vscode-v0.8.0/ci-streaming-window/ci-short-stream-failure.png)
shows the completed diagram and a two-second response. The URI-drop assertion
had passed. Fattie's test-only `98e31c321` adds a bounded streamed text suffix
after the closed diagram and jointly probes SVG labels and the Stop control.
It proves a diagram is visible while its response streams, not incremental
changes to Mermaid source. The final inline/fullscreen and native-line checks
remain required. VS Code 1.124.2 local CDP, lint, typecheck and format passed;
Pillow inspected the copied [final inline](screenshots/vscode-v0.8.0/ci-streaming-window/inline-success.png)
and [native line](screenshots/vscode-v0.8.0/ci-streaming-window/native-file-link-success.png)
screenshots. CI confirmation remains pending.

R5 [Biru](screenshots/vscode-v0.8.0/biru-r5.txt) and
[Coco](screenshots/vscode-v0.8.0/coco-r5.txt) found no material defects. Pillow
accepts their scope and assertion judgments but rejects their initial eight-second
calculation: `tokenize` splits each seven-character `hold-NN` into two chunks,
so 80 words at 100ms/chunk give a 16-second suffix. Pillow's first correction also
misattributed this to whitespace chunks; complete function inspection corrected
that account. The observed final local turn took 19 seconds, within the existing
30-second waits. No runtime change or assertion removal is required.

| Revision  | PR / workflow            | Run URL                                                                     | Result    | Follow-up                                                                                                                                                                                 |
| --------- | ------------------------ | --------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 46f3385a3 | PR13 / VS Code Extension | [34818858120](https://github.com/hinneslung/paseo/actions/runs/34818858120) | pass      | All four jobs: build, Linux/Windows smoke, CDP                                                                                                                                            |
| 46f3385a3 | manually dispatched CI   | [34818805713](https://github.com/hinneslung/paseo/actions/runs/34818805713) | cancelled | Superseded; cancelled to release same-branch concurrency for final code. Completed quality/app/SDK/relay/Linux-server/Windows-desktop/CLI jobs were green; unfinished jobs are not passes |
| 2c6cd2b38 | PR13 / VS Code Extension | [34820181500](https://github.com/hinneslung/paseo/actions/runs/34820181500) | failed    | Build and Linux/Windows smoke passed; streaming observation window corrected in 98e31c321. No assertion removed                                                                           |
| 2c6cd2b38 | manually dispatched CI   | [34820176689](https://github.com/hinneslung/paseo/actions/runs/34820176689) | running   | Full CI/app e2e on unchanged runtime; subsequent harness delta is dedicated VS Code-only                                                                                                  |
| 98e31c321 | PR13 / VS Code Extension | [34821628250](https://github.com/hinneslung/paseo/actions/runs/34821628250) | running   | Corrected bounded streaming fixture; all four jobs started                                                                                                                                |

## Deferred work and blockers

- Client plugin feature support is deferred unless a small CSP-compatible
  integration is approved; ordinary extension use must remain safe.
- SecretStorage authority partitioning is unverified and pre-existing; investigate
  separately before considering password-key changes (B-R1-6).
- C-R2-1 / B-R2-2: source-string tripwires are weak unit coverage; defer cleanup.
  Real Linux/Windows smoke exercises home-relative discovery and authentication;
  deterministic CDP fixture coverage is being added at the actual webview boundary.
- C-R2-2: generic attributed/multiple-script nonce matching is future hardening,
  not a failure with the pinned single-script generated runtime; deferred.
- B-R2-1: approved `daa262d64` build-script scope. Explicit package prefixes keep
  nested npm workspace builds in the owning package instead of recursively
  inheriting the caller workspace selection; full CI covers shared build paths.
- B-R2-3: closed; final artifact rebuilt from the committed native-file/drop
  source and independently SHA-256 checked at the requested path.
- Stale bridge identity recovery covers a single stale profile. Existing
  reconciliation refuses to merge into an already-live controller for the new ID;
  that collision stays fail-closed, not recovered. Do not claim broader recovery.
- Native routing blocker P-Q1-1 is closed at `46f3385a3`.
- File-drop blocker P-Q1-2 is closed at `2c6cd2b38` with independent CDP proof.
- Local physical coverage is Linux/WSL headless VS Code 1.129.1. Windows smoke
  runs in CI; Windows/macOS CDP and native mobile devices were not exercised.
  Existing matching folder and workspace switching were exercised in CDP;
  worktree-specific selection is covered by the preserved targeted unit cases.
- Pipeline heartbeat `9cf0c300` checks every five minutes, expires after three
  hours; remove when this round completes or is paused.

## Activity

- 2026-09-14: Pillow initialized the original plan and scratchpad, inspected repo
  rules and test harnesses, confirmed target/base, and discovered open PR #12.
- 2026-09-14: Started Fattie/Biru/Coco from the named profiles; no substitutions.
  Both reviewers received the original-plan source-of-truth rule.
- 2026-09-14: Adjudicated Coco R1, rejected false tag ambiguity, narrowed unsupported
  failure claims, and assigned PR #12 integration to Fattie.
- 2026-09-14: Captured and inspected baseline fresh-workspace CDP screenshot.
- 2026-09-14: Adjudicated Biru R1 against code; confirmed existing plugin timeline
  fallback, assigned transport coverage details, deferred speculative secret-key work.
- 2026-09-14: Baseline real Codex response, Mermaid preview, and native file link
  succeeded through the isolated VS Code bridge. These do not certify the pending build.
- 2026-09-14: Inspected narrow-rail screenshot and verified composer clipboard
  shortcuts. Stopped both baseline QA sessions and their isolated daemons; kept
  scratch data for diagnostics. Main and team daemons were not restarted.
- 2026-09-14: PIC CDP found two merge regressions (native file caller, imperative
  composer drop setter), assigned minimal fixes, validated RED/GREEN evidence,
  and independently verified the rebuilt extension. Both final reviewers clean.
- 2026-09-14: PR13 opened in draft, final code pushed, dedicated VS Code and
  manually dispatched full CI started. Closed PIC QA browser/extension/daemon
  and seed client; kept scratch diagnostics, without touching main/team daemons.
