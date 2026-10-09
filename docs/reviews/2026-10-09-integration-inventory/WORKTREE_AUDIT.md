# Worktree and branch integration inventory

October 9, 2026. Read-only repository audit after fetching origin.

All 88 registered worktree heads are reachable from GitHub remote refs. Of those,
76 are ancestors of `origin/main`, eight are contained in PR #170, and four are
contained in PR #171. The two integration PRs still need their remaining checks;
this inventory does not claim that their commits have merged.

All 112 local branch tips and 113 nonsymbolic origin branch tips are accounted
for by the same ancestry checks. No tip lies outside main or the integration
stack, and no local tip is unpublished. There are no stashes. This covers every
registered worktree and current branch, including those older than the past month.
It does not recover deleted untracked files or assess ignored build/model data.

The only untracked entry is `.directory` in the canonical checkout. Inspection
shows a desktop folder-icon preference, not application source. It is preserved
locally and is not committed. No tracked edits were found in any worktree.
The BCA worktree is clean; its head `ff3d2d2d` is already in GitHub main.

## Reference state

- GitHub main: `2de610b2b91d3aaafa8f7a92c7edad4348aa00e5`.
- PR #170: `03ba477f7ed1c5c20277150780628d05f7280912`.
- PR #171 at audit: `4d114e307b3ae424f8a3ebc8570fd1af78ead7e9`.

PR #170 contains 71 commits beyond the fetched main; PR #171 contains another
179 commits beyond its base. These counts include integration history and do
not count independent features. PRs #165–169 are already contained in #170;
their open listings do not identify additional unintegrated work.

The canonical local `main` remains at `565cd983`, 175 commits behind origin with
no commits ahead. Codex and browser-tool processes still have that checkout as
their working directory. This audit does not establish whether they are active
or idle, so it leaves the checkout and processes untouched. The isolated
integration and frozen browser-acceptance worktrees remain separate.

## Landing gates

GitHub reports all eight checks passing for PR #170 at `03ba477f`. PR #171's
current checks are pending, with live RLS running at observation time. T3 reports
the preview available on the frozen Models page at port 3518, but reopening it
still reports a hidden panel, and saved snapshot capture fails on the same
preview client. Browser acceptance is still unfinished. No alternate browser,
checkout reset, process termination or merge was performed.

The next landing sequence remains PR #170 after its relevant acceptance, then
PR #171 after its required checks and evidence. Native/synthetic worker campaigns
do not replace browser acceptance, actual source preparation, scientific
acceptance, or observation with practicing planners and public participants.
The V1 contract and roadmap remain unchanged.

## Worktrees

Names below identify the canonical checkout or the directories under the local
OpenPlan state folder. Detached checkouts are retained acceptance snapshots.
“Main” means the exact head is an ancestor of fetched GitHub main, not merely
that its patch looks similar. Pending heads are also reachable on GitHub.

| Worktree | Branch or detached snapshot | Head | Contained in |
| --- | --- | --- | --- |
| canonical checkout | `main` | `565cd983c` | origin/main |
| aeq-output-receipts-20261008 | `fix/aeq-output-receipts-20261008` | `c617ca4ef` | origin/main |
| agent-hold-receipts-2026-09-10 | `work/engagement-response-snapshots` | `e006b98bd` | origin/main |
| assistant-audit-outcomes-2026-09-10 | `work/assistant-audit-outcomes` | `d87a04d42` | origin/main |
| award-acceptance-20261007 | `docs/award-acceptance-20261007` | `15e22c220` | origin/main |
| award-obligation-custody-20261007 | `fix/award-obligation-custody-20261007` | `4e0392435` | origin/main |
| award-obligation-review-20261007 | `fix/comparable-study-display-custody-20261008` | `c800c6bd3` | origin/main |
| award-reopen-choice-20261007 | `fix/award-reopen-choice-20261007` | `431c8927b` | origin/main |
| bca-workbench-20261006 | `work/bca-workbench-20261006` | `ff3d2d2d8` | origin/main |
| catalog-acceptance-532c0f81 | `detached` | `532c0f81f` | PR171 |
| contract-reconciliation-2026-09-07 | `work/contract-reconciliation` | `76f019bfb` | origin/main |
| dependency-patch-2026-09-10 | `fix/development-dependency-advisories` | `5d7ccdb06` | origin/main |
| engagement-complete-case-20261006 | `work/engagement-complete-case-20261006` | `2276b4d23` | origin/main |
| engagement-context-handoff-20261007 | `work/engagement-context-handoff-20261007` | `21b1f86ad` | origin/main |
| engagement-evidence-refocus-20261007 | `fix/engagement-evidence-refocus-20261007` | `792873761` | origin/main |
| engagement-execution-controls-20261006 | `work/engagement-execution-controls-20261006` | `c91d68136` | origin/main |
| engagement-execution-progress-20261006 | `work/engagement-execution-progress-20261006` | `bd292640a` | origin/main |
| engagement-export-source-labels-20261007 | `fix/engagement-export-source-labels-20261007` | `f5e4aa1db` | origin/main |
| engagement-first-workflow-2026-09-06 | `work/engagement-first-workflow` | `860260baa` | origin/main |
| engagement-form-recovery-20261006 | `work/engagement-form-recovery-20261006` | `00b849e75` | origin/main |
| engagement-handoff-target-refresh-20261007 | `fix/engagement-handoff-target-refresh-20261007` | `c255dd49b` | origin/main |
| engagement-main-integration-20261007 | `work/engagement-main-integration-20261007` | `359ab9920` | origin/main |
| engagement-response-writes-2026-09-12 | `work/engagement-response-writes` | `88fb20b61` | origin/main |
| engagement-review-status-labels-20261007 | `fix/engagement-review-status-labels-20261007` | `57a9f1d35` | origin/main |
| engagement-thematic-inputs-20261007 | `work/engagement-thematic-inputs-20261007` | `a76bfc94b` | origin/main |
| engagement-write-recovery-2026-09-12 | `work/engagement-write-recovery` | `3f70af98e` | origin/main |
| evidence-ci-20261007 | `fix/evidence-ci-20261007` | `92894d916` | origin/main |
| explicit-agent-consent-2026-09-10 | `work/explicit-agent-consent` | `4d02130b2` | origin/main |
| independent-fixes-20261001 | `fix/independent-review-20261001` | `ca3e442cd` | origin/main |
| independent-review-20261001-01 | `review/independent-20261001-01` | `3072fc155` | origin/main |
| land-use-creation-20261007 | `work/land-use-creation-20261007` | `dfada38fa` | origin/main |
| land-use-frozen-rules-20261007 | `work/land-use-frozen-rules-20261007` | `d6b5eb374` | origin/main |
| land-use-plan-authority-20261007 | `work/land-use-plan-authority-20261007` | `f4eb8a969` | origin/main |
| land-use-plan-context-20261007 | `work/land-use-plan-context-20261007` | `5a2679b01` | origin/main |
| land-use-plan-kinds-20261007 | `work/land-use-report-recovery-20261007` | `3e2df7b64` | origin/main |
| land-use-report-transaction-integration-20261007 | `work/land-use-implementation-report-transaction-20261007` | `b3a03990b` | origin/main |
| local-artifact-containment-20261008 | `fix/local-artifact-containment-20261008` | `03ba477f7` | PR170 |
| local-font-build-20261006 | `fix/local-font-build-20261006` | `48c52f036` | origin/main |
| m11-delivery-closeout-2026-09-08 | `work/m11-delivery-closeout` | `5850d63e9` | origin/main |
| m2d3-reimbursement-2026-09-09 | `work/m2d3-reimbursement` | `88de2d23f` | origin/main |
| m2d4-closeout-review-2026-09-09 | `work/m2d4-closeout-review` | `8015a05f1` | origin/main |
| m2d4-multi-carryover-2026-09-09 | `work/m2d4-multi-carryover` | `3a752db6c` | origin/main |
| m2d4-period-closure-2026-09-09 | `work/m2d4-period-closure` | `b0c6c0585` | origin/main |
| m2d4-refund-matching-2026-09-09 | `work/m2d4-refund-matching` | `609347ade` | origin/main |
| m2d4-settlement-2026-09-09 | `work/m2d4-settlement` | `5dffba4bc` | origin/main |
| managed-dispatch-integration-20261008 | `work/managed-dispatch-integration-20261008` | `4d114e307` | PR171 |
| model-agreement-computation-20261008 | `work/model-agreement-computation-20261008` | `2cd35b969` | PR170 |
| model-agreement-recovery-20261008 | `work/model-agreement-recovery-20261008` | `b8556f268` | PR170 |
| model-assessment-command-20261008 | `work/model-assessment-command-20261008` | `afea6de68` | origin/main |
| model-attempt-ownership-20261008 | `work/model-attempt-ownership-20261008` | `719687fc9` | origin/main |
| model-attempt-readers-20261008 | `work/model-attempt-readers-20261008` | `2b45c0c75` | origin/main |
| model-attempt-schema-20261008 | `work/model-attempt-schema-20261008` | `3ce5033e1` | origin/main |
| model-command-client-20261008 | `work/model-command-client-20261008` | `67be2aff9` | origin/main |
| model-evidence-publication-20261008 | `work/model-evidence-publication-20261008` | `30ce6651b` | origin/main |
| model-recovery-status-20261008 | `fix/model-recovery-status-20261008` | `6e53cd42e` | PR170 |
| model-relaunch-retention-20261008 | `fix/model-relaunch-retention-20261008` | `5fec27872` | PR170 |
| model-retention-restore-20261008 | `test/model-retention-restore-20261008` | `376f09933` | PR170 |
| model-run-state-publication-20261008 | `fix/model-run-state-publication-20261008` | `ce41dc153` | PR170 |
| model-stage-recovery-20261008 | `work/model-stage-recovery-20261008` | `cc0f60a26` | PR170 |
| october-integration-20261006 | `work/october-integration-20261006` | `3e106c566` | origin/main |
| owp-full-recovery-2026-09-09 | `work/owp-full-recovery` | `051b735fa` | origin/main |
| owp-preparation-2026-09-06 | `work/owp-preparation` | `398d8f0df` | origin/main |
| owp-reporting-2026-09-07 | `fix/owp-staff-workspace` | `dfdb98459` | origin/main |
| owp-review-2026-09-07 | `work/owp-review` | `e204cdeea` | origin/main |
| planner-action-followup-recovery-2026-09-10 | `work/planner-action-followup-recovery` | `3ffd2a415` | origin/main |
| project-calendar-dates-20261007 | `fix/project-calendar-dates-20261007` | `443e8e6ef` | origin/main |
| project-engagement-evidence-20261007 | `fix/project-engagement-evidence-20261007` | `4e72fb85b` | origin/main |
| published-model-custody-20261007 | `fix/published-model-custody-20261007` | `d1c46c2e7` | origin/main |
| recovery-acceptance-3cfaae4e | `detached` | `3cfaae4ea` | PR171 |
| relaunch-acceptance-276e2627 | `detached` | `276e26272` | PR171 |
| scientific-ingestion-review-20261008 | `fix/model-worker-state-receipts-20261008` | `be1caa62c` | origin/main |
| synthesis-execution-queue-20261007 | `work/synthesis-execution-queue-20261007` | `db48f48da` | origin/main |
| synthesis-history-ui-20261006 | `work/synthesis-history-ui-20261006` | `b720ba361` | origin/main |
| synthesis-native-output-types-20261008 | `fix/synthesis-native-output-types-20261008` | `c800c6bd3` | origin/main |
| synthesis-resource-assessment-20261007 | `fix/synthesis-resource-assessment-20261007` | `dcbf63c8c` | origin/main |
| synthesis-staff-generation-2026-10-02 | `work/synthesis-staff-generation` | `9775ab531` | origin/main |
| synthesis-supervision-20261007 | `work/synthesis-supervision-20261007` | `d2f92dcc8` | origin/main |
| thematic-import-ui-2026-10-02 | `work/thematic-import-ui` | `6f3ffa7b5` | origin/main |
| translation-command-workflow-2026-09-13 | `work/engagement-synthesis-generation` | `a8f718309` | origin/main |
| translation-resolution-qa-20260913-125bf2a3 | `detached` | `5a93ae99c` | origin/main |
| ui-ux-2026-10-01 | `work/ui-ux-review` | `08d8b12c9` | origin/main |
| v047-release-2026-09-09 | `work/v047-release` | `f65a27db9` | origin/main |
| v048-release-2026-09-09 | `work/v048-release` | `e39258b92` | origin/main |
| v068-evidence-20261007 | `fix/award-reopen-mobile-20261007` | `57a975301` | origin/main |
| v068-release-20261007 | `release/v0.68.0-20261007` | `10c3bc0ca` | origin/main |
| v1-integration-20261007 | `work/v1-integration-20261007` | `60920f8bf` | origin/main |
| workspace-switch-v0581-2026-09-13 | `fix/workspace-switch-v0581` | `ef16f1664` | origin/main |
| write-outcome-truth-2026-09-10 | `work/write-outcome-truth` | `3a6099c11` | origin/main |

## Method and retained evidence

The audit uses `git worktree list --porcelain`, read-only porcelain status with
optional Git locks disabled, `git for-each-ref`, and exact `merge-base
--is-ancestor` checks after `git fetch origin`. Symbolic origin aliases are
excluded from branch counts. GitHub PR check results are read separately from
Git ancestry. Working-tree scans use two concurrent read-only Git processes.

Full path/ref observations are retained privately as `worktree-audit-20261009.json`
and `branch-audit-20261009.json` in the OpenPlan state directory. This note records
the observed snapshot; later pushes or edits require a fresh comparison. The
commit containing this note necessarily follows the recorded PR #171 head.
