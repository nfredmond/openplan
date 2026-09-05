# v0.44 release continuation

This supersedes the September 1 release-readiness checkpoint, not its frozen
modeling results. The September 5 checkout is not yet release-ready.

## Approved database change

Nathaniel approved the FARS constraint replacement and requested CI monitoring.
`npm run db:sync` applied `20260904000001_persist_fars_crashes.sql` locally.
A separate database query confirmed that `safety_crashes_source_id_check`
accepts `ccrs-ca` and `fars-national`. No crash records were deleted or rewritten.
FARS remains a fatal-crash census, not all-severity or serious-injury evidence.

## CI correction

At `9ec13026`, upgrade run 33936721573 and RLS run 33936721630 succeeded.
CI run 33936721673 failed. The release gate first rejected stale source hashes
for the land-use registry, crash registry, and FARS adapter. Current readiness
bindings now refer to those reviewed bytes; partial and unavailable claims
remain unchanged. Historical v0.42 hashes remain untouched.

After that correction, the direction guard correctly rejected the missing
v0.44 fresh-context review. The current review still describes v0.43 and cannot
be relabeled as new evidence. A new packet and independent reviews are required.

The broad Safety/readiness run also exposed two old fixture assumptions:
selecting a different area should clear the previous area's acquisition. The
headline and disclosure fixtures now begin with matching saved study areas.
The panel test expects the updated source hash.

All 378 tests in 28 Safety/readiness files passed after restoration. A harmless
comment mutation survived all 25 tests in the three changed test files.
Replacing the displayed hash, substituting one crash for the counted total,
and hiding the stored FARS caveat each failed its specific assertion. All three
behavioral mutations were restored. These component tests do not prove browser
layout, live source availability, or database isolation.

## Still required

Recheck the saved FARS acquisition and report handoff from visible navigation,
then run the full twelve-job first-week outcome gate on the final checkout.
Complete the new product-direction record without rewriting dated reviews.
Run the unexcluded QA gate and inspect remote CI before tagging. Do not change
frozen model artifacts, defaults, acceptance rules, or holdout access.
