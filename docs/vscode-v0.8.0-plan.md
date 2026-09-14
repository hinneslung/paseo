# VS Code v0.8.0 rebase plan

This is the original plan and source of truth for this release round. Read it
before implementation or review. Pillow owns scope and acceptance decisions.
Record progress, evidence, and approved deviations in
[the scratchpad](vscode-v0.8.0-scratchpad.md); do not rewrite the original plan to
make an implementation or review finding appear compliant.

## Objective and boundary

Bring the unofficial VS Code extension from `vscode-v0.4.0`
(`52ad6cd4cce8752abb0efea75a35dced6e882e12`) onto upstream `v0.8.0`
(`b8e24677e12b226c7c38c1c3a40649daa9f1152f`). Preserve the extension's existing
behavior and security boundaries while adopting the upstream client changes.

Work on `release/vscode-v0.8.0`. Build version `0.8.0` to
`packages/vscode/paseo.vsix`, open a PR targeting `vscode-extension`, and iterate
until the relevant PR checks and manually dispatched CI/e2e checks pass on the
final code. This round stops with a reviewable PR and QA evidence. Merging,
tagging, and Marketplace publishing are not part of this request.

Preserve published branch history and unrelated work. Pillow chooses the Git
integration method after inspecting the fork history. No force push to
`vscode-extension`. Never overwrite a collaborator's worktree.

## Team and ownership

- **Pillow (PIC):** break down work, assign implementation/revisions, resolve
  scope, critically adjudicate review, inspect code, own QA and release gates,
  maintain scratchpad, create PR, and monitor CI. Delegation does not transfer
  accountability for simplicity, maintainability, coverage, or security.
- **Fattie:** implement the upstream integration, fork adaptations, behavioral
  regression tests, build changes, and revisions assigned by Pillow. Use an
  isolated worktree with explicit ownership. Report commit IDs and exact checks.
- **Biru and Coco:** independent peer review. Each reviewer must treat this
  original plan as the source of truth, inspect the implementation and tests,
  and report evidence and severity. If one is unavailable, use the other. Do not
  silently substitute a different reviewer or implementer.

Coordinate through the user-designated Paseo daemon at `192.168.1.194:6768`.
Use its configured profiles for the named team. Keep connection credentials out
of tracked files, logs, screenshots, PR text, and prompts.

## Working rules

1. Read the owning docs before acting: [VS Code integration](vscode-extension.md),
   [VS Code CI](vscode-ci.md), [coding standards](coding-standards.md),
   [testing](testing.md), [QA](qa.md), [routing](expo-router.md), and
   [protocol compatibility](protocol-compatibility.md).
2. Keep changes scoped to making this upstream release work in the extension.
   Prefer adapting existing boundaries to new wrappers, duplicate state, broad
   refactors, or compatibility paths without a supported use case.
3. Preserve project/worktree auto-selection, native VS Code file opening and line
   navigation, attachments and file mentions, keyboard editing, always-visible
   section rail with zero left offsets, and Mermaid preview.
4. Keep Paseo's duplicate Files/Explorer, Changes/Diff, Browser, and voice surfaces
   hidden in VS Code, including new launchers, shortcuts, and restored layouts.
5. Pin daemon traffic to the extension-host-resolved endpoint. Keep passwords in
   the extension host/SecretStorage; validate bridge input, constrain attachment
   paths and URL schemes, and preserve nonce-based CSP. Do not enable
   `unsafe-eval` or broaden host access to accommodate new upstream features.
6. Treat client plugins as unsupported in VS Code for this round unless Pillow
   approves a small CSP-compatible solution after review. Ensure unsupported
   plugin UI fails safely and cannot break ordinary chat. Daemon-side plugins
   are not disabled by the extension.
7. Never restart the main daemon or the team daemon, and never edit the user's
   Paseo config. QA uses scratch homes, unused ports, isolated VS Code profiles,
   and only processes created by the QA run. Inspect harnesses before launch.
8. Add meaningful unit/regression and end-to-end coverage for changed behavior.
   Do not mock away the behavior under test, weaken assertions, add auth skips,
   or remove tests to get green. Run targeted files locally; broad suites run in
   CI. Coordinate expensive builds/checks so agents do not overload the host.
9. Run typecheck and lint after changes; rebuild workspace declarations before
   diagnosing cross-package errors. Use npm formatting/lint scripts and run
   `npm run format` before committing. Keep unrelated formatter churn out.
10. Every review comment needs Pillow's independent correctness and urgency
    judgment. Adopt only findings Pillow fully agrees with. Fix release-critical
    problems now; record and defer non-critical work. Record rejected comments
    and reasons. Review findings do not authorize scope expansion.
11. Screenshots are mandatory QA evidence. Capture real VS Code CDP screenshots
    under `docs/screenshots/vscode-v0.8.0/`, inspect them, and link them in the
    scratchpad and PR. Record viewport, scenario, code revision, and result.
12. A green report names its commit, command/run URL, and actual result. A timeout,
    skipped check, unavailable platform, or provider-auth failure is not a pass.

## Work packages

| ID  | Owner     | Deliverable                                                                                                            |
| --- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| P0  | Pillow    | Pin base/tag, establish plan and scratchpad, discover named profiles, inspect existing PRs and harness safety          |
| I1  | Fattie    | Integrate pinned upstream release and resolve conflicts while preserving the fork contract                             |
| I2  | Fattie    | Adapt transport session handshake/TCP bridge, preserve endpoint/auth isolation, add regression coverage                |
| I3  | Fattie    | Reconcile panels/composer, move Mermaid nonce handling to shared iframe runtime, preserve rail and native file routing |
| I4  | Fattie    | Resolve build/version changes, safely gate unsupported plugin client UI, add targeted unit/e2e coverage and build VSIX |
| R1  | Biru/Coco | Review plan and concrete integration risks; Pillow adjudicates findings                                                |
| R2  | Biru/Coco | Review exact implementation commits against this original plan; Pillow assigns accepted critical revisions             |
| Q1  | Pillow    | Inspect code and checks; CDP smoke/regression QA with screenshots and targeted e2e evidence                            |
| C1  | Pillow    | Open PR, dispatch manual CI/e2e, inspect all applicable jobs, assign fixes and reverify final code                     |

## Main release gates

| Gate                      | Required evidence                                                                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connectivity and identity | Password-authenticated bridge connection; send/stream/stop; reconnect; correct event/session correlation; stale stored host identity recovery; endpoint remains pinned                                          |
| Initial selection         | Existing matching folder/worktree opens correctly; an unknown folder leaves the splash and opens a usable workspace; no unintended navigation after switching elsewhere                                         |
| Panels and persistence    | Agent/terminal tabs survive reopening; narrow sidebar is usable; duplicate VS Code-owned surfaces stay hidden in new launchers, keyboard actions, and restored layouts                                          |
| Composer                  | Enter/send, active-turn steer or queue as supported, copy/cut/paste/select-all, file drop/mention and line links; voice remains unavailable                                                                     |
| Rich transcript           | Inline Mermaid preview/code/fullscreen, streaming and reload; no CSP errors; section rail visible at narrow widths with agreed zero left offsets                                                                |
| State recovery            | Switching/reopening chats and foreground reconnect do not lose conversations, strand queued messages, or resurrect archived workspace state                                                                     |
| Packaging and CI          | Extension version 0.8.0; fresh VSIX at requested path; lint/typecheck/format; targeted regression tests; VS Code build and Linux/Windows smoke; VS Code CDP e2e; manually dispatched applicable full CI/app e2e |

Use a real daemon and real VS Code for CDP QA. Deterministic provider fixtures may
prove UI flows; record them as fixtures, and separately exercise an available
real provider for basic send/stream behavior. Record app/daemon versions and any
unavailable platform or new feature. Older-daemon compatibility is assessed at
the feature gate and transport boundary; do not promise new daemon capabilities
from a VSIX update alone.

## Review acceptance format

Reviewers provide the reviewed commit, plan requirement, file/line evidence,
failure scenario, severity, proposed minimal correction, and coverage gap. A
clean review must still state which gates were inspected and which could not be
verified. Pillow records each finding as accepted-now, deferred, or rejected
with an independent rationale and the resulting revision/evidence.
