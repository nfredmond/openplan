# Benefit-cost analysis program and method research

Research date: October 6, 2026. Scope: OpenPlan product research using public sources. No employer or client records were used. Author: OpenPlan research agent. This note distinguishes source findings, direct workbook inspection, and proposed implementation choices. Program applicability and final submissions remain agency decisions.

## Findings that change the implementation

A single generic grant BCA profile would produce incorrect instructions. Current PROTECT requirements depend on the funding category and a qualifying Resilience Improvement Plan. California and federal Cal-B/C workbooks retain the same 8.1 version number but use different economic settings. The published federal Corridor workbook also contains an accounting convention that differs from current USDOT guidance. Preserve these differences visibly.

A source-backed annual Build/No Build ledger is the appropriate shared calculation foundation. Keep program selection, monetary valuation, modeling evidence, accounting, and submission requirements separately versioned. A dashboard cannot establish that a forecast is valid. An official-looking spreadsheet cannot establish compliance.

## Current program requirements

### PROTECT has four distinct branches

The controlling opportunity located is FY24–26 PROTECT Competitive, FHWA-PROT-26-001, posted August 27, 2026. The listing gives October 9, 2026 as the deadline. Its displayed $1 minimum and $60 million maximum are system fields; the narrative states there is no minimum or maximum award. [Official opportunity listing](https://simpler.grants.gov/opportunity/b5627a85-1b8b-4248-8b79-24722a396422).

The NOFO's Economic Analysis table, PDF page 18, gives these requirements:

| Funding category | BCA treatment |
|---|---|
| Planning | Not required |
| Resilience improvement | Required for prioritization unless included in a qualifying Resilience Improvement Plan |
| Community resilience and evacuation route | Required for prioritization |
| At-risk coastal infrastructure | BCA not required; demonstrate avoided long-term maintenance or rebuilding costs for eligibility |

Required analyses include a standalone methods memo, unlocked spreadsheets, and relevant supporting files sufficient for FHWA reproduction. Include full project costs, including prior expenditures, and match benefit scope to cost scope. Federally recognized Indian Tribes may elect to provide specified raw data instead, including project costs, asset use, impacts, and next-best-route travel time. [NOFO, PDF pages 18–19](https://files.simpler.grants.gov/opportunities/b5627a85-1b8b-4248-8b79-24722a396422/attachments/d21d3b4d-d7fc-4885-8d22-18eb40912bfc/FY24-FY26_PROTECT_NOFO-FHWA-PROT-26-001.pdf).

The September 25, 2026 FAQ clarifies that the project must appear in the applicable plan by the application deadline. A project list or clearly labeled project on a vulnerable-area map can establish inclusion; submit the applicable State DOT or MPO plan. Its June 2026 resilience BCA resource supplements, rather than replaces, USDOT guidance. The FAQ identifies HPMS, CMF Clearinghouse, NHTSA crash data, InfoBridge, and Census as potential tribal data sources. It also states that submissions under the earlier FY24–25 notice will not carry forward. [FAQ, questions 25–28 and 48](https://files.simpler.grants.gov/opportunities/b5627a85-1b8b-4248-8b79-24722a396422/attachments/b1eae9f3-dde3-4cdd-9784-8221bfbe21ff/PROTECT_NOFO_QAs_2026.pdf).

Implementation decision: expose these branches explicitly. Record the asserted exception, source plan, page or map reference, and reviewer. Do not infer an exception from a project title or hazard overlay.

### CTC's 2026 competitive programs have adopted guidance

The official CTC announcement identifies August 20, 2026 adoption and November nomination dates: LPP-C November 18, SCCP November 19, and TCEP November 20. These supersede using the 2024 cycle as the current default. [CTC announcement](https://dot.ca.gov/CTC/).

| Program | Source finding | Product implication |
|---|---|---|
| LPP Competitive | Section 14.4 considers measurable benefits using Cal-B/C or an applicant-proposed alternative. Economic development and workforce responses are additional criteria. | Allow a documented alternative method; do not automatically monetize jobs. |
| SCCP | Section 17.10 permits Cal-B/C or an applicant-proposed alternative. The nomination requires a BCR table for each element when there are multiple elements. Its congestion narrative considers the 20-year No Build condition. | Preserve component results and avoid hiding a weak component in an aggregate ratio. |
| TCEP | Appendix C requires a cost-benefit ratio for all project types, alongside freight, safety, emissions, and other performance measures. Public/private assessments apply to relevant private benefits. | Export both monetized results and physical outcome measures. |

Sources: [LPP-C 2026, section 14.4](https://catc.ca.gov/-/media/ctc-media/documents/programs/local-partnership-program/competitive/final-draft-2026-lpp-competitive-guidelines-v16-a11y.pdf), [SCCP 2026, sections 17.1 and 17.10, nomination cost-effectiveness instructions](https://catc.ca.gov/-/media/ctc-media/documents/programs/sccp/final-2026-sccp-guidelines-a11y.pdf), [TCEP 2026, section 19 and Appendices A–C](https://catc.ca.gov/-/media/ctc-media/documents/programs/tcep/2026-tcep-guidelines-adopted-a11y.pdf).

TCEP nomination packages require remediated accessible PDFs, including tagged structure, reading order, accessible tables, alternative text, contrast, descriptive links, and machine-readable text. A print-to-PDF operation alone does not establish this. Its funding table uses escalated implementation-year costs and must agree with the electronic Project Programming Request. Economic constant-dollar costs and grant funding schedules therefore need separate representations. [TCEP 2026, Appendix A, PDF pages 53 and 68–71](https://catc.ca.gov/-/media/ctc-media/documents/programs/tcep/2026-tcep-guidelines-adopted-a11y.pdf).

Research boundary: searches of all three adopted PDFs found no occurrence of “spreadsheet” and no blanket completed-native-Cal-B/C-workbook mandate. LPP-C and SCCP expressly allow alternatives. This does not establish that supplemental application instructions never request native files. TCEP's ratio requirement is established; universal acceptance of an OpenPlan substitute is not. LPP Formulaic was not reviewed and must not inherit Competitive requirements automatically.

## Federal settings and exact units

[USDOT 2026 guidance](https://www.transportation.gov/sites/dot.gov/files/2025-12/Benefit%20Cost%20Analysis%20Guidance%202026%20Update%20(Final).pdf), printed pages 12, 20, 33–35, 38–42:

- Discount: 7%; dollars: 2024.
- BCR numerator: benefits minus incremental O&M plus residual; denominator: capital.
- CO2/GHG monetization is no longer recommended.
- Time, dollars/person-hour: personal 20.10; business 34.60; all-purpose 21.80; walking/cycling/waiting/standing/transfer 40.20; truck-driver 37.20; bus-driver 40.30.
- Vehicle operating costs, dollars/vehicle-mile: light-duty .56; commercial-truck 1.23. Includes fuel.
- KABCO, dollars/person: O 5,500; C 122,400; B 256,300; A 1,302,300; K 13,700,000; U 238,500.
- Dollars/crash: PDO 9,700; injury 342,400; fatal 15,366,900.
- Emissions, 2024 dollars/metric-ton:

| Year | NOx | SOx | PM2.5 |
|---|---:|---:|---:|
| 2025 | 21,600 | 59,000 | 1,054,000 |
| 2026 | 22,000 | 60,100 | 1,070,700 |
| 2027 | 22,500 | 61,100 | 1,087,800 |
| 2028 | 22,900 | 62,200 | 1,105,100 |
| 2029 | 23,300 | 63,400 | 1,122,600 |
| 2030–2055 | 23,800 | 64,500 | 1,140,500 |

Metric ton = 1.1023 short tons. PM2.5 valuation does not apply to PM10. Preserve negative benefits.

Proposed implementation: separate the monetary base year from the discount reference year and occurrence year. Require a conversion record when inputs use other dollars. Block undefined schedule years rather than silently extrapolating. A federal profile should retain physical GHG quantities while marking their monetization excluded under the selected guidance. Exclusion is a policy treatment, not evidence that physical impacts are zero.

## Cal-B/C editions and source inspection

Caltrans currently publishes five state modules: Sketch, Active Transportation, Park and Ride, Corridor, and Intermodal Freight. The same page provides 2026 federal editions of all five. Corridor accepts travel demand and microsimulation outputs. The page also links input sheets, a separate SB1 emissions calculator, and an SB1 performance-metrics workbook. Published emissions rates use EMFAC2021. [Current Caltrans download page](https://dot.ca.gov/programs/transportation-planning/division-of-transportation-planning/state-planning/transportation-economics).

The comparison matrix identifies state settings as 2021 dollars and 4%, versus federal 2024 dollars and 7%. It permits justified parameter overrides. It lists 20 operating years after construction as typical and notes the federal 30-year guidance ceiling. Its prose incorrectly attributes the 7% update to “2024 USDOT” while labeling the workbook 2026. Treat that date sentence as a source inconsistency, not independent confirmation of historical federal policy. [2026 comparison matrix](https://dot.ca.gov/-/media/dot-media/programs/transportation-planning/documents/division-transportation-planning/transportation-economics/cal-bc-federal-comparison-of-value-matrix-2026-a11y.pdf).

The older 8.1 parameter guide explains the 4% state rate, historical input sources, regional variation, and occupancy defaults. The guide itself is dated methodology, not proof that every workbook cell remains unchanged. [Parameter guide](https://dot.ca.gov/-/media/dot-media/programs/transportation-planning/documents/new-state-planning/transportation-economics/cal-bc/2022-cal-bc/guides/cal-bc-81-parameter--guide-v1-a11y.pdf).

### Directly inspected workbook facts

The following public workbooks were downloaded into `/tmp/openplan-bca-research-*.xlsm`. Inspection used ZIP/XML parsing. No VBA executed, no native Excel session ran, and no workbook recalculation was claimed.

| Workbook | Size | SHA-256 | Observed settings |
|---|---:|---|---|
| State Corridor v8.1 | 740,142 bytes | `e1c9bc1c4825785574a032e57ffa730514bf66026893d4e68eaac7d5f0a95014` | `PARAMETERS!F9=2021`, `F12=.04` |
| Federal 2026 Corridor v8.1 | 741,783 bytes | `2e752807a39ef4a9e349f4f55d92546f8f80b59f5589e4a0736f80654bb51a51` | `PARAMETERS!F9=2024`, `F12=.07` |

Downloads: [State Corridor](https://dot.ca.gov/-/media/dot-media/programs/transportation-planning/documents/new-state-planning/transportation-economics/cal-bc/2023-cal-bc/2023-non-federal-model/cal-bc-8-1-corridor--a11y.xlsm), [Federal Corridor 2026](https://dot.ca.gov/-/media/dot-media/programs/transportation-planning/documents/division-transportation-planning/transportation-economics/cal-bc-81-corridor-infra-2026-a11y.xlsm).

Both inspected workbooks use this accounting chain:

1. `1) Project Information` columns W–AC contain support, right-of-way, construction, maintenance/operations, rehabilitation, mitigation, and transit-agency savings.
2. `AD24=SUM(W24:AC24)*1000`; `AE24=$AD24/(1+DiscRate)^($V24-YearCurrent)`.
3. `Final Calculations!X34='1) Project Information'!AE24`; X85 sums construction and operating years.
4. Named `LifeCycleCost='Final Calculations'!$X$85`; `LifeCycleBene` points to W85.
5. `3) Results!H18=IF(LifeCycleCost=0,"N/A",LifeCycleBene/LifeCycleCost)`.

Finding: the state workbook includes net operating and rehabilitation costs in its denominator. The inspected federal edition preserves this chain despite the federal guidance's numerator treatment. No explicit residual-value input was identified in this Corridor inspection. This is a traced formula discrepancy, not a claim that all Cal-B/C modules have identical behavior.

Implementation decision: provide distinct accounting profiles and explain the resulting ratio differences. Native workbook parity and conformance to USDOT instructions need different tests. Do not label an independently generated crosswalk an official Cal-B/C workbook.

### Modeling and input requirements

The Corridor guide supports groups by time, vehicle, trip purpose, segment, road class, or speed. It separately supports safety and reliability groups. It uses base/forecast model years and interpolates intermediate data. Costs use thousands of dollars in its input cells. Current year is the discount reference. Construction start and opening year are separate. The guide allows up to 500 groups and 50 years, which is a workbook limit rather than a program-approved horizon. [Corridor guide, pages 1–3](https://dot.ca.gov/-/media/dot-media/programs/transportation-planning/documents/new-state-planning/transportation-economics/cal-bc/2022-cal-bc/guides/cal-bc-81-corridor-instructions-v1-a11y.pdf).

Sketch's crash input instructions call for the three most recent years of fatal, injury, and PDO crashes. Rail grade crossings use a separate 10-year FRA data convention. Default occupancies can be replaced with project-specific evidence. Build and No Build transit person-trips are required. These instructions differ from simply taking one universal five-year crash count for every method. [Sketch guide, highway crash and transit inputs](https://dot.ca.gov/-/media/dot-media/programs/transportation-planning/documents/new-state-planning/transportation-economics/cal-bc/2022-cal-bc/guides/cal-bc-81-sketch-instructions-v1-a11y.pdf).

The joint Caltrans/USDOT FAQ says USDOT does not require a particular BCA model and applicants can develop their own spreadsheets. It identifies Cal-B/C's limits for climate/resilience and residual values, and recommends Corridor when users already have VHT, VMT, and trip data for complex projects. It describes state and federal editions separately. These FAQ statements guide tool choice; cycle-specific notices remain controlling. [Caltrans federal liaison FAQ, questions 5–7, 17 and 20](https://dot.ca.gov/programs/federal-liaison/faqs).

## Resilience methods and uncertainty

FHWA's June 2026 resilience guide applies a probability-consequence method to hazard-related outcomes. It does not apply event probability to unrelated ordinary-day benefits. The guide distinguishes annual event frequencies, which can exceed one, from event probabilities. Changing probabilities need scientific or engineering support. Multiple hazard severities need non-overlapping treatment; adjacent facilities require attention to dependent failures and unavailable detours. Repair duration may span years. Floodplain intersection alone does not provide closure duration, damage, detour, or effectiveness evidence. [FHWA resilience guide, sections 3–4](https://www.fhwa.dot.gov/policy/otps/Best_Practices_for_Resilience_Investment_BCA.pdf).

Proposed supported first method:

`annualExpectedBenefit = sum(eventFrequency × (noBuildConsequence − buildConsequence))`

Each term carries an event definition, disjoint-event or frequency interpretation, affected asset, units, source, and review state. If event classes overlap, leave the aggregate unavailable until the analyst provides a defensible joint treatment. Recurring events and one-time replacement pathways should not share an unqualified probability field.

A defensible resilience input form should ask for:

- Hazard severity and annual probability or frequency, including changes by year.
- Conditional damage or closure probability given that hazard.
- Closure/restriction duration and recovery profile.
- Available detour geometry and travel time, including possible concurrent failure.
- Affected trips by mode, vehicle and time period, including suppressed travel.
- Repair, maintenance, response and residual costs with source estimates.
- Evidence for how the proposed project changes each consequence.

These are proposed data requirements. They are not an assertion that the application can infer engineering fragility from a map.

## Existing tools and licensing

| Resource | Verified capability or limitation | Reuse recommendation |
|---|---|---|
| Cal-B/C | Official modules, input forms, technical methods and spreadsheets are available. Caltrans's site generally identifies its information as public domain but excepts third-party material. | Link exact versions, export mapped inputs, preserve notices; review each bundled artifact's provenance. |
| USDOT spreadsheet template | The current page links `USDOT BCA Spreadsheet Template 12.23.25.xlsx`. | Use as a structural reference; native roundtrip and formulas require separate verification. |
| BIP BCA Tool 1.1.2 | Updated for December 23, 2025 guidance and 2025 NBI forecasts. Includes bridge preservation/replacement analysis. | Build an explicit bridge handoff; do not substitute a generic traffic model for condition evidence. |
| FHWA safety BCA tool | Public Excel tool is available. | Evaluate safety-specific compatibility before adopting defaults. |
| Volpe RDR-Public | Python tool addresses resilience returns across hazards and future scenarios. Its EULA is restrictive. | Do not embed, modify, redistribute, or expose as an OpenPlan service under an assumed open-source license. |

Sources: [Caltrans conditions](https://dot.ca.gov/conditions-of-use), [USDOT template](https://www.transportation.gov/mission/office-secretary/office-policy/transportation-policy/benefit-cost-analysis-spreadsheet-template), [BIP tool](https://www.fhwa.dot.gov/bridge/bip/bca/), [BIP manual 1.1.2](https://www.fhwa.dot.gov/bridge/bip/bca/BIP_BCA_Tool_User_Manual_v1.1.2.pdf), [FHWA safety tool](https://highways.dot.gov/safety/hsip/highway-safety-benefit-cost-analysis-tool), [RDR project](https://github.com/VolpeUSDOT/RDR-Public).

RDR's published EULA permits internal noncommercial use, restricts third-party network access, and prohibits modification, derivatives, and redistribution without authorization. Public GitHub visibility is not an open-source grant. The implementation should use independently implemented published methods, existing OpenPlan modeling, and user-provided outputs. [RDR license, section 1](https://github.com/VolpeUSDOT/RDR-Public/blob/main/LICENSE).

## Proposed OpenPlan implementation contract

The following items are design recommendations, not assertions that an agency approves a particular software output.

### Keep evidence and calculations inspectable

Each ledger row should identify category, quantity unit, occurrence year, Build and No Build values, valuation source, dollar year, source URL or artifact, method, and reviewer. Preserve raw imported values beside normalized values. Mark whether evidence is observed, modeled, assumed, transferred from another location, or unavailable. Missing data must not become zero.

Model imports should retain run ID, engine/version, scenario IDs, geometry, network period, population, settings, validation tier, and original artifact hash. AequilibraE and ActivitySim results remain separate alternatives or evidence sources. Require matched boundaries before calculating their differences. An observed corridor count is not a Build forecast. A model's network total is not automatically the nominated project's benefit.

### Use explicit math, not generated valuations

Code should calculate every total. For a fixed-user quantity, the annual reduction is No Build minus Build, multiplied by its compatible unit value. New users, diverted users, congestion externalities, health effects, reliability and resilience need their own declared methods. A manually supplied annual monetary benefit still requires a derivation attachment.

Record the BCR numerator and denominator separately from the NPV economic ledger. Preserve losses and negative net present values. A zero or negative denominator needs an explanatory unavailable BCR state rather than infinity or a passing result. Do not round intermediate values. Display precision should not imply evidence precision.

Create category compatibility checks. Examples include vehicle-hours versus person-hours, crashes versus persons, metric tons versus short tons, vehicle-miles versus person-miles, calendar versus fiscal year, and discounted versus undiscounted dollars. An imported quantity already multiplied by occupancy must not be multiplied again.

### Make data gaps useful

For each gap, show why the row cannot support a result, the evidence needed, responsible person, and requested date. Provide a documented proxy pathway where the selected method permits it. Show the source geography, sample, year, applicability rationale, and sensitivity range. A default unit valuation and an assumed physical outcome are different facts.

Prioritize data collection by its effect on the decision. A break-even benefit quantity can tell staff whether a new count or closure-duration estimate is likely to change the conclusion. Sensitivity scenarios should vary named uncertain inputs independently of policy-mandated settings. Label low/base/high cases as scenarios, not confidence intervals. Do not report probability of BCR exceeding one unless distributions and dependencies are supported.

### Ship a review package, not just a ratio

Recommended exports are an unlocked formula workbook, annual calculation CSV, complete JSON case, source register, assumptions/change log, issues log, sensitivity table, reproducible methods memo, physical-outcome table, and Cal-B/C input crosswalk. Include profile version, calculation version, timestamp, case hash, and build identity in the manifest. Every artifact should reconcile to the same case.

A formula workbook should expose quantities, values, conversions, discount factors, annual streams, numerator/denominator, and scenario results. Keep external links and macros unnecessary for reading the OpenPlan workbook. An official template handoff is a separate artifact with separate verification.

The dashboard should show the dominant benefit categories, negative effects, annual flows, uncertain inputs, break-even quantities, and gaps. A large BCR beside missing evidence should be visually subordinate to that evidence warning. Show the decision's dependence on assumptions, not a decorative approval score.

### Checks that can fail meaningfully

Use small independent hand calculations for discount timing, capital/O&M treatment, residual timing, and inflation conversion. Test sign reversal and scaling invariance. Add units deliberately wrong by factors of 60, 1,000, 365, and occupancy. Test duplicate benefits, missing opening-year quantities, unsupported years, mismatched model boundaries, and a BCR that changes when O&M moves between accounting conventions.

A harmless metadata change should leave numbers unchanged. A targeted sign or discount mutation should fail. Export verification should independently recompute totals and inspect the workbook in a spreadsheet application. Desktop/mobile browser journeys and PDF visual review cover different failures. Native spreadsheet recalculation, PDF accessibility, practitioner review and agency acceptance must remain separately reported boundaries.

## Download custody

Downloaded source files remain outside the repository in `/tmp/openplan-bca-research-*`. The two Corridor workbook hashes appear above. The FHWA resilience PDF is 1,452,560 bytes with SHA-256 `6e396dbeaaa2ea10079c7b31ec77c6ecdbf64cbaceccb59991f8e06671d15e37`. Its extracted text is also available in that temporary directory. Temporary files are research working copies, not a durable repository evidence archive. The unsuccessful USDOT template response is not a verified workbook and must not be used as one.

## Unresolved boundaries

- No native Excel recalculation or VBA execution occurred in this research task.
- The current USDOT template link was verified, but direct download returned a non-workbook response. Its formulas were not inspected.
- Cal-B/C Sketch, AT, IF and PnR formulas were not inspected at cell level.
- No claim is made that OpenPlan outputs replace engineering assessment, crash analysis, hydraulic analysis, or independent model validation.
- Supplemental portal instructions and current staff determinations can add requirements. Record them against the selected funding cycle.
- Current guidance contains source inconsistencies. Retain the cited edition and document the chosen treatment rather than silently correcting history.
