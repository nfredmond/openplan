# CA Stage-Gate LAPM v0.2 Review Pack (Compliance-Ready Handoff)

Date: 2026-03-05 (PT)  
Owner: Priya (GIS)  
Branch: `ship/phase1-core`  
Status: Draft for planning/legal/principal review (non-runtime)

## 1) Directive lock + non-blocking posture

Approved directives carried into this pack:
1. Interim CA template binding proceeds now via current bootstrap path.
2. Exact LAPM exhibit/form IDs are deferred to v0.2 pending planning/legal QA.

Enforcement posture with this package:
- `ca_stage_gates_v0_1` remains the active enforcement template for current operations.
- `ca_stage_gates_v0_2_draft` is documentation/template scaffolding only until formal signoff.
- No runtime behavior is changed by this pack.

Reference alignment set:
- `docs/ops/2026-03-05-openplan-blueprint-requirements-lock.md`
- `docs/ops/2026-03-05-blueprint-module-to-epic-map.md` (OP-003 scope)
- `docs/ops/2026-03-05-california-stage-gate-template-pack.md`
- `docs/ops/templates/ca_stage_gates_v0.1.json` (baseline scaffold)

## 2) Proposed LAPM ID insertion points by gate/evidence item

### 2.1 Gate-level insertion points (chapter + catalog references)

| Gate | Gate name | Chapter ID insertion path | Exhibit catalog insertion path |
|---|---|---|---|
| G01_INITIATION_AUTHORIZATION | Initiation & Project Authorization | `/gates/0/lapm_reference/lapm_chapter_id` | `/gates/0/lapm_reference/lapm_form_or_exhibit_catalog_refs/0` |
| G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS | Agreements, Procurement, and Civil Rights Setup | `/gates/1/lapm_reference/lapm_chapter_id` | `/gates/1/lapm_reference/lapm_form_or_exhibit_catalog_refs/0` |
| G03_ENVIRONMENTAL_CEQA_VMT_METHOD | Environmental + CEQA VMT Method Gate | `/gates/2/lapm_reference/lapm_chapter_id` | `/gates/2/lapm_reference/lapm_form_or_exhibit_catalog_refs/0` |
| G04_OUTREACH_PUBLIC_HEARING | Outreach + Public Hearing Documentation Gate | `/gates/3/lapm_reference/lapm_chapter_id` | `/gates/3/lapm_reference/lapm_form_or_exhibit_catalog_refs/0` |
| G05_PLANNING_TO_PROGRAMMING_STIP_RTIP | Planning-to-Programming (RTIP/STIP) Gate | `/gates/4/lapm_reference/lapm_chapter_id` | `/gates/4/lapm_reference/lapm_form_or_exhibit_catalog_refs/0` |
| G06_DESIGN_PSE_ROW_UTILITIES_COST | Design/PS&E + ROW/Utilities + Cost Documentation Gate | `/gates/5/lapm_reference/lapm_chapter_id` | `/gates/5/lapm_reference/lapm_form_or_exhibit_catalog_refs/0` |
| G07_ADVERTISE_AWARD | Advertise & Award Gate | `/gates/6/lapm_reference/lapm_chapter_id` | `/gates/6/lapm_reference/lapm_form_or_exhibit_catalog_refs/0` |
| G08_CONSTRUCTION_ADMINISTRATION | Construction Administration Gate | `/gates/7/lapm_reference/lapm_chapter_id` | `/gates/7/lapm_reference/lapm_form_or_exhibit_catalog_refs/0` |
| G09_COMPLETION_MAINTENANCE_AUDIT | Completion, Maintenance, Audit/Corrective Action Gate | `/gates/8/lapm_reference/lapm_chapter_id` | `/gates/8/lapm_reference/lapm_form_or_exhibit_catalog_refs/0` |

### 2.2 Evidence-level insertion points (exact exhibit/form IDs)

All evidence-level fields below are intentionally initialized as `PENDING_REVIEW` in `ca_stage_gates_v0.2_draft.json`.

| Gate | Evidence ID | Evidence item | Chapter ID path | Exhibit/Form ID path | Revision date path | Source URL path |
|---|---|---|---|---|---|---|
| G01_INITIATION_AUTHORIZATION | G01_E01 | Project charter and scope baseline | `/gates/0/required_evidence/0/lapm_reference/lapm_chapter_id` | `/gates/0/required_evidence/0/lapm_reference/lapm_exhibit_or_form_id` | `/gates/0/required_evidence/0/lapm_reference/lapm_revision_date` | `/gates/0/required_evidence/0/lapm_reference/source_url` |
| G01_INITIATION_AUTHORIZATION | G01_E02 | LAPM authorization checklist packet | `/gates/0/required_evidence/1/lapm_reference/lapm_chapter_id` | `/gates/0/required_evidence/1/lapm_reference/lapm_exhibit_or_form_id` | `/gates/0/required_evidence/1/lapm_reference/lapm_revision_date` | `/gates/0/required_evidence/1/lapm_reference/source_url` |
| G01_INITIATION_AUTHORIZATION | G01_E03 | Funding/program intent register (STIP/RTIP flag + cycle) | `/gates/0/required_evidence/2/lapm_reference/lapm_chapter_id` | `/gates/0/required_evidence/2/lapm_reference/lapm_exhibit_or_form_id` | `/gates/0/required_evidence/2/lapm_reference/lapm_revision_date` | `/gates/0/required_evidence/2/lapm_reference/source_url` |
| G01_INITIATION_AUTHORIZATION | G01_E04 | Compliance role assignment record | `/gates/0/required_evidence/3/lapm_reference/lapm_chapter_id` | `/gates/0/required_evidence/3/lapm_reference/lapm_exhibit_or_form_id` | `/gates/0/required_evidence/3/lapm_reference/lapm_revision_date` | `/gates/0/required_evidence/3/lapm_reference/source_url` |
| G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS | G02_E01 | Agreement/execution tracker | `/gates/1/required_evidence/0/lapm_reference/lapm_chapter_id` | `/gates/1/required_evidence/0/lapm_reference/lapm_exhibit_or_form_id` | `/gates/1/required_evidence/0/lapm_reference/lapm_revision_date` | `/gates/1/required_evidence/0/lapm_reference/source_url` |
| G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS | G02_E02 | Consultant selection package (if consultant delivery path) | `/gates/1/required_evidence/1/lapm_reference/lapm_chapter_id` | `/gates/1/required_evidence/1/lapm_reference/lapm_exhibit_or_form_id` | `/gates/1/required_evidence/1/lapm_reference/lapm_revision_date` | `/gates/1/required_evidence/1/lapm_reference/source_url` |
| G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS | G02_E03 | Civil rights/DBE/ADA/Title VI compliance plan | `/gates/1/required_evidence/2/lapm_reference/lapm_chapter_id` | `/gates/1/required_evidence/2/lapm_reference/lapm_exhibit_or_form_id` | `/gates/1/required_evidence/2/lapm_reference/lapm_revision_date` | `/gates/1/required_evidence/2/lapm_reference/source_url` |
| G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS | G02_E04 | Invoicing controls and eligible cost protocol | `/gates/1/required_evidence/3/lapm_reference/lapm_chapter_id` | `/gates/1/required_evidence/3/lapm_reference/lapm_exhibit_or_form_id` | `/gates/1/required_evidence/3/lapm_reference/lapm_revision_date` | `/gates/1/required_evidence/3/lapm_reference/source_url` |
| G03_ENVIRONMENTAL_CEQA_VMT_METHOD | G03_E01 | CEQA transportation approach memo (§15064.3) | `/gates/2/required_evidence/0/lapm_reference/lapm_chapter_id` | `/gates/2/required_evidence/0/lapm_reference/lapm_exhibit_or_form_id` | `/gates/2/required_evidence/0/lapm_reference/lapm_revision_date` | `/gates/2/required_evidence/0/lapm_reference/source_url` |
| G03_ENVIRONMENTAL_CEQA_VMT_METHOD | G03_E02 | VMT method declaration and assumptions register | `/gates/2/required_evidence/1/lapm_reference/lapm_chapter_id` | `/gates/2/required_evidence/1/lapm_reference/lapm_exhibit_or_form_id` | `/gates/2/required_evidence/1/lapm_reference/lapm_revision_date` | `/gates/2/required_evidence/1/lapm_reference/source_url` |
| G03_ENVIRONMENTAL_CEQA_VMT_METHOD | G03_E03 | LOS/delay carve-out determination note | `/gates/2/required_evidence/2/lapm_reference/lapm_chapter_id` | `/gates/2/required_evidence/2/lapm_reference/lapm_exhibit_or_form_id` | `/gates/2/required_evidence/2/lapm_reference/lapm_revision_date` | `/gates/2/required_evidence/2/lapm_reference/source_url` |
| G03_ENVIRONMENTAL_CEQA_VMT_METHOD | G03_E04 | SHS induced-travel method note (conditional if SHS=true) | `/gates/2/required_evidence/3/lapm_reference/lapm_chapter_id` | `/gates/2/required_evidence/3/lapm_reference/lapm_exhibit_or_form_id` | `/gates/2/required_evidence/3/lapm_reference/lapm_revision_date` | `/gates/2/required_evidence/3/lapm_reference/source_url` |
| G04_OUTREACH_PUBLIC_HEARING | G04_E01 | Outreach strategy and schedule | `/gates/3/required_evidence/0/lapm_reference/lapm_chapter_id` | `/gates/3/required_evidence/0/lapm_reference/lapm_exhibit_or_form_id` | `/gates/3/required_evidence/0/lapm_reference/lapm_revision_date` | `/gates/3/required_evidence/0/lapm_reference/source_url` |
| G04_OUTREACH_PUBLIC_HEARING | G04_E02 | Engagement activity log | `/gates/3/required_evidence/1/lapm_reference/lapm_chapter_id` | `/gates/3/required_evidence/1/lapm_reference/lapm_exhibit_or_form_id` | `/gates/3/required_evidence/1/lapm_reference/lapm_revision_date` | `/gates/3/required_evidence/1/lapm_reference/source_url` |
| G04_OUTREACH_PUBLIC_HEARING | G04_E03 | Comment-response matrix | `/gates/3/required_evidence/2/lapm_reference/lapm_chapter_id` | `/gates/3/required_evidence/2/lapm_reference/lapm_exhibit_or_form_id` | `/gates/3/required_evidence/2/lapm_reference/lapm_revision_date` | `/gates/3/required_evidence/2/lapm_reference/source_url` |
| G04_OUTREACH_PUBLIC_HEARING | G04_E04 | Public hearing notice/package/record | `/gates/3/required_evidence/3/lapm_reference/lapm_chapter_id` | `/gates/3/required_evidence/3/lapm_reference/lapm_exhibit_or_form_id` | `/gates/3/required_evidence/3/lapm_reference/lapm_revision_date` | `/gates/3/required_evidence/3/lapm_reference/source_url` |
| G05_PLANNING_TO_PROGRAMMING_STIP_RTIP | G05_E01 | RTP/scenario linkage memo | `/gates/4/required_evidence/0/lapm_reference/lapm_chapter_id` | `/gates/4/required_evidence/0/lapm_reference/lapm_exhibit_or_form_id` | `/gates/4/required_evidence/0/lapm_reference/lapm_revision_date` | `/gates/4/required_evidence/0/lapm_reference/source_url` |
| G05_PLANNING_TO_PROGRAMMING_STIP_RTIP | G05_E02 | Programming narrative completeness sheet | `/gates/4/required_evidence/1/lapm_reference/lapm_chapter_id` | `/gates/4/required_evidence/1/lapm_reference/lapm_exhibit_or_form_id` | `/gates/4/required_evidence/1/lapm_reference/lapm_revision_date` | `/gates/4/required_evidence/1/lapm_reference/source_url` |
| G05_PLANNING_TO_PROGRAMMING_STIP_RTIP | G05_E03 | STIP/RTIP schedule checklist | `/gates/4/required_evidence/2/lapm_reference/lapm_chapter_id` | `/gates/4/required_evidence/2/lapm_reference/lapm_exhibit_or_form_id` | `/gates/4/required_evidence/2/lapm_reference/lapm_revision_date` | `/gates/4/required_evidence/2/lapm_reference/source_url` |
| G05_PLANNING_TO_PROGRAMMING_STIP_RTIP | G05_E04 | Complete Streets consideration statement | `/gates/4/required_evidence/3/lapm_reference/lapm_chapter_id` | `/gates/4/required_evidence/3/lapm_reference/lapm_exhibit_or_form_id` | `/gates/4/required_evidence/3/lapm_reference/lapm_revision_date` | `/gates/4/required_evidence/3/lapm_reference/source_url` |
| G06_DESIGN_PSE_ROW_UTILITIES_COST | G06_E01 | Design basis + PS&E readiness checklist | `/gates/5/required_evidence/0/lapm_reference/lapm_chapter_id` | `/gates/5/required_evidence/0/lapm_reference/lapm_exhibit_or_form_id` | `/gates/5/required_evidence/0/lapm_reference/lapm_revision_date` | `/gates/5/required_evidence/0/lapm_reference/source_url` |
| G06_DESIGN_PSE_ROW_UTILITIES_COST | G06_E02 | ROW status/certification artifact | `/gates/5/required_evidence/1/lapm_reference/lapm_chapter_id` | `/gates/5/required_evidence/1/lapm_reference/lapm_exhibit_or_form_id` | `/gates/5/required_evidence/1/lapm_reference/lapm_revision_date` | `/gates/5/required_evidence/1/lapm_reference/source_url` |
| G06_DESIGN_PSE_ROW_UTILITIES_COST | G06_E03 | Utility relocation coordination log | `/gates/5/required_evidence/2/lapm_reference/lapm_chapter_id` | `/gates/5/required_evidence/2/lapm_reference/lapm_exhibit_or_form_id` | `/gates/5/required_evidence/2/lapm_reference/lapm_revision_date` | `/gates/5/required_evidence/2/lapm_reference/source_url` |
| G06_DESIGN_PSE_ROW_UTILITIES_COST | G06_E04 | Cost/invoicing update + field review disposition | `/gates/5/required_evidence/3/lapm_reference/lapm_chapter_id` | `/gates/5/required_evidence/3/lapm_reference/lapm_exhibit_or_form_id` | `/gates/5/required_evidence/3/lapm_reference/lapm_revision_date` | `/gates/5/required_evidence/3/lapm_reference/source_url` |
| G07_ADVERTISE_AWARD | G07_E01 | Advertisement/bid package archive | `/gates/6/required_evidence/0/lapm_reference/lapm_chapter_id` | `/gates/6/required_evidence/0/lapm_reference/lapm_exhibit_or_form_id` | `/gates/6/required_evidence/0/lapm_reference/lapm_revision_date` | `/gates/6/required_evidence/0/lapm_reference/source_url` |
| G07_ADVERTISE_AWARD | G07_E02 | Bid analysis and award recommendation | `/gates/6/required_evidence/1/lapm_reference/lapm_chapter_id` | `/gates/6/required_evidence/1/lapm_reference/lapm_exhibit_or_form_id` | `/gates/6/required_evidence/1/lapm_reference/lapm_revision_date` | `/gates/6/required_evidence/1/lapm_reference/source_url` |
| G07_ADVERTISE_AWARD | G07_E03 | DBE/civil-rights award-stage confirmation | `/gates/6/required_evidence/2/lapm_reference/lapm_chapter_id` | `/gates/6/required_evidence/2/lapm_reference/lapm_exhibit_or_form_id` | `/gates/6/required_evidence/2/lapm_reference/lapm_revision_date` | `/gates/6/required_evidence/2/lapm_reference/source_url` |
| G07_ADVERTISE_AWARD | G07_E04 | Pre-construction compliance kickoff minutes | `/gates/6/required_evidence/3/lapm_reference/lapm_chapter_id` | `/gates/6/required_evidence/3/lapm_reference/lapm_exhibit_or_form_id` | `/gates/6/required_evidence/3/lapm_reference/lapm_revision_date` | `/gates/6/required_evidence/3/lapm_reference/source_url` |
| G08_CONSTRUCTION_ADMINISTRATION | G08_E01 | Daily reports + progress payment records | `/gates/7/required_evidence/0/lapm_reference/lapm_chapter_id` | `/gates/7/required_evidence/0/lapm_reference/lapm_exhibit_or_form_id` | `/gates/7/required_evidence/0/lapm_reference/lapm_revision_date` | `/gates/7/required_evidence/0/lapm_reference/source_url` |
| G08_CONSTRUCTION_ADMINISTRATION | G08_E02 | Change-order register + rationale | `/gates/7/required_evidence/1/lapm_reference/lapm_chapter_id` | `/gates/7/required_evidence/1/lapm_reference/lapm_exhibit_or_form_id` | `/gates/7/required_evidence/1/lapm_reference/lapm_revision_date` | `/gates/7/required_evidence/1/lapm_reference/source_url` |
| G08_CONSTRUCTION_ADMINISTRATION | G08_E03 | Claims/disputes tracker | `/gates/7/required_evidence/2/lapm_reference/lapm_chapter_id` | `/gates/7/required_evidence/2/lapm_reference/lapm_exhibit_or_form_id` | `/gates/7/required_evidence/2/lapm_reference/lapm_revision_date` | `/gates/7/required_evidence/2/lapm_reference/source_url` |
| G08_CONSTRUCTION_ADMINISTRATION | G08_E04 | Construction impact outreach log | `/gates/7/required_evidence/3/lapm_reference/lapm_chapter_id` | `/gates/7/required_evidence/3/lapm_reference/lapm_exhibit_or_form_id` | `/gates/7/required_evidence/3/lapm_reference/lapm_revision_date` | `/gates/7/required_evidence/3/lapm_reference/source_url` |
| G09_COMPLETION_MAINTENANCE_AUDIT | G09_E01 | Completion/closeout report + as-built archive index | `/gates/8/required_evidence/0/lapm_reference/lapm_chapter_id` | `/gates/8/required_evidence/0/lapm_reference/lapm_exhibit_or_form_id` | `/gates/8/required_evidence/0/lapm_reference/lapm_revision_date` | `/gates/8/required_evidence/0/lapm_reference/source_url` |
| G09_COMPLETION_MAINTENANCE_AUDIT | G09_E02 | Maintenance handoff record | `/gates/8/required_evidence/1/lapm_reference/lapm_chapter_id` | `/gates/8/required_evidence/1/lapm_reference/lapm_exhibit_or_form_id` | `/gates/8/required_evidence/1/lapm_reference/lapm_revision_date` | `/gates/8/required_evidence/1/lapm_reference/source_url` |
| G09_COMPLETION_MAINTENANCE_AUDIT | G09_E03 | Final invoicing and financial closeout package | `/gates/8/required_evidence/2/lapm_reference/lapm_chapter_id` | `/gates/8/required_evidence/2/lapm_reference/lapm_exhibit_or_form_id` | `/gates/8/required_evidence/2/lapm_reference/lapm_revision_date` | `/gates/8/required_evidence/2/lapm_reference/source_url` |
| G09_COMPLETION_MAINTENANCE_AUDIT | G09_E04 | Audit package and corrective-action tracker | `/gates/8/required_evidence/3/lapm_reference/lapm_chapter_id` | `/gates/8/required_evidence/3/lapm_reference/lapm_exhibit_or_form_id` | `/gates/8/required_evidence/3/lapm_reference/lapm_revision_date` | `/gates/8/required_evidence/3/lapm_reference/source_url` |
| G09_COMPLETION_MAINTENANCE_AUDIT | G09_E05 | Policy delta acknowledgement log (Office Bulletins/LPP) | `/gates/8/required_evidence/4/lapm_reference/lapm_chapter_id` | `/gates/8/required_evidence/4/lapm_reference/lapm_exhibit_or_form_id` | `/gates/8/required_evidence/4/lapm_reference/lapm_revision_date` | `/gates/8/required_evidence/4/lapm_reference/source_url` |

### 2.3 Required v0.2 LAPM fields (per evidence item)

Each required evidence item in v0.2 includes these structured fields to be populated during review:
- `lapm_reference.lapm_id_applicability`
- `lapm_reference.lapm_chapter_id`
- `lapm_reference.lapm_exhibit_or_form_id`
- `lapm_reference.lapm_exhibit_or_form_title`
- `lapm_reference.lapm_revision_date`
- `lapm_reference.source_url`
- `lapm_reference.office_bulletin_or_lpp_override`
- `lapm_reference.planning_review`
- `lapm_reference.legal_review`
- `lapm_reference.principal_signoff`

## 3) Review workflow (planning + legal + principal signoff)

### Stage A — Planning QA (content and workflow fit)
Owner: Planning lead (TBD)
- Confirm every gate/evidence item maps to the intended LAPM chapter workflow intent.
- Mark `lapm_id_applicability` for each evidence item (`required`, `optional`, `not_applicable`).
- Populate chapter IDs and draft exhibit/form IDs where known; leave unresolved values as `PENDING_REVIEW` with notes.
- Output artifact: planning-reviewed template draft + issue list of unresolved IDs.

### Stage B — Legal QA (citation validity and supersession control)
Owner: Legal reviewer (TBD)
- Verify cited exhibit/form IDs and titles against official LAPM forms/exhibits source pages and revision dates.
- Verify no Office Bulletin/LPP supersession invalidates selected IDs; if superseded, set `office_bulletin_or_lpp_override` and update references.
- Flag any language implying legal certainty and replace with approval-scoped wording.
- Output artifact: legal-approved ID matrix with exception notes.

### Stage C — Principal signoff (activation authorization)
Owner: Principal (TBD)
- Review unresolved exceptions from planning/legal stages.
- Approve risk posture for moving from scaffold IDs to exact IDs.
- Issue written PASS/HOLD decision for v0.2 activation readiness.
- Output artifact: dated principal decision memo referencing this pack + approved template hash.

### Stage D — Engineering implementation window (post-signoff only)
Owner: Engineering lead (TBD)
- Execute merge/wiring steps in Section 5 using principal-approved template only.
- Keep fallback path to v0.1 until production verification is complete.

## 4) PASS criteria to approve v0.2 LAPM ID activation

v0.2 is PASS-eligible only when all conditions are true:
1. **Field completeness:** no required evidence item has `lapm_exhibit_or_form_id = PENDING_REVIEW` when `lapm_id_applicability = required`.
2. **Source traceability:** each populated ID includes `source_url` + `lapm_revision_date`.
3. **Supersession control:** Office Bulletin/LPP review completed and reflected in override fields where applicable.
4. **Planning signoff:** `planning_review` marked approved on all required evidence rows.
5. **Legal signoff:** `legal_review` marked approved on all required evidence rows.
6. **Principal decision:** dated principal memo explicitly authorizes activation (PASS).
7. **Engineering readiness checks:** template parses cleanly and regression tests pass with v0.2 selected.
8. **Rollback safety:** documented fallback to `ca_stage_gates_v0_1` remains available at bootstrap selection.

If any condition fails -> **HOLD** (no v0.2 activation).

## 5) Engineering handoff (exact merge/wiring steps once approved)

1. **Freeze approved template artifact**
   - Update `docs/ops/templates/ca_stage_gates_v0.2_draft.json` with final approved IDs and review fields.
   - Rename/copy to runtime artifact:
     - `openplan/src/lib/stage-gates/templates/ca_stage_gates_v0.2.json`

2. **Register template in loader (non-default first)**
   - Update/create loader module: `openplan/src/lib/stage-gates/template-loader.ts`
   - Ensure `listTemplates()` returns both v0.1 and v0.2.
   - Keep default selector at `ca_stage_gates_v0_1` until explicit promotion decision.

3. **Wire bootstrap selector safely**
   - Extend `POST /api/workspaces/bootstrap` selection path to accept `stageGateTemplateId` (allowlist: v0.1, v0.2).
   - On invalid/missing value, hard fallback to `ca_stage_gates_v0_1`.

4. **Persist review metadata**
   - Ensure template storage/instance schema carries `lapm_reference.*` fields (chapter, form/exhibit ID, revision date, source URL, approval fields).
   - Preserve decision logging semantics (`PASS`/`HOLD`) from OP-003 baseline.

5. **Test gates before enablement**
   - Add/extend integration tests for bootstrap template selection + gate advance behavior with v0.2.
   - Required checks: `npm run lint`, `npm test`, `npm run build`, and stage-gate hold/pass regression test.

6. **Promote only after QA memo**
   - Attach principal/legal approval memo paths in release notes.
   - If production issues emerge, revert default/template selection to v0.1 immediately.

## 6) Summary of created files and open questions

### Created in this package
- `docs/ops/2026-03-05-ca-stage-gate-lapm-v02-review-pack.md` (this handoff + review workflow + activation criteria)
- `docs/ops/templates/ca_stage_gates_v0.2_draft.json` (structured LAPM ID placeholders set to `PENDING_REVIEW`)

### Open questions requiring principal/legal input
1. Which specific LAPM chapter numbering convention should be canonical in-template (chapter number only vs chapter + revision date token)?
2. For evidence items that may be chapter-governed but not tied to a single form, should `lapm_exhibit_or_form_id` allow `NOT_APPLICABLE_APPROVED` or remain required with a legal note?
3. What is the authoritative legal source priority when LAPM chapter text and recent Office Bulletin/LPP language diverge?
4. Does principal want v0.2 released first as opt-in (`stageGateTemplateId`) or promoted to bootstrap default immediately after approval?
5. What approval artifact format is required for audit (single memo vs signed checklist + memo bundle)?
