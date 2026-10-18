# First-week workflow assessment, October 17, 2026

Ten agent-run journeys completed against the isolated local installation at
`95c60a2`, application tree `6c2a069`. Five reached their outcome and five reached
it partly. No session was blocked or failed to finish. The outcome gate exits 1
because the selected set contains partial outcomes. This is not full Stage A or
v1 acceptance. The original reports and captures remain private and unchanged.

| Journey | Outcome |
| --- | --- |
| 02 Project end to end | Partial |
| 03 Public engagement | Reached |
| 04 Safety case | Partial |
| 05 Corridor analysis | Partial |
| 06 Land-use plan | Partial |
| 07 GIS handoff | Reached |
| 08 Portfolio workbook round trip | Reached |
| 09 Evidence bundle | Reached |
| 10 Governed decision handoff | Reached |
| 11 Model validation evidence | Partial |

## Corrections from this run

- Data Hub crashes because shared journal helpers eagerly load installed CLI
  adapters. Defer adapter loading until an actual connector cycle. The strict
  registry and exact supported versions remain unchanged.
- Analysis text treats an unavailable Census population as a zero-job estimate,
  and absent commute/vehicle data as a low walk/bike rating. Withhold those
  derived values and their narrative claims. Keep genuinely measured zeroes.
- The project overview says an uploaded boundary is missing. Recognize the
  uploaded extent and keep its unresolved place and authority identity explicit.

Focused checks exercise these corrections. The journal regression survives a
harmless comment and fails when eager loading returns. Analysis regressions
survive a harmless comment and fail when missing employment, missing walk/bike
inputs or an absent population denominator are treated as measurements. The
uploaded-area regression fails when its source or extent is ignored. All source
edits used for these controls are restored. These checks do not establish
provider operation, live source coverage or scientific model validity.

## Open findings and installation limits

Report generation advances the project evidence revision. Its retained readiness
payload therefore differs from a later live project export. Preserve the revision
protection and make the exact report snapshot available beside the artifact;
this workflow remains open. A populated board packet also has confusing evidence
counts before a deliverable is recorded.

Safety initially omits road matches later supplied during report generation and
can lose its source display after navigation. The bundle picker gives multiple
PDFs identical titles without dates or freshness cues. Journeys 09 and 10 report
the same picker issue, so this is one work item.

The fresh installation has no Census key, workspace home geography, loaded tract
coverage or processing/model-validation workers. These are setup limits, not
measurements of zero or model-validation failures. An existing local Census key
can be reused privately for focused reruns. No historical model study is promoted
from inconclusive, and no new scientific run is required merely to turn this
assessment green.

The eight stack migrations are applied to the authorized hosted installation.
PRs 330 and 331 are merged; PR332 waits for serial deployment confirmation.
The current assessment covers local workflows, not an authenticated hosted
acceptance run. Human feedback follows v1 under Nathaniel’s October 17 direction.

## Focused rerun and report correction

Five sessions finish against `ab8a373`: both setup journeys and land-use reach
their outcomes; project handoff and safety remain partial. Latest outcomes across
the two identified builds are eight reached and four partial. This is not a
single-build twelve-journey pass. The isolated installation now has its existing
Census key, workspace home geography and tract coverage. It still has no new
model-validation acceptance.

The report correction distinguishes an automatic generation writeback from a
real edit. It records the returned database revision on the newly created
artifact and refuses concurrent report changes. Explicit incomplete receipts
stay non-current. Legacy artifact treatment stays unchanged. The jurisdiction
export now hashes jurisdiction and registry inputs under schema v4; the global
project revision and bundle freshness checks remain in place. The PDF retains
the precise assessment snapshot used at generation.

Focused regression checks cover completed, concurrent, failed and incomplete
writebacks, later edits, legacy artifacts, source projections and assessment
hash stability. Harmless changes survive. Removing revision, receipt, schema or
input-scope protections produces the expected assertion failures, with source
restored afterward. These tests do not establish live database permissions,
transaction-wide source atomicity. Browser verification at `9a9d81f1b` generates
and downloads a real PDF through the isolated app. The project remains current
after generation, a real title edit immediately requests a refresh, and the
PDF's readiness hash matches direct JSON before and after generation. Desktop
and 390-pixel DOM checks show no horizontal overflow. The relevant PDF pages
are readable; the existing long summary and assessment cross page boundaries.
The T3 screenshot capture duplicates the narrow frame, so it does not establish
pixel-level layout fidelity. Raw captures stay private.

Safety road-match timing and source persistence, duplicate PDF picker labels,
land-use review links and vague validation messages remain open. PRs 330, 331
and 332 are now merged. Final combined hosted acceptance and the Stage A tag
remain pending. Human feedback follows v1.

The PR334 full-suite check finds three integration failures missed by the focused
selection. Generation now uses the shared zero-row result helpers, removes six
retired unverified-write inventory entries, and updates the RTP lifecycle mock
to enforce the revision predicate and artifact receipt projections. The source
inventory still rejects a new unobservable write. Its parser and thresholds are
unchanged. All 251 related tests pass with CI seed `266519`, including both
write guards and the RTP lifecycle. Mocked lifecycle checks do not establish
native RLS or concurrency.

## Merged-main project handoff

Journey 02 reaches its outcome on merged main `ae9c263`. Its PDF, standalone
readiness JSON and frozen bundle agree. A separate saved-file readback verifies
all eleven packaged checksums. Latest outcomes across the recent identified
builds are nine reached and three partial. Safety, corridor/model comparison
and model-validation evidence remain partial; this is not full v1 acceptance.

The rerun also finds two bounded defects. A date-only October 22 deliverable
appears as October 21 at 5 p.m. in the report. Preserve date-only values as
calendar dates without a clock. A jurisdiction change also leaves an earlier
packet marked current. Compare the retained v4 assessment's canonical hash with
current jurisdiction and registry inputs in project overview, Reports and report
detail. Distinguish changed inputs from an unavailable check, and preserve old
snapshot formats. Report creation still does not invalidate its own snapshot.
No migration is required. All 351 related tests pass with shuffled seed `266519`,
plus changed-file lint and affected TypeScript closure. Harmless controls survive;
seven targeted date, snapshot and caller faults fail as intended, with source
restored. Browser verification on `fddc4aa82` changes a saved jurisdiction through
the editor and observes the refresh warning in all three surfaces. Removing the
synthetic declaration and regenerating returns the packet to current. The actual
downloaded PDF shows October 22 without a clock, and retains the current
jurisdiction hash. Desktop and 390-pixel DOM checks show no horizontal overflow.
The rendered PDF date is readable. The T3 screenshot limitation above still
applies; bounded console readback does not establish an exhaustive clean console.
Raw captures and the original run remain private and unchanged.

PR review also finds an artifact-query error discarded by the Reports registry.
Preserve that outcome, disclose the failed read, and treat the jurisdiction
comparison as unavailable. A regression uses a generated packet whose timestamps
would otherwise appear current. A harmless comment survives; discarding the
error fails the expected assertion. All 77 affected tests pass again with seed
`266519`, plus lint and the affected TypeScript check. This covers the mocked
read failure, not a native outage or database permission test.

The PR335 shuffled run also exposes two source-guard integration failures. Remove
the retired Reports read-error debt entry and spell out both project column
lists so the existing projection scanner checks them. The parser and thresholds
stay unchanged. All 115 affected tests pass with the failing CI seed `95014`,
plus lint and affected types. A harmless comment survives; a discarded error
and nonexistent column fail the intended guards, with source restored.

## Report file selection

Journeys 02, 09 and 10 find indistinguishable PDF choices in the evidence bundle
picker. The picker now shows format, UTC generation time and artifact ID in each
report row and its checkbox name. A missing time stays unavailable. These details
identify the retained file; they do not label its sources current or change
default selection, revision tokens, frozen manifests or governed submission.
All 45 related tests pass with seed `95014`, including duplicate titles and
timestamps, HTML/PDF distinction, missing dates and the exact selection payload.
A harmless comment survives, and six deliberate label, format, missing-time and
selection faults fail the intended checks, with source restored. Lint, affected
types and product direction pass; existing direction reminders remain.

Chrome verification on `af1a8441d` follows Dashboard, Projects, the project and
its Evidence tab. Twelve actual report candidates have distinct accessible
names. Screenshots show readable format, UTC time and ID at desktop and 390
pixels, with no horizontal overflow or observed console errors. Toggling a
specific file changes that checkbox and restores correctly. No bundle is frozen
in this check. The first attempt targeted the closed tab, whose loading effects
were suspended; that navigation error stays in the private capture. This does
not establish hosted behavior or new artifact-byte validation. Raw captures stay
private.

The full QA run finds two GeoPackage disclosure tests still using the old report
checkbox name. Update both to the exact format, date and artifact label. Their
required-map, selected-report and automatic-location warnings remain enforced.
All 47 related tests pass with seed `95014`, plus lint. A harmless comment
survives; removing the default report selection or geographic-record warning
fails the intended assertions. Source is restored. Production code is unchanged
by this test correction.

## Aerial CI replay setup

Main `bd541e5` passes QA, shuffled tests and live RLS. The separate aerial
workflow fails in its `terminal-replay-recommit` fault check. Its replay setup
has not reached a saved terminal command, so an input trap fires before the
intended recommit trap. The original run does not retain the setup's failure
cause and remains failed.

The correction changes the test fixture only. Its stage bounds and nested
reader/custody bounds allow 15 seconds, and replay setup must retain its initial
acknowledgement before traps are armed. A failure now names the retained stage
and error type. Production deadlines and the existing exact diagnostic oracle
remain unchanged. A controlled 4.25-second loopback reply fails the old
four-second fixture and passes the new one; this demonstrates scheduling room,
not the unrecorded cause of the CI failure. The first outer-only timeout trial
still hits the nested reader clamp and remains recorded privately.

All 25 pipeline tests pass on Python 3.11.15 and 3.14.4. A harmless comment
survives; input reentry, recommit and incomplete setup each fail the intended
assertion. Source restores exactly. These checks use supplied application
replies, loopback HTTP and synthetic raster data. They do not establish live
photogrammetry or hosted behavior. Product direction and whitespace checks pass.

PR review identifies two remaining four-second bounds in the inherited input
fixture: URL intake and draft transport. Both now use the same 15-second
fixture budget. Separate controlled 4.25-second fetch and draft replies fail
with an input-stage timeout when their respective bounds stay at four seconds.
Both complete and replay without new effects at 15 seconds. Production source
and the exact fault oracles remain unchanged.

## Safety source restoration, October 18

Current-area coverage now has its own workspace, project and bounding-extent
query. The recent eight-import history remains separate. Coordinate comparisons
retain the shared round-trip tolerance. A failed current lookup is disclosed and
suppresses the fallback crash read; a history-only failure still permits the
verified current acquisition to load. No migration is required.

All 141 related tests pass, plus changed-file lint and affected TypeScript checks.
A harmless comment survives. Reintroducing the history cutoff, removing extent
filtering, ignoring a lookup error or permitting its fallback request fails the
intended assertions. Source restores exactly. The query tests model database
predicates and projections; they do not establish native PostgREST behavior.

An agent browser run uses main `231f4fba` plus the three pinned Safety edits.
The path through Projects into Safety retains the same source panel after leaving
and returning. Desktop and 390-pixel captures show the CCRS attribution, 390
reported and mappable records, and the unknown exact publication cutoff. The
filtered read returns 109 of 109 matching records. No page error, failed HTTP
response or horizontal overflow is observed. An earlier exact-text locator
timeout remains recorded privately; the count paragraph also carries a caveat.

Road-enrichment timing and bare `/safety` context remain open. This correction
does not close the Safety journey or establish hosted behavior. Separate hosted
checks reach Dashboard, Projects and Reports in an empty synthetic workspace;
populated hosted artifacts and public signup-email delivery remain unassessed.
Raw captures stay private, and human feedback remains post-v1.
