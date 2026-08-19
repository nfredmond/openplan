# National behavioral estimation: source boundary measured 2026-08-18

This is a dated measurement, not a promise that the upstream download will stay
the same. It records the first executable slice replacing ActivitySim's borrowed
Bay Area behavior with nationally estimated parameters.

## The method, and the trap it avoids

OpenPlan will not fit one scalar per region. The measured count-calibration
residual is distributional, and a scalar cannot repair which trips occur, which
mode people choose, where activities happen, or when tours run.

The defensible route is ActivitySim's own estimation workflow:

1. convert a household travel survey into observed household, person, tour and
   trip choices;
2. create estimation data bundles for the component choice models;
3. estimate parameters with survey weights;
4. validate on whole geographies excluded from estimation; and
5. publish a versioned coefficient package whose source, component coverage,
   diagnostics and holdouts determine its claim tier.

The US source adapter is `scripts/modeling/us_nhts_survey.py`. Country-specific
survey concepts stop there; the future coefficient-package contract above it
must not know what a Census division or FHWA is.

## What the federal download returned

Measured from the official CSV URL on 2026-08-18:

- URL: `https://nhts.ornl.gov/media/2022/download/csv.zip`
- SHA-256: `64530c396d5f164d2259a22f7042f27bee5147babcd367568ddbfafe6c8bf34c`
- compressed bytes: 4,533,528
- households: 7,893
- persons: 16,997
- trips: 31,074
- vehicles: 14,684

The downloads page advertises **2022 V2.1**, whose release notes add the
summarized `TRIPMODE` field. The archive above contains that field and satisfies
the adapter's measured source contract.

An important false start is retained because it explains the guard: the
plausible URL `/assets/2022/download/csv.zip` exists and returned a 3,916,688-byte
older archive (SHA-256
`210a4e7092a0135f15c95f001836669949cd6a1f515620bce496c84250527bf2`)
without `TRIPMODE`. Inspecting the site's shipped application bundle revealed
that its actual V2.1 link uses `/media/`, not `/assets/`. The adapter would have
refused the stale bytes rather than deriving `TRIPMODE` locally and silently
creating an OpenPlan-specific survey release.

The source boundary is therefore open for estimation work. Until component
estimation and holdout validation are complete, the existing executed
ActivitySim lane remains truthfully labeled as borrowed Bay Area behavior.

## Weighted diary mapping now measured

`scripts/modeling/us_nhts_diaries.py` maps the V2.1 archive into auditable
household, person, tour and trip diaries while retaining every raw
mode/purpose code.
Measured on the full archive:

- 7,893 weighted household records;
- 16,997 weighted person records;
- 31,074 weighted trip records;
- 11,064 complete home-based tours reconstructed from 27,779 trips;
- all trip modes mapped;
- 31,006 trips eligible for tour reconstruction; and
- 47 trips retaining an explicit unknown purpose rather than a guessed one.

Tour reconstruction requires a home anchor, continuous observed purposes,
valid times, a non-home primary activity and an observed return home. The
excluded trip counts are: 1,807 did not return home, 1,009 were not home
anchored, 391 had no primary activity, 68 had invalid fields, 17 had an invalid
trip inside a chain, and 3 had a discontinuous purpose chain. Mandatory work or
school is the primary activity even when a discretionary stop lasts longer;
otherwise the longest observed dwell wins with diary order as the tie-breaker.

NHTS trip weights differed within 2,567 reconstructed chains. Tour-frequency
estimation is a person-day observation, so `observed_tours.csv` uses the person
weight (`WTPERFIN`) rather than selecting an arbitrary trip weight. The
inconsistency remains in the manifest as a diagnostic.

This is not yet an ActivitySim coefficient package. Public-use NHTS does not
contain local origin/destination zone identifiers or matching network LOS. The
mapper therefore emits a 23-component support matrix: location/destination and
LOS-sensitive mode-choice models are blocked by name. Eight non-spatial
components now have weighted home-based observations and are candidates for a
separately reviewed estimation specification: auto ownership, CDAP, mandatory
tour frequency, work and school tour scheduling, non-mandatory tour frequency
and scheduling, and stop frequency. Joint-tour components remain blocked until
participants are mapped; at-work subtour components remain blocked until those
chains are reconstructed. That partial posture is deliberate. A nationwide
coefficient set may combine components supported by national survey evidence
with named donor components, but it may never call the whole model nationally
estimated when only part of it is.

## Holdout rule now executable

The adapter assigns whole public-use Census divisions to deterministic,
source-scoped folds and preserves the survey weights in each fold. Records from
one division can never appear in both fit and validation. Fold assignment is
balanced after hashing, so a requested fold cannot silently be empty when
enough geographic groups exist.

## First component estimated, not yet accepted

`activitysim_auto_ownership_estimation.py` creates ActivitySim's native
`simple_simulate` estimation-data bundle rather than a parallel OpenPlan
regression. It writes one all-data bundle and a train/validation pair for every
whole-division fold. Larch receives `survey_weight` as its case-weight variable.

The specification deliberately excludes the stock MTC county constants,
network accessibility terms and local density index. NHTS cannot supply
matching local LOS, and the Bay Area constants are exactly the transfer problem
this work is removing. Included predictors are available in both the national
survey and Census-fitted runtime households: household drivers, household
size, workers and income thresholds. The official imputed income brackets are
represented as $35,000, $75,000 and $150,000 threshold indicators; no bracket
midpoint or open-ended top-code value is invented.

Measured with ActivitySim 1.5.1 and Larch 6.0.36 on all 7,893 households
(weighted households 127,544,707):

- every geographic-fold fit converged in 178–189 iterations;
- the all-data fit converged in 180 iterations;
- held-out weighted log loss ranged from 0.9211 to 0.9994, compared with 1.6094
  for the zero-start uniform model;
- held-out weighted exact vehicle-count accuracy ranged from 63.1% to 69.3%;
  and
- held-out weighted mean absolute vehicle-count error ranged from 0.36 to 0.44.

The result remains `estimated_not_accepted_for_production`. Convergence and a
holdout improvement establish that the estimator works; they do not alone set
an acceptance threshold, prove transfer to Census-synthetic households, or
make the other ActivitySim components nationally estimated. The next
scientific gate is a versioned coefficient package plus a same-population
comparison against the borrowed auto-ownership component before changing an
executed run.

### Transfer gate result: first candidate rejected

That next gate was executed, not assumed. The fitted coefficients were packaged
as a hash-locked three-file ActivitySim overlay, then ActivitySim ran the
candidate on the same retained Census-fitted household populations previously
run with stock MTC. Both sides saw identical households, persons, land use,
skims and upstream model sequence. The original PUMS-derived vehicle ownership
on each synthetic household was retained as the accuracy reference.

Eleven complete holdout runs covered 1,186,026 households. A twelfth discovered
directory (`53073`) lacked both a complete bundle and borrowed output and is
named as excluded in the machine-readable study result. Across the eleven:

Machine-readable result: [`results/auto-ownership-transfer-2026-08-18.json`](results/auto-ownership-transfer-2026-08-18.json).

- stock MTC exact accuracy: 45.01%; national candidate: 42.77%;
- stock MTC mean absolute error: 0.7131 vehicles; candidate: 0.7770;
- stock MTC mean bias: -0.0380 vehicles; candidate: +0.0391; and
- the candidate had lower mean absolute error in **0 of 11** geographies.

The first national auto-ownership candidate is therefore rejected for
production. Its national NHTS holdout result proved that the estimator and
survey mapping work; it did **not** prove transfer to Census-synthetic
populations. This prevents a familiar calibration failure: replacing borrowed
coefficients merely because the replacement has a national label and converged.
The reusable comparison remains in
`scripts/modeling/run_auto_ownership_transfer_study.py`.

### Post-hoc diagnosis: the rejection metric compared separate draws

The rejection above remains the dated decision. It is not rewritten after the
fact. A 2026-08-19 diagnostic found that its primary transfer metric was wrong
for a stochastic choice model: each fitted household retains one PUMS donor's
reported vehicle count, while ActivitySim makes a new probabilistic choice.
Household exact accuracy and mean absolute error therefore reward reproducing
the donor's individual realization rather than the population distribution.

The reusable comparator now reports vehicle-count distribution calibration as
total variation distance across the five modeled choices. On the same 1,186,026
households, the borrowed MTC component scored 0.09089 and the national candidate
scored 0.06374; the candidate had lower distribution error in 10 of 11
geographies. The machine-readable post-hoc result is
[`results/auto-ownership-distribution-diagnostic-2026-08-19.json`](results/auto-ownership-distribution-diagnostic-2026-08-19.json).

That result does not accept the candidate. The metric was selected after these
geographies were read, so all eleven are spent for this question. The next
transfer gate must name a fresh geography registry before any candidate output
is generated, use distribution calibration as its primary measure, retain mean
vehicle bias and household error as diagnostics, and keep the source-specific
geography selection inside the US survey adapter. There is no scientific basis
for changing the coefficients before that fresh gate answers whether the first
candidate actually failed.

The unchanged candidate was then run on the study's development half after the
distribution metric was fixed. Across another 11 geographies and 1,103,922
households, it reduced household-weighted total variation from 0.11714 to
0.06918 and beat MTC in all 11. Individual household MAE still favored MTC,
which is the predicted behavior when that metric rewards matching one donor
realization. Together the two halves show lower distribution error in 21 of 22
geographies, but neither half is now untouched. Production acceptance still
requires the pre-registered fresh-geography gate.

One full 31-stage paired run was also completed on the smallest retained
population before the component-isolation sweep. It confirmed that the overlay
runs through downstream ActivitySim, while changing total trips from 266,556
to 265,795. That difference is sensitivity to the auto-ownership method, not
evidence that either method is correct.

Sources checked:

- [ActivitySim estimation mode](https://activitysim.github.io/activitysim/develop/users-guide/estimation-mode/index.html)
- [FHWA NHTS downloads](https://nhts.ornl.gov/downloads)
- [2022 NHTS V2.1 release notes](https://nhts.ornl.gov/media/2022/doc/2022%20NextGen%20NHTS%20V2.1%20Release%20Notes.pdf)
