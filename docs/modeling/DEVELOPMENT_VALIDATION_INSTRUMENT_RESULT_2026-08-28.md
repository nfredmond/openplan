# Frozen development validation instrument result

Date: 2026-08-28

Release: v0.39.0

Study: `california-seven-county-observed-count-instrument-v2`

## Decision

The instrument is ready and the study is scientifically **inconclusive**.
All seven county custody gates passed before any model output was opened. The
runner then evaluated unchanged AequilibraE and ActivitySim baselines with the
same frozen county network, observation package, and pre-volume match audit.

No use-specific acceptance rule was frozen and no observation was both
decisive and fully comparable on model year, day, period, direction, and
vehicle basis. The results therefore cannot pass or fail either model. They did
not change a default, calibrate a candidate, open an acceptance holdout, select
a method, or support a California or nationwide accuracy claim.

## What the run found

`Matched` and `unloaded` below are post-assignment outcomes for observations
whose link choice was frozen before volumes were available. Raw median APE is
shown only as a diagnostic; `—` means no observation could be computed.

| County | Method | Matched | Unloaded | Ambiguous | Excluded | Unresolved | Raw observations | Raw median APE |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 06007 | AequilibraE | 0 | 4 | 151 | 4,260 | 4,312 | 4 | 100.0% |
| 06007 | ActivitySim | 0 | 4 | 151 | 4,260 | 4,312 | 4 | 100.0% |
| 06039 | AequilibraE | 6 | 0 | 84 | 3,234 | 2,856 | 6 | 96.1% |
| 06039 | ActivitySim | 4 | 2 | 84 | 3,234 | 2,856 | 6 | 98.1% |
| 06047 | AequilibraE | 0 | 0 | 174 | 5,433 | 6,348 | 0 | — |
| 06047 | ActivitySim | 0 | 0 | 174 | 5,433 | 6,348 | 0 | — |
| 06053 | AequilibraE | 4 | 6 | 155 | 5,756 | 6,864 | 10 | 100.0% |
| 06053 | ActivitySim | 4 | 6 | 155 | 5,756 | 6,864 | 10 | 100.0% |
| 06057 | AequilibraE | 4 | 0 | 98 | 3,270 | 2,892 | 4 | 2.4% |
| 06057 | ActivitySim | 4 | 0 | 98 | 3,270 | 2,892 | 4 | 6.0% |
| 06069 | AequilibraE | 0 | 0 | 27 | 1,217 | 1,755 | 0 | — |
| 06069 | ActivitySim | 0 | 0 | 27 | 1,217 | 1,755 | 0 | — |
| 06107 | AequilibraE | 6 | 0 | 244 | 11,552 | 7,806 | 6 | 329.3% |
| 06107 | ActivitySim | 6 | 0 | 244 | 11,552 | 7,806 | 6 | 18.5% |

The raw figures are not comparable enough to rank the methods. In particular,
the model base year and day basis remain unproved, source-supported intervals
were unavailable for the computed rows, and the Grade B TMAS records generally
did not land on frozen network matches. Grade C records remain diagnostic and
Grade D records remain coverage evidence.

## Source and custody result

Caltrans and HPMS attempts were available for all seven counties. The complete
2024 TMAS package contained county observations for 06007, 06047, 06057, and
06107; it was explicitly `supported_but_empty` for 06039, 06053, and 06069.
Unavailable and empty states were never conflated.

The machine-readable record is
`data/modeling/development-validation-study-2026-08-28/study-result.json`.
Per-method comparison bases and assessments are stored under the adjacent
`results/` directory. They bind the preregistration, network, observation
package, pre-volume audit, model output, basis, assessment, Git SHA, and app
version hashes. Exact downloaded source bytes, county network databases, and
model workspaces remain in local frozen custody and are omitted from Git
because they total several gigabytes; their SHA-256 manifests are tracked.

## Next scientific question

Use the frozen development instrument to explain unmatched observations,
unloaded links, missing temporal comparability, and method disagreement. Do not
fit these rows, change stock defaults, or open an acceptance holdout. A later
use-specific rule must be preregistered from primary evidence before untouched
outcomes are visible.
