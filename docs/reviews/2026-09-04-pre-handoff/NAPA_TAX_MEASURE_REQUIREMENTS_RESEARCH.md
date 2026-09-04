# Napa transportation sales-tax administration: Measure T to Measure U

Research date: September 4, 2026. Scope: primary NVTA/NVTA-TA and Napa County records, with historical documents labeled as such. OpenPlan source implementation is being reviewed separately by the parent agent. Checkout identity checked read-only: `d2ce5c0f50d64d84cd57da6048f7b5afae3c2bb6`. The initial status was clean; two handoff checks showed concurrent developer-owned modifications, first ten files including tests, then six project/geography/funding source files. None was written by this research task. This report is the sole written artifact. PDF text was read through in-memory downloads; no checkout, browser/app, account, database, test, model, credential or service changes occurred.

## Findings that change the product design

**Napa requires interagency program administration, not merely a grant application or invoice screen.** Cities, the town and county prepare project programs and report financial and delivery information to the administering tax agency. Oversight, allocation, disbursement, audit and publication are related but separate decisions.

**Measure U is not a renamed Measure T.** It changes the allocation formula, financing options, allowable uses and compliance calculations. The 6.67% Measure T equivalent-funds requirement is distinct from its local-general-fund maintenance-of-effort baseline. U changes equivalent funding to 7% and changes maintenance of effort to an audited-revenue calculation. Existing records must retain the rule version that governed them.

**Formula disbursement is not an invoice reimbursement.** The current U master agreement describes pay-as-you-go allocations and quarterly distribution, with deductions and possible bond debt service. The administrator sends the County Auditor-Controller a claim specifying allocations. That use of “claim” does not make each city's project expenditure report a reimbursement request. Reusable grant administration must support both formula distributions and actual cost reimbursement, without conflating them.

**The official source set has historical conflicts and incomplete publication.** Available T documents disagree about some reporting deadlines. The current U agreement references reporting exhibits that were not attached to the examined 23-page copy. Configure deadlines and calculations from identified applicable instruments and reviewed interpretations. Correction to an earlier research update: a fresh retrieval of the current NVTA reporting page correctly describes U's 20% MOE and 7% equivalent-funding requirements. The earlier claim that this current page retained T's baseline is withdrawn.

## Source inventory, assembled before detailed reading

Page numbers below are one-based PDF pages unless identified as printed agreement pages. Publication/upload paths are not evidence of a document's approval date.

| Primary record | Date/version and what it establishes | Coverage and limits |
|---|---|---|
| [Measure U Ordinance 2024-01, linked by NVTA as signed](https://nvta.ca.gov/wp-content/uploads/2024/07/Measure-U-Ordinance-24-01-signed.pdf) | 2024 ordinance and expenditure plan; §§3, 8–18, 23–30; pp.2–7, 10–11, 15–17, 20–23 | Governing rule text sampled extensively. Search metadata calls it “DRAFT”; rely on its actual text and official publication context, not that search label. No legal opinion on internal ambiguities. |
| [NVTA July 1, 2025 commencement announcement](https://nvta.ca.gov/news/7283/) | Confirms U collection began July 1, 2025, replacing T | Public implementation announcement, not a calculation manual. |
| [NVTA Tax Agency institutional page](https://nvta.ca.gov/about-nvta/nvta-tax-agency/) | Records June 26, 2024 ordinance adoption and identifies administering authority | Establishes the tax agency's role; not proof that every recipient agreement was executed. |
| [County August 19, 2025 agreement agenda item 25-1385](https://napa.legistar.com/LegislationDetail.aspx?FullText=1&GUID=F1B60BDC-C04F-4572-B5F0-21DB3BED91BD&ID=7502352) and [attached master agreement](https://napa.legistar.com/View.ashx?M=F&ID=14564769&GUID=524B9E80-254E-4577-9498-41F6B59402A2) | Agreement No. 2025-C01 / County No. 260112B; printed pp.8–10, 13–16 | Retrieved attachment directly when the web reader failed. Reviewed text is a public approval attachment with signature blanks, not evidence of completed execution. |
| [NVTA-TA July 16, 2025 packet](https://nvta.ca.gov/wp-content/uploads/2025/07/NVTA-TA-Agenda-Packet-07-16-25.pdf) | Master-agreement text, printed agreement pp.4–16; packet PDF pp.15–27 | Independent publication of the agreement; exhibits named, not fully reproduced. |
| [NVTA July 16, 2025 packet](https://nvta.ca.gov/wp-content/uploads/2025/07/NVTA-Agenda-Packet-07-16-25.pdf) | Item 11.4, PDF pp.44–46: NVTA's implementing-agency role and differentiated obligations | Staff recommendation and background distinguish NVTA from NVTA-TA. Not a vote record or bond issuance record. |
| [Measure T clean master agreement](https://nvta.ca.gov/wp-content/uploads/2023/03/8.3-Attch-1-Clean-MasterAgreementMeasureT.pdf) | Historical amended agreement text; §§3–6 | Template/board materials, not a signed instrument for every jurisdiction. |
| [T Accounting, Reporting and Auditing Guidelines](https://nvta.ca.gov/wp-content/uploads/2023/03/8.3-Attch-3-clean-Exhibit-C-Accounting-Reporting-and-Auditing-Guidelines.pdf) | Updated February 2022; pp.1–6 | Historical accounting/reporting workflow and deadlines. Do not automatically apply to U. |
| [T Policies and Procedures](https://nvta.ca.gov/wp-content/uploads/2023/03/8.4-Attch-1-Clean-Measure-T-Policies-and-Procedures.pdf) | Historical clean copy; PDF pp.4–5, 8–9 | Workflow, closeout, evidence and reporting. Some deadlines differ from the preceding document. |
| [September 27, 2023 NVTA-TA packet](https://nvta.ca.gov/wp-content/uploads/2023/09/09-27-23-NVTA-TA-Agenda-Packet.pdf) | PDF p.16, proposed/redlined policies | Documents completed-project form, photos and closeout distinctions. Redlines are not proof of final adopted wording. |
| [June 18, 2025 NVTA packet](https://nvta.ca.gov/wp-content/uploads/2025/06/NVTA-Agenda-Packet-06-18-25.pdf) | Item 10.2 PDF pp.33–40; database contract amendment | Describes existing recipient logins/reporting and proposed U enhancements. No live software testing performed. |
| [2022 T biennial public report](https://nvta.ca.gov/wp-content/uploads/2023/03/001_Measure-T-Biennial-Report-2022-FINAL.pdf) | PDF p.3: delivered outputs, project and financial tables | Demonstrates actual published metrics. Not the current U submission form. PDF screenshot retrieval timed out; extracted text was readable. |
| [American Canyon performance/compliance audit](https://nvta.ca.gov/wp-content/uploads/2024/08/Measure-T-Performance-and-Compliance-American-Canyon-Final.pdf) | Auditor report dated May 18, 2023, fiscal years 2021/2022; pp.1–3 | Concrete evidence of what an audit checked and could not verify. Findings are historical. |

## Dates and rule versions must remain distinct

The tax agency reports ordinance adoption on June 26, 2024; voters approved U on November 5, 2024; NVTA confirms collection commencement on July 1, 2025. “Effective” is not a safe single database date. Ordinance §30(D) defines it by electorate passage; §30(L) separately defines the operative collection date. Section 18 addresses operative timing and replacement of T. Its cross-reference to §30(H) does not match the actual operative-date definition in §30(L). Preserve the source discrepancy rather than silently repairing quoted authority. [Ordinance, pp.11,16–17](https://nvta.ca.gov/wp-content/uploads/2024/07/Measure-U-Ordinance-24-01-signed.pdf), [commencement announcement](https://nvta.ca.gov/news/7283/).

The County's certification item quotes Elections Code 9122 as adoption upon declaration of the vote and legal effect ten days afterward. The displayed item metadata has an implausible December 31, 2023 final-action date for this 2024 election and no usable history. I did **not** establish the precise certification-based legal-effective date. Store election date, board adoption, certified declaration, legal effect, collection commencement and recipient agreement execution independently. [County certification item 24-2028](https://napa.legistar.com/LegislationDetail.aspx?GUID=82823BEB-A920-434E-BBB0-2E3AAB1F77D6&ID=7032885&Options=&Search=).

The U agreement's §13 explicitly distinguishes tax reporting periods through June 30, 2025 from periods beginning July 1, 2025. A late receipt is therefore not automatically U money. The system needs the underlying tax period, receipt date, allocation date, disbursement date and accounting period. [County agreement, p.10](https://napa.legistar.com/View.ashx?M=F&ID=14564769&GUID=524B9E80-254E-4577-9498-41F6B59402A2).

## Rules to represent, without confusing one calculation with another

| Topic | Measure T evidence | Measure U evidence | Product implication |
|---|---|---|---|
| Equivalent funding | 6.67% collective commitment to eligible Class I facilities, separate from local MOE | 7%; Class I/IV; routine maintenance capped at 20% of that requirement | Separate obligation, eligible-source ledger and geographic/program scope; committed and spent are different states. |
| MOE | Historical local-general-fund baseline using FY 2007–08, 2008–09, 2009–10 | 20% audited-revenue basis; subsequent increase cap; five-year-average deficiency process | Effective-dated baseline evidence, annual calculation, certification, review and held allocation; never use 6.67% as this baseline. |
| Allocation | Historical prescribed jurisdiction shares | Revised formula and five-year updates, 3% floor/normalization | Store approved formula/version and inputs; no permanent Napa shares in generic code. |
| Financing/use | Primarily maintenance and pay-go | Bonding and 5% flexibility provisions | Track approved use, debt, deductions and exceptions separately from costs incurred. |

The first two T rows derive from the [T master agreement §§3–4](https://nvta.ca.gov/wp-content/uploads/2023/03/8.3-Attch-1-Clean-MasterAgreementMeasureT.pdf); the U rules derive from [Ordinance §§3,6,11](https://nvta.ca.gov/wp-content/uploads/2024/07/Measure-U-Ordinance-24-01-signed.pdf). This is a compact rule map, not executable financial advice. Exact fund-source exclusions, permitted carryforward, formula denominators and exceptions must be loaded from the complete governing text and approved for implementation by the administering agency.

The [current NVTA reporting page](https://nvta.ca.gov/programs/measure-t-reporting/), refreshed during final review, describes U's first-year MOE as at least 20% of the latest audited local streets-and-roads sales-tax revenue, recalculated annually with increases limited to 2% over the preceding requirement. It separately describes 7% equivalent funding and annual certified resolutions. This agrees with the broad distinction in the [County's 2025 staff explanation](https://napa.legistar.com/LegislationDetail.aspx?FullText=1&GUID=F1B60BDC-C04F-4572-B5F0-21DB3BED91BD&ID=7502352). The master agreement specifies an initial FY 2024 Measure T proceeds basis and a May 15 certification calculation point. Ordinance §11's growth-cap wording is awkward; the webpage clarifies the agency's public explanation but is not a substitute for an agency-approved calculation tied to the applicable agreement, audited base and year. Do not silently encode a formula from an ambiguous clause. The current webpage was not established to contradict U's baseline; my earlier statement to that effect was incorrect.

Roles also change applicability: the July 2025 NVTA staff report explains that NVTA receives regional-program funds as an implementing agency and is not subject to the local-streets 20% MOE requirement, while participating in equivalent-funds certification. NVTA-TA administers the measure. Treating them as one interchangeable organization would apply the wrong obligations. [Item 11.4, PDF pp.44–46](https://nvta.ca.gov/wp-content/uploads/2025/07/NVTA-Agenda-Packet-07-16-25.pdf).

## Allocation, reporting, review and disbursement

The U agreement calls for biennial five-year project lists with local public-meeting/resolution support, ITOC consideration and NVTA-TA approval. Distribution distinguishes regional and agency bond deductions, administrative costs and local allocations. Quarterly letters distinguish allocated amounts from proceeds received. The separate special-revenue fund, quarterly trial balances, semiannual expenditure updates and supporting accounting evidence remain distinct records. Ineligible expenses require restoration from a source other than U. [County agreement, pp.8–10,13–14](https://napa.legistar.com/View.ashx?M=F&ID=14564769&GUID=524B9E80-254E-4577-9498-41F6B59402A2).

For product design, this yields the following separate flows:

1. Recipient prepares its program, obtains local approval and submits the identified version to the administrator.
2. Administrator reviews eligibility, requests correction and records the applicable oversight/board decisions.
3. Administrator calculates allocations from actual receipts and the approved formula; finance records authorized distribution and later reconciles actual payments.
4. Recipient submits period-specific financial and delivery reports, backed by its own accounting and project records.
5. Administrator accepts or returns the report; auditors investigate evidence and staff track corrective action. Acceptance of a report does not certify every expenditure automatically.
6. Authorized staff publish the approved public record and aggregate outputs, retaining the underlying recipient submission and subsequent corrections.

This is a proposed OpenPlan workflow derived from the institutional requirements, not a claim that NVTA currently uses these exact software states. Reimbursement may be another payment mode for a particular agreement; it should share evidence and review components while retaining its own earned-cost, claim, retention and payment semantics.

## What recipient reports and public outputs actually contain

The February 2022 T guidelines specify semiannual reports with project name, approved budget, spent-to-date, remaining amount, completion percentage and completion date, plus equivalent-fund accounting and attached trial balance/detailed expenditures. They distinguish special-revenue transfers from capital-project expenditure records. [Guidelines, pp.4–5](https://nvta.ca.gov/wp-content/uploads/2023/03/8.3-Attch-3-clean-Exhibit-C-Accounting-Reporting-and-Auditing-Guidelines.pdf).

The 2022 public report publishes **10.26 miles of roads repaired/replaced, 7,280 linear feet of sidewalks repaired/replaced and 28 curb ramps installed/replaced**, alongside revenues/expenditures and project status/funding tables. These are verified published output categories, not invented example metrics. The underlying current U form's mandatory output fields were not established. [Biennial report, p.3](https://nvta.ca.gov/wp-content/uploads/2023/03/001_Measure-T-Biennial-Report-2022-FINAL.pdf).

Historical closeout policies require an official completion notice or an agency memo for staff-performed work. Proposed 2023 revisions distinguish the completed-project form, photographic evidence and formal completion documentation. “100% complete” and “form submitted” are therefore insufficient substitutes for the closeout record. [T clean policies, PDF pp.4–5](https://nvta.ca.gov/wp-content/uploads/2023/03/8.4-Attch-1-Clean-Measure-T-Policies-and-Procedures.pdf), [2023 redline, PDF p.16](https://nvta.ca.gov/wp-content/uploads/2023/09/09-27-23-NVTA-TA-Agenda-Packet.pdf).

The June 2025 staff report says jurisdictions already had individual logins to update project status, costs, photographs, signage and closeout documents. It describes implemented dynamic semiannual reports, selected-entry presentation reports and a document library. Proposed additions include report-date attachment associations, scoped fund choices and an explicit no-equivalent-projects response. **This is an existing workflow benchmark worth matching; it is not evidence those proposed additions were delivered.** No login, demonstration or live competitor testing occurred. [June 2025 packet, PDF pp.33,37–40](https://nvta.ca.gov/wp-content/uploads/2025/06/NVTA-Agenda-Packet-06-18-25.pdf).

Recommended reusable output record, based on these reporting needs:

| Field group | Needed meaning |
|---|---|
| Identity | Administering program, recipient agency, project/phase, asset or segment, submission and reporting period |
| Measurement | Output type, quantity, unit, installed/repaired/replaced treatment, measurement date and method |
| Scope | Reporting-period increment versus cumulative total; completed versus planned; length versus lane-miles versus area |
| Finance | Total project expenditure, eligible amount, amount attributed to each funding source, accrual/payment distinction |
| Evidence | Quantity sheet/inspection/contract record, source accounting rows, photos, completion record and responsible certifier |
| Review | Submitted version, correction request, revised version, accepted quantity, reason, reviewer and publication decision |

A sidewalk funded by multiple sources must not become multiple sidewalks in countywide totals. A corrected cumulative number must not be added as a new period increment. Missing or unmeasured output must remain distinct from zero. These are proposed integrity requirements, not additional Napa ordinance thresholds.

## Audit and public accountability are real work

The American Canyon audit found expenditure documentation existed but did not allow the auditor to verify direct-project cost eligibility; it also reported a late/missing annual audit submission for one reviewed year. These are historical findings, not current accusations. They demonstrate why uploading a document or balancing a spreadsheet cannot alone establish eligible spending or compliance. [Auditor report dated May 18, 2023, pp.2–3](https://nvta.ca.gov/wp-content/uploads/2024/08/Measure-T-Performance-and-Compliance-American-Canyon-Final.pdf).

U's master agreement provides financial/operational inspection and audit access, record retention and restoration of ineligible charges. It separately names accounting/reporting exhibits, tax reporting and the County's airport-fuel-related responsibilities. These are program/recipient-specific controls, not fields to require of every grant recipient. [NVTA-TA packet, agreement printed pp.13–16](https://nvta.ca.gov/wp-content/uploads/2025/07/NVTA-TA-Agenda-Packet-07-16-25.pdf).

The public reporting layer should use reviewed figures and publish its reporting period, coverage, definitions and correction history. Keep invoice details, payroll and personal information in authorized review records. Preserve independent auditor findings, agency responses and corrective-action status rather than converting uploaded reports into a green compliance badge. Public outputs should connect back to adopted programs and actual delivery, and export in readable documents and reusable tables.

## Complete milestone and verification proposal

This belongs within the existing Programs/Projects/funding-administration/evidence/reporting infrastructure, subject to the parent's source inventory. The requirement includes recipient agencies reporting to a parent administering-agency instance. Sharing the same workspace is not sufficient evidence of that relationship. Support an explicit administering/recipient agreement and a durable submission boundary; separate installations need authenticated exchange or a verifiable import/export package, not copied credentials or unrestricted cross-agency access.

**Milestone A: authority and program setup.** Import the actual ordinance, expenditure plan, agreement and applicable forms. Preserve T and U separately and map successor relationships. Capture payment mode, effective periods, recipient obligations, output definitions and human-approved interpretations. Done evidence: reviewers can trace every enabled rule and deadline to its controlling version; historical deadline conflicts and unresolved calculation interpretations are disclosed; a late T receipt retains T classification.

**Milestone B: one complete recipient reporting cycle.** A city user creates or imports a real approved project, reports sidewalk/road/ramp outputs and expenditures, attaches source records and submits the selected period to the administrator. Administrator returns an error; city resubmits; administrator accepts the corrected version. Done evidence: both sides retain matching submission IDs, payload/evidence hashes, review history and exact period; another city cannot access the draft; reconnect/retry does not duplicate records.

**Milestone C: allocation and financial control.** Use actual source receipts and a reviewed formula version to calculate a distribution, record deductions/holds, obtain human finance authorization, export the disbursement instruction and reconcile the resulting payment record. Run a separate reimbursement agreement through its own claim path. Done evidence: allocation, budget, eligible expenditure, amount claimed, approved amount and paid amount remain distinct; output-report acceptance cannot silently authorize money.

**Milestone D: audit, closeout and public reporting.** Complete the project with output evidence, resolve a cost finding through a traceable correction, close out under applicable rules and generate the administrator's public period report and project record. Done evidence: totals independently reconcile to accepted recipient versions; mixed funding does not double-count physical outputs; private financial evidence stays private; correcting a prior period produces a visible revision rather than rewriting history.

Acceptance must cover actual entry points on desktop and 390px, keyboard and screen-reader tasks, permissions, reload/retry, export reconciliation and clean-console review. No part of that acceptance was performed in this research. Register adversarial cases before implementation: wrong-period categories/form, duplicate submission, retired measure renamed in place, zero substituted for unknown quantity, cumulative totals double-counted, multi-funder duplication, eligible-source misclassification, receipt-date/tax-period mismatch, stale formula, wrong recipient MOE applicability, bond proceeds treated as recurring revenue, an audit attachment without eligibility evidence, and report approval mistaken for payment approval. Guards require a surviving no-op and targeted failing mutations.

## Unresolved evidence and safe next steps

- Obtain the actually executed recipient U agreements and current Exhibits B–H/program manual. The examined attachment names these exhibits but does not include their complete contents. Confirm current output definitions and submission deadlines before operational configuration.
- Resolve historical deadline differences: the 2014 draft progress form used March 31/September 30; February 2022 guidelines use March 1/September 1 and January 31 for ACFR; another historical policy copy states January 1. These records demonstrate version drift, not a current universal deadline. [Historical form, PDF p.84](https://nvta.ca.gov/wp-content/uploads/2023/02/7-Aug-2014-NVTA-ITOC-Agenda-Packet.pdf), [2022 guidelines](https://nvta.ca.gov/wp-content/uploads/2023/03/8.3-Attch-3-clean-Exhibit-C-Accounting-Reporting-and-Auditing-Guidelines.pdf), [historical policies](https://nvta.ca.gov/wp-content/uploads/2023/03/8.4-Attch-1-Clean-Measure-T-Policies-and-Procedures.pdf).
- Confirm legal-date ambiguities against certified records and agency interpretation. Do not infer a precise legal-effective day from broken agenda metadata.
- No current bond issuance, recipient compliance, bank transfer, audit closure or successful portal workflow was verified. No claim that all measures reimburse expenditures, that every Napa source is internally consistent, or that OpenPlan already meets these requirements is made.

Research deliverable complete: primary-source inventory, version distinctions, reporting/output requirements, workflow specification, limitations and falsifiable milestone acceptance preserved. Product implementation and operational verification remain future work. Final shared-checkout status check is recorded in the handoff; no checkout mutation was authorized or performed.
