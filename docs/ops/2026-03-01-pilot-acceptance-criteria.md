# OpenPlan v1 Pilot Acceptance Criteria (Must-Ship) + Runbook Framing

**Date:** 2026-03-01  
**Owner:** Owen Park (Associate Planner)  
**Lane:** Ship Week Day 1 — Pilot Readiness + Acceptance

## 1) Purpose
Define must-ship acceptance language for planner-facing pilot workflows and provide a practical runbook frame for pilot execution without scope creep.

## 2) Must-Ship Acceptance Language (P0/P1)
A pilot is **PASS-eligible** only when every P0 criterion below is met and no unresolved P0 defects remain at ship gate.

### P0-A: Account + Session Reliability
**Acceptance statement:** Pilot users can sign in, maintain stable sessions, and recover from expired sessions without dead-end states.

**PASS checks**
- User can authenticate and reach workspace dashboard.
- Session expiry redirects to recoverable sign-in flow.
- No blocking auth loop in core planner workflow.

**Evidence required**
- Test output link(s)
- Screenshot/video of login -> workspace success path
- Open defect board showing no unresolved P0 auth defects

---

### P0-B: Workspace Role Gate Integrity
**Acceptance statement:** Workspace permissions are deterministic; only authorized roles can execute billing and critical workspace actions.

**PASS checks**
- Owner/admin role gates enforced.
- Non-authorized user receives clear denial + next-step message.
- Cross-workspace access is blocked.

**Evidence required**
- Role gate test output
- API route behavior evidence (200/403 expected cases)
- Defect board link with role-gate status

---

### P0-C: Billing/Webhook Provisioning Reliability
**Acceptance statement:** Paid checkout events map to the correct workspace with idempotent, repeat-safe processing.

**PASS checks**
- Successful checkout event updates correct workspace subscription fields.
- Duplicate webhook events do not double-apply state changes.
- Retry path is deterministic and documented.
- Purchaser-email mismatch path is explicit (allow rule or manual review fallback).

**Evidence required**
- Billing test suite output
- Webhook receipt/idempotency logs or traces
- Runbook note for mismatch + retry handling

---

### P0-D: Planner Core Output Flow
**Acceptance statement:** Pilot user can complete one end-to-end planning run and receive expected output package elements.

**PASS checks**
- User can initiate planner workflow from valid workspace.
- Workflow completes without blocking error for baseline scenario.
- Output includes methods/assumptions + clear status indicators.

**Evidence required**
- Pilot run screenshot set or recording
- Sample output artifact path
- Known limitations note included

---

### P0-E: Support Handoff + Incident Clarity
**Acceptance statement:** If pilot flow degrades, user gets clear fallback messaging and support path with named owners.

**PASS checks**
- User-facing fallback text exists for common failure states.
- Internal escalation owner + backup listed.
- Incident timestamping and resolution log format defined.

**Evidence required**
- Support fallback copy file path
- Escalation matrix path
- Example incident log template path

---

## 3) P1 Acceptance (Should-Ship, may not block Day 1 if mitigated)
- Enhanced UX trust cues and readability improvements in non-critical screens.
- Non-blocking analytics instrumentation completeness.
- Secondary geospatial presentation polish beyond baseline trust threshold.

P1 items must have owner + ETA + mitigation if carried past Day 1.

## 4) Pilot Runbook Framing (Day 1 baseline)

### 4.1 Pilot Onboarding Sequence
1. Confirm pilot user identity + workspace assignment.
2. Confirm role level (owner/admin/member) and expected permissions.
3. Complete first login and session validation.
4. Provide short “first successful run” instruction card.

### 4.2 Expected Pilot Outputs
For each pilot run, package should include:
- run status summary,
- planner output artifact(s),
- methods + assumptions note,
- limitation/disclosure note,
- support contact path.

### 4.3 Support Handoff Rules
- If P0 failure occurs: immediate escalation to engineering owner and principal lane.
- If user confusion (non-technical): assistant-planner support script first, then escalate if unresolved.
- All incidents logged with: time, user/workspace, symptom, severity, owner, fix ETA.

### 4.4 Pilot Communication Standard
Use plain-English, client-safe language:
- Do not claim guaranteed approvals or funding outcomes.
- Mark outputs as planning-level unless verified otherwise.
- Keep next-step instructions explicit and short.

## 5) PASS/HOLD Recommendation Rule (Day 1)
- **PASS:** all P0 sections A–E satisfied with evidence links.
- **HOLD:** any unresolved P0 OR missing evidence for a claimed pass state.

## 6) Evidence Index Placeholder
Fill before 17:30 gate:
- Auth/session evidence: `[PATH]`
- Role gate evidence: `[PATH]`
- Billing/webhook evidence: `[PATH]`
- Planner output evidence: `[PATH]`
- Support handoff evidence: `[PATH]`

---

Prepared for Ship Week execution. Scope intentionally constrained to must-ship reliability and pilot trust.
