# TBI 2019 development study: frozen admission and analysis design

October 23, 2026. Source admission is authorized by the lead. This record freezes
an admission-first study before any respondent travel outcomes or new modeled
outcomes. **Source permission does not establish model-input comparability.**
If preparation fails admission, stop before opening development choices. Record
both arms as scientific `inconclusive`, development disposition `retire_this_attempt`.
Do not claim a completed validation from an admission failure.

The split specification is already committed at `9b86edcf1`. Its implementation
is committed at `16ebea618`. The roster-only acquisition reads `hh_id`,
`home_county` and `survey_year`, with no weights, trip counts or chosen modes.
The [split summary](evidence/split-summary.json) binds its assignment hash.
The private assignment file stays outside Git. All persons and days inherit
the household partition. No held-out outcome may be requested in this task.

## Question, arms and region

Assess how each fixed ActivitySim arm represents weighted home-based tour-mode
shares in the seven Minnesota counties in [SPLIT.json](SPLIT.json): Anoka,
Carver, Dakota, Hennepin, Ramsey, Scott and Washington. This is development
research within one region, not geographic transfer or nationwide acceptance.
The survey covers travel during 2018 and 2019. Do not silently treat 2022 or
2023 Census inputs as a matched 2019 population.

The two arms are the current default mode-choice coefficients and the named
`semcog2015-walk-asc-development-v1` candidate. Both use the accepted national
auto-ownership component. Each arm is judged against observations separately.
Do not rank arms, compare their errors, select the better arm, average them or
change defaults. The historical SEMCOG retirement remains intact.

Hypothesis for each arm: its mode-share vector describes this region's
home-based tours better than a mode-uninformed vector, within every required
comparison domain. This tests the complete population/input/model pipeline.
A discrepancy cannot identify mode-choice constants as its sole cause.
Census-generated people are not the TBI respondents. Individual predictive
log loss and Brier scores would require a separate observed-chooser adapter;
they are unavailable for this unconditional share-comparison design.

## Model-input admission and custody

Use the existing OpenPlan route, not a substitute regional demand model:

1. Prepare the selected counties' screening network and zone attributes with
   explicit source, boundary, year, units and input-only custody.
2. Use `build_activitysim_input_bundle.py --population census --config-package
   mtc`, which calls `synthetic_population.py` / `census_pums.py` and
   `activitysim_mtc_inputs.py`. Keep exact summary/PUMS endpoints, source files,
   Census control fit, geographic correspondences and household/person hashes.
   Do not relabel a scaffold as a Census population or use another study's
   retained model output. AequilibraE demand and assignment outcomes do not enter.
3. Require a verified survey-period Census profile, matching geographic vintage
   and income conversion. Preserve the adapter's refusal if unsupported.
4. Require survey-period multimodal conditions: road, walk and bicycle paths;
   transit schedules/access/fare; time-period travel times; tolls and parking.
   Hash each input and document the public authorization. Do not turn unknown
   transit service into unavailable alternatives. Grade endpoint coarsening,
   intrazonal travel and station access before viewing residuals.
5. Prepare all counties as one connected region or establish compatible county
   boundary handling before admitting cross-county tours. County clipping cannot
   silently discard observed destinations or cross-county travel.
6. Freeze package versions, CPython 3.11 identity, ActivitySim source/configuration
   hashes, candidate overlay, stock digest, builder closure and input archive
   before a real model opening. Use the sealed-study runner's exclusive receipt.

The inspected branch supports verified Census profiles for 2022 and 2023 only.
Its current skim adapter explicitly disables transit and repeats auto times
across periods. These are **known admission blockers before outcomes**, not
measured behavioral failures. Probe the actual adapter under the pinned
interpreter and retain the refusal. Do not add guessed 2019 compatibility,
import an unsupported skim package, use secrets or obtain restricted data.
A later implementation can resolve these limits, but needs a new dated
preparation record and complete frozen input closure before real execution.

## Trip-to-tour mapping contract

The public linked-trip table is not a ready-made tour table. Before any outcome
opening, a successor executable adapter must prove the following mapping on
synthetic fixtures, including every exclusion counter. This admission attempt
**does not claim that adapter exists**.

- Restrict outcome requests server-side to the frozen development household IDs
  in the seven counties. Do not download the full release and filter afterward.
  Require exact chooser joins and positive household/day weights; retain every
  exclusion denominator, including unweighted households.
- Group by household, person and diary day. Order trips by departure and arrival
  time in the publisher's Central time convention. Require complete diaries and
  contiguous location/purpose chains. Start a tour at home and end on the next
  return home. Record incomplete, overnight, out-of-region, ambiguous-continuity
  and missing-time chains separately. Never turn them into zero tours.
- Identify the primary activity by mandatory-purpose priority (work, university,
  school), then longest non-home activity duration, then earliest arrival.
  University requires an explicit postsecondary student/school-type field,
  not adult age alone. Preserve at-work subtours and joint travel separately;
  neither enters the individual home-based primary analysis.
- Retain raw published mode labels. Use cleaned/reported modes, never predicted
  mode fields. Map WALK and bicycle to their corresponding alternatives; map
  household/other private vehicles to auto with occupancy/driver evidence; map
  taxi/ridehail to hired travel; map transit only with supported access/egress
  distinctions. Preserve school bus and other modes as unsupported unless the
  modeled alternative set actually contains them. Never merge an unsupported
  mode into a modeled category just to conserve a denominator.
- Collapse matched observed and model modes into five common families for the
  share comparison: auto, walk, bicycle, transit and hired travel. A tour has a
  common-family mode only if all its linked trips have that family. Mixed-family
  tours remain a reported exclusion, not a main-mode guess. Sum model
  alternatives within each family. This conservative homogeneous-tour rule
  requires equivalent modeled-tour filtering and may prevent comparison if the
  native primary-tour instrument cannot establish that equivalence.
- Record counts for every raw mode, mapped family, purpose, retained tour and
  exclusion. Preserve joint, at-work, mixed-family, derived-child, proxy,
  trace-quality and unmatched categories. Unknown labels fail mapping admission;
  do not revise the crosswalk after reading observed shares.

Exact hosted value-label crosswalks, compatible modeled-tour filtering, trace
quality linkage, tour-weight interpretation and category counts remain
**unverified**. No real mapping counts are implied by this contract. Freezing
these requirements does not promote an incomplete adapter to executable status.

## Weights, uncertainty and comparison domains

The publisher supplies household, person, day and trip weights. Its
[weighting guidance](https://metropolitan-council.github.io/TBI_Household_Synthesis_Report/06_expansion_and_weighting/ch_6_expansion_and_weighting.html)
normalizes complete weekdays at the day level and recommends Taylor linearization.
Its [user guide](https://metropolitan-council.github.io/TBI_Household_Synthesis_Report/appendices/data_users_guide_R.html)
uses the lowest appropriate hierarchy level and sample segments as strata.
Neither inspected guidance establishes a tour-specific weight for this adapter.
**Do not average trip weights into a tour weight.** Require a source-supported
tour-weight derivation before opening choices for a decisive comparison.

For admitted weights, observed share is `sum(w * indicator(mode)) / sum(w)`.
Report Kish effective tour sample size `(sum(w))^2 / sum(w^2)`, contributing
households and household-cluster effective size. Kish size alone does not
measure clustering. Use Taylor-linearized ratio variance with household clusters,
publisher sample segments and the split's county strata. Treat singleton
variance strata and unsupported design fields as unavailable uncertainty.
Report marginal 95 percent intervals and simultaneous familywise 95 percent
bounds using Bonferroni over the frozen domain/family census. Keep geographic,
network, coefficient and source uncertainty separate from sampling uncertainty.
Zero observed counts do not imply a zero population upper bound.

Domains are overall; each study county; nine purposes (work, school, university,
escort, shopping, maintenance, eating out, social and discretionary); published
income categories; zero/one/two-or-more vehicles; no-auto/auto-deficient/
auto-sufficient; publisher area types with a verified Census-model crosswalk;
university status; and first departure in EA/AM/MD/PM/EV using the installed
model's exact period boundaries. Also report purpose crossed with auto
sufficiency. Preserve unknown/empty cells as unavailable. If the source or model
cannot support a required domain, the arm cannot advance.

## Metrics and decisions frozen before outcomes

Primary metric per domain is total variation distance, one half the sum of
absolute differences between modeled and weighted observed shares, over the
five common families. Report every family share and signed difference as well.
Both arms face the same observation and uncertainty rules independently.

A mode-uninformed reference assigns 0.20 probability to each family. Advance
an arm only if all source, mapping, weights, travel-condition, coverage and
custody admissions pass and the simultaneous upper bound for
`TV(arm, observed) - 0.80 * TV(uniform, observed)` is below zero in every
required nonempty domain. The 20 percent relative reduction is a preregistered
minimum-information rule: merely matching an uninformed vector is insufficient
reason to spend another region's observations. It is an analyst-chosen
**development progression rule**, not a published transportation accuracy
standard or a claim of fitness for planning decisions. If the reference
already matches a domain, the improvement test cannot award advancement.

Require finite shares in [0, 1], unit sums within 1e-8, exact count conservation
and positive weights before interpretation. The simultaneous interval determines
whether precision supports the progression decision; no post-result sample-size
or exclusion threshold may be added. Model expected shares and conditional
simulation uncertainty remain distinct from survey sampling intervals.

- All admission checks pass and the relative-improvement criterion passes:
  `advance_to_separate_regional_preregistration`, not acceptance or default change.
- An admissible, adequately resolved comparison fails the progression criterion:
  `retire`, preserving the negative development result.
- Any admission, equivalence, uncertainty, custody or execution requirement fails:
  scientific `inconclusive`, disposition `retire_this_attempt`. Do not publish
  observed/model errors as if the inputs had been admitted.

## Execution and interruption

Prove the outcome-free split acquisition end to end with synthetic responses.
Use harmless and targeted mutations for its new guards, with exact restoration.
Exercise the inherited native default/candidate/replay instrument on entirely
synthetic inputs through its sealed runner. This is an instrument check, not
proof of the missing Census-to-TBI mapping or historical network.

Run heavy jobs only under `systemd-run --user --scope -p MemoryMax=6G -p
MemorySwapMax=0`, with CPython 3.11. No `next build`, Docker, hosted systems,
managed database or secrets. No time limit changes the scientific target.
Before real choices or models, require the complete admission record and frozen
executable mapping. A failed admission stops this attempt. A real receipt would
consume one opening, including interruption; never retry it to improve results.
