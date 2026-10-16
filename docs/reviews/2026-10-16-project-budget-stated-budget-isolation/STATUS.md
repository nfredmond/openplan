# Invalid stated budget preserves valid delivery work

The staged candidate isolates a malformed stated-budget source. Valid deliverables, direct spending and invoice lines remain available. The invalid budget stays unreadable, its amount stays null, and financial summaries remain withheld. Wrong project identity, wrong envelope version and malformed deliverable records still refuse the snapshot.

This report records the remaining P2 from independent review `e5f69c366ac2645fb2ddf88ffd69a64744db75d7`. That review found the earlier four P2 corrections addressed, then reproduced valid delivery records disappearing when stated-budget money failed validation. The source candidate adds the same lane-level failure boundary already used for direct spending and invoices.

## Source identity and custody

The worktree is `/home/nathaniel/.local/state/openplan/project-budget-cent-readback-worktree-20261016`, branch `work/project-budget-cent-readback-20261016`, based on `0ceedbbd174edb557e90b5bf6a144592e8120bb4`. Its staged application tree is `f520e01ef084e78f1bde90cbe4d6941facd2dae2`. Three source changes pre-exist this report turn. They remain staged, unchanged and uncommitted. This report commit owns its new documentation only. Exact source hashes appear in [evidence.json](evidence.json).

The source files are `budget-queries.ts`, the new `project-budget-stated-budget-isolation.test.ts`, and the added cases in `project-detail-page.test.tsx`. Migration 19 remains unchanged and unapplied. Its SHA256 is `ed2784b2b1623eb34340480d84dc72e5ce8d226c70532a5062495a1565df181d`.

## Recorded result

The before-fix selected run passed 10 cases and failed six, with 84 unrelated cases excluded. The corrected selected run passed all 16, with the same 84 excluded. The final related run passed 254 tests across nine files, with no failures or skipped tests. Changed-file lint and a seven-entry TypeScript closure passed. The compiler closure excludes the full page and board; it is not full-project compilation.

A harmless comment survived. Six source faults failed the intended assertions, then exact bytes were restored. [VALIDATION.md](VALIDATION.md) names those faults and the checks' limits. The final parent controller returned zero for session 85255. No test or service remains running from that controller.

## Remaining work

A fresh independent review must assess this exact staged source and evidence. Native migration, permissions, RLS, complete-row reads, controlled snapshot concurrency and identified-build desktop and 390px journeys remain open. The separate exact-money implementation must address aggregate cent loss before budget acceptance. This report does not close M11, approve a merge, authorize native operation, or establish finance, hosted or v1 acceptance.
