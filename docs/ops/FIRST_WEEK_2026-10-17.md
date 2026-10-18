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
