# Project controls use the project's workspace role

October 15, 2026. Local corrective implementation for
[PR330 finding P2](https://github.com/nfredmond/openplan/pull/330#discussion_r4285653413).
The source confirms the reported mismatch: the page loads projects through the
caller's RLS client and scopes writes to the project's workspace, but its nine
permission flags previously used the active workspace's role. This report
confirms the source defect and mocked server-page correction. It does not
confirm a real multi-workspace browser journey or database permission result.

## Ownership and starting point

The assigned clean branch `t3/pr330-project-membership-role-fix` in
`/home/nathaniel/.t3/worktrees/openplan/t3-6c674048` starts at `05dd3e8da`.
Its own branch advances with `git merge --ff-only` to exact parent
`401c44a0f7bfe4b54740e2c3d07e30f8ed36f169` before source changes. The parent
checkout `t3-e33fc359` retains PR330 integration and operating ownership.

The implementation reads current AGENTS.md, the external coordination record,
the binding contract, roadmap, capability matrix, October 6 direction review,
architecture, known issues, development release policy, project jurisdiction
design and correction report, and V6 parent operating report. Planner-writing,
prove-it and any-place apply. The direction check exits zero with the existing
registry/matrix age and reviewed-version reminders. It refreshes no evidence.

Owned paths are the project detail page, its directly focused page test, this
report directory and the new private receipt directory
`~/.local/state/openplan/privatepr330-project-membership-fix-20261015`.
No other checkout, old source, database, proof, demo or canonical entry is edited.
Frozen V6 APP49 and database OID 6150036 receive no operation from this lane.
Their preservation here follows the operation scope, not a fresh native audit.

## The page resolves project authority after reading the project

After the RLS project read succeeds, the caller's client reads `workspace_members`
with projection `role`, `workspace_id = project.workspace_id` and
`user_id = user.id`, using `maybeSingle()`. A read error discards even a returned
owner role. Missing membership, missing role and unknown role also deny writes
through the existing action matrix. A query error enters the page's existing
read-failure disclosure.

The same project role supplies posture/RTP linking, stage-gate decisions,
identity/jurisdiction editing, delivery, estimated cost, funding awards, map
editing, evidence bundle generation and record editing. Existing bare viewer
checks now use `plans.write`; owner, admin and member retain their write tier,
while unknown roles fail closed. Named stage-gate and program actions retain
their existing matrix entries.

The active workspace resolver and admission branch stay in place. This change
does not select a different active workspace, alter navigation/header context,
change a route or RLS policy, or change project geography. Study geometry,
jurisdiction declarations and workspace home retain their existing owners and
resolution paths. No geographic literal or country-specific rule is added.

## Focused evidence and controls

[The test configuration](vitest.config.mts) uses an owned ignored Vite cache,
runner config loading and one Vitest worker. Dependencies come through the
assigned checkout's ignored node_modules symlink to the authorized read-only
donor `t3-0f743997/openplan/node_modules`. No installation or donor cleanup runs.
Every check executes under
`~/.local/state/openplan/compiler-repair-checks-20261015.lock` in an owned
transient check service. The requested cgroup memory cap is 1,536 MiB, swap
allowance is zero, and the Node heap limit is 1,024 MiB.

The page suite passes 81 tests. Ten new parameterized cases inspect the actual
server page's composed props across all tabs, including inactive tabs. The page
and its permission calculation are real; authentication, database results,
active workspace resolution and other existing boundary mocks are synthetic.
Cases include both reverse-role combinations, project admin/member, same
workspace owner/viewer, missing membership, missing role, unknown role and an
error accompanied by stale owner data. They assert all nine flags, exact role
projection and both filters, project-read-before-membership order, unchanged
active membership, active workspace admission and read-error disclosure.

[The mutation runner](verify_controls.py) restores the original page bytes in
`finally` after every trial and again around the campaign. It also checks that
the test bytes remain exact. `controls03` confirms one harmless comment edit
survives all ten cases and 30 targeted source faults fail with the named
AssertionError. Faults include the stale active role in both reverse cases,
allowing all controls for a viewer, all ten scenario outcomes, ignoring a read
error, each of nine flags independently, the projection, both identity filters,
active-context mutation, removed active admission, altered failure disclosure,
a missing composed panel and moving the lookup before the RLS project read.
The runner rejects crashes, empty/skipped selections, wrong test names and
unexpected failure diagnostics. Source bindings and sanitized results are in
[evidence.json](evidence.json).

The first page run fails because the implementation calls a nonexistent
`ReadFailureLog.collect` method. It is corrected to the existing `check` method;
the original failed run stays private. `controls01` rejects the harmless trial
because Vitest quotes interpolated case labels and the initial exact selector
executes zero tests. `controls02` corrects that selector and confirms a real
survivor before trusting any fault result. The final `controls03` repeats all controls
against the final source bytes. The rejected zero-test trial does
not count as a surviving control or an assertion fault.

The first final-check attempt passes 92 tests across the page and three focused
membership files, with shuffle seed 330 and one worker. Lint rejects the added
query because the page reaches 1,205 counted lines against its existing 1,200
limit. The new lookup is compacted without changing its behavior or the limit.
The final-byte repeat passes all 92 tests across four files with seed 330,
changed-page/test ESLint with zero warnings, and source diff whitespace checks.
Its source hashes match the final control campaign exactly. The final check
service reports rounded memory peak `546.1M` and zero swap; `controls03` reports
`399M` and zero swap. Final cgroup event counters are not captured. These are
check-process resource receipts, not application service or native acceptance.

## Boundaries remain open

These tests cannot establish actual Supabase role projection, RLS enforcement,
revocation timing, HTTP 403 behavior, installed/native operation or service
recovery. Composed flags do not prove that every child honors its flag, every
other action is hidden, or every route authorizes correctly. The unchanged
membership source guard is syntactic and cannot establish either filter's real
identity or database behavior. Active-workspace helper tests use mocked state.
The mutation classifier checks retained Vitest assertions, not browser behavior.

No browser, database, application service, build, full suite, hosted/provider
operation, push, merge, release or nested delegation occurs. No hand-seeded
fixture is created. Whole-application type checking is not run in this lane.
The parent still needs an identified changed-head desktop and 390px
multi-workspace journey, console review and any relevant native permission
checks. Previous APP49 native/browser/artifact evidence remains attached to its
frozen source and does not accept this changed head. Practitioner, public,
scientific, legal and full v1 acceptance remain unconfirmed.
