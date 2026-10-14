# Full output-intake cohort harness allowance

Claude reports two GitHub failures on the unchanged worker portion of PR #299,
run 38512671435 attempts 1 and 2. The full 27-case restored-after-harmless cohort
exceeds the harness 30-second subprocess limit. These are reported timeout
failures, not an established runtime logic defect. The prior main worker gate
passes separately; that does not disprove a slower runner failure.

The correction gives each full positive cohort 90 seconds. Each named fault
keeps 30 seconds. Production network, ownership, cancellation, byte and actor
limits stay unchanged. No assertion, expected failure or test case is removed.

The policy check extracts the actual nested execute function and observes its
subprocess arguments. Before correction it fails the intended full-cohort
budget assertion. Under Python 3.14 and 3.11, baseline, harmless and restored
controls pass; shortening the full allowance or widening named-case allowance
fails that assertion. This spy proves argument selection, not elapsed-time or
application behavior. The source itself stays unchanged during those controls.

The real corrected controller passes four positive 27-case cohorts, 30 targeted
faults and 210 failure-oracle controls under Python 3.11. Source restores in
finally. The actual service uses a 256 MiB cap and peaks at about 65.7 MiB. Fresh
CI is needed to establish the affected runner result; no production or v1
acceptance follows from this correction.

Private proof:
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-intake-cohort-timeout-20261014/`.

## Separate main deadline counterexample

Main 90182a0c49736527531a8caf23b5a799a34ab1df fails the ordinary worker
suite in job 115720370306, run 38524132995. Its budget-composition test uses
one second for all work, a 0.04-second individual RPC budget and a 0.12-second
loopback delay. The final current-access read exhausts the overall deadline.
That is a valid production deadline refusal and an unstable success expectation
on a slower runner. It is distinct from the harness subprocess timeout above.

The revised test observes the deadline forwarded into the actual original-output
Transport. It requires more remaining stage time than one individual RPC budget,
delegates the real loopback transfer once and checks the original archive hash.
The test uses a 120-second operation and five-second individual read allowance,
without an artificial server sleep. Production limits remain unchanged. The
probe does not establish wall-clock expiry or stalled-transport cancellation;
those remain separate existing transport checks.

Both Python 3.11 and 3.14 pass four positive 27-case cohorts, 32 faults
and 224 oracles per interpreter.
Shortening the stage to one RPC budget fails the intended comparison. Bypassing
the recorded transport and corrupting the returned hash also fail their named
assertions. Source restores in finally. The services peak at about 66.7 MiB and 68.8 MiB under 256 MiB. New-head
CI remains pending.
