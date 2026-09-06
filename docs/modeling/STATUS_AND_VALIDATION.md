# Modeling status and validation

Reconciled September 6, 2026 with developer main `cc6c3feb` and the final first-week record. The source-level engineering findings originate in the September 4 review and are not new runtime reproductions.
This page routes present status; dated studies and frozen artifacts retain their
original findings. The [v1 contract](../product/V1_PRODUCT_CONTRACT.md) defines
the required destination and the [roadmap](../ROADMAP.md) owns future work.

## What execution establishes

AequilibraE and ActivitySim execution paths exist, with separate demand results
and assignment evidence. Keep each method identifiable through comparison,
reports, assistant explanations and downloads. Never average their results.
An executing worker, a completed assignment and a valid custody hash establish
different things; none by itself establishes accuracy for a planning use.

The ActivitySim launcher correction in `42e8a996` distinguishes an available
execution environment from a preflight-only poller. The guided-comparison repair
in `f0582670` separates ActivitySim assignment KPIs from AequilibraE KPIs.
Those development corrections are not a nationwide validation result. Consult
the [review](../reviews/TECHNICAL_PRODUCT_REVIEW_2026-09-06.md) for the reconciled
release and acceptance disposition.

The [August 16 execution record](ACTIVITYSIM_RUNTIME_GAP.md) documents an actual
earlier run and its adapter choices. It remains valid history; its closed
execution gap does not forbid reporting a later launcher or lifecycle regression.
Its sampled MTC path records borrowed behavior, period-invariant auto skims and
zero transit skims. Those are path-specific historical limits. A later native
worker record explicitly models transit, so a missing transit download cannot
establish absent configuration or execution. See the
[model-evidence correction](../ops/V044_MODEL_EVIDENCE_STATE_2026-09-05.md).
That record does not establish accepted transit accuracy or nationwide behavior.

## What the studies establish

| Development evidence | Interpretation |
|---|---|
| [Development validation](../../data/modeling/development-validation-study-2026-08-28/study-report.md) | Frozen development comparisons with incomplete scientific adequacy; not untouched nationwide acceptance |
| [Structural diagnosis](../../data/modeling/model-validation-structural-diagnosis-2026-08-28/study-report.md) | Diagnoses observation/network/model limitations; diagnosis does not repair the underlying behavior |
| [Comparable observations](../../data/modeling/comparable-observation-study-2026-08-28/study-report.md) | Improves comparability/accounting of evidence; it does not validate either demand method |
| [Structural demand diagnosis](../../data/modeling/structural-demand-diagnosis-study-2026-08-28/study-report.md) | Preserves structural uncertainties and separate method results |
| [Distributed work loading](../../data/modeling/distributed-work-loading-study-2026-08-31/study-report.md) | The overall candidate did not advance and remains inconclusive; no default changed or acceptance holdout opened |

The historical 43.3% median APE came from model selection in one county. It is
not independent or nationwide accuracy. LODES measures a source-bounded
home-to-work relationship; it is not all-purpose or non-work through traffic.
The v0.44 candidate's individual results cannot rescue a failed overall declared
advance rule by ranking, averaging or selecting favorable counties/methods.

The [frozen nationwide protocol](NATIONWIDE_VALIDATION_PREREGISTRATION_V1.json)
blocks an acceptance claim until decisive data, hashes, independent partitions,
observation intervals and use-specific criteria are frozen appropriately.
The current rules-v5 instrument remains diagnostic and always inconclusive;
future acceptance needs an implemented evaluator as well as a preregistration.

## Current engineering boundaries

The September 4 source review traced unresolved stage-silence versus independent-heartbeat behavior,
unchecked ActivitySim status writes and insufficient protection against a late
attempt's writes. These source-supported paths still need isolated fault tests.
A long computation must not be called abandoned merely for taking time; a fresh
process heartbeat does not establish progress or correct work either.

The published audit and comparison records for all fourteen distributed-work-loading
county-method cases matched their declared bindings and current summaries.
The verifier rejects a wrong source SHA. The sampled display loaders had latent
hash/summary consistency and missing-card disclosure gaps, not reproduced again in this reconciliation; production ingestion
and SQL omitted/NULL metadata behavior need separate proof. Preserve unsupported
or absent values rather than filling them with zero.

Read the [scientific review supplement](../reviews/2026-09-04-pre-handoff/independent-product-science.md)
for exact source traces. No historical artifact was altered to resolve a software
or documentation inconsistency.

## Before relying on an output

Identify the method, actual study geometry, input/source vintage, units and period,
network/observation coverage, loaded/unloaded/unmatched states, parameter provenance,
declared use, validation status and exact artifact. Compare quantities that mean
the same thing. Distinguish a source-supported observation interval from a
preregistered acceptance tolerance. An overlap is not proof that an estimate is
correct. Read the [validation research](VALIDATION_OBSERVATION_UNCERTAINTY_RESEARCH_2026-08-25.md).

Both methods must eventually pass independent, use-specific gates throughout all
states/DC and required archetypes, with deeper California proof. A national
aggregate cannot hide a local failure. Forecasting or environmental use requires
its own evidence. Keep absent, failed, unsupported and inconclusive states visible
on live and exported surfaces until the appropriate gate is actually satisfied.

## Final developer evidence and open use claims

The [final first-week record](../ops/V044_FINAL_FIRST_WEEK_OUTCOMES_2026-09-06.md)
retains nine passes and three partial outcomes, with no authorized v0.44 tag.
The model comparison remained an explicitly synthetic exercise and did not
establish a forecast or value for money. The model-validation reviewer understood
the inconclusive result and downloaded the evidence, but could not explicitly
confirm no arbitrary point cap and untouched-holdout access from visible prose.
Independent byte checks do not convert either partial outcome to a pass.

That record reports 123 distinct selected artifacts checked against frozen
sources or current custody. It separately identifies AequilibraE baseline
`f4ea5d65-92fb-4b85-9c85-b279240601b2` and its custody row
`cac9a54a-38f1-4bac-a3e5-895eabb9abb7`. The counts concern another area and do
not establish a same-quantity comparison. Validation not running is not a measured
accuracy failure. The separate ActivitySim entry and inconclusive assessment
retain their own full hashes. No output is averaged or promoted.

The final record also explains the misleading zero-run header. It counts legacy
links while the execution panel reads two native runs. KI-084 and KI-085 track
that summary and the checkpoint explanation; neither establishes lost output,
changed defaults or accessed acceptance data. Current filenames/hash disclosure
and downloads have bounded corrected evidence, while narrow columns remain open.

TimesFM 3 is a researched option for successor development, with the limitations
in [the technical research](../reviews/2026-09-04-pre-handoff/TIMESFM_TECHNICAL_RESEARCH.md).
No adapter, new model selection, operational forecast, scientific acceptance or
license clearance beyond that dated research is established here. Preserve the
frozen studies and their runtime environments.
