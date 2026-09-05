# First-week execution records must prove completion

An interrupted browser job had an early findings report but no execution.json.
The verifier defaulted the absent exit code to zero, then called the execution
completed. That real report said no, so its outcome still failed. A separate,
explicitly synthetic yes report with no execution record or browser events
demonstrated the false-green path: the old verifier accepted it as passed.
No real product journey was falsely accepted during this investigation.

The verifier now requires a recorded clean process exit before accepting a
completed execution, including after repairing a stale failure classification.
Missing, malformed, empty, missing-exit, null-exit, nonzero-exit, and terminated
records remain blocked_execution_record and inconclusive. Proven quota, browser,
and other infrastructure failures keep their specific reason. Interrupted jobs
remain resumable; earlier attempts are not rewritten or deleted.

Nine cases cover the missing and invalid records, including two stale-status
repair paths. Completed fixtures now explicitly record exit zero. A no-op
comment survived. Restoring the old behavior made seven cases incorrectly
completed and failed those assertions. Checking the old status rather than the
resolved status made two terminated cases incorrectly completed and failed both
assertions. The restored discovery suite passed all 44 checks.

An initial bypass-only mutation also produced null-property exceptions for
missing records. Those exceptions are not credited as evidence of the intended
guard. The old-behavior mutation was rerun to obtain the stated completed-versus-
blocked failures. Logs are retained under `/tmp/openplan-v044-exit-guard-*.log`.

The fix was prepared outside the canonical checkout while its twelve-job run
continued unchanged, then incorporated into the isolated price-year worktree.
Discovery, evidence, regression-outcome, and model-download checks were rerun
there. One command initially named a nonexistent regression-outcome test file;
the correct first-week-regression.test.js was then located and run. That command
error is not counted as a test result. Integration into main and verification
of the complete real run remain outstanding.

This guard proves terminal-record handling, not the truth of agent prose or the
authenticity of manually fabricated execution records. Build identity, browser
evidence, console review, artifact hashes, and independent finding review still
matter. It changes no planner task, exercise fixture, or scientific acceptance
rule, and does not relabel partial outcomes as reached.

## Combined-check follow-up

The first regression-suite attempt also lacked the worktree's Playwright
dependency link. After linking the existing qa-harness/node_modules, all four
commands passed together: discovery, evidence, regression outcomes, and model
download verification. No package was newly installed.

A read-only application of the new verifier to the actual ongoing run found
three passing completed jobs and one failed completed job. The project job
reported yes, but its console contains a 400 from /api/projects/import when
clearing the price year became zero. It does not pass the full outcome gate.
The active Safety job, which has an early report but no exit record, is correctly
inconclusive under the new guard. Earlier progress wording that treated all four
yes reports as passing was too broad; I disclosed the correction. The console
failure remains recorded and is not allowlisted away. The prepared nullable-year
fix addresses the invalid request; a fresh full run is still required.
