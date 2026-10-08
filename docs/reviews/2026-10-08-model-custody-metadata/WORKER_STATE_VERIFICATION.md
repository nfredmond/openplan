# Confirm worker state updates before continuing

October 8, 2026. Development correction under M3/S1, pending integration.

## Failure and change

`sb_patch_stage` and `sb_patch_run` sent unbounded PATCH requests and ignored
their responses. Rejected or empty writes returned normally. A lost completion
acknowledgement could enter the generic failure handler, which then wrote a
contradictory failed status over a possibly committed success.

Both helpers now use a 30-second transport timeout and require HTTP 200 with
exactly one returned row. Its ID and requested values must match. Timestamp
comparison permits equivalent ISO timezone formatting; extra fields remain
valid. Failed, missing, changed or unreadable receipts raise
`WorkerStateWriteUnconfirmed` without exposing response bodies.

The stage executor propagates uncertainty instead of writing another terminal
status. The run-complete log follows confirmation. The push executor no longer
claims that errored runs necessarily have unchanged stages. A missing response
proves neither rollback nor successful completion.

## Verification

- All 27 push-trigger checks pass. Three new checks cover successful receipts,
  failure/malformed receipts for both helpers and lost stage/run completion
  acknowledgements through `process_stage`. The original worker fails all three.
- All 26 existing ActivitySim assignment handoff checks pass.
- Seven targeted mutations fail: ignoring HTTP status, omitting the timeout,
  ignoring returned values, overwriting uncertain success with failure, ignoring
  the returned ID, logging completion before confirmation and losing the distinct
  transport-uncertainty exception. Harmless controls pass; source is restored.
- A native probe verifies the configured database port for the disposable
  `supabase_db_openplan-restore-target-2026091050` stack. Both helpers update
  synthetic rows through PostgREST, accept normalized timestamps and reject
  nonexistent IDs. A separate native read confirms saved statuses. No model runs.
- `git diff --check` passes. Private logs, controls and native probe/results are
  under `~/.local/state/openplan/s1-metadata-20261008-proof/`, prefixed
  `worker-receipts-` or `native-worker-receipts`.

The first invocation used system Python and stopped before tests because its
fallback Shapely stub lacked `shapely.ops`. The corrected invocation uses the
installed AequilibraE worker environment. During the first complete regression
run, an existing heartbeat fixture attempted a local request with synthetic
credentials and received 401. Subsequent mock suites use loopback port 9; only
the explicit native probe targets the disposable database.

## Remaining boundaries

This does not add per-attempt fencing, durable command journals or automatic
restart reconciliation. A stopped attempt can retain a running database state
until reconciliation or a reviewed retry handles it. Generic stage claims and
later writes still need the broader M3 ownership work. Long model execution,
host-loss recovery and nationwide scientific acceptance remain unverified.

The native probe covers successful receipts and missing-row refusal. Lost
acknowledgements and rejected responses use controlled requests. PR #155's
running full QA and GitHub checks cover its earlier commit, not this follow-up.
No release or full worker-recovery claim follows.
