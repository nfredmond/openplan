# California Stage-Gate Template Pack (OP-003 Scaffold)

Date: 2026-03-05 (PT)  
Owner: Priya (GIS) for OP-003 scaffold handoff  
Status: Draft scaffold for engineering ingestion

## 1) Scope + alignment lock

This scaffold is aligned to the locked 2026-03-05 blueprint artifacts:

- `docs/ops/2026-03-05-openplan-blueprint-requirements-lock.md`
- `docs/ops/2026-03-05-blueprint-module-to-epic-map.md` (OP-003)
- `/home/nathaniel/.openclaw/workspace/openplan-blueprint.md` (Module C baseline and California compliance spine)

Design intent: provide a default California stage-gate sequence with evidence requirements that can block advance (PASS/HOLD), while mapping each gate to LAPM, STIP/RTIP, CEQA VMT, and outreach documentation expectations.

---

## 2) Default gate sequence (v0.1)

1. **G01 — Initiation & Project Authorization**
2. **G02 — Agreements, Procurement, and Civil Rights Setup**
3. **G03 — Environmental + CEQA VMT Method Gate**
4. **G04 — Outreach + Public Hearing Documentation Gate**
5. **G05 — Planning-to-Programming (RTIP/STIP) Gate**
6. **G06 — Design/PS&E + ROW/Utilities + Cost Documentation Gate**
7. **G07 — Advertise & Award Gate**
8. **G08 — Construction Administration Gate**
9. **G09 — Completion, Maintenance, Audit/Corrective Action Gate**

Gate progression rule (default): **cannot advance unless all required evidence items at current gate are approved**.

Decision states (default): **PASS** | **HOLD**.

---

## 3) Required evidence by gate

## G01 — Initiation & Project Authorization
Required evidence:
- Project charter + scope baseline (signed)
- LAPM authorization checklist packet (template-driven placeholder)
- Funding/program intent register (includes STIP/RTIP candidate flag + cycle year)
- Compliance role assignment (CEQA lead, outreach lead, civil-rights/DBE lead)

## G02 — Agreements, Procurement, and Civil Rights Setup
Required evidence:
- Agreement/execution tracker (draft-to-executed status)
- Consultant selection package (RFP/RFQ path, scoring, conflict-of-interest attestation)
- Civil rights/DBE/ADA/Title VI compliance plan + reporting calendar
- Invoicing controls plan (eligible cost categories + review cadence)

## G03 — Environmental + CEQA VMT Method Gate
Required evidence:
- CEQA transportation approach memo (explicit §15064.3 framing)
- VMT method declaration + assumptions/revisions register
- LOS/delay carve-out determination note (if applicable)
- SHS induced-travel path flag + method note (if SHS project)

## G04 — Outreach + Public Hearing Documentation Gate
Required evidence:
- Outreach strategy and schedule (audience, language access, ADA access)
- Engagement activity log (events, channels, participation summary)
- Comment-response matrix (acknowledged/incorporated/not-incorporated + rationale)
- Public hearing notice/package and hearing record artifacts

## G05 — Planning-to-Programming (RTIP/STIP) Gate
Required evidence:
- RTP/scenario linkage memo (project traced to plan/scenario rationale)
- Programming narrative completeness sheet (benefits, negative impacts, mitigations)
- STIP/RTIP schedule checklist (cycle milestones and submission windows)
- Complete Streets consideration statement (where applicable)

## G06 — Design/PS&E + ROW/Utilities + Cost Documentation Gate
Required evidence:
- Design basis + PS&E readiness checklist
- Right-of-way status/certification artifact
- Utility relocation coordination log
- Updated cost + invoicing draw schedule + field review dispositions

## G07 — Advertise & Award Gate
Required evidence:
- Advertisement/bid package archive
- Bid analysis + award recommendation memo
- DBE/civil-rights implementation confirmation for award stage
- Pre-construction compliance kickoff minutes

## G08 — Construction Administration Gate
Required evidence:
- Construction daily reports + progress payment records
- Change-order register + rationale + approvals
- Claims/disputes tracker with resolution status
- Construction-phase outreach impact log (if impacts to communities/users)

## G09 — Completion, Maintenance, Audit/Corrective Action Gate
Required evidence:
- Completion/closeout report + as-built archive index
- Maintenance handoff record
- Final invoicing/financial closeout package
- Audit package + corrective action tracker (if findings)
- Policy monitor acknowledgement record (Office Bulletin/LPP deltas reviewed)

---

## 4) Compliance mapping matrix (LAPM / STIP-RTIP / CEQA VMT / Outreach)

| Gate | LAPM expectation mapping | STIP/RTIP expectation mapping | CEQA VMT expectation mapping | Outreach documentation expectation |
|---|---|---|---|---|
| G01 | Project Authorization kickoff, foundational agreements setup | Programming intent captured early | Preliminary project-type/VMT relevance classification | Preliminary engagement strategy owner + timing assigned |
| G02 | Agreements, consultant selection, civil-rights/DBE administration, invoicing controls | Funding/program packaging inputs begin | CEQA lead and method ownership formally assigned | Outreach roles and equity/access commitments assigned |
| G03 | Environmental procedures gate before downstream advancement | Environmental readiness feeds programming credibility | §15064.3 workflow: VMT primary, method documented, assumptions/versioning captured, LOS carve-out evaluated | Outreach plan updated to support CEQA scoping/public understanding |
| G04 | Public hearings + field/public documentation progression | Robust engagement evidence starts accumulating for RTIP/ITIP narratives | Community input log can inform impact framing/mitigation narrative | Activities, feedback, responses, and mitigations documented in auditable format |
| G05 | Design/programming readiness evidence linked to delivery path | RTIP/STIP package completeness: activities, incorporation, benefits, negative impacts, mitigations; schedule milestones documented | Preferred alternative and VMT implications traceable to scenario rationale | Engagement outcomes explicitly tied to programming choices |
| G06 | Design guidance, PS&E, ROW, utility, invoicing controls, field review closure | Cost/scope/schedule reliability for program submissions | CEQA assumptions updated where design changes affect VMT findings | Any material scope impacts communicated and logged |
| G07 | Advertise & Award evidence and procurement compliance | Funding commitments tied to award readiness | CEQA commitments carried into bid/award package where applicable | Bid/award communication artifacts retained |
| G08 | Construction contract administration + payment/change governance | Programming commitments tracked during implementation | Mitigation/impact commitments traced during delivery | Construction impacts + public communication log maintained |
| G09 | Project completion, maintenance obligations, audits/corrective actions | End-of-cycle performance and closeout records support future cycles | Final CEQA/VMT narrative archive with revision history retained | Final outreach closeout record and lessons learned archived |

---

## 5) Evidence model conventions for OP-003

- Required evidence item states: `missing | uploaded | approved | rejected`
- Gate state: `not_started | in_progress | hold | pass`
- Decision record must persist:
  - gate id
  - decision (`PASS` / `HOLD`)
  - rationale text
  - decided by (user id)
  - decided at timestamp
  - evidence snapshot hash/list for audit traceability

Policy monitor convention (from blueprint lock):
- Track Office Bulletin/LPP changes as `policy_delta` records.
- If a delta supersedes template language, mark impacted evidence items `policy_review_required=true` until approved.

---

## 6) Implementation handoff (exact OP-003 wiring steps)

1. **Register template artifact for runtime use**
   - Source artifact: `docs/ops/templates/ca_stage_gates_v0.1.json`
   - Create runtime loader in OP-003 lane (suggested module path):
     - `openplan/src/lib/stage-gates/template-loader.ts`
     - `openplan/src/lib/stage-gates/templates/ca_stage_gates_v0.1.json` (copied/synced from docs artifact)
   - Loader must expose: `getTemplateById(id)` + `listTemplates()`.

2. **Persist template + instances in Supabase**
   - Add migration (OP-003):
     - `stage_gate_templates` (template metadata + JSON payload + default flag)
     - `project_stage_gate_instances` (project_id, gate_id, sequence, state)
     - `project_stage_gate_evidence` (instance_id, evidence_id, state, uri, metadata)
     - `project_stage_gate_decisions` (instance_id, decision, rationale, decided_by, decided_at)
   - Apply RLS mirroring existing workspace membership policies.

3. **Template selection at project creation**
   - On project create API (or current bootstrap path until projects API is live), add `stageGateTemplateId` input.
   - Default to `ca_stage_gates_v0_1` when not provided.
   - On create, instantiate ordered gate rows + required evidence rows from template.

4. **Gate-advance enforcement (PASS/HOLD)**
   - Add OP-003 gate action endpoint (e.g., `/api/projects/:id/stage-gates/:gateId/advance`).
   - Enforcement rule: block advance if any required evidence is `missing` or `rejected`.
   - Persist decision log row on every attempt (including HOLD).

5. **Queryable decision history**
   - Add read endpoint for timeline/history (e.g., `/api/projects/:id/stage-gates/history`).
   - Must return ordered gate decision history with rationale + evidence references for audit export.

6. **Acceptance test wiring to OP-003 criteria**
   - Add integration test to prove:
     - template selectable/defaulted at creation,
     - forced HOLD on missing evidence,
     - PASS after evidence upload/approval,
     - decision history query returns both HOLD and PASS events.
   - This directly satisfies OP-003 acceptance criterion #4 in `2026-03-05-blueprint-module-to-epic-map.md`.

---

## 7) Notes / assumptions

- This is a scaffold template pack, not legal advice.
- LAPM chapter references are represented as workflow expectations; engineering should attach exact exhibit/form identifiers in OP-003 implementation.
- Because project CRUD is not yet visible in current app surface, OP-003 should bind template selection to the first project-creation path that lands (or temporary workspace bootstrap if needed), then migrate to canonical project objects.
