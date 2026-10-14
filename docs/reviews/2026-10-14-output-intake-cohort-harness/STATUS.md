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
