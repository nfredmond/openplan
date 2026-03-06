# OpenPlan Blueprint → Epic Map (Execution Packet)

Date: 2026-03-05 (PT)
Owner: Bartholomew (COO)
Status: ACTIVE
Source Blueprint: `/home/nathaniel/.openclaw/workspace/openplan-blueprint.md`

## Purpose
Convert blueprint modules (A–J) into executable epics with acceptance criteria and ship sequence.

## Phase 1 (Now): Reliability + Core Spine

### OP-001 — Identity, Tenancy, and Security Baseline (Module A)
**Scope:** org signup, invitations, role assignment, RBAC enforcement, tenant isolation, MFA-admin path, audit log events.

**Acceptance criteria:**
- Tenant data isolation enforced server-side and DB-side (RLS) for protected entities.
- Role matrix applied to API and UI actions with deny-by-default behavior.
- Audit log entries generated for auth, role, and critical config changes.
- Regression test: signup → tenant create → invite → role update passes.

### OP-002 — Project/Plan Operating System Core (Module B)
**Scope:** projects, plans, programs, tasks, deliverables, decisions, risks/issues, meetings; immutable event history.

**Acceptance criteria:**
- Core domain objects CRUD available through API + UI.
- Project timeline displays state transitions from immutable event stream.
- Exportable project binder skeleton generated with linked artifacts.
- Test: create project → add tasks/deliverables → export binder metadata.

### OP-003 — Stage-Gate Engine + California Template Scaffold (Module C baseline)
**Scope:** configurable stage gates with required evidence; initial LAPM/STIP/CEQA template stubs.

**Acceptance criteria:**
- Template-driven workflow can block gate advance when required artifacts missing.
- Minimum CA template pack present and selectable at project creation.
- Gate decision log (PASS/HOLD + rationale) persisted and queryable.
- Test: run project through two gates with one forced HOLD then PASS after evidence upload.

## Phase 2: Outreach + Ingestion Backbone

### OP-004 — Community Outreach Mapping (Module D)
**Scope:** campaigns, map pins/comments, moderation, heatmaps, report exports.

**Acceptance criteria:**
- Public participant pin submission flow with moderation queue.
- Campaign dashboard with map filters and comment clustering.
- CSV/GeoJSON export and HTML/PDF-style report output.

### OP-005 — Governed Data Acquisition Fabric (Module E)
**Scope:** connectors, ETL schedules, provenance/licensing metadata, diff/change detection.

**Acceptance criteria:**
- At least 2 authoritative connectors live with provenance fields.
- Dataset records store source URL, fetch timestamp, checksum, license, schema version.
- Policy-impacting diffs route to review queue.

## Phase 3: VMT/CEQA + Scenario System

### OP-006 — CEQA VMT Workflow Engine (Module G)
**Scope:** classifier, method paths (quantitative/qualitative), documentation fields, mitigation package.

**Acceptance criteria:**
- CEQA §15064.3 workflow path enforced via structured forms.
- Scenario output includes VMT metrics + assumptions/revision log.
- Narrative draft includes citation/provenance links.

### OP-007 — Scenario Manager + Program Linkage (Modules G + RTP/STIP linkage)
**Scope:** baseline/alternatives comparison and linkage to plan/program choices.

**Acceptance criteria:**
- Scenario compare table + narrative generation complete.
- Programming candidate can be traced back to scenario rationale.

## Phase 4: ABM + AI Layer

### OP-008 — ABM Managed Runs MVP (Module H)
**Scope:** containerized model-run orchestration, run metadata, output warehouse.

**Acceptance criteria:**
- Synthetic-region demo run executes end-to-end.
- Run artifacts are reproducible with versioned config.

### OP-009 — AI Gateway + Guardrails (Module I)
**Scope:** model config, prompt versioning, retrieval, tool-use policy checks, provenance.

**Acceptance criteria:**
- AI outputs store prompt version + source citations + confidence.
- Risky operations require human approval state.
- Guardrails tested against prompt-injection patterns.

### OP-010 — API, Webhooks, Integrations (Module J)
**Scope:** public API keys, rate limits, webhook events, external integrations scaffold.

**Acceptance criteria:**
- Per-tenant API key scopes and rate limits enforced.
- Core webhook events emitted and documented.

## Immediate Next Coding Packet (2026-03-05)
1. Execute OP-001 + OP-003 reliability-focused closure packet first.
2. Capture runtime evidence in `openplan/docs/ops/2026-03-01-ship-evidence-index.md` addendum or 2026-03-05 companion index.
3. No feature expansion beyond scope of active packet until gate proof is complete.
