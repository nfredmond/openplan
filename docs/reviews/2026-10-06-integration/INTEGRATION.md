# October integration and next development boundary

Audit date: October 6, 2026 Pacific. This record covers registered worktrees, local branches, origin branches and stashes. The dated inventory is [worktree-inventory.json](worktree-inventory.json). It does not inventory ignored dependency caches or claim they belong in Git.

## Findings and custody

- The normal checkout started at `891a0d89`, 63 commits behind fetched main `eae9880d`. It now matches that fetched main. The `.directory` file is local desktop metadata and remains untouched.
- All existing branch tips except staff synthesis were already ancestors of fetched main. The 22 staff-synthesis commits through `9775ab53` join main without conflict.
- The independent-review worktree contained 65 publishable untracked files. Commit `3072fc15` preserves those reports and original evidence. Existing exclusions retain its private files, test stack and Python environment locally. A credential-pattern scan found no JWT, Mapbox token, provider key or private key in the published files.
- Outdated or absent remote branch references were pushed without force. The inventory records each local and remote tip. Merged worktrees remain on disk so ignored configuration and evidence are not lost.
- No stashes exist. Nathaniel confirms no other active OpenPlan editing or browser acceptance session.
- Main `eae9880d` has successful exact-commit GitHub QA, shuffled tests, worker checks, live RLS, browser smoke and populated upgrade checks. Historical health failures returned by broad listings do not describe that commit. Staff head `9775ab53` had no GitHub checks at audit.
- The demo initially served `32dbc44b388e`. Nathaniel then used OpenPlan Control to update it. The supplied update log and the live identity both show `eae9880dc83e`, matching fetched main at audit. That successful update does not establish acceptance of this later integration.

## Worktrees at audit

| Branch | Commit | Unmerged into integration | Working changes |
|---|---|---:|---|
| `main` | `eae9880d` | 0 | Local desktop metadata |
| `work/engagement-response-snapshots` | `e006b98b` | 0 | None |
| `work/assistant-audit-outcomes` | `d87a04d4` | 0 | None |
| `work/contract-reconciliation` | `76f019bf` | 0 | None |
| `fix/development-dependency-advisories` | `5d7ccdb0` | 0 | None |
| `work/engagement-first-workflow` | `860260ba` | 0 | None |
| `work/engagement-response-writes` | `88fb20b6` | 0 | None |
| `work/engagement-write-recovery` | `3f70af98` | 0 | None |
| `work/explicit-agent-consent` | `4d02130b` | 0 | None |
| `fix/independent-review-20261001` | `ca3e442c` | 0 | None |
| `review/independent-20261001-01` | `3072fc15` | 0 | None |
| `work/m11-delivery-closeout` | `5850d63e` | 0 | None |
| `work/m2d3-reimbursement` | `88de2d23` | 0 | None |
| `work/m2d4-closeout-review` | `8015a05f` | 0 | None |
| `work/m2d4-multi-carryover` | `3a752db6` | 0 | None |
| `work/m2d4-period-closure` | `b0c6c058` | 0 | None |
| `work/m2d4-refund-matching` | `609347ad` | 0 | None |
| `work/m2d4-settlement` | `5dffba4b` | 0 | None |
| `work/october-integration-20261006` | `5b580803` | 0 | None |
| `work/owp-full-recovery` | `051b735f` | 0 | None |
| `work/owp-preparation` | `398d8f0d` | 0 | None |
| `fix/owp-staff-workspace` | `dfdb9845` | 0 | None |
| `work/owp-review` | `e204cdee` | 0 | None |
| `work/planner-action-followup-recovery` | `3ffd2a41` | 0 | None |
| `work/synthesis-staff-generation` | `9775ab53` | 0 | None |
| `work/thematic-import-ui` | `6f3ffa7b` | 0 | None |
| `work/engagement-synthesis-generation` | `a8f71830` | 0 | None |
| `detached` | `5a93ae99` | 0 | None |
| `work/ui-ux-review` | `08d8b12c` | 0 | None |
| `work/v047-release` | `f65a27db` | 0 | None |
| `work/v048-release` | `e39258b9` | 0 | None |
| `fix/workspace-switch-v0581` | `ef16f166` | 0 | None |
| `work/write-outcome-truth` | `3a6099c1` | 0 | None |

The later UI worktree, `work/synthesis-history-ui-20261006` at `b720ba36`, brings
the registered total to 34. It is clean, pushed and merged into integration
`d4b85e30`. The final scan finds no other unpublished source changes outside this
integration's evidence files and the canonical checkout's desktop metadata.

## Next completed outcome

The [roadmap](../../ROADMAP.md) remains the sole queue. The new bounded M9b outcome lets a staff member find saved synthesis requests from the campaign and inspect their original source, stage, author and cancellation state. The existing caller-scoped history route supports this read. A saved request is not proof that preparation or provider execution completed.

The identified browser journey starts from sign-in, then Dashboard, Engagement, campaign, Analysis and saved source. The history stays collapsed until requested so it does not bury staff review controls. Native pages contain 25 and 16 requests; the rendered order and cancellation states match all 41 native records. Refresh resets the list to the newest page. Desktop and 390px views preserve full identifiers without horizontal overflow. A connection failure clears the list with an unavailable notice. A deliberately mismatched expected account receives a real HTTP 403 and clears retained source and request details. Reopening through campaign navigation restores the authorized 25-row view. No new requests or provider calls are made.

The [browser record](history-browser.json), [desktop list](images/history-desktop.png), [desktop details](images/history-desktop-details.png) and [390px details](images/history-390px-details.png) retain this synthetic software evidence. It does not establish public participation, practicing-planner usefulness, full accessibility conformance or real-browser write recovery. The existing denied-access notice says the account changed even when permission cannot be confirmed; the private content is cleared, but that wording remains imprecise.

Creation, preparation, cancellation, provider authorization, retained output, proposal import and review then need one coherent campaign workflow. Use the existing recovery modules and approval registry. Do not add a second execution system. Keep external provider calls opt-in and preserve original command identity after uncertain replies.

Broader v1 priorities remain the complete agency workflows, independent installation/recovery, accessibility, geography/authority coverage and separate nationwide scientific validation. This audit does not promote capability cells, refresh old review dates, claim legal currency or declare v1 ready.

## Verification

The first combined QA exposed an unused history endpoint, an omitted migration in the changelog, an undocumented preparation-worker directory, two stale schema exceptions and a roadmap expiry assertion that contradicted the adopted development policy. These are corrected. The historical review date remains unchanged. Mutation records cover the [history UI](history-ui-mutations.json), [roadmap guard](roadmap-guard-mutations.json) and [schema inventory](schema-inventory-mutations.json).

The next combined run passes 1,435 test files and 18,144 tests, with 84 files and 1,524 tests skipped. It then finds eight dependency advisories. The [dependency correction](DEPENDENCIES.md) records their resolution, CLI compatibility checks and limits.

Final clean-install local QA passes on the integrated application source. It records 1,436 passing files and 18,146 passing tests, with 84 files and 1,524 tests skipped. Provider connector checks pass 387 tests; the dependency audit and its 18 regression checks pass with zero reported vulnerabilities. Webpack compilation, TypeScript and the production build pass. The log SHA-256 is `19c3e69b97d81e1e9f8cb24ae8e83507463a9ccd9c7779d8f72993e4a506c3a7`. Local QA intentionally does not run the live RLS fixtures. The later direction-document changes pass their eight focused checks.

Production follow-through identifies `923b5c5a` and build `C3FZrAOEO0wbpZp9gqWZf` in the integration checkout. Real campaign navigation reaches the saved source and history, loads 25 then 41 requests and shows full details at 390px without document overflow. [Desktop](images/production-desktop.png) and [390px](images/production-390px.png) captures supplement the earlier refusal/recovery journey. No new application console error is observed; the tab retains an earlier refused HMR connection after its development server stopped. The owned production server is stopped after inspection.

The [populated upgrade from v0.66.0](https://github.com/nfredmond/openplan/actions/runs/37560712039) passes on `d4b85e30`. Later candidate commits alter documentation only; application, worker, script, harness and workflow paths match. Exact-head GitHub QA, shuffled tests, live isolation and full archive recovery remain pending at this documentation checkpoint. Their final disposition belongs to [PR #115](https://github.com/nfredmond/openplan/pull/115); a push or a cancelled superseded run is not passing evidence.

The past-month reflog contains 618 distinct tips. Thirteen no longer have a live branch reference. [Their disposition](reflog-disposition.json) identifies the merged equivalent or superseding change for each. Superseded raw captures that contain a provider token are not republished. The safe replacements and retained evidence remain in main's history.

The original branch evidence remains in [staff-generation progress](../2026-10-02-staff-generation/PROGRESS.md). The historical [independent review](../2026-10-01-independent-code-review/FINAL_REPORT.md) and [fix disposition](../2026-10-01-independent-fixes/DISPOSITION.md) retain separate dates and conclusions.

## Subsequent review correction

Before merge, GitHub review exposes an expiry-related preparation recovery defect.
The [correction and evidence](PREPARATION_RECOVERY.md) preserve the reproduced failure,
additive migration, 35 passing native cases and 111 focused tests. Earlier candidate
results above remain dated evidence; final-head verification restarts in PR #115.
