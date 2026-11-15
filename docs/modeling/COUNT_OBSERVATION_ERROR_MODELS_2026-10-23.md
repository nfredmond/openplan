# AADT observation error models and their limits

**Date:** October 23, 2026.

**Scope:** S1 research only. No code, study-output analysis, holdout access, or acceptance decision.

**Decision:** Admit documented station intervals. Do not assign a universal percentage from count type, duration, agency, or AADT volume alone.

## Recommended models

The reviewed sources do not establish a transferable, fully specified station error distribution from a published AADT value and count-type label alone. They do establish estimation methods, conditional experimental error distributions, and a method for constructing station predictive intervals from local data. These are different products.

| Proposed method ID | What can be implemented | Required evidence and limit |
|---|---|---|
| `publisher_station_interval_v1` | Preserve publisher-supplied lower and upper bounds, probability level, interval type, and target quantity. | Exact station, section, direction, vehicle definition, year, method, and interval documentation must match. A group-mean interval or sensor-only tolerance does not establish total station AADT uncertainty. Preserve narrower component scope when that is all the source supports. |
| `calendar_year_census_temporal_component_v1` | Record zero temporal sampling uncertainty for a verified complete census of the specified year's traffic. | Every required interval, lane, and direction must be actually observed, with no imputation, growth, expansion, or missing periods. This says nothing about sensor or processing error. It does not authorize a zero-width total observation interval. |
| `unknown_observation_uncertainty_v1` | Return no numeric interval and an explicit unsupported-component reason. | Use when the source supplies insufficient evidence. Unknown is not zero, a failed observation, or a passing model result. |
| `local_empirical_bayes_station_prediction_candidate` | Future, separately validated implementation of Davis and Yang's station predictive distribution. | Requires local daily counts, factor-group estimates, and daily correlation parameters. It is not a lookup from a continuous/short-count label. See the candidate below. |

These IDs are proposed names for implementation, not existing repository APIs. This note does not inspect their implementation. Preserve raw model-count differences separately from any observation interval. A planning-use acceptance tolerance requires its own preregistration and justification.

## Keep four statistical objects separate

| Object | Meaning | Why it cannot substitute for another object |
|---|---|---|
| Population error distribution | Distribution of estimation errors over defined station-years, dates, and methods. | Pooled coverage can conceal poorly covered stations or strata. Transfer to a new station requires evidence of applicability. |
| Confidence interval for a group mean | Uncertainty in a mean adjustment factor estimated from a sample of counters. | It contracts with the number of counters. It does not include all variation of an individual site's factor or short count. |
| Station interval | A confidence/credible interval for a station parameter, or predictive interval for a specified station quantity. | The target, conditioning information, probability interpretation, and covered error components must be stated. An interval for a future annual total differs from uncertainty in a past year's recorded AADT. |
| Acceptance tolerance | Maximum discrepancy acceptable for a declared planning use. | It is a decision rule, not an observed error distribution or confidence level. |

FHWA's factor-group formula is `mean ± t(1-alpha/2, n-1) * s / sqrt(n)`. The guide identifies its target as a “confidence interval for a composite group factor.” Here `n` counts continuous monitoring locations, not sampled days at one station. Its recommended ±10 percent precision at 95 percent confidence concerns monthly adjustment factors, with a separate recreational-group discussion. It is not a universal station AADT interval. The preceding page also warns that some factor distributions are not normal. [TMG22-FACTOR-MEAN, pp. 3-8 and 3-9](https://rosap.ntl.bts.gov/view/dot/74643/dot_74643_DS1.pdf#page=86)

Statistical interpretation: a prediction for an individual site's factor must account for between-site variation as well as uncertainty in the mean. Even a normal-theory factor prediction would not, by itself, cover sampling-date, assignment, sensor, growth, or missing-data errors in station AADT. Do not divide pooled error standard deviation by the square root of the number of pooled samples and call the result station uncertainty.

This narrows the August 25 research note's proposed grade-B wording. Documented factor-group mean precision alone does not establish an individual station AADT interval. Preserve the earlier note as historical research; use the distinctions here for the present uncertainty decision.

## Continuous counters need three separate assessments

**A complete year's temporal census is not a sample of that year.** For daily totals `C_d`, its recorded annual average is `sum(C_d) / D`, where `D` is the actual calendar-year day count. Day-to-day variability does not create uncertainty about that arithmetic average when every day's actual traffic is known. A standard error across days instead answers a question about a stochastic or longer-run mean. This is a mathematical distinction, not a claim that equipment records equal true traffic. FHWA describes the complete-year average and the biases that missing days can introduce. [TMG22-CONTINUOUS, section 3.8.2, pp. 3-67 and 3-68](https://rosap.ntl.bts.gov/view/dot/74643/dot_74643_DS1.pdf#page=145)

**Missing-data estimation remains conditional on the missingness pattern.** FHWA recommends a calendar-weighted method using available time increments within month, day of week, and time of day. This retains partial days that traditional AASHTO calculations discard. It is a point estimator, not an accompanying generic probability model. Computability with sparse coverage does not establish station precision. [TMG22-CONTINUOUS, pp. 3-68 through 3-70](https://rosap.ntl.bts.gov/view/dot/74643/dot_74643_DS1.pdf#page=146)

Krile, Feng, and Schroeder study simulated missingness at 496 selected complete station-years. Their study distinguishes random removals from continuous missing blocks. A nominal missing-day removal in the random scenarios removes selected within-day blocks averaging 12 hours, not necessarily an entire 24-hour day. They protect at least one occurrence of each weekday per month. For block scenarios that eliminate complete months, they modify the averaging procedures to use the remaining months. Those details prevent interpreting a headline missing percentage as the experimental design. [KRILE14-MISSING, pp. 9 and 11 through 12](https://www.fhwa.dot.gov/policyinformation/travel_monitoring/pubs/aadt/aadt_task_2_final_report_jan_2015.pdf#page=11)

The report's national Table 10 illustrates the dependence on missingness. Its AASHTO column reports these percent-bias ranges:

| Removal scenario | Table 10 national range, percent |
|---|---:|
| One selected day per month under the report's removal procedure | -0.42 to +0.25 |
| All but seven days per month | -2.24 to +1.99 |
| One 30-day block | -1.30 to +1.06 |
| One 60-day block | -3.60 to +2.53 |

These are source-reported national summaries, not proposed station bounds. The text calls them confidence intervals for median percent bias, while its methods define percentiles of simulated bias distributions and describe separate aggregation levels. Do not infer a station distribution from the national row. The report identifies separate station results in its supplemental tables; their exact applicability and values remain **[VERIFY: retrieve station-level supplement before any use]**. Sensor measurement error is not estimated by deleting observations from an existing count series. [KRILE14-MISSING, pp. 15 through 18, especially Table 10, printed p. 18, PDF page 20](https://www.fhwa.dot.gov/policyinformation/travel_monitoring/pubs/aadt/aadt_task_2_final_report_jan_2015.pdf#page=20)

**Sensor and processing errors need their own evidence.** FHWA recommends equipment calibration and testing, including manufacturer procedures, initial checks, and continuing checks. The cited guidance does not assign a universal sensor-error distribution to every continuous counter. Record station equipment, calibration, classification, edits, and failure flags where supplied. Do not assume independent zero-mean errors that cancel over a year; a shared detection or processing bias can persist. [TMG22-EQUIPMENT, sections 2.4.2 through 2.4.3, pp. 2-40 and 2-41; section 5.3.5, p. 5-11](https://rosap.ntl.bts.gov/view/dot/74643/dot_74643_DS1.pdf#page=76)

## Short-count AADT depends on duration and factor assignment

The original 2022 TMG Table 3-3 contains the previously cited reference figures. Its two error columns have different meanings:

| AADT range | Reference median error/bias, percent | Reference 95 percent TCE median error range, percent |
|---|---:|---:|
| 500 to 4,999 | ±2.0 | ±34.0 |
| 5,000 to 54,999 | ±1.5 | ±28.0 |
| 55,000 and higher | ±2.5 | ±28.0 |

The source labels the latter column “95% TCE Median Error Range,” under a minimum-probability heading. It does not specify an individual station's duration, factor assignment, equipment, or missingness model, and supplies no row below 500 AADT. Do not relabel these values as normal standard deviations, station predictive intervals, sensor tolerances, or acceptance thresholds. [TMG22-REFERENCE-TABLE, Table 3-3, p. 3-12, PDF page 90](https://rosap.ntl.bts.gov/view/dot/74643/dot_74643_DS1.pdf#page=90)

Krile, Todt, and Schroeder provide more specific experimental distributions. Their Table 4 reports the following central error ranges. All rows below concern Monday-through-Thursday counts excluding federal holidays. Values are percentages of true annual AADT, not of the estimated AADT. [KRILE15-SHORT, Table 4, printed p. 19, PDF page 26](https://www.fhwa.dot.gov/policyinformation/travel_monitoring/pubs/aadt/aadt_task_3_final_report_nov_2015.pdf#page=26)

| Count duration | Functional-class grouping | Volume-range grouping | Clustering grouping |
|---|---:|---:|---:|
| One full calendar day | -24.31 to +30.51 | -25.43 to +31.39 | -16.55 to +19.48 |
| 24 hours, random starting hour | -24.91 to +30.46 | -25.60 to +31.51 | -17.41 to +19.01 |
| Two full calendar days | -22.53 to +28.28 | -23.32 to +29.00 | -15.33 to +17.18 |
| 48 hours, random starting hour | -23.19 to +27.36 | -23.83 to +27.96 | -15.78 to +16.24 |
| Three full calendar days | -21.48 to +26.95 | -22.01 to +28.12 | -14.18 to +16.37 |
| 72 hours, random starting hour | -21.98 to +26.24 | -22.46 to +25.86 | -14.57 to +15.16 |

For seven full calendar days, Table 2 reports functional-class grouping across all eligible days, excluding holidays: -17.85 to +24.12 percent. It supplies no Monday-through-Thursday entry for a seven-day count. Do not mix that row with the Table 4 sampling restriction. [KRILE15-SHORT, Table 2, printed p. 17, PDF page 24](https://www.fhwa.dot.gov/policyinformation/travel_monitoring/pubs/aadt/aadt_task_3_final_report_nov_2015.pdf#page=24)

The report calls these ranges confidence intervals but defines them from the 2.5th and 97.5th percentiles of simulated short-count errors. They describe the experimental error population. Factors exclude the station being estimated. Functional-class and volume groups use state/year structure; clustering uses temporal patterns. The clustering experiment uses annual pattern information unavailable at an ordinary short-count site. The authors warn its full benefit “cannot be realized outside of this evaluation.” Even the national functional-class result conceals substantial variation among groups. These tables support sensitivity scenarios with the experimental scope attached, not automatic station admission. [KRILE15-SHORT, pp. 8 through 13 and 17 through 19](https://www.fhwa.dot.gov/policyinformation/travel_monitoring/pubs/aadt/aadt_task_3_final_report_nov_2015.pdf#page=15)

### Peer-reviewed studies reinforce the applicability limit

Grande, Paramita, and Regehr study Manitoba's 2018 program. Their simulated 48-hour samples start on Monday or Tuesday between 6 a.m. and 6 p.m., occur from May through September, and exclude holidays. They use 100 samples per site-direction, impute missing hours, and use an AASHTO-derived annual reference. The pooled benchmark uses 117 preassigned site-directions. Factors and short samples share continuous-counter data, a dependency the paper discusses. The authors state that the “results presented are specific to this case study.” [GRANDE21-TPG, pp. 273 through 278, publisher PDF](https://journals.sagepub.com/doi/pdf/10.1177/03611981211001831)

Table 3, printed p. 278, PDF page 8, records pooled signed-error percentiles -16.46 and +17.49 percent, signed-error standard deviation 8.58 percent, and mean absolute percentage error 6.40 percent. **[VERIFY: rendered PDF table image remains unavailable in this session; figures checked against publisher PDF text and publisher HTML only.]** These values stay out of implementation parameters. They do not supply a US station interval. The paper's Equation 3 transcription uses a true-minus-estimate sign, whereas Krile defines estimate-minus-true; verify the rendered equation and table convention before translating any signed quantiles. Do not treat 6.40 percent mean absolute error as a standard deviation or interval half-width. [GRANDE21-TPG, Table 3 and Equation 3](https://journals.sagepub.com/doi/10.1177/03611981211001831)

Sharma, Gulati, and Rizak examine Minnesota and check their findings against Alberta and Saskatchewan. The publisher abstract identifies factor-group assignment effectiveness as a major influence, beyond the distinction among 24-, 48-, and 72-hour counts. **[VERIFY: full paper, numerical figures, equations, and internal page locators unavailable; no numerical parameters adopted.]** The confirmed bibliographic range is pp. 430 through 439. [SHARMA96-ASSIGNMENT, DOI 10.1061/(ASCE)0733-947X(1996)122:6(430)](https://ascelibrary.org/doi/10.1061/%28ASCE%290733-947X%281996%29122%3A6%28430%29)

## A station predictive model exists, but needs local inputs

Davis and Yang derive an empirical Bayes predictive distribution for annual or multiyear traffic totals. Their model uses log daily traffic, monthly and weekday effects, and correlated daily residuals with daily and weekly autoregressive structure. It integrates uncertainty over factor-group and covariance choices. Equation 14 gives the predictive mixture; quantile root-finding supplies interval bounds. Dividing an annual-total interval by the actual number of calendar days would give an interval for that annual average, provided the same target year and vehicle basis apply. That transformation is arithmetic, not new validation. [DAVIS-YANG01-PREDICTIVE, sections “Deriving the Predictive Distribution for Total Traffic Volume” and “Predictive Distribution of Total Traffic,” Equations 4 through 15](https://www.bts.gov/archive/publications/journal_of_transportation_and_statistics/volume_04_number_01/paper_02/index)

Required inputs include raw station sample counts and dates, locally estimated factor groups, and continuous-counter covariance estimates. Applicability also depends on the approximation for a long total period relative to a short sample, and the treatment of sample/target correlation. The paper does not supply universal coefficients. **[VERIFY: original journal PDF pagination, rendered equations, and numerical coverage-test results before implementation.]** The publisher HTML establishes a credible research candidate, not a ready default for current feeds. Do not implement from garbled HTML equation transcription. A local implementation would need a separate preregistered coverage assessment using observation data independent of model residuals. [DAVIS-YANG01-PREDICTIVE, sections “Epistemic Uncertainty” and “A Calibration Test”](https://www.bts.gov/archive/publications/journal_of_transportation_and_statistics/volume_04_number_01/paper_02/index)

## Estimated or modeled AADT needs a different lineage

TMG reporting codes distinguish government direct-count derivations (A), government alternative methods (B), private direct-count derivations (C), private alternative methods (D), and other methods (E). Alternative methods include demand modeling, statistical trends, and cellular-data modeling. A and C include short counts; neither establishes a complete-year census or a station interval. B and D do not inherit direct-count error distributions. A modeled observation may also share inputs with the model under assessment. Preserve that dependence rather than treating a second agency feed as independent measurement. [TMG22-METHOD-CODES, section 5.3, pp. 5-8 and 5-9, PDF pages 264 and 265](https://rosap.ntl.bts.gov/view/dot/74643/dot_74643_DS1.pdf#page=264)

No reviewed source supports a generic error percentage for all modeled, growthed, spatially transferred, or cellular-derived AADT. Require the producer's applicable station interval or a separately supported method. A point-model RMSE or mean absolute error does not establish individual predictive coverage.

## Evidence fields and interval conversion

The implementation owner should consider these evidence fields. This is a proposed research contract, not a metadata audit:

- **Source custody:** agency, dataset/version, public artifact URL, retrieval time, immutable hash, source record ID, citation ID, exact table/equation/printed page/PDF page, source edition, and verification status.
- **Observation target:** station/section, count year, actual start/end timestamps, timezone, vehicles/classes, units, direction, lanes, carriageways, AADT versus weekday/day-specific average, and underlying-count lineage.
- **Collection and estimation:** direct/derived code with its code-system version, continuous versus short-duration status, exact duration and starting hour, actual versus edited/imputed coverage, missing blocks, calendar weighting method, expansion factors, factor-group assignment and membership, donor stations, factor year, axle correction, and growth/spatial transfer.
- **Equipment:** sensor and processing type, calibration/recount source, dates, QA flags, known bias, editing rules, and quantified versus unknown error components.
- **Interval evidence:** lower/upper values, units, target parameter, probability level, confidence/credible/predictive/tolerance classification, component scope, estimation method, distribution or empirical quantiles, sample size/unit, dependence assumptions, applicability restrictions, and unassessed components. Preserve source asymmetry and probability level.
- **Use boundary:** station-specific or population-reference scope, applicability finding and reasons, decisive-use eligibility, uncertainty status, and a separate acceptance-tolerance record. Missing evidence produces a reason, not a guessed number.

When a supported error model uses `e = (O - T) / T`, where `O` is estimated AADT and `T` is true AADT, an error interval `[l, u]` in fractional units inverts to:

```text
T_lower = O / (1 + u)
T_upper = O / (1 + l)
```

This requires positive denominators and the same target and error convention. It is not `O * (1 ± r)`. If a source defines error relative to `O`, or reverses the sign, the conversion changes. The algebra does not establish that a pooled population interval applies to a particular station. Nor does a 90 percent interval become 95 percent without further distributional evidence.

## Source register and verification record

Citation IDs below are stable research identifiers proposed for code references. They identify evidence; they do not themselves authorize a numeric uncertainty model.

| Citation IDs | Source identity and public primary URL | Verification in this session |
|---|---|---|
| `TMG22-FACTOR-MEAN`, `TMG22-REFERENCE-TABLE`, `TMG22-CONTINUOUS`, `TMG22-EQUIPMENT`, `TMG22-METHOD-CODES` | FHWA, *Traffic Monitoring Guide*, December 2022, FHWA-PL-022-026. [Archived original PDF](https://rosap.ntl.bts.gov/view/dot/74643/dot_74643_DS1.pdf); [methodologies HTML](https://www.fhwa.dot.gov/policyinformation/tmguide/tmg_2022/traffic-data-methodologies.cfm); [reporting HTML](https://www.fhwa.dot.gov/policyinformation/tmguide/tmg_2022/federal-data-reporting.cfm). | Original PDF has 288 pages. Rendered and inspected original pp. 3-9 and 3-12, PDF pages 87 and 90. Cross-checked current revised PDF pp. 3-8, 3-9, 3-12, 3-68, 5-8, and 5-9 visually. Current [FHWA PDF](https://www.fhwa.dot.gov/policyinformation/tmguide/2022_TMG.pdf) has 462 pages and identifies version 1.2, April 2026. Do not mix its PDF offsets with the archived original. |
| `KRILE14-MISSING` | Krile, Feng, and Schroeder, FHWA-PL-015-008, cover dated November 2014; retrieved through a January 2015 filename. [FHWA PDF](https://www.fhwa.dot.gov/policyinformation/travel_monitoring/pubs/aadt/aadt_task_2_final_report_jan_2015.pdf); [ROSA P copy](https://rosap.ntl.bts.gov/view/dot/53676/dot_53676_DS1.pdf). | 23 pages. Table 10 visually inspected in the ROSA P copy at printed p. 18, PDF page 20. FHWA copy text/table cross-checked; bytes differ. Supplemental station tables not retrieved. |
| `KRILE15-SHORT` | Krile, Todt, and Schroeder, FHWA-PL-16-008, October 2015. [FHWA PDF](https://www.fhwa.dot.gov/policyinformation/travel_monitoring/pubs/aadt/aadt_task_3_final_report_nov_2015.pdf). | 45 pages. Rendered and visually inspected Tables 2, 3, and 4 at printed pp. 17 through 19, PDF pages 24 through 26. The [ROSA P PDF](https://rosap.ntl.bts.gov/view/dot/41079/dot_41079_DS1.pdf) contains this report, although its catalog record associates a different report number. Use the document's title page. |
| `GRANDE21-TPG` | Grande, Paramita, and Regehr, *Transportation Research Record* 2675(9), 271–283, 2021; DOI 10.1177/03611981211001831. [Publisher PDF](https://journals.sagepub.com/doi/pdf/10.1177/03611981211001831). | Publisher HTML and 13-page PDF text checked. Direct download returns HTTP 403. Screenshot request does not expose an inspectable image through this tool transport. Rendered verification and signed-error convention remain [VERIFY]. |
| `SHARMA96-ASSIGNMENT` | Sharma, Gulati, and Rizak, *Journal of Transportation Engineering* 122(6), 430–439, 1996; [publisher DOI page](https://ascelibrary.org/doi/10.1061/%28ASCE%290733-947X%281996%29122%3A6%28430%29). | Publisher abstract and bibliographic range checked. Full-text numerical claims remain [VERIFY]. |
| `DAVIS-YANG01-PREDICTIVE` | Davis and Yang, *Accounting for Uncertainty in Estimates of Total Traffic Volume: An Empirical Bayes Approach*, *Journal of Transportation and Statistics* 4(1), 2001. [Publisher-hosted full HTML](https://www.bts.gov/archive/publications/journal_of_transportation_and_statistics/volume_04_number_01/paper_02/index). | Method and limitations checked in primary HTML. Journal-PDF equation rendering, internal pages, and numerical coverage-test figures remain [VERIFY]. The webpage's 2011 timestamp is not the journal publication year. |

For retrieval custody, SHA-256 digests are:

```text
TMG December 2022 archived PDF
ffcda0a82b7ba39ffcde321370101f9be1887a07e434e4cd752d3b316b438726
TMG current version 1.2 PDF
40058715fb820840a04be9ff7cfadafb10120a3b77be004b2aaef7abb2f040bc
KRILE14-MISSING, FHWA January-2015 filename
59731d32117584ccdb27485edc5018a3c5b17d429c4ced6d3bd4b1281a6ff26c
KRILE14-MISSING, ROSA P 53676 copy
eab915f7d95ccf6d63ab1e92fc785ab15498af57b03813b795e936f42ec5badb
KRILE15-SHORT, FHWA November-2015 filename
deb6acf4142028484ea0397b74d48a4cd1e23e9eef41e58b8a17b5ab77be971e
```

Downloaded sources and rendered pages remain temporary files under `/tmp/s1-aadt-research-20261023/`; they are not committed research artifacts. Rendered inspection can catch signs, columns, and page-number errors. It cannot prove external station applicability, sensor accuracy, independence, interval coverage, or model acceptance. No test, guard, or code changes fall within this research assignment.
