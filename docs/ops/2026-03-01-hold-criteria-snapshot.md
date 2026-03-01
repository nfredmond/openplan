# OpenPlan Ship Week — HOLD Criteria Snapshot (Effective Immediate)

**Date/Time (PT):** 2026-03-01 12:54  
**Authority:** Nathaniel / COO directive  
**Enforcement Owner:** Elena Marquez (Principal Planner)

## Hard No-Bypass Rules
1. **Any unresolved P0 at any gate = HOLD.**
2. **No external-ready claim without Principal QA gate artifact.**
3. **13:00 and 17:30 gate packets must include blocker-level owner/ETA/evidence.**
4. **If evidence path is missing, blocker is treated as unresolved.**

## Principal QA Gate Requirement (mandatory before external-ready claim)
External-ready claim is valid only when:
- Principal QA PASS decision is documented in a dated artifact, and
- Scope reviewed + assumptions + blockers + recommendation are explicit, and
- No unresolved P0 remains in defect ownership list.

## Minimum Gate Packet Content (13:00 and 17:30)
For **each open blocker** include:
- Blocker ID
- Severity (P0/P1)
- Owner
- ETA
- Evidence path(s)
- Mitigation (if any)
- Exit criteria

## Automatic HOLD Triggers
- Unresolved P0
- Missing evidence path for a claimed closure
- Billing/provisioning state inconsistency
- Auth/session regression in production-like checks
- Any external-ready claim lacking Principal QA artifact

## Release Posture Decision
- **PASS** only if all P0 blockers show closure evidence and Principal QA artifact exists.
- Otherwise **HOLD**.
