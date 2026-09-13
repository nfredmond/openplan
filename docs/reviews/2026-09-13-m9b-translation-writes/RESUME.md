# Resume after usage reset

Read [USAGE_RESET_HANDOFF.md](USAGE_RESET_HANDOFF.md) first. It records the newest
unfinished editor implementation, browser failure, retained evidence and next checks.

# Weekly usage checkpoint, September 13, 2026

The latest continuation is [WRITE_BOUNDARY_PROGRESS.md](WRITE_BOUNDARY_PROGRESS.md).
Start there for the route/recovery checks, fixed acknowledgement gap and remaining
editor integration. [WRITE_PROGRESS.md](WRITE_PROGRESS.md) retains the earlier
weekly-reset backup. This work is unfinished and not released.

Continuation after this checkpoint repaired the runner, exercised competing
database sessions and added a complete snapshot reader. Start with
[SNAPSHOT_PROGRESS.md](SNAPSHOT_PROGRESS.md) for that earlier verified result.
The original stopping point below is
retained as history, not the current test status.

The user is approaching the weekly usage limit and asked whether this thread
can resume after reset. Preserve this checkpoint rather than depending on live
processes or conversation recall. Full V1 remains the authorized goal. Continue
directly to main after applicable verification, without a PR or human review
release gate. Keep operation free and local; preserve the pending reminder
constraint, original checkout and demo.

## Where to resume

Owned checkout:
`/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`
on `work/translation-command-workflow`, application package `openplan/`.
The starting commit for this checkpoint is `24d5d948`.
Read [NEXT.md](NEXT.md) for the complete workflow and
[READ_PROGRESS.md](READ_PROGRESS.md) for the committed pagination work.
Do not restart from the old v0.47 plan. v0.58.0 is already published at
`18c50222b7f9ab440c9274cc5696f70871710679`; its publication record is in
`../2026-09-13-m9b-translation-custody/PUBLICATION.md`.
Post-publication main was `88fb20b619f9108c29c7102ca20fb6423f553e45`.
Recheck remote state on resumption. The original `/home/nathaniel/code/openplan`
checkout is intentionally stale and was not changed.

## Saved unfinished implementation

`translation-command-candidate.sql` is a rollback-only prototype, not an
installed migration. It implements exact source/version checks, atomic batches,
sealed request receipts and confirmed retry results for save/accept/withdraw.
Generated-result publication explicitly refuses until durable generation exists.
Legacy direct writes remain; no new API, editor or worker uses this command.
It must not be described as a finished or released workflow.

The serial SQL probe and its mutation runner recorded expected outcomes for
baseline, harmless comment and twelve targeted failures in
`translation-command-controls.json`. Private logs are under
`/home/nathaniel/.local/state/openplan/response-write-probe-20260913`.
Failed earlier attempts are retained there too. The JSON is recorded evidence,
not a rerun. The source compatibility probe uses Node's actual trim behavior
for 26 independently hashed cases.

The last concurrency runner FAILED before exercising its first command:
`TimeoutError: Lock holder did not report readiness`.
See `translation-command-locks.log` in the private directory. No successful
concurrency result is claimed. The runner process has ended; there is no live
probe to poll. Its finally block rolled back the holder.

First repair the runner's readiness loop: text-mode read(1) buffers bytes that
select cannot see. Use os.read on stdout's descriptor and accumulate the marker.
Also fix the timeout mutation's expected failure: query_canceled is not caught
by PostgreSQL WHEN OTHERS, so removal of the bounded lock wait can produce
the statement-timeout error instead of the expected PT503 assertion.
Then run real two-connection controls and targeted mutations.

Two more probe improvements remain: give the "existing address presented as
absent" case an explicit correction reason so another guard cannot mask an
overwrite; verify rollback removes every candidate function/history column,
not only the receipt table. Rerun affected controls after changing them.

All SQL probes target only the named disposable container
`supabase_db_openplan-restore-target-2731143`, DB port 28762, schema
328 migrations through `20261014000009`. The separate app stack uses 29821/29822.
`translation-command-lock-fixture.json` identifies deliberately retained
synthetic source fixtures. Do not casually delete their immutable history.
At this checkpoint a fresh read confirmed: candidate receipt table absent,
two fixture categories retained, zero fixture translations. No reset or DROP
was performed. Existing demo records were not a probe target.

## Process and acceptance boundaries

The owned dev server on 3260 was stopped after identified-checkout root access.
No concurrency runner or 3260 dev process was found at checkpoint time.
Root navigation was observed in Chrome, but this is not translation workflow
acceptance. Reestablish browser/build identity when restarting.

The pagination checkpoint has recorded focused/full unit, type and lint evidence.
The new complete workflow still requires installed/PostgREST reads and writes,
concurrent corrections and source changes, interrupted retries, durable generation,
all producer conversions, real desktop/390px navigation, keyboard and console
inspection, full QA/shuffled/RLS/worker/upgrade checks and final release CI.
Preserve exact raw source words, original baselines and scientific claim limits.
Continue the roadmap toward the full V1 contract after this increment.
