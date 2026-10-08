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

## Completion-read correction

A follow-up audit found that the final unfinished-stage query treated any falsy JSON response as an empty list. HTTP 200 with `null`, `{}`, `false` or an empty string could therefore authorize a run-success write. That GET also had no transport timeout.

The worker now requires HTTP 200 and a JSON list, with a 30-second timeout. An empty list permits the existing completion write; a nonempty list leaves the run incomplete. Failed HTTP, malformed JSON, non-list payloads and transport errors stop completion with an explicit unconfirmed-read error. This check is outside the stage failure handler, so an uncertain completion read does not rewrite a successfully completed stage as failed. Public log text excludes transport exception detail.

The push-trigger suite passes all 28 checks. The added process-stage test uses synthetic computation and mocked HTTP. It covers valid empty and nonempty lists, null/object/boolean/string responses, HTTP 503 and 403, JSON parse failure and timeout. It checks the request timeout and run filter, retained successful stage, run writes and absence of false completion logging. The original source fails the new check. A harmless comment passes; accepting non-list JSON, ignoring HTTP status, removing the timeout and leaking the transport exception each fail. Restored source passes.

These checks do not establish live network timeout behavior, attempt fencing, host recovery or atomic completion. The stage-list read and run-status write remain separate operations. M3 still needs ownership and reconciliation work; this correction does not claim to close that boundary. Logs remain in the private proof directory as `completion-read-*.log` and `completion-read-controls.json`.

## Claim-receipt correction

The conditional claim used a separate unchecked response path. Any nonempty JSON counted as a successful claim; HTTP errors counted as a lost race; malformed JSON became an empty result. A network call also had no timeout. The claim now uses the same exact returned-record verifier as state writes, with the existing queued-status condition and a 30-second timeout. Only a confirmed HTTP 200 empty list returns `False`. One matching row returns `True`. Other responses raise `WorkerStateWriteUnconfirmed`, preserving the distinction between a lost race and a possibly committed claim with no valid acknowledgement.

All 29 push-trigger checks pass, as do the 26 ActivitySim assignment-handoff checks. The new mocked claim cases cover normalized timestamps, extra returned metadata, empty results, HTTP errors, wrong IDs, missing or changed values, multiple rows, JSON errors and request exceptions. The existing conditional-claim test retains its URL and lost-race assertions. Both modified tests pass a harmless comment and restored source. Five adverse controls are caught: ignoring record identity, ignoring payload values, treating HTTP failure as loss, removing the queued condition and removing the timeout. The pre-correction suite fails the new test.

This does not establish a native simultaneous claim race or add per-attempt fencing. A claim acknowledgement can be lost after the stage becomes running, so recovery still requires persisted-state reconciliation. The timestamp-based reaper and stage-ID-only later writes remain separate M3 boundaries. Proof files use the `claim-receipt-` prefix in the private proof directory.

## Native conditional-claim evidence

At source commit `08e0a1e7`, five fresh synthetic stages were each claimed by two concurrent HTTP requests using the production `sb_claim_stage` function. Every round returned one `True` and one `False`. Independent PostgreSQL reads confirmed running status and the winning request's distinct log marker. The probe verified that the resolved database port belonged to `supabase_db_openplan-restore-target-2026091050` before creating fixtures.

A harmless payload copy retained that result. An adverse call through the production state-write helper without the queued predicate returned two winners, which the one-winner check rejected. This establishes that the assertion distinguishes unconditional writes from the conditional claim behavior.

A separate fresh stage exercised acknowledgement loss. The real HTTP PATCH completed, then the test transport raised a timeout before returning the response to the claim helper. The helper raised `WorkerStateWriteUnconfirmed`; an independent database query found the committed running stage. A subsequent normal claim returned `False`. This is a simulated lost acknowledgement after a real commit, not a killed process or a network-fault injection.

The probe uses concurrent requests in one test process. It does not execute a scientific stage, establish distributed process recovery, or supply attempt fencing. Those boundaries remain open. Synthetic fixture identities and exact results remain in `native-claim-race.json`; the retained executable probe is `native-claim-race.py`, both under the private proof directory.

## ActivitySim receipt parity

The ActivitySim poll worker retained the older unchecked stage/run updates and truthy claim response handling. Its generic failure handler could also overwrite a successful stage after completion acknowledgement loss. The same returned-record checks now apply in that independently packaged worker. Confirmed empty claims remain lost races; uncertain writes raise. The completion query requires a JSON list and confirmed HTTP response, and completion logging follows the successful run write. Read uncertainty and write uncertainty bypass the stage-failure rewrite.

All 31 tests in `workers/activitysim_worker/tests` pass. Existing mock responses now represent the requested PostgREST returned records, preserving the prior behavioral assertions. Three added tests cover stage/run/claim receipts, completion reads and uncertain stage/run completion through the real process-stage handler with synthetic computation. Original code fails those tests. Harmless and restored controls pass; six adverse mutations are caught for record identity, values, HTTP failure, overwriting possible success, null completion responses and false claim-loss reports.

The production ActivitySim claim helper also passes five concurrent native request races in the named disposable stack, with independently queried winner markers. A harmless copy passes, removing the queued predicate admits two winners, and a timeout injected after a real committed claim remains uncertain. The private `native-activity-claim-race.json` records the pre-commit base and tested source hash. These are claim requests, not ActivitySim computations or separate worker processes.

Artifact and KPI insert receipts in ActivitySim remain unchecked in this change. Attempt ownership, atomic completion, stale-worker fencing and restart reconciliation remain open for both workers. Native and mocked proof files use `activity-receipts-` and `native-activity-claim-race` prefixes in the private proof directory.
