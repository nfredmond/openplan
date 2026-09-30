# Native request verification

September 30, 2026. This checkpoint retains private synthesis requests and
cancellation receipts. It does not enable model generation or declare a release.
[Implementation and limits](REQUESTS.md) explain the native commands and the
remaining M9b work.

The tested source builds on `bddcd9f1`. [Machine-readable evidence](native-checks.json)
records code/test hashes and private log checksums. All four installed native
function bodies match the migration source after the fault tests; their trusted
schema ordering remains intact.

| Check | Observed result |
|---|---|
| Full QA | Passed, including lint, dead-code checks, 16022 tests, provider connector checks, dependency audit and production build. 868 tests skipped; native isolation ran separately. |
| Shuffled tests | Passed 16022, skipped 868, seed 650934. |
| Installed database isolation | Passed 772, skipped 125, across 69 files in the explicitly selected disposable database. Includes all 40 request-custody checks. |
| Native request faults | One baseline, a harmless comment control, unrelated/same-request lock probes, one retained redundant-guard survivor, and 35 targeted failures. |
| Inventory/operator evidence faults | One harmless control and eight targeted failures, with source restored. |
| TypeScript | Passed with a 6144 MB heap after the first default-heap invocation exhausted memory. |
| Isolated migration | Added migration 352 without resetting the database. The unreleased create function was corrected in place after a reproduced refusal mismatch. |

The first full checks caught the missing migration name, stale relation counts
and unexplained SQL-only fields. Those failures remain in local logs. The first
native fault run exposed the redundant workspace-check survivor. A subsequent
actor probe exposed the cancelled-absent-request refusal mismatch; its regression
failed against the old function before the correction. These findings are part of
the evidence, not successful initial runs.

The inventory checks do not establish runtime reachability. Native checks do not
establish provider behavior, concurrent revocation during a provider call,
usefulness, final generated review content or browser recovery. No new UI journey
is claimed. The separate full RLS result is required because the ordinary QA gate
explicitly skipped fixture writes with `OPENPLAN_RLS_GATE=0`.

GitHub CI, RLS and the populated upgrade workflow must be inspected on the pushed
commit. This internal checkpoint does not tag a version, upgrade the demo or
remove any V1 requirement. Remaining work includes durable execution plans,
bounded dispatch authorization, uncertain-call recovery, retained outputs,
complete context consolidation and explicit staff import into review history.
