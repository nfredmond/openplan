# Mandatory-tour successor outcome-source research, 2026-08-20

## Decision

Use the complete **2017 National Household Travel Survey (NHTS)** as the next
locked acceptance source. Use every already-consumed 2022 NHTS division for
development, leave all 2017 outcome records untouched until the successor
candidate and evaluator are frozen, and keep the 2009 NHTS sealed as a reserve.
Open and evaluate 2017 only once as one national source. Prespecify all nine
Census divisions as safety domains within the 2017 U.S. survey adapter if a
pass will authorize nationwide production, but never use those labels in the
candidate, reference, fit, calibration, or model selection. Do not use a place
identifier, regional constant, regional scalar, or post-hoc rescaling anywhere
in the candidate.

This supports a narrower claim than an interchangeable replication:

- A pass would show that one national mandatory-tour component transfers to a
  new respondent sample, an earlier travel era, and a materially different
  survey method.
- A failure would not identify model misspecification by itself. It could also
  reflect changed behavior, reporting mode, household-completion rules, or the
  absence of a national nonholiday-weekday weight in 2017.
- It would not validate destination choice, mode choice, scheduling, or local
  corridor volumes.

2017 is independent enough at the **outcome level** for this purpose, subject to
an access-history check. The rejected 2022 study used one person weight per
person-day, not 2017-derived trip weights. It is not independent of the NHTS
program or its methods: FHWA used aggregate 2017 travel-log evidence when it
adjusted 2022 trip weights. The distinction must remain in the result's claim.
[FHWA's 2022 compatibility report](https://nhts.ornl.gov/media/2022/doc/2022%20NextGen%20NHTS%20Compatibility%20with%20Prior%20Data%20V2.1.pdf)
documents that dependence and the other design changes.

The source is not ready to open today. Before any outcome row is read, the
successor must settle these contracts:

1. The national 2017 public-use product exposes `WTPERFIN` and its 98
   replicates, not a national `WTPERFIN5D`. The acceptance estimand therefore
   has to be a Monday-through-Friday domain estimate under the seven-day person
   weight, including holidays, or 2017 must be rejected.
2. `SCHTYP` is not an all-age student-status field. It was asked only for people
   age 5 through 17 who had not graduated from high school. The successor cannot
   reuse the 2022 worker-by-student reference cells or manufacture adult student
   status from observed school tours. The lock must prove that student status is
   absent from the candidate as well as the reference.
3. The accepted auto-ownership component cannot produce probabilities from the
   successor's exact common inputs because it requires driver and income fields
   that do not match 2017. Remove vehicle and no-vehicle terms from the primary
   successor candidate.
4. Freeze the replicate critical-value convention, domain failure rules, and
   effective-sample calculation. Replicate weights alone do not define an
   acceptance interval.
5. If the result will authorize nationwide production, freeze non-modeling
   safety checks for all nine Census divisions. A pooled national pass by itself
   supports only a pooled national claim.

No microdata archive was downloaded, no microdata row was opened, and no model
was fitted for this review. Counts below are published codebook frequencies,
not a private inventory of outcome rows.

## Source screen

| Source | Complete weekday home-based work/school chains | Design-based inference | Role |
|---|---|---|---|
| 2017 NHTS | Yes. Ordered trips and exact home, work, and student-school purpose codes support the same reconstruction, including people with no reported trips. | Yes. One full person weight and 98 official jackknife replicates. | **Immediate acceptance source**, after the contracts and safety-domain plan above are frozen. |
| 2009 NHTS | Yes, through a vintage-specific purpose adapter. | Yes. One person weight and 100 official replicates. | **Sealed reserve**, not development data. |
| 2001 NHTS / 1995 NPTS | Likely yes; official trip-chain products exist. | 2001 has replicate weights. 1995 has an official standard-error macro rather than the later replicate package. | Historical sensitivity only. Both are dominated by 2009 for a reserve study. |
| 1990 and earlier NPTS | The public products are older than the diary-era chain contract used here; the current download page does not offer the same chain-and-replicate combination. | Varies by vintage. | Do not use for this acceptance claim. |
| 2024 NextGen NHTS | Intended to collect a travel diary, but the official surfaces reviewed contain no final public-use core file, codebook, weight contract, or compatibility report. | Planned, not yet a public-use contract on those surfaces. | Preserve unopened for a later, more contemporary confirmation. |
| American Time Use Survey (ATUS) | No. It can approximate some adult work activity chains, but not complete household-member work and school travel tours. | Yes, with 160 replicate weights. | Separate adult sensitivity study only. |
| ACS PUMS / CPS | No ordered daily itinerary or return-home chain. | Yes for the questions those surveys ask. | Reject as outcome sources. |

FHWA's [current NHTS download page](https://nhts.ornl.gov/downloads) provides
the 2017, 2009, 2001, and 1995 files, separate replicate archives where
available, and trip-chain products. FHWA describes NHTS as the national
inventory of 24-hour daily travel, including purpose, mode, time, and day of
week. [FHWA NHTS program page](https://www.fhwa.dot.gov/policyinformation/nhts.cfm).

## The 2017 public-use contract

### Diary, files, and exact reconstruction fields

The 2017 survey collected travel between April 2016 and May 2017 from the
civilian noninstitutionalized population. Every household member age five or
older had to complete the retrieval survey for the household to be usable. The
travel day runs from 4:00 a.m. through 3:59 a.m. the next day. The survey used
an address-based frame, a mail recruitment stage, and web or telephone
retrieval. Households received a paper travel log for each member age five or
older; 66 percent of people who reported travel said that they used it. The
official file totals are 129,696 households, 264,234 people, and 923,572 trips.
[2017 NHTS User's Guide](https://nhts.ornl.gov/assets/2017UsersGuide.pdf).

The source adapter needs these fields:

| File | Fields required for this study | Use |
|---|---|---|
| Household | `HOUSEID`, `HHSIZE`, `WRKCOUNT`, `SMPLSRCE`, `SAMPSTRAT`, `CENSUS_D` | Join key, common runtime predictors, provenance, and the evaluation-only nationwide safety domain. `SAMPSTRAT` is not a variance stratum. |
| Person | `HOUSEID`, `PERSONID`, `R_AGE_IMP`, `R_SEX_IMP`, `WORKER`, `TRAVDAY`, `TDAYDATE`, `FRSTHM17`, `OUTOFTWN`, `OUTCNTRY`, `WTPERFIN` | One record for every potential person-day, status and common predictors, weekday domain, start-at-home and away-state checks, and full weight. |
| Trip | `HOUSEID`, `PERSONID`, `TDCASEID`, `TDTRPNUM`, `STRTTIME`, `ENDTIME`, `WHYFROM`, `WHYTO` | Ordered daily place-purpose chain. |
| Replicate weights | Person key plus `WTPERFIN1` through `WTPERFIN98` | Every design-based standard error and interval. |

These are documented in the [2017 public-use codebook,
version 1.2](https://nhts.ornl.gov/media/2017/doc/codebook_v1.2.pdf). The raw
header and join-key contract still must be confirmed without reading data rows
when the exact archive is acquired.

Reconstruction must start from the person file, not the trip file. Otherwise a
person with no trip record vanishes instead of being classified as having no
observed mandatory tour. For each person, sort trips by `TDTRPNUM`; use times
only as a consistency check. Build the chain from `WHYFROM` and `WHYTO`, not the
derived `TRIPPURP` summary:

- `01` is regular home activity;
- `02` is paid work from home and counts as home for anchoring, not as a
  mandatory travel destination;
- `03` is work;
- `08` is attending school as a student;
- `04`, a work-related meeting or trip, must not silently become a mandatory
  work destination.

The official codebook publishes 98,968 trip destinations coded work and 22,133
coded student-school. Those totals establish that both purposes are observed,
not that the rare two-tour alternatives are adequate. [Official 2017 `WHYTO`
entry](https://nhts.ornl.gov/tables09/CodebookPage.aspx?id=1375).

`FRSTHM17` records whether the person began the travel day at home. There is no
equivalent public end-at-home flag, so the last ordered trip must end with
`WHYTO` in `{01, 02}`. FHWA's [2017 derived-variable
specification](https://nhts.ornl.gov/assets/derived_variables_20180301_public%20use.pdf)
uses both codes as home when it constructs tour windows. [Official `FRSTHM17`
entry](https://nhts.ornl.gov/tables09/CodebookPage.aspx?id=1210). The protocol
must freeze the treatment of chains that start away, end away, contain a broken
origin/destination transition, or contain more than the supported number of
mandatory tours. It must publish unweighted and weighted exclusions rather than
coercing a chain to the nearest ActivitySim alternative.

People with no trip record stay in the person universe and in exclusion/status
accounting. They do not contribute to the five-alternative score unless a
frozen rule first establishes an observed mandatory-DAP pattern. Zero-trip,
out-of-town or out-of-country, incomplete-chain, no-mandatory-pattern,
supported, and out-of-support states must be reported separately; none may be
silently relabeled as a zero-tour alternative.

The public `DIARY` field records use or completion of the paper travel log. It
is not survey completion or travel-day completion. The successor adapter and
evaluator must not use it as an eligibility rule, predictor, calibration input,
or post-open subgroup.

Purpose codes are adapter data, not a cross-vintage constant. School is `08` in
2017 but `06` in 2022; `06` in 2017 is escorting another person. The generic
evaluator should receive only a role-neutral person-day outcome and survey
design, plus an opaque safety-domain label when nationwide acceptance is in
scope. It should never know an NHTS purpose code, interpret a Census-division
code, or receive a FIPS identifier.

### Weekday sample and adequacy

The codebook publishes 205,755 person records assigned to Monday through Friday
(`TRAVDAY` `02` through `06`) before eligibility, missing-data, complete-chain,
or supported-alternative rules. That is substantially larger than the 2022
source, but it is only an upper bound. The following cannot be known without the
one authorized inventory:

- eligible mandatory-DAP person-days;
- supported records in each of the five alternatives;
- incomplete or non-home-anchored chains;
- out-of-support patterns;
- effective sample size after unequal weights;
- replicate stability for `work2`, `school2`, and `work_and_school`;
- common-predictor missingness.

Use the whole national sample in one acceptance opening and make the pooled
national gate primary. Do not partition divisions into fit and holdout sets.
For nationwide installation, evaluate all nine divisions simultaneously as
prespecified safety domains without fitting or selecting on them. If the locked
rare-alternative minimums, domain effective-sample minimums, or replicate
diagnostics fail, the result is **inconclusive** for nationwide installation,
not permission to merge alternatives, change thresholds, suppress a domain, or
inspect 2009 casually.

### Weights, strata, and PSUs

The correct available full weight for one categorical outcome per person-day is
`WTPERFIN`, with `WTPERFIN1` through `WTPERFIN98` for replication. A trip weight
cannot represent people with zero trips and must not be substituted. The
official jackknife standard error is

```text
sqrt(sum(r = 1..98, (6 / 7) * (estimate_r - estimate_full)^2))
```

FHWA formed the replicates from 14 geographic variance areas with seven
delete-one units in each. [2017 NHTS weighting
report](https://nhts.ornl.gov/assets/2017%20NHTS%20Weighting%20Report.pdf) and
[User's Guide, replicate-weight section](https://nhts.ornl.gov/assets/2017UsersGuide.pdf).
`SAMPSTRAT` is only the public primary sampling classification. It is not the
14-area variance stratum, and neither `HOUSEID` nor `PERSONID` is a public PSU.
Use the official replicates; do not invent a Taylor-series design.

The successor preregistration should use 84 design degrees of freedom,
`14 * (7 - 1)`, with `t(.95, 84)` for a one-sided 95 percent upper bound and
`t(.975, 84)` for two-sided 95 percent intervals. Use the same degrees of
freedom for one-sided deterioration tests and apply Holm at family alpha 0.05.
This critical-value rule is an OpenPlan inferential choice, not an FHWA
instruction, and the required independent methods review must approve it while
the source remains sealed. Refuse or mark the study inconclusive if any full or
replicate denominator is nonpositive, any estimate is nonfinite, a replicate is
missing, or a locked domain lacks its minimum unweighted count or Kish effective
sample size, `(sum(w) ** 2) / sum(w ** 2)`. Do not drop a failed replicate or
substitute a normal critical value after opening.

The central limitation is weekday weighting. FHWA produced seven-day weights
for the national sample and both seven-day and nonholiday five-day weights for
each add-on area. The combined public-use codebook names only `WTPERFIN`, and
the guide names only that full person weight plus its 98 replicates. There is no
documented national `WTPERFIN5D`. FHWA also publishes `TDAYDATE` only as
`YYYYMM`, so the exact federal holidays omitted from add-on five-day weights
cannot be removed from the national public-use records.

The defensible national estimand is therefore:

> The conditional distribution and mean number of complete home-based mandatory
> tours on an assigned Monday through Friday, including holidays, among people
> whose observed pattern maps to the mandatory-DAP study contract.

Filter `TRAVDAY` to `02` through `06`, apply `WTPERFIN`, and recompute every
ratio separately with each replicate. FHWA raked the seven-day weights so each
day represents one seventh of the annual person total; the weekday-domain
weighted total is consequently about five sevenths of the population. That
constant cancels in shares, mean tours per eligible person-day, and normalized
log loss. It does not cancel in an absolute weekday population total. This
acceptance study should not use absolute population totals; if one is added,
its `7/5` conversion and uncertainty must be frozen explicitly.

This estimator is a reasoned application of FHWA's weight construction, not an
explicit FHWA instruction for this derived categorical person-day outcome. The
opening lock should contain either a written FHWA/ORNL confirmation or an
independent review accepting this derivation. If the scientific target requires
the same nonholiday-weekday estimand used in 2022, 2017 cannot answer it and
must not be opened.

Use the combined national and add-on records with their official weights.
`SMPLSRCE` documents the sample-origin concept, but its values are not needed
for this study: FHWA states that its weighting accounts for add-on oversampling
and supports combined national estimates. Filtering to `SMPLSRCE == 01` would
throw away valid respondents and change the design without an official
instruction.

### Access and licensing

FHWA provides the 2017 survey in CSV, SAS, SPSS, and dBase formats and the
replicate weights as a separate direct download. No account or application is
shown on the [official download page](https://nhts.ornl.gov/downloads). FHWA
requests a formal citation. No Creative Commons, public-domain, or other
explicit dataset license was located on the current download or documentation
surfaces. Record the source as **public-use; citation requested**. Using it for
analysis is supported by the publication posture; redistributing the raw
archive with OpenPlan should wait for explicit terms.

## Predictor overlap with the OpenPlan runtime

The rejected candidate used age, age squared, sex, household size, household
workers, vehicle count, and a no-vehicle indicator. Several have a 2017
counterpart, but a survey field existing is not enough. Its meaning and its
position in the production chain have to match.

| Concept | 2017 field | Runtime field | Successor treatment |
|---|---|---|---|
| Age | `R_AGE_IMP` | `age` | Use. Freeze the same transform and valid range. |
| Sex | `R_SEX_IMP` | `female` | Use for the existing binary runtime contract; disclose that this is a survey-era binary field. |
| Household size | `HHSIZE` | `hhsize` | Use after confirming both count the same household roster, including ages 0 through 4. |
| Household workers | `WRKCOUNT` | `num_workers` | Use after confirming the worker definition and clipping rule. |
| Worker status | `WORKER` | `is_worker` | Use for eligibility/reference stratification if the definitions remain exact. |
| Vehicles | `HHVEHCNT` | `auto_ownership` | Exclude. The accepted upstream component requires driver and income inputs that are not exact common fields in this study, so no valid common-input marginalizer exists today. |
| Student status | `SCHTYP`, partly `PRMACT` | `is_student` | Do not use as an all-age predictor or reference cell. `SCHTYP` covers only ages 5–17, and `PRMACT == 05` misses working adult students. |
| Licensed drivers | `DRVRCNT` | runtime age-16-plus proxy | Exclude. These are different concepts. |
| Income | `HHFAMINC` | year-2000-dollar runtime income | Exclude until a frozen, vintage-correct price and bracket adapter makes them identical. |
| Young children | no complete person roster below age five | runtime age 0–5 counts | Exclude. Do not infer the count from a household life-cycle label. |
| Urban/rural context | `URBRUR` | zone-derived density area type | Exclude. An official home-address classification is not the runtime's local zone class. |
| LOS and destination geography | no matching runtime alternative-set LOS | skims and zones | Exclude. No invented distance or place proxy. |

The student mismatch is confirmed by the [official 2017 retrieval
instrument](https://nhts.ornl.gov/assets/2016/NHTS_Retrieval_Instrument_20180228.pdf):
`SCHTYP` was asked only for ages 5 through 17 who had not graduated from high
school. `PRMACT` asks people age 16 or older for their primary activity during
the prior week. A person who works and attends college can be a worker in
`PRMACT` and still make a school tour. Defining student status from `WHYTO == 08`
would turn the outcome into a predictor.

Replace the old worker-by-student reference with a development-only reference
using only exact common inputs, preferably worker status and broad age bands.
Freeze the bands, smoothing, fallback, and all probabilities on consumed 2022
development data before 2017 access. Do not let 2017 decide the reference
design. The package verifier must prove that `is_student` and every student
interaction are absent from candidate utilities, transforms, offsets, and
reference cells; removing the old reference alone is insufficient.

Remove vehicle and no-vehicle terms from the primary successor candidate. The
accepted auto-ownership component requires driver and vintage-adjusted income
inputs, while this study correctly excludes both as semantically mismatched.
It therefore cannot produce the needed probability vector from exact common
inputs. Conditioning on observed `HHVEHCNT`, averaging over one stochastic
draw, or adding an ad hoc marginalizer would validate a different model from
the one production can run.

## How independent is 2017?

### What is independent

2017 is a separate survey wave with a separately selected address sample, field
period, and respondent set. No 2017 mandatory-tour outcome artifact or raw
archive was found in the current repository. The only 2017 reference found in
executable data-pilot code is a comment about published rural trip-rate
summaries, not a mandatory-tour reconstruction. That does not consume this
outcome.

The executed 2022 study reconstructed one categorical choice per person-day and
weighted it with `WTPERFIN5D`. FHWA says the 2017-derived methods adjustment was
applied to **2022 trip weights**. It therefore did not weight the fitted
person-day choice and did not supply its 2017 choice labels. This makes 2017 a
fresh outcome sample for the successor, assuming nobody inspected its
mandatory-tour outcomes outside this checkout.

### What is not independent or comparable

Both vintages belong to the same NHTS program and share concepts, sponsor, and
some survey machinery. More importantly, they differ in ways that can move the
measured outcome:

- 2017 used a two-stage survey, supplied travel logs, and completed about 60.4
  percent online, 30.3 percent by telephone, and 9.4 percent through a
  combination of modes. 2022 used a single-stage, no-log design and completed
  99 percent online.
- All household members age five or older had to complete 2017. In 2022,
  households of four or more were usable at 75 percent completion.
- 2017 represents pre-pandemic travel. 2022 was fielded during recovery and
  transition in work and school location.
- Earlier NHTS weights included group-quarters residents in population control
  totals even though the survey did not sample them. 2022 removed that
  population from its controls.
- FHWA derived a 10–12 percent purpose-specific 2022 trip-weight adjustment by
  comparing 2017 respondents who did and did not report using the travel log.

FHWA explicitly warns that survey mode can affect reported results and may
require adjustment for direct trend comparisons. No new scalar adjustment is
appropriate here: it would change a five-choice outcome after seeing a survey
method difference and recreate the nationwide scalar-calibration trap. Treat
cross-method transfer as the stress being tested.

The remaining independence limit is procedural. A repository search cannot
prove that a person, another checkout, or an unrelated process never inspected
2017. Before opening the archive, record an attestation covering all known
agents and prior work, plus the exact archive hash. If prior inspection of the
five-choice outcome is discovered, 2017 is not a fresh confirmatory source. Also
do not claim that FHWA proves zero household/address overlap between waves; no
such public-use statement was located.

## Older and future NHTS vintages

### 2009: scientifically usable, but preserve it

The 2009 survey is the only sensible released reserve. It contains 150,147
households, 351,275 people, and 1,167,321 travel-day trips collected from March
2008 through May 2009. Its assigned day also runs 4:00 a.m. to 3:59 a.m. The
official fields include `HOUSEID`, `PERSONID`, `TDTRPNUM`, `TRAVDAY`,
`STRTTIME`, `ENDTIME`, `WHYFROM`, `WHYTO`, `FRSTHM`, and `WTPERFIN`.
[2009 NHTS User's Guide](https://nhts.ornl.gov/assets/2009/doc/UsersGuideV2.pdf)
and [2009 public-use codebook](https://nhts.ornl.gov/2009/pub/Codebook.pdf).

It requires its own purpose mapping. Home is `01`; going to or returning to work
uses `11` and `12`; `13` and `14` are other work-related activity; student school
is `21`. The broad derived school-purpose group must not be used because it also
includes religious activity and daycare. The person full weight is `WTPERFIN`,
with `WTPERFIN1` through `WTPERFIN100`; the official jackknife factor is
`99/100`. Use those replicates rather than inventing a PSU from public fields.

2009 used a telephone, list-assisted random-digit-dial landline design, was
fielded during the Great Recession, and did not require the same all-member
completion as 2017. It is less comparable to today's runtime, but precisely
because it remains unopened it can answer a future robustness question. Do not
spend it on development after a 2017 result.

The 2001 NHTS and 1995 NPTS also have public survey and trip-chain files; 2001
has separate replicate weights, while 1995 provides an official standard-error
macro. They are older, smaller, and methodologically farther from current
travel. Pre-1995 surveys precede the travel-log change that FHWA associates with
materially higher trip reporting. They add age, not independent contemporary
evidence, and should not displace 2009.

### 2024: preferred when it actually releases

FHWA says the 2024 NextGen collection began November 1, 2024, targeted 7,500
randomly sampled households, and was intended to cover November 2024 through
November 2025 as part of a shorter biennial program. [FHWA NHTS program
page](https://www.fhwa.dot.gov/policyinformation/nhts.cfm). The active OMB
package describes recruitment and travel-diary instruments, but its 28,625
responses are burden-accounting responses across instruments, not completed
households or a public-use sample. [OMB information-collection
record](https://www.reginfo.gov/public/do/PRAViewICR?ref_nbr=202504-2125-005).

As of August 20, 2026, the official FHWA download, documentation, and program
surfaces reviewed here still expose 2022 as the newest core public-use release.
Those surfaces contain no final 2024 public-use archive, codebook, exact field
names, weights, replicate contract, compatibility report, or release date.
This is a bounded statement about the official surfaces reviewed, not proof
that no file exists anywhere. Provisional OMB instrument names are not a PUF
data contract, and the instruments are not fully consistent about the diary
period. Do not wait for 2024 to begin successor development. When it releases,
preserve it unopened until its final guide proves the unit of analysis and
design; then prefer it for a contemporary confirmation rather than silently
pooling it with 2017.

## Why other national surveys do not replace NHTS

### American Time Use Survey

ATUS interviews one person age 15 or older per sampled household and records an
ordered activity diary from 4:00 a.m. to 4:00 a.m. Relevant public-use fields
include `TUCASEID`, `TUACTIVITY_N`, `TUDIARYDAY`, `TUSTARTTIM`, `TUSTOPTIME`,
`TUACTDUR24`, `TRCODE`, and `TEWHERE`. `TEWHERE` distinguishes the respondent's
home, workplace, and school. The full weight is `TUFINLWGT`; single-year files
carry `FINLWGT001` through `FINLWGT160`, with the official variance factor
`4/160`. [ATUS User's Guide](https://www.bls.gov/tus/atususersguide.pdf),
[2025 data dictionary](https://www.bls.gov/tus/dictionaries/atusintcodebk25.pdf),
and [BLS microdata guide](https://www.bls.gov/tus/other-documentation/howto.htm).

That is enough for a separately defined adult activity-chain sensitivity
analysis, but not this outcome. ATUS omits children under 15, observes only one
person per household, records activities rather than every trip and place, has
no persistent place identifier, and does not collect location for sleep and
some personal-care activities. A home anchor can therefore be ambiguous. It
also lacks the exact household vehicle-count predictor needed by the current
candidate. Pooling years increases observations but cannot repair the target
population or measurement gaps.

### ACS and CPS

ACS PUMS provides person weights and 80 replicate weights, school enrollment,
and usual journey-to-work fields such as mode and departure time. It has no
assigned diary day, ordered trip sequence, or return-home observation. [Census
ACS PUMS documentation](https://www.census.gov/programs-surveys/acs/microdata/documentation.html)
and [Census explanation of the commuting
questions](https://www.census.gov/acs/www/about/why-we-ask-each-question/commuting/).
The CPS provides labor-force, school, household, and survey-design information,
not a daily travel itinerary. [Census CPS public-use dataset
catalog](https://www.census.gov/programs-surveys/cps/data/datasets.html). Neither
can reconstruct one work tour versus two, one school tour versus two, or a
complete home return. Design-based inference cannot compensate for a missing
outcome.

## Concrete allocation and opening protocol

### Allocation

| Role | Source | Permitted use |
|---|---|---|
| Development | All 2022 NHTS divisions, already consumed | Candidate structure, partial pooling across rare alternatives, coefficients, reference probabilities, metric implementation, thresholds, and every exclusion rule. No claim that any division remains a holdout. |
| Acceptance | Entire weighted 2017 NHTS public-use sample | Exactly one opening and one pooled national evaluation after the lock, plus all nine preregistered Census-division safety domains if the decision can authorize nationwide production. Geography never enters the candidate, reference, fit, or calibration. |
| Reserve | Entire 2009 NHTS | No header or outcome inventory during the 2017 study. Open only under a later, separately justified preregistration. |
| Future confirmation | 2024 NHTS core PUF, once released | Keep sealed until final first-party documentation establishes fields, diary unit, weights, replicates, and compatibility. |

The candidate remains one national coefficient vector. It may share statistical
strength across one-versus-two-tour alternatives through a frozen structured
model, but it may not fit a source-year scalar, division effect, state effect,
sample-source effect, or place identifier. A manifest may name `SMPLSRCE`,
`CENSUS_D`, state, CBSA, county, and survey mode as prohibited fields. Their
values may not become features, fit partitions, calibration controls, or
model-selection diagnostics. The 2017 adapter may expose Census division only
as a frozen acceptance safety-domain label. It may never flow into a utility or
change a coefficient.

### Freeze before touching rows

The 2017 opening lock should require all of the following:

1. **Freshness record.** A dated repository search, an attestation covering
   known prior agents and analyses, and a statement of the one aggregate 2017
   trip-rate reference already present. If anyone has inspected reconstructed
   2017 mandatory-tour choices, stop.
2. **Source identity.** Independently lock the core public-use archive and the
   separate replicate-weight archive: each official URL, retrieval timestamp,
   byte count, SHA-256, member name and size, and header-only inventory. Freeze
   the cross-archive join keys, uniqueness, and coverage checks. Header access
   may confirm the documented contract; it may not compute a frequency,
   preview a row, or derive an outcome.
3. **Weight decision.** Lock the Monday-Friday-including-holidays estimand,
   `WTPERFIN`, all 98 person replicates, the `6/7` factor, combined-sample use,
   ratio normalization, 84 design degrees of freedom, t criticals, failed-
   replicate behavior, and Kish effective-sample calculation. Obtain first-
   party confirmation or an independent methods review of the weekday-domain
   and inference derivation. Refuse a hidden `WTPERFIN5D` assumption.
4. **Predictor and reference decision.** Freeze the exact common predictor list;
   replace the all-age student reference; remove student, vehicle, and
   no-vehicle terms from every candidate utility, interaction, offset,
   transform, and reference cell. No decision may depend on a 2017 category
   count.
5. **Outcome adapter.** Freeze the 2017 purpose codes, person-first universe,
   chain ordering, home anchors, midnight handling, invalid/missing codes,
   supported alternatives, and every exclusion. Hash the full reachable
   implementation closure.
6. **Candidate package.** Freeze every coefficient, transform, alternative,
   regularization result, source manifest, ActivitySim configuration, and
   package hash. All fitting uses only consumed 2022 outcomes.
7. **Evaluator.** Freeze the paired replicate implementation, reference,
   thresholds, multiplicity correction, minimum cell/effective-sample rules,
   national and nine-domain safety rules, failure versus inconclusive rules,
   output schema, and full implementation closure. Prove by mutation that each
   gate and each domain safeguard can fail before opening.
8. **One-opening receipt.** Write and fsync a consumed-source receipt before the
   first non-header source row is read from either archive. Never persist
   acceptance person-days. Emit only aggregate JSON and Markdown evidence with
   both source hashes, candidate, evaluator, and receipt hashes.

The old requirement to improve in every held-out division cannot carry over as
a model-selection rule because 2017 is one national acceptance source.
Preserve the substantive gates in pooled national form: paired replicate
uncertainty for candidate-minus-reference log loss, total-variation distance
and five choice-share errors, work and school tours per eligible person-day
without scaling, reconstruction coverage, and preregistered nongeographic
transfer cells. A pass requires the one-sided 95 percent jackknife upper bound
for log-loss difference below zero, not merely a better point estimate. The
existing `0.05` total-variation ceiling and tour-mean interval gates can remain
only if frozen before access. Transfer cells should use exact common fields such
as worker status, age band, and sex, with Holm correction.

Nationwide installation adds a separate safety family across all nine Census
divisions in the same one-shot result. Preregister a one-sided paired log-loss
deterioration test per division with Holm family alpha 0.05, a maximum allowed
distribution disadvantage, coverage and tour-total diagnostics, and minimum
unweighted and Kish effective sample sizes. A significant deterioration fails
nationwide acceptance; an underpowered or invalid domain makes nationwide
acceptance inconclusive. The pooled result may still be reported as pooled
national evidence, but it cannot silently authorize “safe anywhere in the
United States.” Division labels remain evaluation-only adapter data and may not
alter the fitted model.

## What remains unknowable until the authorized raw inventory

Documentation cannot establish:

- both acquired archives' exact hashes, member names, delimiter/encoding, and
  field types;
- exact replicate-file join keys, uniqueness, coverage, and ordering;
- whether the current downloadable bytes contain an undocumented weight that
  the current codebook omits;
- key uniqueness and referential integrity among household, person, trip, and
  replicate files;
- missingness in common predictors and chain fields;
- the number and weighted share of complete, eligible, supported person-days;
- rare-alternative counts, effective sample sizes, or unstable replicates;
- start-away, end-away, broken-chain, and out-of-support rates;
- whether household size and worker counts match the runtime roster in every
  edge case;
- whether somebody outside the current repository previously inspected this
  outcome;
- raw-data redistribution rights beyond FHWA's public-use and citation posture.

Those unknowns are not reasons to fit first and document later. They determine
whether the locked study can execute at all. If the inventory violates a frozen
source invariant or lacks enough rare-choice information, record an
inconclusive study and preserve 2009 for a new decision. Do not repair the
acceptance source after seeing its outcomes.

## Bottom line

2017 NHTS is the only already released national source that combines the
complete 24-hour travel chain, enough published sample, common runtime
predictors, and official design-based variance machinery for this successor.
It can be a genuinely fresh outcome holdout, but it is a temporal and
survey-method transport test, not a same-design replication of 2022. The
weekday-weight, home-anchor, predictor, replicate-inference, dual-archive, and
nationwide safety-domain contracts must be settled before row access. With
those settled, all 2022 outcomes belong to development, the whole 2017 sample
belongs to one national acceptance opening, and 2009 stays sealed. That
allocation gains new evidence without another geographic scalar sweep or a
place-coded model.
