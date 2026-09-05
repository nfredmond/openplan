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

## Subsequent correction and diagnostic journey

The initial registry correction used the raw file hash in a field that binds
normalized JSON. This was my error. The current normalized binding is
`ba3a8a2216c18bbf96d8a195467c6c8d6ee5f4d5cbc730511394a4ae5e908c11`.
The source-file entries still bind their downloaded or checked-in bytes.

The broad app run exposed two missing server-only test-environment declarations,
a stale non-California crash-coverage fixture, copy-ledger drift, and an omitted
migration entry in Unreleased. The fixtures now distinguish national FARS
coverage from unavailable coverage in New Zealand. The copy uses clearer review
links; the ledger deliberately permits the scientifically necessary phrase
"crash records" so it cannot become a claim about people.

The Safety run `2026-09-05T02-17-34-837Z` is diagnostic only. It produced a
451,835-byte PDF and retained four evidence-complete findings, but its outcome
was partial and the harness rejected the dirty checkout as `blocked_build`.
Code changed while this run was collecting findings. It does not prove a
fixed-build outcome, and no release claim may cite it as a passing journey.

The two false-output findings are now guarded in code. Severity choices outside
the source's coverage say "not covered" and cannot produce an apparent zero.
History names each requested year without implying a continuous observed span.
The report's Evidence tab and generated document share the same saved-summary
disclosure, and the page query explicitly selects the source metrics it needs.
Stored runs and old report artifacts remain unchanged. A transient ranking
failure that recovered and unclear summary-length validation are queued in
both the issue register and capability registry.

The harmless comment control survived 155 tests in twelve files. Eight isolated
behavioral mutations then failed for their named reasons: unsupported severity
bands, mislabeled requested years, exposed contradictory prose, omitted source
metrics, rejected national coverage, swallowed scenario-read failure, missing
review instructions, and extra ledger vocabulary. The summary mutation failed
both the rendered Evidence component and generated-document test. The metric
projection mutation failed independently of a mock's returned data. All were
restored. Static copy checks still do not prove visible reachability.

The local live-RLS run passed 132 tests in eighteen files. All 51 worker suites
passed. The production dependency audit initially found the xmldom advisory
GHSA-6gmq-8vp8-gcm6 in Mammoth's transitive dependency. Only xmldom changed,
from 0.8.13 to the maintained patched 0.8.15 release; the production audit then
reported zero vulnerabilities. This is not a claim that development dependencies
have no advisories. The advisory is documented by the maintainer at
https://github.com/xmldom/xmldom/security/advisories/GHSA-6gmq-8vp8-gcm6.

Independent direction reports and their exact input packet are preserved under
`docs/reviews/product-direction/independent/`. The packet uses `.txt` because
its quoted roadmap marker must not register as a second active roadmap.
