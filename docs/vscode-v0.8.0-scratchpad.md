# VS Code v0.8.0 scratchpad

PIC: **Pillow**. Source of truth: [original plan](vscode-v0.8.0-plan.md).

## Current state

- Phase: initialization and team assignment.
- Source checkout: `/home/hinnes/projects/paseo`; initially clean.
- Base: `vscode-extension`, `52ad6cd4cce8752abb0efea75a35dced6e882e12`.
- Target: upstream `v0.8.0`, `b8e24677e12b226c7c38c1c3a40649daa9f1152f`.
- Intended branch: `release/vscode-v0.8.0`.
- PR: pending. Merge/tag/publish: outside this round.
- Existing unrelated PR: [#12](https://github.com/hinneslung/paseo/pull/12), stale
  bridge host identity fix. Inspect for release relevance; do not mutate its
  branch or claim its existing evidence covers this rebase.

## Team assignments

| Agent  | Profile/session | Assignment                              | Status  |
| ------ | --------------- | --------------------------------------- | ------- |
| Pillow | current session | PIC, plan, independent QA, PR/CI        | active  |
| Fattie | discovering     | implementation I1-I4                    | pending |
| Biru   | discovering     | original-plan and implementation review | pending |
| Coco   | discovering     | independent review/fallback             | pending |

## Progress

| Work                     | Status      | Evidence / next action                                                                   |
| ------------------------ | ----------- | ---------------------------------------------------------------------------------------- |
| P0 plan and baseline     | in progress | Baseline and upstream commit verified; dry merge previously identified 25 conflict files |
| I1 upstream integration  | pending     | Assign isolated implementation worktree                                                  |
| I2 transport             | pending     | Upstream caller-supplied session IDs conflict with current flat-target bridge API        |
| I3 UI integration        | pending     | Panels/composer overlap; Mermaid iframe extraction requires moving nonce patch           |
| I4 tests/build           | pending     | Plugin client uses eval; preserve CSP and gate unsupported UI                            |
| R1 plan review           | pending     | Reviewers must read original plan as source of truth                                     |
| R2 code review/revisions | pending     | Review exact implementation commits                                                      |
| Q1 CDP QA                | pending     | Capture evidence under docs/screenshots/vscode-v0.8.0/                                   |
| C1 PR/manual CI          | pending     | Include manual CI/app e2e on final release code                                          |

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
- Harness safety: `run-smoke-with-daemon.mjs` currently writes the real user's
  `~/.paseo/config.json`. Do not run it locally in that form; require isolated
  config discovery before smoke QA. The CDP e2e harness already uses a scratch
  daemon home.

## Review ledger

| ID      | Reviewer / commit | Finding and evidence | Pillow judgment | Action / verification |
| ------- | ----------------- | -------------------- | --------------- | --------------------- |
| pending |                   |                      |                 |                       |

## QA evidence

| Gate    | Revision / environment | Command or scenario | Result  | Screenshot / log |
| ------- | ---------------------- | ------------------- | ------- | ---------------- |
| pending |                        |                     | not run |                  |

## CI and PR ledger

| Revision | PR / workflow | Run URL | Result | Follow-up |
| -------- | ------------- | ------- | ------ | --------- |
| pending  |               |         |        |           |

## Deferred work and blockers

- Client plugin feature support is deferred unless a small CSP-compatible
  integration is approved; ordinary extension use must remain safe.
- No blockers established at initialization.

## Activity

- 2026-09-14: Pillow initialized the original plan and scratchpad, inspected repo
  rules and test harnesses, confirmed target/base, and discovered open PR #12.
