# Observed regional mode-choice data: source and access review

**Source-check appendix.** The [combined assessment](../PUBLIC_OBSERVED_TRAVEL_CHOICE_SOURCES_2026-10-23.md) governs the final recommendation across all regions. Rankings below concern only this checker's assigned sources. Its inspected NYMTC prefix and CHTS sample records are exposed development material and cannot later count as untouched acceptance records. Statements about no PR or writing only this note describe the checker session, not the combined task.

Accessed date for every source below: **2026-10-23**. Prepared as a research sub-agent note. Findings describe public releases and published terms, not eligibility for restricted access. `[VERIFY]` identifies a fact or permission this review does not establish.

## Recommendation and evidence boundary

**NYMTC's 2010/2011 public-use linked-trip file is the strongest candidate for strictly noncommercial development-only ActivitySim mode-choice research.** Its public CSV actually retains both OD TAZs and 2010 census tracts, departure/arrival fields, a chosen linked-trip mode, household/person links, tour identifiers, and weights. A bounded archive-prefix inspection confirms these fields exist in records, beyond the codebook. Its terms expressly limit use to noncommercial purposes. It is therefore not an openly reusable dataset for unrestricted redistribution or commercial services. See NY1–NY3.

**The Caltrans CHTS sample is the clearest explicitly open-licensed artifact verified here.** The official OEDI submission applies CC BY 4.0 and supplies a 115,624-byte sample. It retains tract geography, modes, times, and weights, while detailed locations contain a redaction marker. Its 100-row table excerpts support schema development, not estimation or accuracy claims. Full CHTS through TSDC is the next candidate to investigate, subject to registration, the full-release terms, and actual completeness checks. Do not extend the sample's CC BY license to every full TSDC release. See CA1–CA4 and TS1–TS4.

No source reviewed here supplies verified public point coordinates plus an unrestricted, complete observed household sample. Tract or TAZ skims remain possible development inputs, with spatial aggregation error. This review does not establish ready-to-run alternative-specific skims, tour construction, model estimates, or independent scientific validation.

## Source comparison

| Source | Observed record unit and period | Public OD geography established here | Access and reuse status | Development decision |
|---|---|---|---|---|
| Atlanta Regional Commission, 2011 | Person travel diaries and GPS subsamples | TSDC dictionary marks place/origin/destination TAZ and coordinates with `*`; county of residence remains. No public fine OD verified. | ARC exposes a public archive; a separate open reuse license was not located. TSDC requires registration for cleansed records and approval for spatial details. | Hold pending fine-OD and permission verification. |
| SANDAG, 2016/2017; 2022/2023 | Household/person diaries; multiday smartphone component | No public person-level OD release verified. Survey-collected coordinates and report maps do not establish public microdata geography. | Public reports; latest report and appendices available upon request. No free, agreement-free microdata pathway verified. | Do not use model-output portal tables as observations. |
| NYMTC/NJTPA, 2010/2011 | Linked person trips, unlinked segments; tour identifiers | OD NYBPM TAZ and 2010 census tract, actually present in public linked CSV prefix | Free direct public ZIP, no account or signed application encountered; noncommercial use and notice-preservation restrictions apply. | First choice for bounded noncommercial development. |
| Bay Area MTC, BATS 2023 | Household/person trips; one-day and multiday diaries | No unrestricted public person-level OD established; public dashboard gives summaries | Microdata applicants must sign NDA; listed purposes are peer agency projects and university research. | Not an agreement-free source. |
| Bay Area MTC, 2012/2013 CHTS subset | Household/person one-day diaries | TSDC CHTS sample supports tract geography; separate unrestricted MTC fine-OD release not verified | Public weighting documentation; broader data access follows CHTS route | Useful California subset, not independent of CHTS. |
| Caltrans CHTS through TSDC | Diary place/activity sequences, 2012/2013 collection; TSDC labels 2010–2012 | Sample has place/home/work/school tract fields; block groups and coordinates are redacted | Sample explicitly CC BY 4.0. Full cleansed records require registration. Detailed spatial data require signed agreements and secure analysis. | First choice for open schema prototype; next full-data lead. |

## Atlanta Regional Commission

### Official sources and access

- **ARC1**, agency survey landing page, accessed **2026-10-23**: https://atlantaregional.org/what-we-do/transportation-planning/modeling/household-travel-survey/ . The search-indexed official page identifies the 2011 survey, 20-county region, and survey/report download links. Direct fetch returned HTTP 403 here; treat current landing-page operation as `[VERIFY]`.
- **ARC2**, agency download index, accessed **2026-10-23**: https://abmfiles.atlantaregional.com/downloads/ . Public directory lists the survey archive.
- **ARC3**, exact archive URL, accessed **2026-10-23**: https://abmfiles.atlantaregional.com/downloads/ARC%20Regional%20Household%20Travel%20Survey%20-%202011.zip . HEAD returns 588,203,726 bytes. Range requests work without login or an agreement screen. The full archive was not downloaded.
- **ARC4**, TSDC study page, accessed **2026-10-23**: https://www.nlr.gov/transportation/secure-transportation-data/tsdc-atlanta-regional-travel-survey .
- **ARC5**, TSDC dictionary, revised December 5, 2016, accessed **2026-10-23**: https://www.nlr.gov/media/docs/libraries/tsdc/arc_data_dictionary.pdf?sfvrsn=b389ce50_1 . Read through web PDF extraction; terminal download returned 403.

ARC3 contains a 216-page report and three nested archives named `arc_full_survey.zip`, `arc_sorted_by_person.zip`, and `arc_sorted_by_vehicle.zip`. The report was extracted through a 2.575 MB range request; no nested survey archive was downloaded. Its PDF page 11 says public files are to be **“stripped of all identifying information prior to its release”**. This is a privacy statement, not an open reuse license. `[VERIFY]` ARC-specific permission for redistribution, adaptation, commercial use, or bundling. The open license on unrelated ARC Census products does not answer this question.

### Sample, variables, and limits

The ARC3 report, PDF page 8, reports **10,278 households, 25,810 persons, 93,713 trips, and 21,270 vehicles**. ARC4 instead reports **25,797 participants** in its curated data. Preserve both counts and their different releases; `[VERIFY]` the exact filtering that explains the difference. Diary assignment covers nonholiday weekdays, with a 3 a.m. day boundary. The report describes respondent travel diaries; tours would require an explicit reconstruction method.

ARC5 documents place-sequenced records using household, person, place, and trip identifiers. It includes arrival/departure time, chosen mode, trip duration/distance, and transit access/egress. Modes cover walking, cycling, auto driver/passenger, local/express buses, MARTA rail, paratransit, hired rides, school buses, and motorcycles. Household weights are `hhwgt`/`exphhwgt`; person weights are `perwgt`/`expperwgt`; place records use `pwgt`/`expwgt`. OD TAZ and coordinates carry asterisks; county appears as a residence field. No tract/block-group OD field appears in this dictionary. `[VERIFY]` the asterisk legend and actual full public archive values before asserting retained TAZs. The TSDC spatial process restricts coordinates. The direct ARC archive's public placement does not prove those coordinates survive redaction.

**Result:** observed multimodal diaries exist, but this review does not establish the required fine public OD geography for Atlanta. Do not use county of residence as trip OD.

## SANDAG

### Official sources and access

- **SD1**, survey program, accessed **2026-10-23**: https://www.sandag.org/data-and-research/applied-research-and-performance-monitoring/surveys . It provides reports for 2016/2017. For 2022/2023 it offers the final report and appendices upon request, rather than a direct public microdata download.
- **SD2**, 2016 study Volume I, accessed **2026-10-23**: https://www.sandag.org/-/media/SANDAG/Documents/PDF/data-and-research/applied-research-and-performance-monitoring/surveys/san-diego-transportation-study-volume-i-technical-report-2016.pdf .
- **SD3**, Volume II, questionnaires and weighting memo, accessed **2026-10-23**: https://www.sandag.org/-/media/SANDAG/Documents/PDF/data-and-research/applied-research-and-performance-monitoring/surveys/san-diego-transportation-study-volume-ii-final-report-technical-appendix-2016.pdf . Web text inspected; the 9,825,479-byte PDF was not downloaded by the terminal.
- **SD4**, official catalog search, accessed **2026-10-23**: https://opendata.sandag.org/api/catalog/v1?search_context=opendata.sandag.org&q=household%20travel&limit=100 . The response returns 61 results, predominantly Community Characteristics products. No raw person-trip household survey release was identified in those results. This is a bounded search, not proof that no release exists.
- **SD5**, mode-choice portal, accessed **2026-10-23**: https://opendata.sandag.org/stories/s/Mode-Choice-by-Jurisdiction/df98-zk4w/ . It identifies its mode-choice figures as Activity-Based Model results. Those are modeled outputs, not independent observed choices.

SD1 states **“All personal information collected in our surveys will remain strictly confidential.”** SD3's participant privacy statement also limits presentation to aggregate samples. Neither statement grants public reuse of individual responses. `[VERIFY]` current free microdata availability, application or agreement requirements, dataset license, and permitted reuse. Do not transfer portal permissions for aggregate/model products to survey microdata. No staff contact, application, or agreement was initiated.

### Sample, variables, and limits

SD2 reports **6,199 completed households**, **22,598 complete household travel days**, more than **282,000 collected trips**, and more than **193,000 trips on complete household days**. Smartphones collect a week; online/telephone diaries collect one day. Its reported analysis generally uses unlinked trips; its linked-trip analysis removes identified transit access/egress legs. Reported modes include autos, walking/cycling, transit, hired rides, and smaller categories. Separate tour records and public mode-code definitions remain `[VERIFY]`.

SD3 Appendix D documents expansion, calibration to 2015 one-year ACS PUMS, and reporting-bias adjustments. SD2 also describes household/person weights, multiday adjustments, and trip corrections. Exact fields in a public release remain `[VERIFY]`. The report maps destinations by block group and collects location/time details, but **public OD resolution is unverified**. The 2022/2023 sample, weights, and public OD fields are `[VERIFY]` because the requested report/data were not obtained.

**Result:** no eligible public observed microdata source verified. SANDAG remains an agency inquiry lead, not an admitted development dataset.

## NYMTC and NJTPA

### Official sources and access

- **NY1**, current agency landing page, accessed **2026-10-23**: https://www.nymtc.org/20102011-regional-household-travel-survey . The older path redirects here: https://www.nymtc.org/DATA-AND-MODELING/Travel-Surveys/2010-11-Travel-Survey .
- **NY2**, public-use manual, revised November 2013, accessed **2026-10-23**: https://www.nymtc.org/sites/default/files/rfp/Task%209%202%20Final%20Users%20Manual_2013-11-04_for%20Public_Use_Data_Set.pdf .
- **NY3**, exact public CSV archive, accessed **2026-10-23**: https://www.nymtc.org/sites/default/files/rfp/CSV.zip . The page mislabels this third format as SPSS; its actual target and archive members are CSV. HEAD returns **34,043,273 bytes**. Only directory and linked-file prefix ranges were read.

Download steps are to open NY1, obtain NY2, and select the CSV target NY3. No fee, account, signed agreement, or application appeared on this path. **This does not mean no terms apply.** NY2 printed page 2 limits reuse to **“non-commercial use only”**. It forbids sale and transfer for sale, requires copyright/credit/disclaimer notices to remain intact, requires written authorization for other uses, and imposes an indemnity. These are use restrictions, not an open license. A noncommercial development study is the candidate use supported here; unrestricted distribution or commercial application is not established.

### Public geography, choices, time, and weights

NY1 reports **18,965 households, 43,558 participants, and 143,925 linked trips**, including 1,930 GPS households. Collection spans fall 2010 through fall 2011 across 28 NY/NJ/CT counties. NY2 describes a 24-hour diary. Its six-file release includes household, person, vehicle, place, linked-trip, and unlinked-trip tables, rather than a separate tour table.

NY3's linked CSV header and 419 complete prefix rows confirm `OTAZ`, `DTAZ`, `OTRACT`, and `DTRACT`, with nonzero values in 418, 416, 418, and 416 rows respectively. This is **actual public TAZ and tract geography**, not an inference from survey collection. NY2 defines tract vintage as 2010 and zero as outside the NYBPM region. Block-group OD and coordinates are not verified public fields. `[VERIFY]` full-file missingness, TAZ boundary/crosswalk vintage, and zone-system compatibility with skims.

NY3 includes `LTMODE_AGG`, departure/arrival hour and minute fields, `TOUR_ID` and subtour linkage, plus household/person keys. NY2's chosen-mode scheme distinguishes solo auto, shared-auto roles, bus/rail access arrangements, walking, cycling, school bus, hired rides, and other modes. A tour choice still requires an explicit aggregation rule. The manual directs household/person summaries to `HH_WHT2` and trip summaries to `WHT_FAC3`, which includes `TOURFAC` reporting corrections. These weights correct reporting as well as selection; document their role separately from estimation weights.

**Result:** sufficient observed public OD/time/choice ingredients for a **noncommercial development** candidate. Not proof that historical multimodal skims are available or that a tour estimator is ready. Inspect all mode codes, exclusions, complete-day flags, and missing/external geography before estimation.

## Bay Area MTC

### Official sources and access

- **MTC1**, Bay Area Travel Study, accessed **2026-10-23**: https://www.mtc.ca.gov/bay-area-travel-study .
- **MTC2**, survey history, accessed **2026-10-23**: https://mtc.ca.gov/tools-resources/survey-program .
- **MTC3**, 2023 final report, accessed **2026-10-23**: https://www.mtc.ca.gov/sites/default/files/documents/2026-02/BATS2023ConsultantFinalReport.pdf?cb=e81e1185 . Agency document record: https://www.mtc.ca.gov/digital-library/5135375-2023-bay-area-travel-study-final-report .
- **MTC4**, official modeling team's CHTS weights documentation, accessed **2026-10-23**: https://github.com/BayAreaMetro/modeling-website/wiki/HouseholdSurvey2012Weights . The agency modeling portal https://data.mtc.ca.gov/ links to this official organization/wiki.

MTC1 says microdata applicants are **“required to sign a non-disclosure agreement with MTC”**. Its stated audience is peer public agencies and university research. It still describes availability as anticipated June 2026, despite this October access date. `[VERIFY]` whether admission has opened and whether an independent development project qualifies. No application or agreement was submitted. Public summaries and public PDF access do not grant microdata redistribution.

### Years, sample, geography, and weights

MTC3 reports 2023 study collection from **May 9, 2023, through January 19, 2024**. Its final eligible sample has **8,258 households and 15,985 persons**. Preserve its internal one-trip discrepancy: narrative summary gives **365,831 trips**; Table 1 gives **365,830**. Table 1's footnote distinguishes all associated travel records from the **121,969 trip records used in weighting**. These are different denominators, not interchangeable sample counts. Trips are initially unlinked; a separate tour release is `[VERIFY]`. Smartphones contribute up to seven days, with one-day web/call-center alternatives. The report covers mode and departure-time analysis and household/person/day/trip weighting. Exact public field names are `[VERIFY]`.

The report derives PUMA/block-group attributes from collected coordinates, but that is **agency processing geography**, not public person-level release resolution. **No unrestricted 2023 OD tract, block group, TAZ, or coordinates are established.** Public dashboards and reports do not meet the required choice-record/OD join. Restricted fine geography and public codebook availability remain `[VERIFY]`.

MTC2 reports **5,107 persons** in the 2018/2019 adult-focused smartphone survey; no agreement-free fine-OD release is verified. Its 2012/2013 CHTS survey has **9,719 Bay Area households** within a reported statewide **42,431 households**, collected February 1, 2012, through January 31, 2013. These historical totals differ from TSDC's curated totals below. MTC4 publishes separate Bay Area daily/weekday/weekend weighting work and warns Bay Area-specific weights differ from statewide weights. Do not pool these as independent surveys or silently substitute statewide weights for Bay Area analysis.

**Result:** 2023 is restricted. The older CHTS Bay Area subset is a California development lead through the CHTS access route, not a second independent observation source.

## Caltrans CHTS through TSDC

### Official sources, terms, and access steps

- **CA1**, TSDC CHTS page, accessed **2026-10-23**: https://www.nlr.gov/transportation/secure-transportation-data/tsdc-california-travel-survey .
- **CA2**, dictionary revised December 7, 2016, accessed **2026-10-23**: https://www.nlr.gov/media/docs/libraries/tsdc/caltrans_data_dictionary.pdf?sfvrsn=73a75ece_1 . Web PDF extraction read; terminal fetch returned 403.
- **CA3**, official OEDI sample submission, accessed **2026-10-23**: https://data.openei.org/submissions/4073 . It links its license to https://creativecommons.org/licenses/by/4.0/ .
- **CA4**, exact sample ZIP, accessed **2026-10-23**: https://data.openei.org/files/4073/caltrans_sample_data.zip . This download succeeds directly without registration. It is a sample, not the full CHTS.
- **TS1**, current TSDC catalog/access description, accessed **2026-10-23**: https://data.nlr.gov/submissions/41 . It says a **“simple registration form must be completed”** for cleansed data. No registration was submitted.
- **TS2**, license linked by TS1, accessed **2026-10-23**: https://data.nlr.gov/node/41/license . It grants use/copy **“without any fee or cost”**, conditional on preserving the whole notice, crediting DOE/NREL/Alliance in publications, and other stated terms, including indemnity and no endorsement. This is an express use/copy grant, not evidence that the full release carries CC BY or every open-data permission. Its scope covers material on that server; `[VERIFY]` full CHTS download's controlling terms and any click-through.
- **TS3**, spatial access, accessed **2026-10-23**: https://www.nlr.gov/transportation/secure-transportation-data/tsdc-spatial-data . Its secure portal **“prohibits removal of sensitive data”**.
- **TS4**, secure application overview, accessed **2026-10-23**: https://www.nlr.gov/media/docs/libraries/tsdc/tsdc-secure-portal-application-overview.pdf . It requires an analysis description, a detailed-data agreement signed by the user and supervisor/advisor, further cyber-resource conditions, and approval. Read for access rules only; no forms were completed.

For the public sample, use CA3 then CA4. CA3 explicitly labels the submission CC BY 4.0. The license permits adaptation and redistribution with attribution, license linkage, and change notices; separate rights remain relevant. This sample-specific evidence is stronger than a public-download button. For full cleansed records, CA1 offers survey/person/vehicle packages after TSDC registration. `[VERIFY]` current full-download URLs, sizes, and controlling license. Detailed coordinates require TS3/TS4; free access is not agreement-free or downloadable access. The secure route fails the requested public, unrestricted-local-OD condition.

### Actual public geography and variables

CA1 labels the study **2010–2012** and reports **42,454 households in any study component**, **42,436 diary households**, and **109,113 participants**. MTC2 identifies the main diary collection as 2012/2013. Preserve the naming/vintage difference and use actual travel dates in later work. CA1 also reports 3,871 wearable-GPS households and 1,866 vehicle-GPS households. These should not be mistaken for the household diary sample.

The CA4 sample has **42 member files**, mostly 100-row excerpts. Its 100 place rows represent only six distinct households. All 100 place rows contain a tract value, across 22 distinct tracts. All block-group, longitude, latitude, and geometry values in that table are `REDACTED`. Home block group and coordinates likewise have one repeated value; the reviewed place and GPS coordinate columns do not supply usable points. **The verified public spatial resolution is census tract**, not block group or coordinates.

CA2 documents place-sequenced diary records with household/person/place/trip keys, travel date, arrival and departure times, chosen mode, occupancy, and person/trip weights. Public sample columns include `tract_id`, `arr_time`, `dep_time`, `mode`, `perwgt`, `expperwgt`, `tcfperwgt`, and `exptcfperwgt`. All 100 place rows contain arrival and departure values; 83 contain modes and trip weights. `[VERIFY]` whether the remaining rows are solely anchors or include other missing trip fields. The broader questionnaire supports nonmotorized travel, auto roles, hired rides, and several transit forms. `[VERIFY]` exact diary-mode mapping for ActivitySim, rather than borrowing commute or long-distance codes.

OD must be reconstructed from successive places within the same person/day, with the prior place's departure and next place's arrival. This is an analysis inference, not a supplied complete tour file. The sample's activity table also retains tract, purpose, times, and weights. Its separate 100-row excerpts need not form a complete relational panel. `[VERIFY]` full-file coverage, identifier integrity, tract vintage, trip linking, time rounding, and all missingness. No alternative travel skims are supplied or verified by this review.

**Result:** actual tract-based observed ingredients and an explicit open license exist for the small sample. Full CHTS is promising but not admitted as a complete unrestricted licensed dataset on this evidence.

## Download and inspection custody

Only this Markdown report is written to disk. All retrieved metadata and small public samples were processed in memory. No large survey archive, restricted records, agreement, model, test, build, hosted OpenPlan system, or secret was used. Public website and catalog queries are the only remote operations.

All entries below were accessed **2026-10-23**. A range checksum covers only the named bytes, never the entire archive.

| Artifact | Exact URL or archive member | Bytes inspected | SHA-256 |
|---|---|---:|---|
| NYMTC public manual, complete PDF | NY2 exact URL above | 922,796 | `2b42f736e294dec7b8fd32f78c65d554e2db581b40321d9a0e86e51ae1d3f98a` |
| NYMTC ZIP directory range | NY3, final 65,536 bytes | 65,536 | `8edf890d146262e2db9e66df3916d9331644795f94dc2c0bb7cd8869f2919eb2` |
| NYMTC linked CSV compressed prefix | NY3, bytes 1,377,109–1,409,876 | 32,768 | `b61409cedd3bfa2a0787e8b7a7194c7fba1d86093ae96e6ecbc6aaa64545df01` |
| ARC ZIP directory range | ARC3, bytes 588,138,190–588,203,725 | 65,536 | `4fe815aa9bac9744fc766a47543ec939d13a7f5fb17b4cac5c50b3effe58c15b` |
| ARC report range, compressed entry plus header | ARC3, bytes 0–2,574,614 | 2,574,615 | `9e6c87aa4e0ced8e8f502c991f532165e36ad5f14f81ef9b7376a3625e1e8c2b` |
| ARC report, extracted complete PDF | ARC3 member `2011 Household Travel Survey Report.pdf` | 2,793,919 | `43b355fffbe0a5680f980b25fbb1ea0011549a80e00d7213408294978095b732` |
| ARC public directory HTML | ARC2 exact URL above | 5,349 | `14f98345226608d7d0c771df4ccef451490e4de8d37da2ff4cce302d67fc2182` |
| MTC 2023 report, complete PDF | MTC3 exact URL above | 6,017,883 | `034835872bfd165c663be1894f40cc8b2778a180336acc2ed9fa66651d257cd6` |
| MTC CHTS weighting wiki HTML | MTC4 exact URL above | 382,947 | `6800c80336810e0deeb62d696fe31e9a016531c532a289d3c9e020068aa5acc4` |
| SANDAG catalog response | SD4 exact URL above | 261,191 | `0fba6542bd422088b53a99d8a6dfd651ccbd517efd8ebfbdddaa2032ddec60db` |
| SANDAG surveys HTML | SD1 exact URL above | 37,930 | `d38ddd3940c235b458a303a420afb1c2ef130ec8f088d713900b4218ed1aeb5a` |
| NLR catalog license HTML | TS2 exact URL above | 7,238 | `de6802cc6b4a904eb6762c433f7b50ef4f6c0e865efa4881dd154ed96a8a7636` |
| OEDI sample landing HTML | CA3 exact URL above | 68,566 | `eb55ad9426d1df410fe9b01ac902e34f7823e5f3c48f94953675472d7978f73d` |
| CHTS public sample, complete ZIP | CA4 exact URL above | 115,624 | `8627957c78ea631d43f128146bf87392cfb84be0835ddd12515281e2112f23ab` |
| Sample place table, complete member | CA4 member `caltrans_sample_data/survey_place.csv` | 26,664 | `7714997e60f889d0045ea29eda554f7f9a6590a2ff15c4512cecf4ea43bf2b0b` |
| Sample activity table, complete member | CA4 member `caltrans_sample_data/survey_activity.csv` | 16,671 | `f99b648f4e2beb62a1948abf04d644c7f55df577304b2a1a8a4ba79378afa003` |
| Sample household table, complete member | CA4 member `caltrans_sample_data/survey_households.csv` | 31,705 | `6a17396620426e97c652b1126dc246c4f7c0db7f44d1cb2a92bc36bb376ddef1` |
| Sample GPS trip table, complete member | CA4 member `caltrans_sample_data/w_gpstrips.csv` | 18,629 | `d4a49f7b884df93228f6d3d25ed315caa56a889d7f7f19dc7bf391051c6e4da3` |

ARC3's directory tail identifies four members, rather than establishing fine-OD availability in the nested data. ARC5/CA2/TS4 and SD3 were read through the web service's text representation; original-file byte hashes are `[VERIFY]`, not the hashes of HTTP 403 error pages. Dynamic HTML response hashes may vary by request. They identify the inspected response, not immutable agency publications.

## Next work for the parent task

1. Keep NYMTC in a named, noncommercial development lane. Preserve its notices and terms. Do not bundle raw records or describe it as open data. Any broader use needs scope-specific permission verification.
2. Use the explicitly licensed CHTS sample to design a tract-based intake schema. A full-data download is separate work, with registration and terms review before acquisition.
3. Before creating skims, verify zone boundaries/vintage, complete person-days, transfer linking, choice availability, cost fields, survey weights, and historical network/transit service. A tract centroid is an approximation and does not recover a respondent's location.
4. Keep development observations separate from untouched geographic acceptance data. This note neither consumes an acceptance holdout nor establishes independent ActivitySim accuracy.

No PR is created. The parent task owns any final research PR.
