# Resume retained API turns

Active full v1 goal remains open. v0.54.0 is already released. Main
`c858b89e7293ce90fb9afea67ce481b7bcd0a8fa` has successful CI 34722018877 and
RLS Isolation 34722018874. Continue A0b; do not repeat old releases.

Implementation checkout:
`/home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10`, package
`openplan/`, branch `work/planner-agent-api-connections`. Preserve the root
checkout, demo and unrelated reminder constraint. No other agent or browser
acceptance collection was observed in this tree.

The new migration `20261012000002_assistant_api_turns.sql` is implemented and
applied only to the explicitly named disposable stack at API29821/DB29822:
`/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050`.
Its matching migration file was copied into that stack's own migrations folder.
The stack now includes this migration; do not reset or apply it again manually.

`assistant-api-turns-rls.test.ts` has 16 focused live SQL cases. The final restored
run, exec 88368, passed 80 cases with the 64 existing provider-history cases.
Changed-test ESLint and diff checks also passed. Read VERIFICATION.md for the
discovered test errors and unproved boundaries.

Both mutation campaigns are terminal. Initial exec 76455 exited one because a
fault failed on an independent usage-ledger guard instead of the expected
assertion. Revised exec 83063 exited zero: one harmless control survived and 27
faults failed for their recorded reasons. All nine committed function bodies
matched the migration source afterward; hashes are retained. The 80-case replay
then passed. Do not restart any of these completed handles.

## Usage reset checkpoint, September 12

The user is approaching the weekly usage limit. Preserve this checkpoint and
resume in this thread after reset; do not restart the product plan. The full v1
goal remains active. Continue verified delivery directly to main without PRs or
human engineering-release gates. This working branch is a recovery checkpoint,
not a release or a request for review.

Concurrent API lifecycle coverage is now implemented in
`openplan/src/test/assistant-provider-concurrency.test.ts`: ten new API cases,
with the eight existing cases retained. The API-only baseline passed ten cases.
The final concurrency mutation campaign survived its harmless control and killed
three faults for their named reasons. `concurrency-mutations.json` retains the
result and `initial-concurrency-mutations.json` preserves the initial expected-
message mismatch. Both changed database function bodies were restored and hashed.
Private recovery state is at
`/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/concurrency-mutations/state.json`;
it reports `phase: restored`. Do not rerun mutations alongside other DB tests.

The TypeScript retained-turn projection/decoder now accepts API snapshots while
preserving legacy provider records. Nineteen new decoder cases plus existing
route/API tests passed 110 tests in three files. Decoder/projection mutation
proof is still pending. No API POST selection, worker or project UI is joined.
Settings must retain their generation-unavailable disclosure until that path is
executable and browser-verified.

A fresh checkpoint TypeScript check FAILED, exit one, with four fixture errors in
`openplan/src/test/provider-api-turn.test.ts` at lines 51, 59, 64 and 107. The first
three assign deployment_api_key where the narrowed API branch expects a connection
auth mode; the fourth assigns codex where the fixture type became api_connection.
Read the fixtures and preserve their actual legacy behavior when repairing typing.
Do not cast away the error or weaken the production discriminator just to pass.
Changed-file ESLint passed, exit zero. The earlier truncated command output was
not recoverable; no corresponding process remained, so these checks were rerun.

Immediate next work:

1. Repair those fixture types, rerun TypeScript and the focused suites, and prove
   the decoder/projection guards with harmless and targeted mutations.
2. Replay all 18 concurrency cases. Wire the new assistant-api-turns-rls.test.ts
   into the explicit package test:rls-live command, which currently omits it.
   Inspect file parallelism before combining these suites: claim selects globally
   and committed concurrency fixtures must not race other API fixtures.
3. Run full isolated RLS, upgrade, applicable full QA and shuffled tests on the
   final implementation. Do not claim the lifecycle main-ready before these pass.
4. Join the existing provider-api-generation adapter to the local worker and
   project panel, reusing native connector private journal primitives. Claim once,
   reserve once, abort on lost access/cancellation, and retry delivery without
   regenerating. Browser acceptance needs identified build, desktop and 390px,
   keyboard, console, interrupted retry and immutable history evidence.
5. Land verified increments directly on main and inspect CI before release tags.

No compiler, linter, Vitest or mutation process remains running at this checkpoint.
No new generation option or release is claimed. All fixtures stay synthetic and
free; no external provider call is needed. Preserve the root checkout, demo,
private credentials and unrelated reminder constraint.
