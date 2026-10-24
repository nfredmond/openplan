# TBI 2019 attempt stops before observed-choice validation

**Both arms are scientifically inconclusive. Retire this attempt at input
admission. No observed-versus-modeled validation executes, and no default changes.**

The current OpenPlan preparation path cannot produce admitted survey-period
inputs for this study. The pinned native probe returns:

> ACS 2019 population inputs have no verified Census vintage profile.

The same probe accepts the existing 2022 and 2023 profiles. The skim adapter
classifies walk-access and drive-access transit time matrices as `zero`.
Source inspection confirms that this disables transit and copies auto times
across periods. These failures precede observed outcomes and cannot establish
whether either coefficient vector describes Twin Cities travel.

The [frozen design](PREREGISTRATION.md) requires compatible historical inputs,
source-supported tour weights and an executable observation/model mapping.
Those gates remain unsatisfied. The [native probe](evidence/input-probe.json)
and [source record](SOURCE.md) identify exact code, environment and source bytes.
No scientific error metric, sampling interval or effective sample size is
computed from unadmitted inputs. This is an incomplete validation task with a
preserved admission result, not a successful validation study.

## Household split completes without opening outcomes

The split is frozen at `9b86edcf1`, before roster acquisition. Within each exact
publisher county label, rank households by the salted SHA-256 rule in
[SPLIT.json](SPLIT.json). Reserve the first `floor(n / 5)` households. Assign
all remaining households to development, keeping all persons and days together.
The rule uses no weight or travel outcome. It assigns all 7,516 released
households, including those outside the study region.

| County | Development households | Held-out households | Total |
|---|---:|---:|---:|
| Anoka | 423 | 105 | 528 |
| Carver | 114 | 28 | 142 |
| Dakota | 578 | 144 | 722 |
| Hennepin | 2,331 | 582 | 2,913 |
| Ramsey | 1,100 | 275 | 1,375 |
| Scott | 152 | 38 | 190 |
| Washington | 343 | 85 | 428 |
| Seven study counties | 5,041 | 1,257 | 6,298 |
| Outside study counties | 978 | 240 | 1,218 |
| Whole released roster | 6,019 | 1,497 | 7,516 |

Outside-region households are excluded by the frozen geography rule before
outcomes. These are household counts, not weighted sample sizes, people, trips
or tours. No completion/weight filter changes the split. The [full summary](evidence/split-summary.json)
retains every county. The split is a household holdout, not geographic transfer.

Survey outcomes requested: **zero**. Survey outcomes read: **zero**. Held-out
outcomes requested/read: **zero**. The entire development outcome partition also
remains unopened. Published methodology and aggregate guide examples were read;
no partition-specific aggregate outcome or respondent choice was read.

## Mapping and results remain unavailable

The frozen mapping contract describes complete home-return chains, primary
purpose, university evidence, homogeneous common-mode families, joint/at-work
separation and explicit exclusion categories. It is not an executed adapter.
Mapped real trips/tours: **zero processed**. Counts of incomplete, mixed-mode,
joint, derived, proxy, quality-flagged, unsupported and missing-weight records
are **unavailable**, not observed zeros. No category is dropped after an outcome
look. Source permission and public OD fields do not resolve these mappings.

| Required domain | Default arm | SEMCOG candidate arm | Observed shares, intervals and effective size |
|---|---|---|---|
| Overall and each of seven counties | Not run | Not run | Unavailable; outcomes unopened |
| Work, school, university and six other purposes | Not run | Not run | Unavailable; outcomes unopened |
| Income and auto ownership/sufficiency | Not run | Not run | Unavailable; outcomes unopened |
| Area type and university status | Not run | Not run | Unavailable; crosswalk unverified |
| Time of day | Not run | Not run | Unavailable; period-compatible inputs unverified |
| Purpose crossed with auto sufficiency | Not run | Not run | Unavailable; outcomes unopened |

| Arm | Scientific decision | Development disposition | Reason |
|---|---|---|---|
| Current default coefficients | `inconclusive` | `retire_this_attempt` | Historical input and mapping admission incomplete |
| `semcog2015-walk-asc-development-v1` | `inconclusive` | `retire_this_attempt` | Same incomplete admission, judged independently |

Retiring this attempt does not retire the installed default, revive the
historically retired SEMCOG transfer, or compare the arms with each other.
Neither arm advances. The preregistered relative-improvement criterion remains
unevaluated. S2/S3 and all scientific acceptance requirements remain open.

## Synthetic native instrumentation works within its limited boundary

The inherited sealed synthetic fixture runs under CPython 3.11.15, ActivitySim
1.5.1 and NumPy 1.25.2. Its 60 synthetic households and 240 synthetic persons
produce 284 primary tours, including nine joint tours. Shared upstream,
default, candidate and default replay stages all exit zero. The instrument
retains 67 strata and 21 alternatives, finite shares in [0, 1], unit probability
sums, unchanged joint probabilities and bit-identical default replay.

These numerical checks establish instrument conservation, not plausible
Twin Cities behavior. Their all-mode values and conditional simulation envelopes
remain in the [synthetic aggregate](evidence/native-synthetic/aggregate.json.gz).
They are not substituted into the real-data table above. The inherited
validator correctly retains `inconclusive` when matched observations are absent.
The synthetic lock freezes the inherited coefficient-study instrument and its
protocol; it does not purport to execute the new TBI mapping contract.

The runner reports 499,748,864 bytes of peak process RSS. The process and its
children run within `MemoryMax=6G`, `MemorySwapMax=0`. This is not a measured
whole-scope simultaneous memory peak. No timeout shortens the model.
[Verification](VERIFICATION.md) records 13 tests, 17 targeted mutation failures,
a surviving harmless comment and exact restoration.

## Work needed before another development opening

The lead needs to sequence a preparation lane that supplies verified 2019
Census/geography/income compatibility and authorized historical multimodal
conditions. A network/input shortage must remain unavailable, not zero transit.
Complete the trip-to-tour adapter, compatible modeled-tour selection and
source-supported tour-weight interpretation on synthetic fixtures. Bind exact
labels, category census, input files, domain crosswalks and estimator code in a
successor frozen execution lock before any development outcome request.

No restricted agreement or paid acquisition is needed for the admitted TBI
public release. No action from Nathaniel is needed to preserve this record.
If a successor requires restricted historical inputs, Nathaniel must decide
whether to pursue the agreement; this task sends no inquiry and signs nothing.
The outcome-free split can remain fixed. Do not label this attempt's unfinished
mapping as completed preparation or reopen any old consumed study.
