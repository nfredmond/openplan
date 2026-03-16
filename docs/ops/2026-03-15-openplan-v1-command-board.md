# OpenPlan V1 Command Board

**Date:** 2026-03-15  
**Owner:** Bartholomew Hale (COO)  
**Executive Sponsor:** Nathaniel Ford Redmond  
**Purpose:** single-source status board for what is done, what is partially done, and what must close before OpenPlan can be called a credible v1.

## Executive Status

### Current scorecard
- **Pilot-ready v1 confidence:** ~60%
- **Original-plan coverage:** ~30%
- **Product posture:** real product, no longer prototype theater
- **Ship posture:** improving, but not yet honest to call fully v1-complete

### Plain-English read
OpenPlan now has a real Planning OS spine with meaningful domain modules and real geospatial/analysis capability. The main remaining gap is no longer “does the product exist?” It is whether the critical workflows, auth/billing controls, QA evidence, and production verification are strong enough to justify a v1 claim.

---

## GREEN — materially shipped / real now

### Planning OS foundation
- Authenticated app shell and left-nav structure are in place.
- Projects are now a real first-class domain module.
- Project subrecords and timeline structure exist.

### Analysis + geospatial core
- Analysis Studio is real and operational.
- Data Hub is real and operational.
- SWITRS collision mapping is real when local geometry exists.
- Overlay readiness tiers are surfaced.
- Map context now persists into run history, reports, and comparison/export artifacts.

### Planning-domain module progress
- Programs v1 foundation shipped.
- Plans v1 foundation shipped.
- Models v1 foundation shipped.
- Models UX refinement shipped.
- Models now integrate into Plan detail and Program detail surfaces.
- Models catalog now supports real filtering/search.

### Recent shipping evidence
- `1c95d22` — `Add Models v1 foundation module`
- `f20af36` — `Refine OpenPlan model controls UX`
- `64f8269` — `Integrate models into plans and programs`

---

## YELLOW — real progress, but still incomplete or insufficiently verified

### Cross-module workflow continuity
- Project → Plan → Program → Model relationships are now visible, but the end-to-end operator workflow still needs more deterministic testing and polish.
- Some modules are now connected, but the full “planner works inside one coherent operating system” experience is still maturing.

### Production verification depth
- Route-level production smoke is passing for key authenticated module entry points (`/models`, `/plans`, `/programs` redirecting correctly to `/sign-in`).
- Full post-login production smoke on real records is still missing for the newest authenticated interiors.

### Auth/access confidence
- The platform has working auth and protected routes, but a current explicit v1 confidence claim still requires stronger end-to-end verification of signup/login/reset/session expiry and role/membership enforcement across critical routes.

### Core workflow determinism
- Planning-domain module creation/edit/save/reload paths are becoming real.
- We still need cleaner proof that the primary planner workflow and core output workflow are deterministic, resilient, and supportable under normal use.

### Launch readiness artifacts
- Strong ship-week planning and QA docs exist.
- Formal closeout evidence, final QA/QC gate status, and a crisp current ship packet still need refresh against the rebuilt Option C product posture.

---

## RED — must close before we can honestly call it v1

### Billing / commerce proof
- Billing and subscription sync still need current, explicit live verification against the rebuilt app posture.
- Checkout, webhook, cancellation/refund, and in-app subscription-state evidence must be refreshed and assembled into a current v1 evidence packet.

### Primary workflow E2E proof
- The sprint definition requires a complete, deterministic primary planner workflow and a stable grant/plan generation workflow.
- That evidence is not yet fully assembled and current.

### Reliability / error / support posture
- Critical-route error handling, logging, abuse/rate controls, rollback docs, and support/triage readiness still need a tighter current pass.
- The product is shipping, but the “safe to launch and support” layer is not fully closed.

### Formal internal ship gate
- Principal Planner review and COO verification pass are not yet closed against the present product state.
- No honest v1 declaration should bypass that gate unless Nathaniel explicitly overrides it in writing for release timing.

---

## ORIGINAL-PLAN TRACK — beyond pilot v1, but must keep moving now

These are part of the original OpenPlan thesis and should guide execution so v1 grows in the right direction:

### Still early relative to original plan
- community engagement as a real integrated module and data loop
- deeper scenario/planning/report orchestration
- chained demand-model / transportation-model posture
- AI-assisted workflow layer across planning tasks
- compliance / construction / implementation tracking
- broader integrated public/planner workflow continuity

### Current strategy
Do **not** try to finish the entire original vision in one reckless wave. Instead:
1. keep strengthening the Planning OS spine,
2. make the planner workflows deterministic,
3. close ship-critical auth/billing/reliability gaps,
4. add original-plan foundations in high-leverage slices that compound rather than sprawl.

---

## Immediate Next Actions

### 1. Authenticated production smoke
Verify the live deployed app with a real session for:
- `/models`
- `/plans`
- `/programs`
- representative detail pages with real records

### 2. Workflow proof pack
Assemble a current evidence packet for:
- create/edit/save/reload flows
- cross-link continuity between Project / Plan / Program / Model
- output/report posture
- failure-state handling

### 3. Billing + auth closure pass
Refresh live evidence for:
- signup/login/reset/session behavior
- workspace/role enforcement
- checkout/webhook/subscription-state behavior
- cancel/refund operational procedure

### 4. Original-plan-aligned next module foundations
Prioritize the next slice that most improves the original platform thesis without destabilizing v1. Current likely candidates:
- engagement foundation tightening
- planning/report orchestration
- compliance/readiness scaffolding
- assistant workflow surface

### 5. Active execution queue
The immediate working queue for tonight / tomorrow is maintained at:
- `openplan/docs/ops/2026-03-15-openplan-v1-execution-queue.md`

---

## Decision Rule
If a task improves **trust, workflow determinism, pilot readiness, or the original platform spine**, it is in scope. If it is merely decorative, speculative, or isolated from actual operator value, defer it.
