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
