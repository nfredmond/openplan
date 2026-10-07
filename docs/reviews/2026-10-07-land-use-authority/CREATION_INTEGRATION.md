# Creation checkpoint and restart recovery

October 7, 2026. The restart preserved the owned worktrees, database fixtures,
control results and private checkpoint. Creation implementation is committed
and pushed at `c7032b63cb4eb6cd2e74ddfa849fd8d7c75fe653` in
[PR 126](https://github.com/nfredmond/openplan/pull/126). It depends on the
unmerged context work in [PR 125](https://github.com/nfredmond/openplan/pull/125).
Its evidence and unfinished workflow are recorded in
[the transaction review](CREATION_TRANSACTION.md).

The fresh [integration audit](creation/integration-audit.json) accounts for 57
local branches and 46 registered worktrees. All local branch tips match their
GitHub branches, and there are no stashes. The only working-tree change at the
audit is the unrelated canonical `.directory` file. Main is `80a829c2`.
Eight remote tips remain outside main: engagement execution controls, execution
progress, form recovery, context handoff, thematic inputs, frozen plan rules,
plan context and plan creation. They remain pending work, not lost changes or
completed integration. The benefit-cost worktree and its running server are
untouched.

PR 126 initially targeted its parent branch. The CI and RLS workflows only run
for main-targeted pull requests, so that configuration started only the restore
workflow. PR 126 now targets main, with its dependency on PR 125 retained in the
description. The follow-up push must start the main-targeted checks before any
merge decision. The pending parent also needs its final QA, RLS and restore
results; its shuffled suite, focused workers and three Python suites have passed
at `5a2679b0`. These are observed intermediate states, not final CI acceptance.

T3 still reports an automation-capable retained browser tab. A fresh screenshot
attempt after the restart fails with a client snapshot error. Earlier DOM
recovery evidence remains bounded by its original build. This checkpoint does
not add rendered desktop or 390px acceptance.

The next change must connect the existing POST and creator together. Replacing
only the POST would reject the current form's older payload. A draft replacement
handler is saved privately for resumption; it is not installed or verified.
Keep the backend checkpoint usable while finishing scoped draft retention,
exact pending requests, explicit retry, plan-owned rule selection and the real
navigation journey. No release tag is added.
