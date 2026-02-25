# Sprint 1 Backlog (Pilot-to-Commercial Readiness)

_Date: 2026-02-24_

## Goal
Convert current technical MVP into a pilot-ready commercial product with repeatable onboarding and defensible report output.

## Priority Queue

### P0 — Must Finish for First Paid Pilot

1. **Downloadable PDF export (not only HTML preview)**
   - Owner: Marcus (Engineering)
   - Target: Week 1
   - Acceptance:
     - User can click “Download PDF” from a saved run.
     - PDF includes scores, AI narrative, equity/safety sections, and timestamped metadata.

2. **Walk/Bike isochrone accessibility scoring (network-based)**
   - Owner: Marcus + Iris
   - Target: Week 1
   - Acceptance:
     - Corridor run computes walk and bike catchments from OSM network.
     - Accessibility score uses catchment coverage + destination opportunity density.

3. **Pilot tenant onboarding checklist + workspace bootstrap**
   - Owner: Evelyn
   - Target: Week 1
   - Acceptance:
     - New pilot agency can be provisioned with workspace + default settings in <10 minutes.
     - Onboarding checklist documented and repeatable.

4. **Data quality + source transparency panel in UI**
   - Owner: Sofia
   - Target: Week 1
   - Acceptance:
     - Every run clearly states source/fallback status for Census, crashes, LODES, equity, and AI.
     - Report and UI values remain consistent.

### P1 — Commercial Readiness

5. **Stripe subscription skeleton (Starter/Pro)**
   - Owner: Marcus
   - Target: Week 2
   - Acceptance:
     - Checkout session works for Starter and Professional plans.
     - Workspace-level subscription status stored and enforced.

6. **Landing page + pricing page (pilot conversion funnel)**
   - Owner: Sofia + Iris
   - Target: Week 2
   - Acceptance:
     - Public page communicates corridor workflow and value proposition.
     - CTA routes leads to pilot intake form.

7. **Pilot metrics instrumentation**
   - Owner: Evelyn
   - Target: Week 2
   - Acceptance:
     - Track run completion rate, time-to-first-result, and report generation rate.
     - Weekly KPI summary view available.

### P2 — Hardening

8. **Error monitoring + audit logging**
   - Owner: Marcus
   - Target: Week 3
   - Acceptance:
     - API errors are captured with run/workspace context.
     - Sensitive values are redacted.
   - Status (2026-02-25):
     - ✅ Added structured API audit logging for `/api/analysis`, `/api/report`, and `/api/runs`.
     - ✅ Added recursive redaction for tokens/keys/password-like fields before logging.
     - ✅ Added test coverage for sanitization (`src/test/audit-logger.test.ts`).

9. **Template variants for ATP vs SS4A narrative framing**
   - Owner: Sofia
   - Target: Week 3
   - Acceptance:
     - User can choose report template (ATP or SS4A).
     - Output language aligns with each program’s framing.

## Definition of Done for Sprint 1
- A new pilot customer can sign in, run corridor analysis, and export a PDF report without manual engineering support.
- At least one pricing path (Starter) is technically operable in app.
- KPI instrumentation is in place for pilot conversion decisions.
