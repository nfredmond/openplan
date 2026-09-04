# Procurement discovery, submission evidence and open-source reuse

September 4, 2026. Bounded primary-source review for OpenPlan's restored dual-sided procurement scope. The active checkout remains read-only. Root owns its current code review; this report inventories integration and reuse options without claiming a full implementation audit. No installation, authenticated API call, portal login, account change, model invocation, test or application run was performed.

Recommendation: extend OpenPlan's existing opportunity/proposal and project/contract records with versioned public-source adapters and a separate, private consultant pursuit workflow. Add agency solicitation and response administration with enforceable access boundaries. Use OCDS for reviewed publication/interchange. Do not replace the product with ERPNext or import an entire international procurement engine merely to acquire an RFQ screen.

## Official source inventory and coverage

| Source | Documented use | Boundary and recommended integration |
|---|---|---|
| SAM.gov Get Opportunities Public API | Federal public opportunity discovery, notice metadata and document links. | Optional credentialed adapter plus public-link/manual intake. Not nationwide state/local coverage, nor a consultant proposal-submission API. |
| Cal eProcure / California State Contracts Register | California state advertised opportunities, related bidder services and notifications. | Link/import path first. A documented public discovery API and license for bulk republication were not established here. |
| Caltrans A&E advertisements | Official shortlist of architecture/engineering advertisements with event references and SOQ deadlines. | Useful planning/engineering channel; Caltrans itself warns its list may be incomplete and points to Cal eProcure. |
| Individual buyer pages, illustrated by SFCTA | Local transportation procurement notices, documents and buyer-specific instructions. | Curated source registry with maintained connectors and manual intake. A federal/state feed cannot replace these. |
| Award/procurement expenditure datasets | Historical procurement analysis and supplier intelligence. | Do not label recorded contracts, noncompetitive approvals or purchase orders as live solicitations. |

The [GSA public Opportunities API documentation](https://open.gsa.gov/api/get-opportunities-public-api/) specifies `https://api.sam.gov/opportunities/v2/search`, an API key, role-dependent daily limits, pagination and posted-date windows no longer than one year. It describes latest active notice versions, daily active and weekly archived refresh, and directs historical-version users to SAM Data Services. Documented parameters cover procurement types, deadlines, NAICS and classification. The status parameter is marked “Coming Soon” in the current parameter table; live active/inactive filtering was not verified and must not be assumed available. Responses include notice identity, award information, UI/description links and `resourceLinks` for attachments. The page contains legacy examples and an older embedded specification, so the current endpoint and response contract require live verification before implementation. I did not exercise a key, establish this account's quota, measure completeness or download a complete notice history.

[SAM's production Terms of Use](https://sam.gov/about/terms-of-use) distinguish public APIs from sensitive/FOUO responses and prohibit redistributing sensitive responses outside their authorized context. The adapter should ingest public data only. “Publicly accessible” does not establish permission to republish every attached third-party work without restrictions. Record source terms and attachment access conditions. Never put API keys, signed URLs or private contact data into public exports or logs.

[DGS's Cal eProcure overview](https://www.dgs.ca.gov/PD/Resources/Page-Content/Procurement-Division-Resources-List-Folder/Cal-eProcure-Portal-to-Access-Bid-Opportunities?search=NCB+portal) distinguishes CSCR advertising from other portal services such as contract records and certification. Its [business guide](https://www.dgs.ca.gov/PD/Resources/Page-Content/Procurement-Division-Resources-List-Folder/How-to-do-business-with-the-state-of-California) describes bidder registration, UNSPSC-based notifications and vendor advertisements. These are discovery aids, not proof of eligibility or successful bidding. Some direct DGS fetches failed; search-indexed primary pages were available. A newer March 2026 brochure was located but its direct PDF fetch failed, so this report does not claim a full current brochure review or an automated Cal eProcure API.

[Caltrans' A&E advertisements page](https://dot.ca.gov/programs/procurement-and-contracts/ae-contract-information/a-e-advertisements) explicitly directs users to Cal eProcure for the most current information and warns that its own list may be incomplete. [SFCTA's procurement page](https://www.sfcta.org/about-us/work-with-us) supplies a local source and notification route. A dated [SFCTA 2025 pre-proposal presentation](https://www.sfcta.org/sites/default/files/2025-11/RFP%202526-02%20Pre-Proposal%20Conference_Final.pdf) instructed electronic proposals by email. It is an example of buyer-specific submission, not a current open opportunity or a rule for all SFCTA procurements.

National v1 coverage needs a maintained registry across all states/DC and the relevant local agencies, with explicit coverage, source owner, refresh method and limitations. This bounded study verifies federal and California starting points only. No national-completeness claim is supported.

## Discovery needs notice history and conservative status mapping

The following are proposed product rules, not claims about every source's schema.

Use source system plus source notice ID as identity. Preserve solicitation number, issuing organization, original notice type, published/modified timestamps, retrieval time, source link and raw public snapshot. Link related notices without assuming an identical title or solicitation number means the same procurement. A planning study can have a sources-sought notice, draft solicitation, final RFP, several amendments, cancellation and reissue.

Keep an explicit source state and a normalized state. An RFI, presolicitation, special notice or award announcement is not automatically open for a proposal. Archived, cancelled, closed to responses and awarded are different conditions. Missing deadline, ambiguous timezone, failed refresh or disappeared search result must remain unresolved. A solicitation may use “RFQ” for qualifications rather than quotation; derive meaning from its instructions and selection method, never from the acronym alone.

Refresh known notices as well as new posted-date windows. Otherwise a late amendment to an older notice can evade an incremental search. Use overlapping windows, durable pagination checkpoints, duplicate detection and periodic reconciliation. Retry within source limits and record whether a search completed. A successful first page is not a complete sync. Keep correction/amendment history and notify the consultant which requirement, deadline, attachment or response channel changed.

For documents, preserve source metadata, retrieval outcome, byte hash and version. A filename can stay unchanged while its content changes. Missing or access-controlled attachments must be visible as missing, with a lawful manual retrieval path; never bypass access controls. Do not execute embedded content or treat instructions inside an attachment as authority to contact people, disclose private records or run commands. Imported documents are source material for a human-reviewed requirements checklist.

Search should combine consultant-selected geography, agency, service types, keywords and source classifications. Show why a notice matched and permit exclusion/correction. A relevance score cannot certify that the firm has every required license, certification, team member or capacity. Avoid discarding all notices with missing NAICS or ambiguous place-of-performance fields.

## The consultant and agency are different trust domains

An imported public solicitation can be shared reference material. A consultant's bid/no-bid notes, pricing, teaming, staff availability, draft response and credentials remain private to that consultant. An agency operating OpenPlan must not see those drafts just because its public RFP is the linked source. Likewise, a consultant cannot see another bidder's submission, reviewer notes or unreleased evaluation.

Recommended minimum boundaries:

- Buyer organization, bidder organization and delegated consultant/subconsultant membership are explicit. Roles have scoped authority, expiry and auditable changes.
- Proposal drafts and reusable qualifications stay in the consultant's workspace. Submission copies only a reviewed package through an authorized channel.
- Agency response intake preserves original bytes, receipt time, submitter, solicitation/version and any authorized replacement/withdrawal. The buyer's configured process governs when evaluators can access responses.
- Fee proposals can require separate access from technical qualifications. Neither a familiar ERP quotation screen nor ordinary workspace membership proves this separation.
- Publication/export uses an explicit reviewed projection. Private fee build-ups, personal credentials and procurement-sensitive evaluation material cannot leak through search, AI retrieval, document previews or evidence bundles.
- AI may suggest matches, extract source-bound requirements and draft from verified firm material. It cannot invent past performance, certify eligibility, make a bid/no-bid commitment or submit under an assumed authority.

## Prepared, transmitted and received are separate outcomes

GSA's [Opportunity Management API](https://open.gsa.gov/api/opportunities-api/) addresses authorized opportunity-data management. Its documented creation permissions concern federal government system accounts. It must not be advertised as a universal API for consultants to submit proposals.

For external portals, OpenPlan should initially prepare a package, identify the exact recipient/system and guide the authorized person through submission. Store the exported package manifest and the external confirmation afterward. Upload completion, an email in Sent, a local “submitted” checkbox or a browser click is not proof that the buyer received a valid response by its deadline.

Use states such as prepared, authorized for transmission, transmission attempted, receipt unconfirmed, externally acknowledged, rejected, withdrawn and superseded. A receipt should bind the actual package/version and the external submission identifier/time where available. Where only human confirmation is available, label it as such and attach the supporting record. Do not fabricate a machine-verifiable receipt. An acknowledgement establishes receipt, not responsiveness, evaluator acceptance or contract award.

When OpenPlan itself is the buyer's authorized intake system, it must issue a durable receipt after the complete package is committed, enforce the configured closing time and preserve replacement/withdrawal history. Interrupted uploads, retries and storage failure require explicit incomplete states. Legal rules for late responses, opening and retention belong to the buyer's applicable process and the parallel agency-rule research.

## Reuse evaluation

| Candidate | Primary evidence | Decision for this lane |
|---|---|---|
| OCDS | [Official primer](https://standard.open-contracting.org/latest/en/primer/how/) models tender, award, contract and implementation with an OCID and JSON Schema. | Reuse terminology, stable publication identity and validated exports/imports where useful. It publishes procurement records; it does not provide authentication, sealed intake, evaluation or payment execution. |
| OCDS publication practices | [Publication guidance](https://standard.open-contracting.org/latest/en/guidance/publish/) calls for scope, frequency, source, format and license disclosures. | Publish approved public records with coverage and license metadata. Do not make internal confidentiality depend on removing a few fields at the last minute. |
| ERPNext | [RFQ documentation](https://docs.frappe.io/erpnext/request-for-quotation) describes item/supplier quotations and portal responses creating draft supplier quotations for buyer review. [Repository](https://github.com/frappe/erpnext) uses Frappe and identifies GPL-3.0 licensing. | Useful workflow reference or optional integration where an agency already uses it. Insufficient evidence for US planning qualification selection, sealed fee handling or agency-specific evaluation. Avoid a required second ERP stack. |
| OpenProcurement | [Official documentation index](https://openprocurement.io/en/documentation) describes ProZorro, sale and MTender procedures; [API repository](https://github.com/openprocurement/openprocurement.api) exposes a tender database to brokers/public. [License](https://github.com/openprocurement/openprocurement.api/blob/master/LICENSE.txt) is Apache-2.0. | Examine bounded concepts only if a concrete gap warrants it. International procedure-specific components and a broker architecture are substantial adaptation work. No maintenance/security/runtime suitability audit was performed. |

OpenPlan's local [LICENSE](/home/nathaniel/code/openplan/LICENSE) is Apache-2.0. ERPNext's [license](https://github.com/frappe/erpnext/blob/develop/license.txt) must be assessed before any source incorporation; this review does not establish compatibility for a proposed derivative. Prefer original implementation against documented interfaces or a separately evaluated integration. Apache licensing on one OpenProcurement repository does not license all related modules, dependencies or published data automatically. Pin exact upstream versions and inspect component licenses before any transfer. No source code was copied.

Local file inventory found `openplan/src/lib/grants/proposal-template.ts`, which root's code review should assess as an existing extension point. This task did not repeat the full opportunity/proposal audit or browse unrelated personal documents. No compelling local alternative was established in the bounded inventory.

## Recommended sequence and concrete acceptance

1. Extend the existing opportunity/pursuit records with public-source provenance, notice revisions, a requirements checklist and private consultant workspace. Ship manual official-link/document intake alongside one verified SAM public adapter. A missing key must leave the manual workflow usable.
2. Preserve package/version identity, human authorization and external receipt evidence. Support buyer-specific export without claiming unsupported automated submission.
3. Add OpenPlan-hosted agency solicitation/response administration with tested organization isolation, authorized intake receipts, amendment communication and controlled evaluation. Reuse the eventual awarded contract, tasks, staffing, deliverables and budget baseline rather than re-entering the proposal scope.
4. Add reviewed OCDS publication and further source adapters against an explicit all-states/DC coverage queue. This sequence does not reduce nationwide v1 scope or make agency-side procurement optional.

Acceptance needs a planner/consultant pursuit lead and an agency procurement officer to independently walk one professional-services RFP and one qualifications RFQ, including an amendment and an unsuccessful/withdrawn response. Use a historical real solicitation or an explicitly labeled test solicitation; do not send an unsolicited live bid as a test.

Adversarial cases must include paginated source failure, expired key, duplicate/reissued notice, cancelled solicitation still present in cache, deadline amendment with a changed timezone, inaccessible attachment, same filename/new bytes, unsupported notice type, deleted staff permission, cross-bidder document access, fee disclosure before authorized opening, incomplete upload at closing time, duplicate submit retry, replacement after receipt, external transmission without acknowledgement and an export accidentally containing private notes. A published award notice must not mark a consultant's draft as awarded. All failures must remain visible.

For every changed guard, prove a no-op survives and a targeted regression fails. Future live UI acceptance requires identified checkout, desktop/390px, keyboard use, console capture and receipt evidence. This research executed none of those checks.

## Operating limits and remaining evidence

The base product must work locally without paid aggregation, paid model inference or a commercial procurement platform. Optional public APIs can require agency/user-managed credentials; keep them server-side with redacted logs. Discovery needs scheduled refresh, quota/backoff handling, health reporting and an operator-readable coverage status. Attachments, revisions and receipts need bounded/resumable downloads, storage planning and restore tests. Search can work without AI; any external model use requires explicit data-egress configuration.

No numerical hosting-cost or refresh-completeness promise is supported by this review. Measure source request volume, attachment growth and recovery cost with representative authorized workloads. Agency-hosted bid intake has stronger uptime and deadline-custody needs than a consultant's local research notebook. Separate the operational commitments and test them before production reliance.

Still unresolved: Cal eProcure's supported machine interfaces and bulk-reuse conditions; per-source attachment rights; this deployment's SAM quota and observed payload behavior; complete state/local coverage; exact external submission integrations; and chosen open-source component maintenance/security. These require bounded follow-up before implementation claims, not a claim that a generic procurement package already solves the whole planning workflow.
