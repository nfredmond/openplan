# CI corrections

The first PR #327 QA job, run 38661127061 at 7058d4b61, fails before tests. Full repository lint uses `--max-warnings 0`. It reports one unused fixture variable in the stopping-observation test after the callback correction. The local changed-file lint command omitted that warning cap and exited zero. It did not meet the CI lint standard.

The correction removes only the unused variable binding. Application behavior and assertions remain unchanged. Source 05 repeats all lifecycle/wiring/startup fault controls against the corrected test bytes. The final local check uses `eslint --max-warnings=0` across the complete PR source diff, followed by the narrow type check, 107-case shuffled regression and direction check. The corrected source campaign and strict final commands pass, and their reports bind the restored bytes. The failed CI and earlier local reports remain in the private proof packet.

Fresh exact-head CI remains required. A previous passing subset or a lint-warning exit zero is not a passing QA gate.

## Actual preparation CLI and migration ordering

The QA and shuffled jobs at `0f1fdf508693` each fail six assertions. The earlier
dedicated observation workflow passes on those bytes, but does not run the
existing actual preparation CLI suite. That omission is the blind category
the broader CI found. The shuffled run uses seed 256781 and reports 22,819
passing, six failing and 1,662 skipped cases. It is not a passing suite.

Two valid CLI tests count every request as a business request, including the
new diagnostic RPC. Three invalid-startup cases expose a real ordering defect:
observation HTTP can start before argument or directory validation rejects the
invocation. Configuration now validates before the observer starts. The valid
tests count the exact dedicated observation path separately, require the real
final stopped-write attempt, and still count unknown paths as unexpected
business traffic. Invalid invocations keep their zero-request assertion.
The source controller now includes all 13 actual CLI cases, not just substituted
entry-body startup tests.

The sixth CI failure requires the changelog to name
`20261017000015_node_queue_process_observations.sql`, rather than only its
version. The entry is corrected. Neither failed test is removed or weakened.

Source 06 passes four 33-case cohorts and 54 targeted faults. The separate idle
CLI control passes four positive runs and one targeted fault. The restored
126-case related cohort passes with the failed seed, alongside scoped types,
strict changed-file lint and direction. These local results do not replace
fresh full exact-head CI. Private raw failed logs remain in `ci-0f1f/`.
