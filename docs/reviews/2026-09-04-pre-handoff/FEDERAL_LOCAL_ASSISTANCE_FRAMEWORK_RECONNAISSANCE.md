# Federal local-assistance framework for OpenPlan

Research date: September 4, 2026 Pacific / September 5 UTC. This is selected-source reconnaissance, not a complete federal manual, legal review, or claim that OpenPlan meets federal requirements. No application, checkout, database, browser session, account, worker, or test changes were made.

## Answer and engineering decision

There is no single current federal counterpart that performs the whole job of California's Local Assistance Procedures Manual. The relevant federal sources form several connected systems. FHWA has Federal-aid requirements, construction guidance, stewardship agreements and program-specific terms. FTA has its own award-management guidance and agreements. Direct discretionary awards, Federal Lands delivery, Tribal programs and territorial programs require additional branches. This conclusion follows from the source inventories and applicability provisions below; it is not a claim to have searched every federal publication.

OpenPlan should maintain a versioned authority and award register shared by capital delivery, grants, financial administration and procurement. Every consequential requirement should identify its source, applicability, effective dates, responsible official, required record, and review status. A manual can organize the workflow, but its publication date cannot by itself establish which rule governs an existing award.

## The federal source hierarchy

| Layer | What belongs here | Treatment in OpenPlan |
|---|---|---|
| Applicable law and regulation | Program statutes, appropriations conditions, applicable CFR provisions | Cite exact provisions and applicability; a checklist cannot waive them |
| Executed award and amendments | Scope, budget, conditions, incorporated agreement versions, approved exceptions | Preserve signed versions and their effective events; link obligations to the actual award |
| Delegation and administration | Stewardship agreements, pass-through agreements, retained decisions, authorized signers | Route the specific decision to the correct entity and official |
| Agency guidance | Circulars, manuals, program guides, memoranda with their actual status | Explain implementation; do not present all guidance as independently binding law |
| State/local procedures | Applicable LAPM/LPM chapters, bulletins, forms and agency procedures | Add the administering jurisdiction's requirements without erasing federal conditions |
| Project evidence | Authorizations, eligibility determinations, invoices, approvals, inspections, certifications | Record what happened and who accepted it; uploading a document does not establish approval |

This table is an engineering synthesis. Source precedence and applicability still need a reviewed program profile. For example, DOT adopts 2 CFR Part 200 through Part 1201 with specific provisions, including treatment of state subrecipients' equipment and procurement procedures. It also specifies written conflict disclosures and a route for questions through the responsible component or pass-through entity. Those details argue against one universal procurement workflow. [2 CFR Part 1201, §§1201.1–1201.328](https://www.ecfr.gov/current/title-2/subtitle-B/chapter-XII/part-1201).

Financial records must identify the award and source of funds and support accurate reporting, obligations, balances, expenditures, controls and budget comparison. OpenPlan therefore needs award identity and a source-backed financial ledger, rather than only a funding-source label and a document folder. [2 CFR §200.302](https://www.ecfr.gov/current/title-2/subtitle-A/chapter-II/part-200/subpart-D/section-200.302).

The exact Uniform Guidance transition depends on the governing award conditions. The root review separately read DOT's current adoption page and will integrate its effective-date findings; this report does not duplicate that review or claim to have read all Part 200 provisions.

## FHWA's older “federal manual” and current guidance

The Federal-aid Policy Guide is a hazardous answer if described as a current universal manual. FHWA Order 1321.1C, January 6, 2010, terminated FAPG and Technical Advisory as directive categories and pointed to the Policy and Guidance Center for dissemination. That did not automatically rescind every substantive provision reproduced in an older guide. Each provision still needs its own current authority. [Order 1321.1C, purpose, background and definitions](https://highways.fhwa.dot.gov/laws-regulations/directives/orders/13211c).

FHWA's current construction portal still links the 2014 *Contract Administration Core Curriculum*. Its introduction describes construction-contract guidance and training, including 23 CFR Parts 230, 630, 633, 635 and 636. Its contents span authorization, contracting, labor/materials, changes and closeout. It is useful for finding questions to ask, but it does not cover all Federal-aid eligibility in depth. The preserved PDF contains 334 pages; I read the contents and introduction, not its entire substantive text. [Current construction portal, updated August 26, 2026](https://www.fhwa.dot.gov/programadmin/contracts/index.cfm), [CACC, printed contents i–iv and introduction 1–2](https://rosap.ntl.bts.gov/view/dot/53664/dot_53664_DS1.pdf).

Currency is a real failure mode. The current contracting guide lists force-account Order 5060.2 dated July 9, 2025, while placing Order 5060.1 from 2012 in its archive. CACC's introduction still references the older order. The old FAPG Part 630A supplement explicitly says it was canceled January 17, 2014. A search result or surviving PDF is insufficient evidence of an active requirement. [Current contract-method guide](https://www.fhwa.dot.gov/construction/cqit/contract.cfm), [canceled supplement](https://www.fhwa.dot.gov/federalaid/0630asup.cfm).

The current Construction Program Guide is a practical topic index, with separate regulations, policy/guidance, training and archive sections. OpenPlan should register those sources individually, including update monitoring, instead of importing CACC as an executable ruleset. [Construction Program Guide](https://www.fhwa.dot.gov/construction/cqit/).

## State-administered and direct Federal-aid work

For state-subawarded Federal-aid work, FHWA Order 5020.2 places accountability on the state transportation agency while allowing different oversight strategies. FHWA oversees that administration. The current national stewardship directory supplies state/DC and Puerto Rico agreements; their delegated and retained decisions matter to individual projects. The previous New York reconnaissance read Order 5020.2 and the main six pages of New York's July 2025 agreement. These are reused findings, not a new complete agreement review. [Local Public Agency resources](https://www.fhwa.dot.gov/federalaid/lpa/), [Order 5020.2, ¶¶4–8](https://www.fhwa.dot.gov/legsregs/directives/orders/50202.cfm), [stewardship directory](https://www.fhwa.dot.gov/federalaid/stewardship/index.cfm).

A directly awarded municipal grant can follow a different path. DOT's current INFRA implementation directory separates FY2025–2026 terms by administering agency, including FHWA, FRA and MARAD, and retains earlier annual terms. I reviewed that directory, not the linked agreements. Its structure alone establishes that “INFRA” and award year do not fully identify the administrator or terms. [INFRA implementation, updated November 21, 2025](https://www.transportation.gov/policy-initiatives/infra/infra-grant-implementation).

FHWA links a Title 23 applicability dashboard for non-state discretionary recipients. The web reader could retrieve its landing page but not the embedded matrix. No dashboard-specific applicability decisions are asserted here. [Applicability dashboard entry](https://www.fhwa.dot.gov/federalaid/stewardship/Title23Applicability.cfm).

For OpenPlan, selection, award execution, obligation, phase authorization, expense eligibility and reimbursement should be separate events. This is the recommended data model; each program's actual sequence must be sourced. Geography alone cannot select the correct chain.

## FTA has its own administration system

FTA Circular 5010.1F is the closest transit counterpart to an award-administration manual. Chapter II-1 gives precedence to statutes, regulations, the Master Agreement, circulars/guidance and the application; program circulars generally take precedence over 5010. Its contents cover preaward work, administration, property, oversight and finance. Selected role provisions address recipient oversight, reporting, budget control, property and authorized actions. The cover is dated November 1, 2024, while the catalog displays an inconsistent November 6, 2025 effective-date field; preserve both observations pending clarification. [Circular 5010.1F, cover and II-1, II-6–7](https://www.transit.dot.gov/sites/fta.dot.gov/files/2024-10/C5010.1F-Circular-11-01-2024_0.pdf), [current catalog](https://www.transit.dot.gov/regulations-and-programs/fta-circulars/award-management-requirements-circular).

FTA lists Master Agreement version 34, November 26, 2025. Section 2 distinguishes the award, recipient, subrecipient and third-party contract; approval concerns a specific action and an authorized official's written permission. Appendix A contains Tribal Transit exceptions and warns that an individual agreement or qualifying compact can alter applicability. Its exceptions must remain program-specific. [Master Agreement v34, §2 and Appendix A](https://www.transit.dot.gov/sites/fta.dot.gov/files/2025-11/FTA-Master-Agreement-v34-2025-11-26.pdf).

FTA's March 2026 third-party provisions matrix is explicitly a nonmandatory aid; its page directs users to the Master Agreement applicable to their award. I read the page, not the matrix. OpenPlan needs separate subaward and purchased-service relationships, official approvals, property records and award-specific provisions. [FTA procurement-matrix page, updated August 26, 2026](https://www.transit.dot.gov/funding/procurement/third-party-procurement/third-party-contract-provisions-matrix).

## Federal Lands, Tribes and territories

Federal Lands Highway retains oversight responsibilities for partner-delivered projects. Its current portal distinguishes FLTP and FLAP stewardship manuals and working instructions, and says those instructions are not inclusive of all federal requirements. I inventoried these links without reading both manuals. They require separate applicability profiles and cannot be treated as state-LPA projects merely because they lie inside a state. [Federal Lands stewardship and oversight, updated August 25, 2025](https://highways.dot.gov/federal-lands/programs/stewardship-oversight).

FHWA's Tribal finance material distinguishes direct agreements and transfers with OTT or BIA stewardship. The appropriate authority depends on the actual agreement and program. OpenPlan must represent Tribal governments as governments, with their own authority and data-control decisions. State geographic containment does not establish state administrative control. The full Tribal Transportation Program Delivery Guide remains unread. [Tribal finance](https://highways.fhwa.dot.gov/federal-lands/tribal/finance).

The April 2026 Territorial Highway Program guidance covers American Samoa, CNMI, Guam and USVI and uses territory-specific agreements to identify applicability and administration. Puerto Rico is a separate branch. The previous reconnaissance read its applicability/agreement passages on PDF pages 5–8, not the entire territorial framework. Preserve this distinction in geographic disclosures and future validation. [THP guidance §§F–I](https://www.fhwa.dot.gov/specialfunding/thp/260330.pdf).

## Concrete roadmap additions

These are review recommendations, not implemented controls. Existing capital, financial, grant and procurement milestones are the right homes; a separate “federal module” would duplicate project records.

- M10 capital delivery should distinguish project location, owner, recipient, administrator, funding program, agreement, roadway system and phase. Definition of done includes a California pass-through project and a direct federal award in the same municipality following independently sourced approval paths.
- M11 financial administration should bind each expense to an award, authorization, budget category, match treatment and supporting record. Corrections must preserve prior claims, and unsupported eligibility must remain unresolved. A finance reviewer should reconcile a real permitted sample packet with its ledger.
- M13 grant administration should preserve executed awards, incorporated terms, amendments, effective events, reporting calendars and retention/hold rules. It should show an applicability explanation and source version for every required action. A newly published manual must not silently rewrite an older award's history.
- M14 procurement should distinguish subawards from purchases, construction from professional services, and the actual procuring entity. Versioned clauses and exceptions need their own evidence and review, including FTA-specific requirements where applicable.

Verification should include mutations that select the wrong administering agency, apply a retired source, approve an action with the wrong role, omit an incorporated condition, or replace historical terms without a reviewed amendment. A harmless wording change should survive. These are proposed checks; none were run during this read-only research.

Recurring costs include monitoring source revisions, reviewing applicability conflicts, secure records storage, restoration and specialist review. A public-agency grants officer, finance specialist and Tribal transportation practitioner should review representative workflows. Nathaniel's product decisions are which direct-award and transit cases enter the first validation cohort and which agencies can supply de-identified files. Full national ambition remains unchanged; a source inventory must not be advertised as nationwide administrative readiness.

## Reading and access ledger

The machine-readable companion is `state-manual-source/federal/reading-ledger.json`. The download manifest preserves URL, bytes, hash and timestamp for CACC; local requests for both FTA PDFs returned HTTP403, although the web reader successfully exposed their text. No local PDF bytes are claimed for those failures.

New reading comprised CACC PDF pages 3–8 in full; selected FTA 5010.1F cover, contents, hierarchy and roles passages; selected MA34 definitions and Appendix A; complete text of 2 CFR Part 1201 and §200.302; and the identified official directory/guidance pages. This is not a whole-PDF count for either FTA document. Earlier New York/federal source readings are labeled reused in the ledger.

Not read in full: Title 23, Title 49, Part 200, all program statutes, all stewardship agreements, linked INFRA terms, Federal Lands manuals, Tribal delivery guide, the embedded applicability matrix or FTA procurement matrix. No current nationwide procurement, DBE, domestic-preference or wage-rule determination is made here. CACC figures were not visually inspected; its selected contents/introduction were readable text. Further review should follow the selected project and award profiles rather than imply that one enormous manual import settles applicability.
