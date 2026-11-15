# ActivitySim behavioral coefficient inventory, October 23, 2026

Inventory baseline: OpenPlan `57be0eed1cbcf4e41dd6459a3bd6ed4df2517797`.
Read the installed ActivitySim 1.5.1 `prototype_mtc` configuration, its settings,
component YAML, CSV coefficients, templates, probabilities and worker resolution.
The accompanying `stock-files.json` records every stock file and its SHA-256.
It includes inactive legacy files for custody, not as active components.
No model outcome or survey microdata was opened to prepare this inventory.

## What actually runs

The starter package is a non-calibrated scaffold. The runnable `mtc` package
uses `build_activitysim_input_bundle.py` to layer bundle settings and accepted
components over installed `prototype_mtc`. `runtime.resolve_layered_config_dirs`
checks the stock directory digest and accepted overlay files before execution.
`activitysim-accepted-components.json` currently installs only national auto
ownership. It does not install either mandatory-tour candidate or the 2017
successor. Custom CLI/config overrides are possible and require their own
inventory; this inventory covers the repository-supported default and retained
research packages, not unknown operator files.

## Source and estimation meaning

**MTC** below means the stock example shipped in ActivitySim 1.5.1. Its original
lineage is MTC Travel Model One, San Francisco Bay Area. MTC documents early
2000s mode-choice estimation and year-2000 price units. That is not evidence that
every shipped coefficient was estimated in 2000. ActivitySim explicitly says
the example has evolved away from TM1. Exact per-file estimation sample, year,
standard errors, later calibration edits and applicability outside the donor
region remain **unverified**. Source bytes and a model description are held;
complete original estimation bundles and nationwide transfer evidence are not.

Sources: [ActivitySim example model documentation](https://activitysim.github.io/activitysim/v1.5.1/users-guide/example_models.html),
[canonical MTC example](https://github.com/ActivitySim/activitysim-prototype-mtc),
[MTC travel modeling report](https://files.mtc.ca.gov/library/pub/29744.pdf).

S means executable source custody, E means estimation evidence, and T means
OpenPlan transfer evidence. A regional source is not a nationwide acceptance.

## Active component map

All files below are relative to stock `prototype_mtc/configs`, except the
national auto-ownership overlay. Components share files where stated.

| Component | Utility/specification and coefficient or probability files | Source, estimation region/year and evidence |
|---|---|---|
| Accessibility | `accessibility.csv`, `accessibility.yaml`, `constants.yaml` | MTC; embedded numeric utility parameters, exact estimation year unverified; S yes, E incomplete, T no |
| School location | `school_location.csv`, `school_location_sample.csv`, `school_location_coefficients.csv`, `destination_choice_size_terms.csv`; tour-mode logsums | MTC; Bay Area, year unverified; S yes, E incomplete, T no |
| Workplace location | `workplace_location.csv`, `workplace_location_sample.csv`, `workplace_location_coefficients.csv`, size terms; tour-mode logsums | MTC; Bay Area, year unverified; S yes, E incomplete, T no |
| Auto ownership, active default | `data/modeling/activitysim-auto-ownership-national-v1/auto_ownership.{csv,yaml}` and `auto_ownership_coefficients.csv` | OpenPlan, 2022 national NHTS; S yes, E yes, T bounded accepted distribution test on nine fresh geographies, not all-state accuracy |
| Free workplace parking | `free_parking.csv`, `free_parking_coefficients.csv` | MTC; Bay Area, year unverified; S yes, E incomplete, T no |
| Coordinated daily activity pattern | `cdap_indiv_and_hhsize1.csv`, `cdap_coefficients.csv`, `cdap_interaction_coefficients.csv`, `cdap_fixed_relative_proportions.csv` | MTC; Bay Area, year unverified; S yes, E incomplete, T no |
| Mandatory tour frequency | `mandatory_tour_frequency.csv`, `mandatory_tour_frequency_coefficients.csv`, alternatives | MTC default; Bay Area, year unverified; S yes, E incomplete, T no |
| Mandatory tour scheduling | `tour_scheduling_work.csv`, `tour_scheduling_school.csv` and matching `_coefficients.csv`; departure/duration alternatives and segments | MTC; Bay Area, year unverified; S yes, E incomplete, T no |
| Joint tour frequency | `joint_tour_frequency.csv`, `joint_tour_frequency_coefficients.csv`, alternatives | MTC; Bay Area, year unverified; S yes, E incomplete, T no |
| Joint tour composition | `joint_tour_composition.csv`, `joint_tour_composition_coefficients.csv` | MTC; Bay Area, year unverified; S yes, E incomplete, T no |
| Joint tour participation | `joint_tour_participation.csv`, `joint_tour_participation_coefficients.csv` | MTC; Bay Area, year unverified; S yes, E incomplete, T no |
| Joint tour destination | `joint_tour_destination.yaml` inherits non-mandatory destination files | MTC; Bay Area, year unverified; S yes, E incomplete, T no |
| Joint tour scheduling | `tour_scheduling_joint.csv`, `tour_scheduling_joint_coefficients.csv` | MTC; Bay Area, year unverified; S yes, E incomplete, T no |
| Non-mandatory tour frequency | `non_mandatory_tour_frequency.csv`, eight person-type coefficient files listed below, extension probabilities and alternatives | MTC; Bay Area, year unverified; S yes, E incomplete, T no |
| Non-mandatory destination | `non_mandatory_tour_destination.csv`, sample spec and coefficients; size terms and tour-mode logsums | MTC; Bay Area, year unverified; S yes, E incomplete, T no |
| Non-mandatory scheduling | `tour_scheduling_nonmandatory.csv`, `tour_scheduling_nonmandatory_coefficients.csv` | MTC; Bay Area, year unverified; S yes, E incomplete, T no |
| Tour mode choice | `tour_mode_choice.csv`, `tour_mode_choice_coefficients.csv`, `tour_mode_choice_coefficients_template.csv`; nests/constants in YAML | MTC; Bay Area, early 2000s lineage, exact current vector year unverified; S yes, E incomplete, T no |
| At-work subtour frequency | `atwork_subtour_frequency.csv`, coefficients and alternatives | MTC; Bay Area, year unverified; S yes, E incomplete, T no |
| At-work destination | `atwork_subtour_destination.csv`, sample spec and coefficients; size terms and tour-mode logsums | MTC; Bay Area, year unverified; S yes, E incomplete, T no |
| At-work scheduling | `tour_scheduling_atwork.csv`, `tour_scheduling_atwork_coefficients.csv` | MTC; Bay Area, year unverified; S yes, E incomplete, T no |
| At-work mode choice | Same tour-mode spec/template, atwork purpose column | MTC; Bay Area, year unverified; S yes, E incomplete, T no |
| Stop frequency | Ten `stop_frequency_<purpose>.csv` specs and ten coefficient files below | MTC; Bay Area, year unverified; S yes, E incomplete, T no |
| Trip purpose | `trip_purpose_probs.csv` | MTC probability table; Bay Area, year unverified; S yes, E incomplete, T no |
| Trip destination | `trip_destination.csv`, `trip_destination_sample.csv`, `trip_destination_coefficients.csv`, size terms and trip-mode logsums | MTC; Bay Area, year unverified; S yes, E incomplete, T no |
| Trip purpose and destination | Wrapper reuses trip-purpose and trip-destination inputs | No independent coefficient vector |
| Trip scheduling | `trip_scheduling_probs.csv`, `trip_scheduling.yaml` | MTC empirical probability table; Bay Area, year unverified; YAML names an absent optional `trip_scheduling_coefficients.csv`, so no source custody for that absent file |
| Trip mode choice | `trip_mode_choice.csv`, `trip_mode_choice_coefficients.csv`, `trip_mode_choice_coefficients_template.csv`; nests/constants in YAML | MTC; Bay Area, exact year unverified; S yes, E incomplete, T no |

Initialization/annotation files also set income segments, person types,
value-of-time distributions and density variables. `settings.yaml` contains
value-of-time distribution parameters; the documentation attributes these to
the SFCTA Mobility, Access and Pricing stated-preference survey, with exact
survey year unverified here. `constants.yaml` and mode-choice YAML contain
walk/bicycle speeds, perceived-cost multipliers and ridehail assumptions.
These are held source assumptions, not independently accepted US coefficients.
Output writing and summaries introduce no behavioral choice model.

## Complete named coefficient and probability file census

Every row has MTC Bay Area lineage and an unverified per-file estimation year
unless explicitly marked as the superseded auto-ownership reference.

| File | Evidence |
|---|---|
| `atwork_subtour_destination_coefficients.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `atwork_subtour_frequency_coefficients.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `auto_ownership_coefficients.csv` | Stock fallback/reference; superseded by accepted national overlay in normal mtc bundle |
| `cdap_coefficients.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `cdap_fixed_relative_proportions.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `cdap_interaction_coefficients.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `destination_choice_size_terms.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `free_parking_coefficients.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `joint_tour_composition_coefficients.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `joint_tour_frequency_coefficients.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `joint_tour_participation_coefficients.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `mandatory_tour_frequency_coefficients.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `non_mandatory_tour_destination_coefficients.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `non_mandatory_tour_frequency_coefficients_PTYPE_DRIVING.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `non_mandatory_tour_frequency_coefficients_PTYPE_FULL.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `non_mandatory_tour_frequency_coefficients_PTYPE_NONWORK.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `non_mandatory_tour_frequency_coefficients_PTYPE_PART.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `non_mandatory_tour_frequency_coefficients_PTYPE_PRESCHOOL.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `non_mandatory_tour_frequency_coefficients_PTYPE_RETIRED.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `non_mandatory_tour_frequency_coefficients_PTYPE_SCHOOL.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `non_mandatory_tour_frequency_coefficients_PTYPE_UNIVERSITY.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `non_mandatory_tour_frequency_extension_probs.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `school_location_coefficients.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `stop_frequency_coefficients_atwork.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `stop_frequency_coefficients_eatout.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `stop_frequency_coefficients_escort.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `stop_frequency_coefficients_othdiscr.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `stop_frequency_coefficients_othmaint.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `stop_frequency_coefficients_school.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `stop_frequency_coefficients_shopping.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `stop_frequency_coefficients_social.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `stop_frequency_coefficients_univ.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `stop_frequency_coefficients_work.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `tour_mode_choice_coefficients.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `tour_mode_choice_coefficients_template.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `tour_scheduling_atwork_coefficients.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `tour_scheduling_joint_coefficients.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `tour_scheduling_nonmandatory_coefficients.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `tour_scheduling_school_coefficients.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `tour_scheduling_work_coefficients.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `trip_destination_coefficients.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `trip_mode_choice_coefficients.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `trip_mode_choice_coefficients_template.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `trip_purpose_probs.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `trip_scheduling_probs.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |
| `workplace_location_coefficients.csv` | S: yes; E: regional lineage only, exact estimation year unverified; T: no US transfer evidence |

## Retained OpenPlan research sets

| Set | Source, region/year | Source/estimation/transfer posture |
|---|---|---|
| `activitysim-auto-ownership-national-v1` | National 2022 NHTS; native weighted ActivitySim/Larch estimation | S and E held. Initial rejection and post-hoc diagnosis remain. Later frozen nine-geography distribution test accepts this component only; exact result and registry hashes bind the installation. |
| `activitysim-mandatory-tour-frequency-national-v1` | National 2022 NHTS development divisions | Source/spec/coefficients and fit manifest held. Superseded research candidate, not registered; no production transfer acceptance. |
| `activitysim-mandatory-tour-frequency-national-v2` | National 2022 NHTS development divisions | S and E held. One-opening three-division acceptance rejects the candidate on predictive and distribution gates. Holdout remains consumed. |
| `activitysim-mandatory-tour-frequency-2017-successor` | Fitted on already-consumed 2022 NHTS; attempted 2017 national transfer | S and E held. 2017 opening terminated after durable receipt. Permanent inconclusive decision, no registration. Neither 2017 archive may be reopened. |

Exact retained filenames, manifest/decision hashes and the currently active
registry are committed under `data/modeling/`. The historical package manifest
still calls national auto ownership a candidate; the later accepted-component
registry plus its verified acceptance result governs its current use. That
history is preserved rather than rewritten.

## The walk symptom does not identify one causal coefficient

The August 16 Nevada County run reports 17.5 percent walk trips. That is a
simulated share, not an observed local error estimate. Local Census households
do not validate the behavior. Transit is disabled, auto times repeat across
periods, and nonmotorized distances use the screening network. Tour mode,
trip mode, destination choice, auto ownership, density and skim construction
can all affect the share. The next experiment must isolate a component while
retaining this confounding and must not call a reduced share an accuracy gain.

NHTS 2022 public-use files lack matching alternative-specific LOS and local
choice-zone identifiers. They cannot re-estimate the current spatial mode-choice
specification without invented inputs. Existing 2017/2009 protections remain.
A published regional donor may support a transparent development transfer, but
it remains another borrowed source until matched observation and uncertainty
support its applicability. No S2 or S3 closure follows from this inventory.
