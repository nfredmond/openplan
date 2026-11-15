# Development preregistration: SEMCOG walk constants

Frozen before outcomes on October 23, 2026. Inventory commit: `ba29e6cc3`.
Named candidate: `semcog2015-walk-asc-development-v1`.
Component: primary-tour mode choice, individual home-based tours only.
This is a donor-transfer experiment, not national re-estimation or acceptance.

## Hypothesis and diagnosed boundary

The current MTC walk constants condition on purpose and household auto
sufficiency. A published second region supplies the same three walk indicators
with different values. Transferring those 27 constants will change expected
walk shares within purpose and auto-sufficiency strata while keeping all
travelers, destinations, times, other utilities and nests fixed. In particular,
the donor's lower auto-sufficient work and school constants predict lower walk
probabilities for those individual tours. A zero effect would challenge the
coefficient path; a different sign would challenge the mapping or instrument.

The August 16 rural walk-trip share motivates this test. It does not identify
coefficients as the sole cause, measure a local walk-share error, or provide a
target. This experiment does not fit a total, intercept adjustment, geographic
scalar or output-guided parameter. It transfers one predefined vector exactly.

## Authorized source and method

Use ActivitySim 1.5.1 `production_semcog/configs` files, downloaded from the
version-tagged public ActivitySim repository. Source files, their hashes and the
BSD license are retained under
`data/modeling/activitysim-semcog-walk-development-v1/source/`.
The source coefficient SHA-256 is
`4e7b7ed7e37672ec76ed0a3aa877708cb723207586074923946831c41dec482c`.

SEMCOG documents its 2015 household travel survey as its primary calibration
source. Its technical description, PDF pages 145 to 153, describes tour-mode
choice and says that all alternative-specific constants were adjusted during
Phase I calibration. These are **regional calibrated constants**, not a newly
estimated national vector. Exact correspondence between the published rounded
tables and this later example revision remains unverified. Donor coefficient
covariance is unavailable. Sources: [SEMCOG model description](https://semcog.github.io/TDM_ActSim/SEMCOG_ABM_Model_Description.pdf)
and [estimation memorandum](https://semcog.github.io/TDM_ActSim/SEMCOG_ABM_Model_Estimation.pdf).

Transfer `walk_ASC_{no_auto,auto_deficient,auto_sufficient}_{purpose}` for
`eatout`, `escort`, `othdiscr`, `othmaint`, `school`, `shopping`, `social`, `univ`
and `work`. Require exact name, template and expression compatibility at the
three WALK indicator rows. Keep all other coefficient bytes/lines, the original
MTC utility specification and nesting parameters. At-work and joint walk
constants stay unchanged. This is not a complete SEMCOG model transfer: other
modes, nests and spatial representations differ, which limits applicability.

## Development population and split

Use only the input bundle at
`data/agreement-study/runs/dev/06069/activitysim_bundle` in the main checkout.
The source registry already names this San Benito County population as
**development**. Do not open any old model output, agreement metric or holdout
directory. Copy only households, persons, land use, skims and input settings.
Hash every selected input before execution. All households in this development
bundle participate. No outcome-guided subsample, fit or selection occurs.

The coefficient vector comes from the external donor, so this transfer has no
local training partition. The entire named population is a development-only
evaluation partition, not an untouched acceptance set. There is no claim that
San Benito represents other counties. No 2017, 2009 or consumed 2022 acceptance
microdata may be read. No AequilibraE outputs or accuracy comparisons may enter.

## Held-fixed comparison and execution

Install the current accepted national auto-ownership overlay in the shared
upstream preparation. Run current ActivitySim 1.5.1 through
`non_mandatory_tour_scheduling`, with every household and seed 0. Copy that
checkpoint for baseline and candidate; execute only
`tour_mode_choice_simulate` in each branch. Capture native nested-logit choice
probabilities immediately before `logit.make_choices`, without changing them.
Require identical tour IDs, purpose, household/person attributes, origins,
destinations and schedules in both branches. Require finite nonnegative
probabilities, row sums within 1e-8, full chooser coverage, no duplicates, and
unchanged joint-tour probabilities. No trip-mode or downstream run is claimed.

The comparison measures expected primary-tour modes, not the earlier 17.5
percent trip share. Default bundle construction, accepted registry and stock
files remain byte-identical. The candidate is available only through the named
research command and cannot enter the accepted-component registry.

Before real access, prove source verification, exact transfer, checkpoint
preparation, native probability capture, aggregation, validator and sealed
runner publication end to end using synthetic input. Synthetic fixtures must
include purpose and auto-sufficiency variation, joint tours, and positive
WALK probabilities. Mutation controls cover each new guard and decision.

Freeze a machine-readable sealed-study lock after this preparation. Include
all evaluator/validator code, candidate bytes, source archive members, input
hashes, environment identity and this preregistration. Use the existing sealed
runner for its exclusive receipt and aggregate publication. No outcome retry
follows a real receipt. An interruption or source/instrument failure is
inconclusive and retires this run. Preserve the failure before any successor.
Run every model/heavy Python command under
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0`.

## Metrics, uncertainty and conservation

Report counts and baseline/candidate expected mode shares for every nonempty
purpose by auto-sufficiency by individual/joint stratum, plus marginal strata
and the population total. Auto sufficiency uses the specification's rules:
zero autos; positive autos fewer than workers; positive autos at least workers.
Retain empty prespecified cells as unavailable, not zero observations.

For each mode report conditional choice standard deviation
`sqrt(sum(p_i * (1-p_i))) / n` and the clipped normal 95 percent simulation
prediction envelope `mean +/- 1.96 * sd`. These describe simulated draws
conditional on fixed inputs and coefficients. They are neither survey
confidence intervals nor coefficient-transfer uncertainty. Expected shares are
deterministic. Report source/observation and coefficient uncertainty as
unavailable. Do not invent those intervals or use the simulation envelope as
an accuracy tolerance. Report all modes, count conservation and coverage.

Re-run synthetic preparation deterministically and verify identical numerical
aggregates. For real data, execute a second baseline probability calculation
from the same checkpoint within the one opening and require bit-identical
probabilities. This checks replay, not another observation or acceptance look.

## Advance or retire

Advance toward an applicability study only if all of these are true:

1. Source mapping, custody, default preservation, native coverage, conservation
   and replay checks pass.
2. A matched observed primary-tour-mode source exists for this population,
   period and purpose, with source-supported sampling uncertainty and a valid
   survey/runtime input crosswalk.
3. On those observations, paired weighted multiclass log-loss improves with a
   one-sided 95 percent uncertainty bound below zero and no prespecified stratum
   has a positive deterioration bound after Holm correction at 0.05.

No matched observed tour-mode source exists in the selected input bundle.
Therefore this design can measure sensitivity but **cannot advance the donor's
applicability**. Retire for missing transfer evidence even if walk share falls.
This is an explicit source-admission limit, not a substantive rejection of
SEMCOG's own calibrated model. Record `inconclusive` scientific status and
`retire` development disposition when observed evidence is unavailable. A source
or execution failure also remains inconclusive. Do not fabricate a score for
unavailable observations, reinterpret sensitivity as validation, select another
donor after results, change defaults or close S2. A later evidence study needs
a new preregistration and an authorized, compatible observed source.
