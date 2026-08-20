# Next ActivitySim component research, 2026-08-19

## Decision

Estimate `mandatory_tour_frequency` next. Of the three components reviewed, it
is the only one whose ActivitySim choice can be reconstructed from a national
public-use survey without inventing a destination zone or relabeling a parking
payment question. Treat the first result as a candidate, not an automatic
replacement. Install it only after one locked evaluation on whole Census
divisions that nobody has inspected for this outcome.

The candidate must be a weekday, person-day, five-alternative model conditional
on an observed mandatory daily activity pattern. It must not fit a regional
scalar, division constant, or post-hoc calibration factor. One coefficient set
must make the five choices directly:

- one work tour;
- two work tours;
- one school tour;
- two school tours; or
- one work and one school tour.

Those are the alternatives in ActivitySim's canonical MTC configuration, and
the component creates the resulting work and school tours. The same source
shows that the borrowed specification uses person type, sex, age, household
composition, income, vehicle availability, urban location, work and school
distance, and auto travel time. [ActivitySim mandatory-tour source and
alternatives](https://github.com/ActivitySim/activitysim-prototype-mtc/blob/79d4a23f9ce72cb666f75f0bc0432e8b8133b3df/configs/mandatory_tour_frequency_alternatives.csv),
[MTC utility specification](https://github.com/ActivitySim/activitysim-prototype-mtc/blob/79d4a23f9ce72cb666f75f0bc0432e8b8133b3df/configs/mandatory_tour_frequency.csv),
[ActivitySim component documentation](https://activitysim.github.io/activitysim/develop/dev-guide/components/mandatory_tour_frequency.html).
The generated component page currently calls this a binary True/False model.
That conflicts with its own implementation and official five-alternative
configuration, so the source configuration governs this recommendation.

## Why this component wins

| Component | Nationally observed outcome | Usable national predictors | Untouched geographic holdout | Scientific limit |
|---|---|---|---|---|
| `mandatory_tour_frequency` | Yes, after auditable reconstruction of complete home-based work and school tours from one person's travel day. The NHTS records trip purpose, time, and linked household and person attributes. | Age, sex, worker and student status, income bracket, household size, workers, drivers, vehicles, and urban/rural status exist in the public files. | Yes. `CENSUS_D` identifies the home Census division, and the sample design itself stratifies by division and urban/rural status. | The outcome is derived, not directly asked. The survey records one retrospective 24-hour day. The public data lack matching local network LOS, and the 2022 survey has telework measures that the runtime synthetic population does not yet carry. |
| `workplace_location` | No. `GCDWORK` observes home-to-work great-circle distance for some workers, but the public file does not expose the chosen local destination zone or the alternative set. | Income and worker attributes exist, but ActivitySim also needs zonal employment size, mode-choice logsums, distance to every alternative, and shadow-pricing terms. | A division can hold out commute-distance distributions, not zone-choice transfer. That is a different outcome. | Estimating a zone choice from distance alone would invent every rejected alternative and its land-use and LOS attributes. The national passenger OD product is a separate device-derived product and is not linked to surveyed person choosers. |
| `free_parking` | Only partially. NHTS `PARK` says whether a person paid for parking at any time that day. Trip `PARK2` distinguishes paid, employer-paid, school-paid, and did-not-pay responses for a small subset. ActivitySim asks whether free parking is available at the person's workplace. | Income, household size, workers, and vehicles exist. The borrowed MTC model also uses three Bay Area workplace-county constants. | A division holdout is mechanically possible, but the already thin paid-parking outcome would be split further, and workplace geography is absent. | "Did not pay on this trip" does not prove free workplace parking. It also includes no parking, another payer, and non-work destinations unless the diary and mode are filtered. The codebook reports only 186 person records that paid at any time and 421 trip records with a substantive `PARK2` category. |

The official source files make the mismatch concrete. Workplace location uses
distance splines, a destination size term, a mode-choice logsum, and shadow
prices. [ActivitySim workplace-location
specification](https://github.com/ActivitySim/activitysim-prototype-mtc/blob/79d4a23f9ce72cb666f75f0bc0432e8b8133b3df/configs/workplace_location.csv),
[ActivitySim work-location documentation](https://activitysim.github.io/activitysim/v1.3.1/dev-guide/components/work_location_choice.html).
Free parking predicts availability at work, while the MTC specification includes
San Francisco, Santa Clara, and Alameda constants. [ActivitySim free-parking
documentation](https://activitysim.github.io/activitysim/v1.2.0/models.html#free-parking-eligibility),
[MTC free-parking specification](https://github.com/ActivitySim/activitysim-prototype-mtc/blob/79d4a23f9ce72cb666f75f0bc0432e8b8133b3df/configs/free_parking.csv).

The NHTS public-use evidence is strong enough for mandatory tour frequency but
not stronger than it is. FHWA describes one 24-hour travel day, 4 a.m. to 4
a.m., for household members age five and older. Its guide says to use five-day
weights for weekday estimates, and to estimate standard errors with Taylor
series methods using `STRATUMID` as the stratum and `HOUSEID` as the primary
sampling unit. It also reports a 10.8 percent overall response rate and names
failure to report a travel day accurately, item nonresponse, and survey
nonresponse as possible errors. [2022 NHTS user's
guide](https://nhts.ornl.gov/media/2022/doc/2022%20NextGen%20NHTS%20User%27s%20Guide%20V201_PubUse.pdf).
The public codebook documents `CENSUS_D`, `WORKER`, `SCHOOL1`, `R_AGE`, `R_SEX`,
`GCDWORK`, household attributes, and the parking fields. [2022 NHTS public-use
codebook](https://nhts.ornl.gov/assets/2022/doc/codebook.pdf).

One more limitation matters. The 2022 survey did not give respondents a travel
diary. FHWA's release notes expected this change to lower reported trip rates by
about 20 percent, mainly through missed discretionary travel. Mandatory travel
may be less affected, but the source does not quantify that difference. [2022
NHTS technical release
notes](https://nhts.ornl.gov/assets/2022/doc/2022%20NextGen%20NHTS%20Technical%20Release%20Notes%20V1.pdf).

## Executable recommendation

1. Freeze the exact NHTS archive hash and a registry before deriving any
   mandatory-tour outcome by division. Assign three whole Census divisions to
   acceptance and six to development. The assignment may balance only
   pre-outcome record counts and survey weights. It may not inspect tour counts,
   choices, or losses.
2. Reconstruct complete home-based tours. Keep work and school purpose codes
   separate. Do not squeeze an unsupported pattern, such as three work tours,
   into the nearest ActivitySim alternative. Record it as out of support.
3. Restrict estimation and evaluation to weekdays and use `WTPERFIN5D`, because
   the chooser is a person-day and the production model is a weekday model.
   Retain `STRATUMID` and `HOUSEID` for design-based uncertainty.
4. Fit ActivitySim's native estimation bundle with one national coefficient
   vector. Use only predictors present with the same meaning in both NHTS and
   the runtime population. Start with age, sex, worker and student status,
   household size, workers, drivers, vehicle count, imputed income brackets,
   young-child counts, and urban/rural status. Do not use `CENSUS_D`, county, a
   regional intercept, `GCDWORK`, invented school distance, invented auto time,
   or telework until the runtime has a matching observed field.
5. Before opening acceptance outcomes, freeze the candidate package, a simple
   development-only reference model, all inclusion rules, all metrics below,
   and the random seeds. Score choice probabilities, not one stochastic draw.
6. Run the candidate and borrowed MTC component on identical upstream runtime
   populations as a sensitivity report. Do not call that comparison validation:
   the synthetic population has no observed person-day tour choice. Production
   acceptance rests on the locked NHTS divisions.

## Preregistered acceptance metrics

The reference model is a development-only weighted frequency table by observed
worker and student status, with additive smoothing fixed before holdout. Those
two statuses have the same meaning in the survey and runtime population. NHTS
does not carry the PUMS weekly-hours field needed to reproduce OpenPlan's exact
eight-category ActivitySim person type, so calling it that would overstate the
match. This is a real prediction baseline and cannot borrow a holdout share.

Accept only if every rule passes on the single opening of the three holdout
divisions:

1. **Outcome coverage.** At least 95 percent of the design-weighted mandatory-DAP
   person-days map exactly to one of the five alternatives. Publish every
   exclusion count and weighted share by division.
2. **Primary predictive score.** The candidate's paired, design-weighted
   multiclass log loss is lower than the reference model pooled across holdouts,
   with the upper end of a one-sided 95 percent Taylor-series confidence interval
   for candidate minus reference below zero. Its point estimate must also be
   lower in all three divisions.
3. **Choice distribution.** Pooled total variation distance between the five
   expected candidate shares and observed weighted shares is at most 0.05 and
   lower than the reference. It must be lower than the reference in at least two
   of three divisions and no more than 0.02 worse in the third. This grades the
   distribution, not a fitted total.
4. **Tour totals without a scalar.** Expected work tours and expected school
   tours per eligible person-day must each fall inside the design-based 95
   percent confidence interval for the observed mean, pooled and in at least two
   of three divisions. No rescaling is allowed before this check.
5. **Transfer cells.** For every preregistered worker-status by student-status
   by urban/rural cell
   with at least 100 unweighted holdout observations, publish log loss, all five
   share errors, work-tour bias, and school-tour bias. Reject if any cell has a
   statistically significant log-loss deterioration against the reference after
   Holm correction.
6. **Stochastic stability.** Across 20 preregistered ActivitySim seeds, every
   weighted alternative share must remain inside the two-sided 95 percent
   interval computed from the frozen choice probabilities and person weights.
   A lucky seed cannot pass a failed probability model.

These gates answer the narrow question: whether one unchanged, nationally
estimated mandatory-tour component transfers to unseen U.S. divisions better
than a development-only reference and reproduces the observed choice
distribution. They do not certify ActivitySim's remaining Bay Area components,
prove local county accuracy, or repair the missing national evidence for
workplace destination and parking availability.

The executable lock is
`data/modeling/mandatory-tour-frequency-preregistration-2026-08-19.json`; its
generator is `scripts/modeling/mandatory_tour_frequency_registry.py`. The lock
names the exact interval formula, seeds, source hash, accepted predictors, and
implementation hashes required before the three acceptance divisions may be
opened.

## Outcome, 2026-08-20

The frozen candidate was evaluated once on the three held-out divisions and
was rejected. The aggregate result is
`data/modeling/mandatory-tour-frequency-acceptance-result-v2-2026-08-19.json`
(SHA-256
`1a139663438c6522104c852f1811839f17e32fa702bb2f95959cf26b6a3c9de4`).
The opening receipt was written before any source member was read and records
that this holdout is consumed. The evaluator did not persist person-day rows.

Two of the six preregistered gates failed. The candidate's pooled log loss was
0.142452, compared with 0.143564 for the worker/student reference, but the
candidate-minus-reference upper confidence bound was +0.002766 and the
candidate won only one of three divisions. Its pooled total-variation distance
was 0.020830, compared with 0.019263 for the reference, although it won that
comparison in two divisions. Coverage, tour totals, transfer cells, and
stochastic stability passed. Passing those four gates does not override either
failed gate.

The candidate remains outside the production accepted-component registry.
OpenPlan therefore continues to disclose the borrowed Bay Area source of the
remaining `prototype_mtc` behavior, including mandatory-tour frequency. The
simple reference model is not promoted either: selecting it after seeing this
result would be a post-hoc decision.

Any successor must be a materially new, preregistered study with an independent
outcome source. It should align survey and runtime predictors exactly, account
for uncertainty from simulated auto ownership, and share information across
rare one-versus-two-tour alternatives instead of estimating a separate full
slope vector for each. It must retain one national coefficient set and must not
introduce division constants, place identifiers, regional scalars, or post-hoc
rescaling. The 2022 NHTS acceptance divisions may not be reused as fresh
confirmation because their aggregate outcomes have now informed the next
design.
