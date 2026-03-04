# OpenPlan QA/QC Rhythm — Ship Week Control System

**Date:** 2026-03-01  
**Purpose:** Keep feature velocity high without letting quality become unwieldy.

## 1) Operating Principle
Every new feature must pass a quality gate **before** it can expand scope.

No gate pass = no merge to ship branch.

## 2) QA/QC Cadence (Frequent Checks)
- **09:00 — Scope + Risk Gate (15 min)**
  - Confirm day scope against Must-Ship list.
  - Reject any unscoped feature unless it resolves P0/P1 risk.

- **13:00 — Midday QA Sweep (20 min)**
  - Run critical flow checks (auth, planner, grant-lab, billing status surfaces).
  - Log defects with severity and owner.

- **17:30 — Ship Gate Review (25 min)**
  - Validate evidence links for completed items.
  - Update P0/P1 queue and freeze unstable changes.

- **Pre-merge mini-gate (every PR)**
  - Build/test pass
  - Acceptance checklist attached
  - Rollback note included if touching auth/billing/data

## 3) Severity Rules
- **P0 (Stop Ship):** security, billing correctness, auth failure, data corruption, production outage.
- **P1 (Fix Before Ship):** core workflow breakage, major reliability failure, severe UX blocker.
- **P2 (Defer allowed):** polish, non-critical enhancements, low-impact UX.

## 4) Feature Intake Control (Prevent Unwieldy Scope)
A feature can enter ship-week only if all are true:
1. Directly supports pilot conversion, delivery quality, or operational safety.
2. Has explicit acceptance criteria.
3. Has test/evidence path and rollback consideration.
4. Does not introduce unresolved P0/P1 risk.

If any item fails, move to v1.1 backlog.

## 5) Required Evidence Pack (Daily)
- Auth regression result
- Core planner E2E result
- Grant-lab E2E result
- Billing/webhook state verification (or explicit "not run" with reason)
- Open P0/P1 defect list with owners and ETA

## 6) Final QA/QC Sign-Off (Before Launch)
- Principal Planner detailed QA pass (Elena Marquez)
- COO verification pass (Bartholomew Hale)
- Ship recommendation: PASS or HOLD with blockers

## 7) Stop Conditions (Automatic HOLD)
- Any unresolved P0 issue
- Any billing state inconsistency
- Any auth/session regression in production-like tests
- Missing rollback steps for high-risk changes
