# OpenPlan 7-Day Ship Sprint (v1)

**Date:** 2026-03-01  
**Owner:** Bartholomew Hale (COO)  
**Executive Sponsor:** Nathaniel Ford Redmond  
**Priority:** P0 (primary execution lane)

## Executive Objective
Ship OpenPlan to a **reliable, client-safe, pilot-ready v1** in 7 days.

This sprint targets a production-quality launch baseline, not the full long-term feature universe.

## Scope Rule (Hard)
- **Include:** Must-Ship capabilities required for pilot use and safe billing/operations.
- **Exclude:** Nice-to-have and speculative features that jeopardize reliability.
- **If uncertain:** default to defer unless directly tied to pilot conversion, delivery quality, or operational safety.

---

## Definition of Done (Ship Gate)
OpenPlan is considered ship-ready only if all are true:

1. Core user flows pass end-to-end in production-like environment.
2. Auth/session/permissions are stable with no critical regressions.
3. Billing checkout, webhook, cancellation/refund test pass with evidence.
4. Error handling/logging/alerts are active for critical paths.
5. P0/P1 bug queue is cleared or has approved mitigation.
6. Launch runbook, rollback plan, and support triage doc are complete.
7. QA/QC rhythm was executed daily with evidence pack updates (`openplan/docs/ops/2026-03-01-openplan-qa-qc-rhythm.md`).
8. Internal QA/QC gate is signed:
   - Principal Planner review (Elena Marquez)
   - COO verification pass (Bartholomew Hale)

---

## Must-Ship (v1)

### A) Product Functionality
- [ ] Primary planner workflow complete and deterministic.
- [ ] Grant/plan generation workflow stable (required fields + save/reload + output actions).
- [ ] Usage/rate-limit behavior clear and user-safe.

### B) Identity & Access
- [ ] Signup/login/password reset/session middleware fully verified.
- [ ] Workspace membership and role gates enforced server-side.
- [ ] Unauthorized access tests pass.

### C) Billing & Commerce
- [ ] Plan selection and checkout complete.
- [ ] Webhook handling verified in live canary.
- [ ] Subscription state sync accurate in-app.
- [ ] Refund/cancel operational procedure documented.

### D) Reliability & Security
- [ ] Structured error states for all critical API routes.
- [ ] Audit logging for auth/billing critical actions.
- [ ] Basic abuse/rate controls verified.
- [ ] Secrets/config validation checklist complete.

### E) Launch Ops
- [ ] Production smoke test script/checklist updated.
- [ ] On-call/triage runbook documented.
- [ ] Rollback procedure documented and dry-run reviewed.

---

## Deferred (v1.1+)
- Extended “everything we’ve ever thought of” modules that do not block pilot delivery.
- Advanced UX polish not tied to conversion or trust.
- Experimental integrations pending direct revenue or delivery need.

---

## 7-Day Plan

### Day 1 — Scope Lock + Board Setup
- Freeze Must-Ship list and explicit defer list.
- Open issue board with P0/P1/P2 labels.
- Define acceptance tests per Must-Ship item.

### Day 2–3 — Feature Closure
- Close unfinished core workflows.
- Resolve highest-impact defects first.
- Daily production smoke checks.

### Day 4 — Reliability Hardening
- Error handling, retries, logging, and guardrails.
- Permission edge-case tests.

### Day 5 — Full QA/UAT
- End-to-end regression on core journeys.
- Fix only P0/P1 defects.

### Day 6 — Launch Readiness
- Complete docs/runbooks/rollback.
- Final billing + auth verification.

### Day 7 — Soft Launch + Monitor
- Controlled rollout.
- Observe metrics, triage quickly, patch fast.

---

## Parallel Portfolio Policy (Keep Other Projects Moving)
- **Execution allocation:** 80% OpenPlan, 20% portfolio maintenance.
- **Daily non-OpenPlan minimum:** one concrete progress action (or explicit blocker log) for another active project.
- **No context thrash:** batch non-OpenPlan actions into one focused block daily.

---

## Success Metrics (Week 1)
- Time-to-first-successful-core-run < 15 minutes for a new qualified user.
- 0 unresolved P0 defects at ship decision point.
- Billing canary and cancellation/refund playbook both verified.
- QA evidence artifact complete and review-stamped.

---

## Risks & Mitigations
- **Risk:** Scope creep into “everything” mode.  
  **Mitigation:** Hard defer list + daily scope policing.

- **Risk:** Last-minute regressions in auth/billing.  
  **Mitigation:** Daily smoke checks + freeze window before launch.

- **Risk:** Ops burden post-launch.  
  **Mitigation:** Clear triage runbook and rollback readiness.

---

## Immediate Next Actions (Now)
1. Stand up sprint issue board and tag current work into Must-Ship / Deferred.
2. Build explicit acceptance checklist artifact for auth, billing, and core planner/grant workflows.
3. Schedule final internal QA/QC review window (Principal + COO) for Day 6/7.
