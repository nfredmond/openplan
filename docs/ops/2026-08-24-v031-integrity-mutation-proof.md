# v0.31 model-run integrity mutation proof

This is release evidence for the worker, cancellation, and roadmap guards. Each
mutation was applied to the working candidate, the named focused check failed
for the expected behavior, and the original code was restored by editing it
back before the green run.

| Control | Mutation | Observed failure |
|---|---|---|
| Active callback identity | Inverted the stored-job comparison. | The stale callback test received 200 instead of 409 and caught that artifacts would have been reachable. |
| Attempt isolation | Removed the job id from `data/screening-runs/<countyRunId>/<jobId>`. | The same-geography retry test found identical attempt directories. |
| Stored attempt identity | Restored detail-presentation fallback that generated a random payload when none was stored. | The presenter test found a worker attempt on a run whose enqueue state was `not-enqueued`. |
| Failure callback boundary | Changed the command-construction exception callback from `failed`. | The worker lifecycle test observed the wrong terminal callback after forced `FileNotFoundError`. |
| Cancellation and queue release | Changed the running process's cancellation callback. | The single-worker test still ran the second job but failed because the first never reported `cancelled`. |
| Heartbeat custody | Replaced the active job heartbeat timestamp with null. | The running-callback test observed the missing timestamp. |
| Bearer control | Bypassed the worker-token dispatch refusal. | The transport test reached the network stub instead of naming the missing token. |
| Assistant refusal | Added a synthetic `cancel_model_run` registered kind. | The executable refusal named it as an offender. |
| Planner confirmation | Bypassed the shared confirmation before the cancel request. | The planner-surface test could no longer find the cancellation `alertdialog` and failed before the cancel call. |
| Active-attempt polling | Broadened detail-page polling to every nonterminal county stage. | A `not-enqueued` run refreshed after five seconds instead of remaining idle. |
| Stage and worker-state separation | Changed the incomplete setup label back to `Running`, then separately restored the stale `job is still in progress` caveat. | The stage-helper test caught both contradictions; live worker state remains a separate badge. |
| Active roadmap expiry | Set the review date to the prior day. | The roadmap guard failed with the exact expired date. |
| Worker-suite discovery | Narrowed the guard back to worker-root test files. | The nested-suite assertion lost the county worker and failed; the restored runner executes 45 suites across all five workers. |

Two initial Python mutation invocations used obsolete test names and failed in
test discovery, which proves nothing. They were rerun with the discovered class
and method names; only the behavior failures above count as evidence.

The first stored-attempt mutation also used an invalid request fixture, so the
old fallback never ran and the test stayed green. After the fixture was made a
valid stored request, restoring the fallback produced the behavior failure
recorded above. The vacuous first run is not counted as evidence.

The guard's deliberate blind spot: roadmap prose is not scanned for product
claims. Only the unique active marker, reviewed commit, release format,
review-by date, machine-listed paths, and npm commands are checked. Historical
records remain historical rather than becoming a second claim scanner.
