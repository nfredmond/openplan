# LAPM chapters 1–5, 18 and 20: capability and requirement review

September 4, 2026 (Pacific). OpenPlan source: `e6900750e0472260b9a7ce774609ade774659f58`. Research and bounded source inspection only; no application, database, browser journey, worker, test or external submission was run. Active checkout kept read-only. HEAD was unchanged at the final status check; 11 safety-related component/library/test files had become modified by the active development lane. None of those files was edited by this reviewer or used for the financial/maintenance findings below.

## Finding

The renewed roadmap already restores the principal capital-delivery, financial-control, records and program-administration scope. These chapters supply important completion requirements within those milestones, rather than a reason to create seven new modules. The strongest additions to explicit completion scope are non-infrastructure authorizations and work plans; fund/phase authorization and payment state distinctions; independent funding clocks; agreement-version custody; official invoice/FROE preparation; post-construction maintenance and county mileage certification; and agency-wide audit/corrective-action administration.

Current code provides project records, work-plan templates, stage-gate evidence descriptions, award/invoice registers, a derived drawdown ledger and printable worksheets. Those are foundations, not evidence of an operative Caltrans delivery or financial-control system. The California reimbursement profile explicitly defers exact forms, and its worksheet explicitly says OpenPlan does not generate the jurisdiction's exhibit packet.

## Reading coverage and sources

Every text page of the seven assigned January 2026 chapters was read, including contents, references and exhibit listings: **82/82 PDF pages; no unreadable pages**. Relevant process diagrams and financial tables were visually inspected. [engineering-reading-ledger.json](lapm-source/engineering-reading-ledger.json) records page numbers, source hashes and visual inspection. Chapter PDFs remain unchanged. Separate exhibit files were not read in this lane: exhibit names in chapters are an inventory, not a claim to have inspected the forms. Other chapters and current Office Bulletin overlays are the parent research lane's responsibility.

| Chapter and official source | PDF pages read | Printed pages read | Visual inspection |
|---|---:|---|---|
| [1: Introduction and Overview](https://dot.ca.gov/-/media/dot-media/programs/local-assistance/documents/lapm/ch01.pdf) | 4/4 | i; 1–3 | Text sufficient |
| [2: Roles and Responsibilities](https://dot.ca.gov/-/media/dot-media/programs/local-assistance/documents/lapm/ch02.pdf) | 16/16 | i–ii; 1–14 | Text sufficient |
| [3: Project Authorization](https://dot.ca.gov/-/media/dot-media/programs/local-assistance/documents/lapm/ch03.pdf) | 24/24 | i–ii; 1–22 | PDF pp. 3, 12, 18–20 |
| [4: Agreements](https://dot.ca.gov/-/media/dot-media/programs/local-assistance/documents/lapm/ch04.pdf) | 5/5 | i–ii; 1–3 | PDF p. 2, agreement flow |
| [5: Invoicing](https://dot.ca.gov/-/media/dot-media/programs/local-assistance/documents/lapm/ch05.pdf) | 17/17 | i–iii; 1–14 | PDF pp. 3, 9, 10, 14 |
| [18: Maintenance](https://dot.ca.gov/-/media/dot-media/programs/local-assistance/documents/lapm/ch18.pdf) | 8/8 | i; 1–7 | Text sufficient |
| [20: Audits and Corrective Actions](https://dot.ca.gov/-/media/dot-media/programs/local-assistance/documents/lapm/ch20.pdf) | 8/8 | i; 1–7 | PDF pp. 4, 7, audit/CAP flows |

The [official LAPM index](https://dot.ca.gov/programs/local-assistance/guidelines-and-procedures/local-assistance-procedures-manual-lapm) identifies the January 2026 edition and links later bulletins. This review does not independently certify every regulation, cross-reference or form as current. A rule must retain its edition and applicable amendment; DBE requirements particularly require the parent's bulletin review before implementation. The source manifest records September 5 UTC retrieval, still September 4 Pacific.

## Applicability first

Chapter 1 §§1.1, 1.3 and 1.6, printed pp. 1–2, distinguishes Federal-aid local transportation projects from state-only paths and points to program-specific LAPG, environmental and State Highway System procedures. Federal-aid users consider all chapters and determine applicability; state-only projects use specified chapters wholly or partly. This is not a universal checklist for a municipal tax program, privately funded planning study or every consultant contract. Procedures may recur and run concurrently.

Record recipient, administering agency, program/fund, phase, project type, NHS/SHS status, location, agreement and dated applicability disposition. Unknown is a work item, not an automatic exemption. Preserve nationwide planning support and implement California-specific controls as source-bound profiles.

## Current source: foundations and limits

Paths are relative to `/home/nathaniel/code/openplan`. These observations come from bounded reads and inventories, not a full code/security audit or proof of visible usability.

| Existing home/source | Present in inspected source | Consequential limit |
|---|---|---|
| `openplan/src/lib/projects/project-record-fields.ts` | Shared validated project statuses and delivery phases | Phases are scoping, analysis, engagement, programming, delivery and complete. They do not model PE/RW/utility/CON/CE/NI authorization or legal eligibility dates. Preserve planning stages while adding funding dimensions. |
| `openplan/src/lib/work-plans/templates/grant_funded_project_delivery_v0.1.json` | Agreement, authorization, procurement, reporting, invoice and closeout checklist with explicit placeholder dates | Its statement that every grant obligation counts from award date is overbroad. LAPM establishes independent clocks. Checklist dates do not compute authority or recurring obligations. |
| `openplan/src/lib/stage-gates/templates/lapm_pm_invoicing_controls_v0.1.json`; `summary.ts` | Sampled pack sections describe reviewer, eligibility, invoice/change/closeout evidence; pack status is `planning_support_not_runtime_enforced`. Summary distinguishes unreadable decisions from no decision. | Internal approval labels do not establish E76 authorization, countersignature, funder acceptance or payment. The pack was sampled; it was not audited as an entire runtime implementation. |
| `openplan/src/lib/invoicing/profiles/us-ca-lapm.ts` | Versioned California profile with internal-use/federal-aid-candidate postures and `deferred_exact_forms` | No exact Caltrans form pack. District 3 submission hint must become project/district specific before statewide operational use. |
| `openplan/src/lib/invoicing/drawdown-ledger.ts`; `invoice-records.ts` status constants | Distinguishes gross claims, paid net, pending retention and actually withheld retention; unknown amounts/read failures have explicit states | `internal_review` is included in CLAIMED and therefore “asked of the funder” totals. Internal review is not external submission. Generic award amounts are not programmed/allocated/authorized/obligated/encumbered authority. |
| `openplan/src/lib/invoicing/reimbursement-worksheet.ts` | Reuses ledger calculations, labels unknown records and explicitly disclaims official-form status | Date/vendor/description/amount cost rows do not prove incurred-and-paid eligible expense by funding phase, original support, approved indirect rate or absence of duplicate claims. |
| `openplan/src/lib/projects/budget.ts`; `budget-queries.ts` | Deliverable budgets, progress basis, direct spend and client invoice lines; refusal without budget/progress basis | `actualToDate = billedToDate + spendToDate` is not agency eligible paid cost or universal accounting actual. Reads cap deliverables at 200, spend at 500 and client invoices at 200; full financial reconciliation needs completeness evidence. |
| `openplan/src/app/api/projects/[projectId]/spend-entries/route.ts` | Auth/workspace action gate and same-project deliverable attribution; editable direct-cost records | Inspected schema lacks payment evidence/date, funding split, phase authorization, indirect-rate reference or certified-invoice lock. Mutable/deletable working rows cannot alone preserve an already certified claim. |
| `openplan/src/app/api/funding-awards/[awardId]/award-closure.ts` | Imported closure differs from earned closure; approval differs from actual paid status | Earned closure requires positive award and paid amount at least award amount. Legitimate underspend/de-obligation, refund, funder acceptance and unresolved claims require richer paths; full award payment is insufficient closeout evidence. |
| Evidence-bundle, stage-gate, work-plan and Measures/claims libraries/routes inventoried | Coherent homes for records, review, reporting and handoff exist | Not all these modules were deep-read. No asset/mileage-specific home was found in the bounded library/API filename inventory; investigate further before choosing a home. This is not a whole-repo absence proof. |

## Chapter findings and completion requirements

### 1. Explainable, versioned applicability

Chapter 1 §§1.3–1.7 (printed pp. 1–3) supports a project/funding applicability profile with source edition, program overlays, explicit exclusions and review history. Annual publication does not automatically rebind a project to a new master agreement, and does not justify ignoring an intervening bulletin. Source updates should identify potentially affected records for review, preserving prior accepted packages.

**Home:** M1 authority/applicability, M2 work plans/Documents, M10a intake. **Done:** federal-aid capital, state-only and noncapital local planning cases produce different justified obligations without invented exemptions; old accepted records remain reproducible. No separate Chapter 1 module is needed.

### 2. Responsible agency, public employee and retained oversight

Chapter 2 §§2.1–2.8 (pp. 1–6) distinguishes LPA implementation, DLAE coordination, MPO/RTPA programming, Caltrans oversight and FHWA retained approvals. NHS/SHS and risk-based involvement change responsibility. A candidate is not necessarily selected for special oversight: preserve the actual stewardship/oversight plan and retained activities. Significant NHS projects also have written procedure and review requirements.

Section 2.12 (pp. 11–13) requires responsible charge by a full-time public employee of the recipient; a consultant cannot satisfy that role by becoming an OpenPlan admin. Multiple public employees may share duties, and an official may serve multiple projects without being an engineer. Model employing agency, assignment interval, duty and delegation separately from software permissions. Retain oversight contacts, reviews, conflicts/recusals and actual signatures. UEI replaces DUNS (§2.12.3).

Sections 2.9 and 2.13–2.15 (pp. 6–8, 13–14) add conditional financial planning, programming calendars and permit coordination. The major-project provisions apply where Federal-aid is used in construction: generally total project cost of $500 million or more, or FHWA designation, entails project management and financial plans; $100 million to under-$500 million has financial-plan requirements. Preserve all-phase/year-of-expenditure cost, risk, approval and annual-update evidence. Do not impose this reporting system on every small planning job.

**Home:** M1/M4 authority, M10a–c delivery, M12 programming. **Done:** consultants prepare but cannot assert recipient responsible charge; retained approvals stay pending without evidence; a large-project case triggers applicable plan/update duties while a small local planning case does not. Regional coordination remains distinct from fiscal authority.

### 3. Phase authorization, funding methods and independent clocks

Chapter 3 §§3.1–3.4 (pp. 1–10) makes phase authorization a prerequisite to eligible work, with explicit exceptions. Federal programming, applicable CTC allocation, E76 authorization, obligation and invoicing are different events. OpenPlan approval cannot create FHWA authorization. Preserve original requests, revisions, transmitted/returned/accepted states and actual external authorization evidence.

PE, RW, utilities, CON and CE need separate classifications/dates. Advertisement before construction authorization is a serious eligibility failure. Separately authorized CE cannot acquire historic eligibility merely because construction was authorized. Environmental approval/revalidation, ROW certification, PS&E and award-package conditions belong to the actual work/funding path. Processing lead-time estimates are guidance, not guaranteed service times.

Specific pathways requiring acceptance coverage:

- **At-risk PE:** §3.3.1, pp. 3–5, permits a conditioned exception, not guaranteed funding or a waiver of procurement/environmental requirements. Preserve original/current programming, effective dates and any CTC allocation constraint. Subsequent authorization is still required before invoicing.
- **ITS:** §3.3.2, p. 5, distinguishes nonconstruction authorization and high-risk systems-engineering approvals from low-risk/exempt treatment. Keep the actual classification and approved SERF/SEMP evidence where applicable rather than applying a universal highway-design gate.
- **NI:** §3.3.6, pp. 7–8, includes education/outreach and demand-management activities. It can be programmed CON yet authorized NI. A tasks/schedule/deliverables/budget work plan replaces PS&E; environmental review remains relevant and ROW certification does not apply. Reuse planning work plans rather than construction quantities.
- **FTA transfer:** §3.11, pp. 19–21, changes administration to the applicable Chapter 53 path while retaining Title 23 matching provisions. Retain purpose, transit recipient, transfer evidence, FSTIP/allocation conditions and direct/state-administered routes. State matching reimbursement can require FTA invoice/payment evidence. Renaming the fund source is insufficient.

Sections 3.5–3.10 (pp. 11–18) require funding-line accounting. Record participating/nonparticipating costs, authorized federal share, local cash/noncash match, source and denominator. Pro-rata versus lump-sum federal participation differs from upfront advances. Advance construction is authorized but initially unobligated; conversion needs a later transaction and agreement steps. Tapered match is an approved variable reimbursement pattern. Flexible match requires eligible source/value evidence. Toll credits satisfy match but do not supply extra cash; mixed funds need separate treatment. Chapter example rates are not default reimbursement rates.

PED is the last eligible cost-incurrence date; §3.3.7 p. 8 specifies invoice submission within 120 calendar days after PED. Appropriation/lapse and Cooperative Work Agreement provisions in §3.5 have separate multi-year clocks and pre-lapse action. Completion/agreement-expiry invoice constraints in Chapter 5 are additional. Store triggering event, actual approved extension, source and explanation for overlapping deadlines. Extending one clock does not extend the others.

**Home:** M10a–b authorization, M11 cost/funding reconciliation, M12 programming, M13c administration. **Done:** reconstruct an E76-supported cost line and explain eligible/ineligible/unknown dates. Exercise NI, at-risk PE, advance construction and FTA transfer separately. Upload, allocation, paid invoice and internal approval cannot manufacture external authority.

### 4. Agreement versions and execution

Chapter 4 §§4.1–4.6 (pp. 1–3; Figure 4-1 on contents p. ii) distinguishes master agreements, Program Supplement Agreements, Exchange/Match agreements, E76 and separate cooperative/maintenance/railroad agreements. A project retains its governing master version. PSA covenants can identify another billing/pay entity; “agreement uploaded” is insufficient.

Capture agency/locode qualification, resolved preaward findings, applicable master, allocation/obligation, PSA covenants, governing-body authorization, authorized signatory, signatures and returned conformed copy. Preserve external drafting and execution states. Unilateral LPA alteration of PSA language/amount is not an executed amendment. A new funding program may require revision; Exchange/Match cancellation has its own return path.

**Home:** M2 Documents, M4 records/authority, M10a. **Done:** two projects retain their different master versions after a new master is signed; LPA signature alone cannot unlock reimbursement; revised funding/covenants prompt review without destroying originals. Actual countersignature/acceptance remain externally evidenced.

### 5. Paid-cost evidence, official packets and reconciliation

Chapter 5 §§5.1–5.3 (pp. 1–7) requires a chain from authority to eligible cost. Normal reimbursement concerns completed/incurred and paid costs with phase, eligible date, agreement, indirect treatment and authorized share. Client bill, funder claim, payer approval and cash receipt are separate. Costs cannot be counted twice because they appear in consultant billing and an agency ledger.

Indirect costs require the applicable approved basis by fiscal year and government unit. The chapter describes de minimis up to 15% of modified total direct costs but directs the agency through CIAO application/certification; this is not a universal 15% expense toggle. Preserve rate period, excluded base costs, approved plan and program restrictions. Prevent retrospective indirect additions after final expenditure reporting where prohibited.

Sections 5.4–5.6 (pp. 8–12) require prescribed packets. Exhibit 5-A includes invoice/billing summary/checklist; the chapter rejects custom agency invoices. An honest OpenPlan worksheet cannot count as that output. A correction needs revised number/date and preserved superseded submission. Attachments, certification, DLAE review, submission and receipt differ. The award package is due within 60 days of award and before the first construction-capital invoice; CE differs, and force-account work has a public-interest-finding path. The normal invoicing cadence is no more often than monthly and at least every six months; the chapter also specifies final invoicing within 180 days of completion or agreement expiry, whichever occurs first. Review April lapse-year handling and final expenditure deadlines alongside the separate PED constraint. Typical processing durations are not payment guarantees.

Separate standard arrears reimbursement, specifically approved escrow advances, agreement-authorized PPM/FSP advances (the chapter's up-to-$300,000-per-fiscal-year condition), and Exchange/Match advances. PPM/FSP have subsequent expenditure reporting; Exchange/Match includes the RTPA annual report as of June 30 due August 1 with city/county amounts. None is synonymous with lump-sum federal participation.

The chapter's retention provision is tied to PSA/master terms; it must not overwrite construction or consultant retainage. Vendor/payee STD 204, EFT setup and bank/tax identifiers require restricted handling rather than public packet or optional model exposure. Recording an external setup receipt differs from performing a bank operation.

Final reconciliation (§§5.6–5.11, pp. 11–13) aligns final invoice, expenditures, eligible/nonparticipating funds and applicable reports. Explicit “none” for claims, damages or changes differs from missing data. Completion, final payment, FROE acceptance and final federal voucher are distinct events. Chapter 2 §2.12.3 p. 13 and Chapter 5 §5.8 pp. 12–13 tie the stated three-year records period to Caltrans transmission of the final voucher to FHWA; project completion is not that event. Preserve applicable longer holds and other governing retention requirements. Overpayment produces a receivable/recovery, not a discarded negative balance. Partly Caltrans-administered work can need separate Caltrans/LPA reports; pending contract claims may delay voucher closure. Service contracts route through the program manager (§5.12, p. 14).

**Home:** M10c–d, M11a–c, M13c–d. **Done:** agency finance independently reconstructs every amount/date from permitted source records, renders the current official packet, returns a correction, records receipt/payment and closes an underspent or overpaid case correctly. Retain the worksheet's honest label until the official-form path is proved.

### 18. Service-life maintenance and county road mileage certification

Chapter 18 §§18.1–18.3 (pp. 1–2) requires maintenance after delivery, custody transfer on annexation, SHS interface agreements, inspection findings and corrections. Written deficiency notice can create a 90-day correction window and external funding consequences. Preserve notice, service date, obligation, corrective evidence and agency disposition. A missed internal task cannot itself establish a sanction.

Public-road bridge inspection responsibility extends beyond federally funded bridges. The chapter describes an approximately two-year cycle, but operational scheduling must use the applicable bridge program and current NBIS rules instead of universalizing it. Current NBIS exceptions were not independently researched in this lane. Chapter 2's four-year LPA maintenance-review language and Chapter 18's request/deficiency/history-based description need agency clarification for the actual calendar.

Section 18.4 (pp. 2–7) establishes a materially under-specified workflow: **county-maintained road mileage certification for HUTA apportionment**. Qualification includes legal road status, actual maintenance, public availability and geography, with stated exceptions. Boundary-road apportionment, maintenance termini, relinquishment, annexation and functional classification matter. Retain segment geometry/version, legal basis, responsible agency, mileage method, effective dates and change reason; prevent boundary double-counting.

Annual May submission combines board resolution, total, tabulation and maps. DLAE review, June 15/July 1 milestones and limited monthly changes/corrections are separate. The chapter permits alternatives in tabulation format and electronic material; color must not be the only accessible change indicator. Certified, tabulated and mapped totals must reconcile. Functional-classification changes have a separate year-round approval path; approved FHWA maps control where source records disagree. Editing OpenPlan GIS does not approve a classification or mileage certification.

**Home:** M5 GIS, M10d asset handover, M13 fiscal administration. Explicitly include maintenance/custody and mileage certification; locate deeper existing asset infrastructure before choosing a home. **Done:** additions, annexations and corrections appear once in the appropriate effective certification with reconciled resolution/map/table and actual approval evidence. A bridge deficiency remains open after construction closeout until disposition.

### 20. Agency audits and corrective action

Chapter 20 §§20.1–20.3 (pp. 1–3) distinguishes preaward qualification, procedural findings and questioned/disallowed costs. Track engagement, document requests, entrance, fieldwork, exit, draft response and final report with actual roles, protected attachments, scope, deadlines and response versions. Link findings to the frozen invoices/contracts/costs they concern.

Sections 20.4–20.5 (p. 4) address entity fiscal-year Single Audit reporting across federal awards, not just one OpenPlan project. Packages include financial statements, SEFA, findings/questioned costs, prior-finding status, corrective action and opinions with submission records for the appropriate recipients. Below-threshold exemption documentation is an affirmative signed annual artifact where required. Import agency-wide accounting or disclose the incomplete denominator.

Current [Federal Audit Clearinghouse guidance](https://support.fac.gov/hc/en-us/articles/18792372809101-Is-my-organization-required-to-conduct-a-Single-Audit) distinguishes fiscal years beginning before October 1, 2024 ($750,000 or more) from years beginning on/after that date ($1 million or more). Chapter 5 p. 13 says “more than” $1 million, whereas Chapter 20 p. 4 is inclusive. Use the verified inclusivity and fiscal-year transition, not the Chapter 5 wording. Other coverage questions still need actual award/entity facts and qualified interpretation.

Sections 20.4 and 20.6–20.7 (pp. 4–6) distinguish Single Audit management-decision/CAP handling from the general CAP path. Typical three-month and five-month periods are not a universal deadline; preserve the actual letter. Corrective evidence includes procedures before adoption, training attendance, repayment or additional support. Local completion is not closure: retain the Final Determination Letter and actual sanction removal. Funding/reimbursement holds need scoped authority, notice and dates rather than a workspace-wide guess.

**Home:** M4 records/holds, M10d project findings, M13d agency oversight, finance from M11. **Done:** trace a finding through rejected response, unresolved amount, accepted correction and authoritative final determination; distinguish entity audit from project file review.

## Source conflicts to preserve

| Issue | Required behavior and resolving record |
|---|---|
| Ch. 20 §20.2 p. 2 gives five business days for draft response; Figure 20-1 p. 3 gives ten | Both verified, including rendered figure. Surface conflict, use actual engagement/draft letter deadline and obtain auditor/DLAE clarification. Do not silently choose. |
| Ch. 5 p. 13 threshold wording versus Ch. 20 p. 4 | FAC establishes inclusive thresholds and fiscal-year transition. Entity expenditures still require complete fiscal-year evidence. |
| Ch. 2 §2.11.6 p. 11 versus Ch. 18 §18.3 p. 2 review descriptions | Store actual scheduled maintenance review and program basis; do not invent one universal calendar. |
| PED/120 days, completion/agreement expiry, appropriation lapse and April processing constraints | Retain applicable clocks; show constraining date and unknown conditions. Extension of one does not extend others. Confirm agreement/DLAE interpretation. |
| Ch. 18 eligibility numbering inconsistency and historic exceptions | Preserve source and reviewed eligibility explanation; do not hardcode an apparent typo or named-place exception as a general rule. |
| January cross-references, particularly civil-rights requirements | Parent bulletin/current-source review supplies overlays before exact form release or compliance claims. |

## Incremental acceptance plan

These refine the existing scratch `ROADMAP_DRAFT.md`, not permission to implement during this review or shrink v1.

| Increment and existing milestones | Mechanism, actors and artifacts | Acceptance and deliberate failure cases |
|---|---|---|
| M1/M4/M10a | Agency authority, agreement/version, fund/phase event ledger; responsible-charge official and reviewer; signed agreement/E76/decision evidence | Import mid-project missing authorization and old master. Consultant cannot self-certify recipient responsibility. Missing countersignature stays pending; current master cannot replace historical terms. |
| M10a–b/M12/M13c | Eligibility and calendars tied to actual events; PM/DLAE/programming staff; requests, conditions, extensions and receipts | Detect CON advertisement before authorization. NI avoids inapplicable ROW/PS&E. At-risk PE does not guarantee money. PED extension leaves appropriation lapse unchanged. Preserve business-day/source conflicts. |
| M11a–c/M10c | Cost/payment/funding allocations and official packets; finance/preparer/certifier/reviewer; paid evidence, rate approval, invoice and acknowledgment | Reject internal-review-as-submitted, duplicated cost, toll-credit-as-cash, wrong-FY rate, silently capped totals and edits to certified history. Inspect rendered current forms and real attachments. |
| M10d/M11c/M13d | Reconciliation with varied closeout; PM/finance/funder; FROE, refund, claims and acceptance | Permit justified underspend/de-obligation; preserve retention, receivable and unresolved claims. Full award payment cannot independently close. Applicable retention starts at final-voucher event, not generic completion. |
| M5/M10d/M13d/M4 | Maintenance/certification and audit continuity; county GIS/roads, governing body, auditor/agency; maps/resolution/inspection/CAP/FDL | Reconcile certified mileage; prevent duplicate boundary segments; preserve corrections. Findings stay open without agency acceptance. Correct audit-year threshold; protected payee/audit data cannot leak through public export or model context. |

Every new consequential guard needs targeted regression failure and a surviving no-op. Arithmetic tests cannot prove access, external receipt, official-form usability or agency acceptance. Acceptance needs identified-checkout desktop/390px, keyboard/accessibility and console review, plus API/database/storage authorization, concurrent amendment/certification, interrupted upload recovery and restore of accepted evidence. None was performed in this read-only review.

## Already covered versus newly explicit

Already covered: all capital phases including mid-construction intake; RTPA coordination versus fiscal authority; planning/environmental/design/construction/closeout; task/staff/deliverable contract budgets; separate contractor/consultant/funder amounts; source-based authority; procurement; files/records; sponsor reporting and public accountability. These are not newly discovered modules.

Make explicit: NI/FTA transfer; historical master/PSA bindings and countersignature; authorized/obligated/encumbered distinctions and overlapping clocks; noncash match and conditional advances; current 5-A/FROE with approved indirect-cost basis; maintenance/custodian transfer and county-maintained mileage certification; entity-wide audit/exemption, CAP and sanction resolution. The grant template's award-date claim and drawdown's internal-review-as-claimed semantics merit correction in their relevant delivery lanes.

Do not turn each example amount, mailing address, process-box interval or attachment list into an immutable default or module. Versioned requirements/evidence, dimensional financial events, protected documents, externally evidenced transitions, recurring obligations and reproducible exports cover most needs.

## Human validation, operating costs and limits

Use a local-agency PM/responsible-charge official, DLAE or qualified local-assistance reviewer, agency finance/indirect-cost staff, county roads/GIS custodian and audit/CAP practitioner. Reconcile a permitted, de-identified case against its actual agreement/current forms. Ask which record proves authorization/receipt; who certifies; which costs need paid evidence; which clocks overlap; who owns post-closeout assets; and what closes a finding. Have reviewers reconstruct the package and detect a deliberately missing prerequisite, rather than approve a screenshot.

Most additions are database/document workflows. Retained invoices, drawings, signed packages, audit support and restoreable evidence drive storage, while staff source/form maintenance and validation drive operating work. No numeric hosting/staff estimate is justified here. Local workflows should not require paid models. Optional OCR/model processing requires protected-data controls and disclosed egress. External payment/submission integrations require separate authorization and verified receipts; none is claimed working.

Chapter reading is complete. Code review is bounded to named files/sections and inventories; truncated outputs were not counted as full reads. Separate exhibits, current NBIS details, live Caltrans systems, agency practice and all cross-chapter bulletin effects remain outside this lane's verified scope. This is feature/completion analysis, not compliance certification.
