# Fence model writes by execution attempt

October 8, 2026. Source inspected at `d120871c`. This is the next M3 implementation boundary, not an implemented recovery feature.

## Reproduced defect

In the named disposable database, the production ActivitySim claim helper claims a fresh synthetic stage. The existing `reap_model_run_if_stale` RPC then marks that stage and its run failed. Subsequent production `sb_patch_stage` and `sb_patch_run` calls from the original execution both succeed and change the records back to succeeded. Independent PostgreSQL queries establish all three states. The returned-record checks correctly describe the writes, but do not establish permission to write after ownership ended.

The probe invokes the reaper transaction directly with a fresh snapshot cutoff. It isolates terminal-state ownership; it does not test the time-based liveness classifier, run a scientific computation or wait for a real worker timeout. Exact synthetic identities and states are in the private `native-late-worker.json`, with executable probe `native-late-worker.py`.

The launch route at `openplan/src/app/api/models/[modelId]/runs/[modelRunId]/launch/route.ts` resets existing stage rows to queued. Both demand workers later write stages by ID. A predicate requiring only running status cannot distinguish an old worker from the new worker after the same row is reclaimed. The AequilibraE process lock does not coordinate different processes. Adding a token solely to scientific-assessment ingestion would leave ordinary stage writes and artifacts exposed.

## Implementation decision

Extend the existing model run and stage lifecycle. Preserve historical records and do not manufacture attempt identities for old artifacts.

1. Add retained execution-attempt records and an active attempt reference on each managed stage. A claim command takes a caller-created request identity and returns the exact attempt identity. Repeating an identical request resolves the same claim; changing its payload fails. A lost acknowledgement must be resolvable without executing the scientific stage again.
2. Require the attempt identity on progress, completion, failure and new artifact/KPI records. Verify the actual run, stage, active attempt and lifecycle state in database commands. Guard direct writes so an older worker cannot bypass the attempt check through its existing REST PATCH path. Service-role access alone is not an execution ownership token.
3. Lock the parent run and stage in a consistent order for claims, terminal writes, reaping and relaunch. Reaping and relaunch invalidate prior ownership in the same transaction. Run completion derives from the required stages inside that transaction, rather than a separate list query followed by an unconditional run update.
4. Preserve separate AequilibraE and ActivitySim attempts under their actual stages. Scope execution context to the current invocation, including thread/process boundaries. Clear it on every exit. No global run-ID token cache may authorize a later invocation.
5. Bind retained artifacts and KPIs to the producing attempt and a stable write request. Exact retries resolve existing records. A different payload under the same request fails. Use immutable object keys and verified logical bytes; database metadata alone does not establish a valid Storage upload. Keep unknown historical provenance explicit.
6. Define expiry and reconciliation separately from cancellation and computational failure. Missing heartbeat proves lost contact, not invalid scientific output. A late attempt cannot regain authority by streaming a log. Resumption must reconcile the persisted command and output boundary before choosing whether to continue, retry or require review.

Both packaged workers, the launch route, reaper and artifact readers must move together. Deployment must prevent older workers from running against managed stages; do not silently allow legacy writes when an attempt check fails. Document rollback and upgrade behavior before applying the enforcing migration to a non-test installation. This design changes no migration or running worker today.

## Required proof before claiming recovery

Use the same native late-write probe as a regression: after reaping or relaunch, the old attempt's state and artifact writes must fail without altering the new attempt. Test simultaneous claims in separate processes, lost claim acknowledgements, exact retry, changed-payload rejection, heartbeat interruption, cancellation, reaper/claim races and long computations. Exercise both worker packages and actual launch/recovery routes. Verify that direct legacy REST writes cannot bypass the command boundary and that historical records remain readable. Restore populated journals, database records and exact output bytes on another installation. Keep scientific accuracy and planner acceptance separate from this operational proof.

The roadmap remains the sole queue. This plan supplies the attempt identity required by the adjacent scientific-ingestion design; it does not reduce the full M3 or S1 scope.
