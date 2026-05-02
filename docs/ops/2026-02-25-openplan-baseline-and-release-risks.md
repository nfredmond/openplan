# OpenPlan Baseline Validation + Release Risk Register

> **Status:** Historical / superseded by [2026-05-01-openplan-known-issues-register.md](2026-05-01-openplan-known-issues-register.md). R1 and R5 are closed; R2/R3/R4 carried forward there with current proof links. This snapshot is preserved for the original Feb 25 baseline state.

**Timestamp:** 2026-02-25 21:21 PST
**Environment:** `/home/nathaniel/.openclaw/workspace/openplan/openplan`

## Baseline Build/Test Status

### Command Results
1. `npm run lint`
   - **Result:** PASS (warnings only)
   - **Note:** `src/lib/export/download.ts` has 1 unused type warning (`MetricValue`).

2. `npm run test`
   - **Result:** FAIL
   - **Summary:** 29 passed, 2 failed (31 total)
   - **Failing tests:**
     - `src/test/report-route.test.ts > returns html for format=html` (expected 200, got 500)
     - `src/test/report-route.test.ts > returns pdf bytes for format=pdf` (expected 200, got 500)

3. `npm run build`
   - **Result:** PASS
   - **Summary:** Next.js production build completed successfully; app routes generated.

## Release-Risk List (Published)

### R1) Report export endpoint instability (current blocker)
- **Impact:** High (breaks core pilot deliverable: client-facing report export)
- **Likelihood:** High (active failing tests)
- **Mitigation:** Prioritize `/api/report` error-path diagnosis and fix before feature expansion.
- **Mitigation owner:** Marcus (Engineering)

### R2) Data-source transparency mismatch between UI and exports
- **Impact:** High (trust/compliance risk in client-facing outputs)
- **Likelihood:** Medium
- **Mitigation:** Introduce a shared source-status model used by both dashboard and export renderer.
- **Mitigation owner:** Sofia (Product/UX) + Marcus (Engineering)

### R3) Bootstrap/onboarding may exceed 10-minute operator target
- **Impact:** Medium-High (pilot setup friction)
- **Likelihood:** Medium
- **Mitigation:** Time-boxed runbook rehearsal and endpoint idempotency checks with known-good script.
- **Mitigation owner:** Evelyn (Operations)

### R4) Billing entitlement drift after webhook events
- **Impact:** Medium-High (revenue leakage or user lockout)
- **Likelihood:** Medium
- **Mitigation:** Add deterministic webhook test fixtures + entitlement regression checks per workspace state.
- **Mitigation owner:** Marcus (Engineering)

### R5) Build green while tests red (false confidence risk)
- **Impact:** Medium
- **Likelihood:** High until test suite fixed
- **Mitigation:** Enforce release gate requiring lint/test/build all green before deploy approval.
- **Mitigation owner:** Owen (coordination) + Engineering owner on duty
