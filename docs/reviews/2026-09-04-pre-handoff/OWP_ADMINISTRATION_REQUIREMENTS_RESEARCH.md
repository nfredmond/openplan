# OWP administration: core OpenPlan requirements

September 4, 2026, Pacific time. **User direction: OWP administration is a high-priority core capability across OpenPlan.** This supersedes treating it as a minor feature discovered during the low-priority DOT Dashboard comparison. The natural homes are M2, M11 and M13, connected to existing planning, records, engagement and procurement work. No new module is presumed necessary.

This is a bounded current-source review, not a complete handbook, grant-law or implementation audit. Root owns code coverage and roadmap integration.

## Current source families and reading coverage

| Source | Edition and selected coverage |
|---|---|
| [Caltrans regional coordination/fiscal resource index](https://dot.ca.gov/programs/transportation-planning/division-of-transportation-planning/regional-and-community-planning/regional-coordination-and-fiscal-management-and-oversight) | Current index carries FY2026–27 guidance, estimates, certifications and invoices, alongside FY2025–26 closeout forms. Read relevant inventory; allocation estimates and certifications not substantively audited. |
| [Regional Planning Handbook](https://dot.ca.gov/-/media/dot-media/programs/transportation-planning/documents/final-2017-rph-11-9-17.pdf) | November 2017; 130 PDF pages. Read contents and selected OWP/contract, reimbursement and year-end sections: printed pp.15–17, 54–55, 59–61. Not the full handbook. |
| [FY2026–27 MPO guidance](https://dot.ca.gov/-/media/dot-media/programs/transportation-planning/documents/division-transportation-planning/regional-and-community-planning/regional-coordination-fiscal-mgmt-oversight/fy-2026-27-mpo-owp-guidance-document-a11y.pdf) | Updated October 23, 2025; 55 pages. Selected pp.12–13, 17–18, checklist pp.33–36 and amendment-template text. |
| [FY2026–27 RTPA guidance](https://dot.ca.gov/-/media/dot-media/programs/transportation-planning/documents/division-transportation-planning/regional-and-community-planning/regional-coordination-fiscal-mgmt-oversight/fy-2026-27-rtpa-owp-guidance-document-final-a11y.pdf) | Updated November 3, 2025; 43 pages. Selected focus, fiscal and reporting provisions pp.10–11, 14–15, 18. |
| [MPO/RTPA amendment and grant guidance](https://dot.ca.gov/-/media/dot-media/programs/transportation-planning/documents/division-transportation-planning/regional-and-community-planning/regional-coordination-fiscal-mgmt-oversight/mpo-rtpa-amendment-and-grant-guidance-v2-a11y.pdf) | Revised August 2024; all seven pages read as extracted text. Tables were not visually audited. |
| Current invoice/closeout workbooks | Downloaded FY2026–27 MPO invoice, RTPA state RFR and FY2025–26 MPO certification of expenditures. Inspected worksheet names, text and selected cells through XML; no formula execution or rendered-workbook acceptance. URLs/hashes in [manifest](owp-source/source-manifest.json). |

## What OWP and UPWP mean

California's OWP describes the agency's planning work and funding for the program year. The handbook connects it with the OWPA and MFTA as a funding agreement, while also recognizing wider agency-management and public-information purposes. An OWP work element is therefore more than a project task list, and including an activity does not itself authorize every funding source. [Handbook §§2.01–2.03](https://dot.ca.gov/-/media/dot-media/programs/transportation-planning/documents/final-2017-rph-11-9-17.pdf).

Federally, an MPO's UPWP identifies proposed work over **one or two years**, responsible performers, schedules, products, activity/task funding and federal/matching totals. A simplified work statement for a non-TMA MPO requires prior state/FHWA/FTA approval. This is not a rule that every rural agency must become an MPO. [23 CFR 450.308(b)–(f)](https://www.ecfr.gov/current/title-23/chapter-I/subchapter-E/part-450/subpart-C/section-450.308).

Agency practice can separate documents: OahuMPO's current page says its FY2026–27 Revision 1 distinguishes the PL-eligible UPWP from the broader Overall Work Program and Budget, both covering July 2025–June 2027. It reports board endorsement May 26 and USDOT approval June 30, 2026. This is a useful national counterexample to making document title, funding scope and fiscal period inseparable. The underlying plan was not fully read. [OahuMPO](https://oahumpo.org/unified-work-program-upwp/).

## Required operating outcomes

| Workflow | Source-backed requirement and proposed OpenPlan representation |
|---|---|
| Build the next program | Retain prior accomplishments and unfinished work; define work-element identity, objectives, tasks, products, responsible agency/consultant and milestones. Tie current-year deliverables to continuing studies without duplicating the study itself. |
| Program resources | Connect each work element to staff/consultant costs and fund sources; keep matching contributions and allocation years explicit. Reconcile work-element tables with the Budget Revenue Summary. Informational/noneligible activities must not acquire planning-fund eligibility merely by appearing in the program. |
| Review and adopt | Preserve draft comments, agency responses, conditional approval, governing-board adoption, state/federal approval where applicable and executed funding agreements as distinct records. |

These rows draw on the [MPO checklist, pp.33–36](https://dot.ca.gov/-/media/dot-media/programs/transportation-planning/documents/division-transportation-planning/regional-and-community-planning/regional-coordination-fiscal-mgmt-oversight/fy-2026-27-mpo-owp-guidance-document-a11y.pdf). They are requirements, not evidence of current application behavior.

Carryover needs its own lifecycle: anticipated balance, completed prior-year reconciliation, signed reconciliation letter, approved programming amendment and available amount. The current RTPA guidance requires fund/year identification and programming reconciled carryover within 90 days of the signed letter. Its quarterly requirements link narrative progress, completed products, schedule and expenditures; final products accompany fiscal-year completion. Keep planning funds distinct from capital-project allocations and local sales-tax proceeds, even when the same agency administers both. [RTPA guidance pp.10–11, 14–15](https://dot.ca.gov/-/media/dot-media/programs/transportation-planning/documents/division-transportation-planning/regional-and-community-planning/regional-coordination-fiscal-mgmt-oversight/fy-2026-27-rtpa-owp-guidance-document-final-a11y.pdf).

Amendments require classification and a recorded decision. The 2024 guidance consolidates covered grant changes into OWP amendments after incorporation, replacing the separate CAT form. It distinguishes administrative, state-formal and state/federal-formal routes. Task budgets remain useful management detail, while covered grants are overseen and invoiced at work-element level. Preserve original grant identity, approved objectives, amendment number, justification and approval evidence. [Amendment guidance pp.1–7](https://dot.ca.gov/-/media/dot-media/programs/transportation-planning/documents/division-transportation-planning/regional-and-community-planning/regional-coordination-fiscal-mgmt-oversight/mpo-rtpa-amendment-and-grant-guidance-v2-a11y.pdf).

Reimbursement must connect to actual accounting evidence. The [current MPO workbook](https://dot.ca.gov/-/media/dot-media/programs/transportation-planning/documents/division-transportation-planning/regional-and-community-planning/regional-coordination-fiscal-mgmt-oversight/fy-2026-27-mpo-inv-and-details-a11y.xlsx) distinguishes previously billed, current billed, remaining balance, matching sources and indirect costs. Its instructions call for consistency with accounting-system transactions and supporting records. A generated spreadsheet alone does not establish expenditure. The [FY2025–26 closeout workbook](https://dot.ca.gov/-/media/dot-media/programs/transportation-planning/documents/division-transportation-planning/regional-and-community-planning/regional-coordination-fiscal-mgmt-oversight/fy-2025-26-mpo-coe-a11y.xlsx) distinguishes active/closed grants and requires expenditure certification. Model closure and remaining obligations explicitly.

FHWA approval/authorization precedes covered work; partial authorization does not promise funding for the remainder. Performance reporting compares actual outcomes, schedules and expenditure with approved work, including revisions and material problems. Acceptance of a report is not federal endorsement of its recommendations. [23 CFR 420.115](https://www.ecfr.gov/current/title-23/chapter-I/subchapter-E/part-420/subpart-A/section-420.115), [420.117](https://www.ecfr.gov/current/title-23/chapter-I/subchapter-E/part-420/subpart-A/section-420.117).

## Currency and ambiguity that must remain visible

- The 2017 handbook describes MFTAs expiring in 2024; current invoice certification text refers to 2034. Obtain the agency's actual executed agreement before asserting its term or conditions.
- The RTPA package has running headers saying MPO and cites “420.308(c)” for planning priorities; the directly reviewed UPWP provision is 450.308(c). Preserve document provenance and verify applicability rather than treating every label as authoritative.
- Amendment guidance says certain task-budget adjustments need no amendment, yet later lists task-fund shifts among administrative-amendment reasons. Minor schedule-change treatment also qualifies general prior-approval language. Agency-approved interpretation is needed before automating edge cases.
- Current MPO workbook PL cells G33:G38 retain FY2024–25/2023–24/2022–23 labels, although the package is FY2026–27. These are referenced worksheet cells, not merely unused shared strings; no hidden-row/column flag was found. Rendering and formula effects were not assessed. Do not silently reproduce the labels in an export.

These observations are grounded in the linked handbook, guidance and workbook versions; they are not OpenPlan defects. Referenced circulars, federal administrative cross-reference transitions and every grant-specific condition were not independently reconciled here.

## Completion and falsification evidence

M2/M11/M13 should jointly deliver **one complete agency program cycle**: import the adopted predecessor and real funding records; prepare and review the new program; adopt and obtain required approvals; assign actual planning work across existing modules; process a quarter with staff and consultant evidence; resolve a returned claim; approve an amendment; deliver final products; certify expenditures; reconcile and roll forward eligible balances.

Acceptance must challenge a duplicated invoice, wrong allocation year, unapproved changed activity, missing product, expired balance, inaccurate match and falsely closed grant. Each must produce a visible unresolved condition. Demonstrate that corrected records reconcile across OWP, work-element budgets, claims and closeout without rewriting submitted history. Add a rural California case and a two-year MPO case to avoid one-agency assumptions. Export both readable documents and structured records for the next fiscal year and a successor staff member.

No checkout edits, tests, browser, accounts, private files or agency contact were used. Reading limits, source pins and final read-only checkout observation are in [reading-coverage.json](owp-source/reading-coverage.json). This report establishes required work and evaluation evidence, not implemented or legally certified capability.
