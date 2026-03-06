# LAPM Source Citation Index (Draft v0.2)

Date: 2026-03-05 (PT)  
Owner: Priya (GIS)  
Source template: `docs/ops/templates/ca_stage_gates_v0.2_draft.json`  
Status: Draft placeholder index for planning/legal completion

## 1) Scope and usage

This index is the citation-control companion to `ca_stage_gates_v0.2_draft.json`.
It is intentionally unresolved (`PENDING_REVIEW`) until planning/legal/principal review.

No legal conclusions are asserted in this draft.

---

## 2) Source-trace schema (matched to v0.2 draft fields)

### 2.1 Minimum required fields (`lapm_id_schema.required_fields`)
1. `lapm_chapter_id`
2. `lapm_exhibit_or_form_id`
3. `lapm_revision_date`
4. `source_url`
5. `planning_review`
6. `legal_review`
7. `principal_signoff`

### 2.2 Full citation trace fields used in this index
- `gate_id`
- `gate_name`
- `evidence_id` (gate-level rows use `G##_GATE_REF` placeholder)
- `lapm_id_applicability`
- `lapm_chapter_id`
- `lapm_exhibit_or_form_id`
- `lapm_exhibit_or_form_title`
- `lapm_revision_date`
- `source_url`
- `office_bulletin_or_lpp_override`
- `planning_review`
- `legal_review`
- `principal_signoff`
- `notes`

---

## 3) Placeholder citation rows (all 9 gates)

| gate_id | gate_name | evidence_id | lapm_id_applicability | lapm_chapter_id | lapm_exhibit_or_form_id | lapm_exhibit_or_form_title | lapm_revision_date | source_url | office_bulletin_or_lpp_override | planning_review | legal_review | principal_signoff | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| G01_INITIATION_AUTHORIZATION | Initiation & Project Authorization | G01_GATE_REF | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | Gate-level chapter/catalog citation placeholder |
| G02_AGREEMENTS_PROCUREMENT_CIVIL_RIGHTS | Agreements, Procurement, and Civil Rights Setup | G02_GATE_REF | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | Gate-level chapter/catalog citation placeholder |
| G03_ENVIRONMENTAL_CEQA_VMT_METHOD | Environmental + CEQA VMT Method Gate | G03_GATE_REF | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | Gate-level chapter/catalog citation placeholder |
| G04_OUTREACH_PUBLIC_HEARING | Outreach + Public Hearing Documentation Gate | G04_GATE_REF | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | Gate-level chapter/catalog citation placeholder |
| G05_PLANNING_TO_PROGRAMMING_STIP_RTIP | Planning-to-Programming (RTIP/STIP) Gate | G05_GATE_REF | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | Gate-level chapter/catalog citation placeholder |
| G06_DESIGN_PSE_ROW_UTILITIES_COST | Design/PS&E + ROW/Utilities + Cost Documentation Gate | G06_GATE_REF | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | Gate-level chapter/catalog citation placeholder |
| G07_ADVERTISE_AWARD | Advertise & Award Gate | G07_GATE_REF | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | Gate-level chapter/catalog citation placeholder |
| G08_CONSTRUCTION_ADMINISTRATION | Construction Administration Gate | G08_GATE_REF | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | Gate-level chapter/catalog citation placeholder |
| G09_COMPLETION_MAINTENANCE_AUDIT | Completion, Maintenance, Audit/Corrective Action Gate | G09_GATE_REF | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | Gate-level chapter/catalog citation placeholder |

---

## 4) Evidence-level extension template (repeat rows as needed)

| gate_id | evidence_id | evidence_title | lapm_id_applicability | lapm_chapter_id | lapm_exhibit_or_form_id | lapm_exhibit_or_form_title | lapm_revision_date | source_url | office_bulletin_or_lpp_override | planning_review | legal_review | principal_signoff | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| G##_... | G##_E## | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW | PENDING_REVIEW |

---

## 5) Reviewer notes / unresolved items

- Legal source hierarchy for LAPM vs Office Bulletins/LPP is `PENDING_REVIEW`.
- Acceptable handling for evidence rows without direct form IDs is `PENDING_REVIEW`.
- Signature and timestamp conventions for `planning_review` / `legal_review` / `principal_signoff` are `PENDING_REVIEW`.
