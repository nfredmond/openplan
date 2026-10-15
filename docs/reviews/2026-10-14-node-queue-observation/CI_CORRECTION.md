# Strict lint correction

The first PR #327 QA job, run 38661127061 at 7058d4b61, fails before tests. Full repository lint uses `--max-warnings 0`. It reports one unused fixture variable in the stopping-observation test after the callback correction. The local changed-file lint command omitted that warning cap and exited zero. It did not meet the CI lint standard.

The correction removes only the unused variable binding. Application behavior and assertions remain unchanged. Source 05 repeats all lifecycle/wiring/startup fault controls against the corrected test bytes. The final local check uses `eslint --max-warnings=0` across the complete PR source diff, followed by the narrow type check, 107-case shuffled regression and direction check. The corrected source campaign and strict final commands pass, and their reports bind the restored bytes. The failed CI and earlier local reports remain in the private proof packet.

Fresh exact-head CI remains required. A previous passing subset or a lint-warning exit zero is not a passing QA gate.
