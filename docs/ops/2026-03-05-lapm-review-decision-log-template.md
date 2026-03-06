# LAPM Review Decision Log Template (v0.2 Draft)

Date: 2026-03-05 (PT)  
Owner: Priya (GIS)  
Scope: `docs/ops/templates/ca_stage_gates_v0.2_draft.json`  
Status: Template (not legal advice; reviewer-owned determinations)

## 1) Purpose

Use this template to record planning/legal/principal decisions for LAPM mapping at:
- Gate level (`gates[*].lapm_reference`)
- Evidence level (`gates[*].required_evidence[*].lapm_reference`)

Decision states should align with current governance posture:
- Gate/evidence decision: `PASS` or `HOLD`
- Evidence state: `missing`, `uploaded`, `approved`, `rejected`

---

## 2) Header + Session Metadata

- Review session ID: `PENDING_REVIEW`
- Review date/time (PT): `PENDING_REVIEW`
- Project/workspace: `PENDING_REVIEW`
- Template version/hash reviewed: `PENDING_REVIEW`
- Planning reviewer: `PENDING_REVIEW`
- Legal reviewer: `PENDING_REVIEW`
- Principal reviewer: `PENDING_REVIEW`
- Notes recorder: `PENDING_REVIEW`

---

## 3) Per-Gate Decision Log (chapter/catalog scope)

| Gate ID | Gate name | lapm_chapter_id | lapm_chapter_title | lapm_form_or_exhibit_catalog_refs | office_bulletin_or_lpp_refs | Planning review status | Legal review status | Principal gate decision (PASS/HOLD) | Decision date | Rationale / notes |
|---|---|---|---|---|---|---|---|---|---|---|
| G01_INITIATION_AUTHORIZATION | Initiation & Project Authorization | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW |
| G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS | Agreements, Procurement, and Civil Rights Setup | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW |
| G03_ENVIRONMENTAL_CEQA_VMT_METHOD | Environmental + CEQA VMT Method Gate | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW |
| G04_OUTREACH_PUBLIC_HEARING | Outreach + Public Hearing Documentation Gate | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW |
| G05_PLANNING_TO_PROGRAMMING_STIP_RTIP | Planning-to-Programming (RTIP/STIP) Gate | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW |
| G06_DESIGN_PSE_ROW_UTILITIES_COST | Design/PS&E + ROW/Utilities + Cost Documentation Gate | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW |
| G07_ADVERTISE_AWARD | Advertise & Award Gate | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW |
| G08_CONSTRUCTION_ADMINISTRATION | Construction Administration Gate | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW |
| G09_COMPLETION_MAINTENANCE_AUDIT | Completion, Maintenance, Audit/Corrective Action Gate | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW |

---

## 4) Per-Evidence Decision Log (form/exhibit source trace)

> Copy one row per required evidence item from the v0.2 draft template.

| Gate ID | Evidence ID | Evidence title | lapm_id_applicability | lapm_chapter_id | lapm_exhibit_or_form_id | lapm_exhibit_or_form_title | lapm_revision_date | source_url | office_bulletin_or_lpp_override | Planning review (`planning_review`) | Legal review (`legal_review`) | Principal signoff (`principal_signoff`) | Evidence state | Decision (PASS/HOLD) | Reviewer notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| G##_... | G##_E## | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW |

---

## 5) Supersession / Office Bulletin-LPP Conflict Handling

Use this block whenever LAPM chapter/form references conflict with Office Bulletins or Local Programs Procedures (LPP) updates.

- Conflict record ID: `PENDING_REVIEW`
- Affected gate(s): `PENDING_REVIEW`
- Affected evidence ID(s): `PENDING_REVIEW`
- Original LAPM reference (chapter/form/revision): `PENDING_REVIEW`
- Conflicting bulletin/LPP citation (ID/title/date): `PENDING_REVIEW`
- Conflict type (supersession / ambiguity / timing gap): `PENDING_REVIEW`
- Interim handling decision (use old / use new / hold pending legal): `PENDING_REVIEW`
- `office_bulletin_or_lpp_override` value applied in template: `PENDING_REVIEW`
- Legal determination owner/date: `PENDING_REVIEW`
- Principal acceptance of risk posture (yes/no + date): `PENDING_REVIEW`
- Follow-up action + due date: `PENDING_REVIEW`

---

## 6) Principal + Legal Signoff Block

### Legal Signoff
- Reviewer name/title: `PENDING_REVIEW`
- Scope reviewed (all gates / exceptions listed): `PENDING_REVIEW`
- Legal status: `APPROVE` / `HOLD` / `APPROVE_WITH_EXCEPTIONS`
- Exceptions/conditions: `PENDING_REVIEW`
- Signature/date: `PENDING_REVIEW`

### Principal Signoff
- Principal name/title: `PENDING_REVIEW`
- Decision: `PASS` / `HOLD`
- Activation authorization for v0.2: `YES` / `NO`
- Conditions precedent (if any): `PENDING_REVIEW`
- Signature/date: `PENDING_REVIEW`

---

## 7) Final Decision Record

- Final disposition: `PASS` / `HOLD`
- Effective date (if PASS): `PENDING_REVIEW`
- Approved template artifact path/hash: `PENDING_REVIEW`
- Rollback instruction (if HOLD or post-activation issue): `revert to ca_stage_gates_v0_1`
- Archive location for signed packet: `PENDING_REVIEW`
