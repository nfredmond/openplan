# Critical UX Trust/Clarity — Implementation Verification Checklist (Live)

**Date (PT):** 2026-03-01 22:28  
**Owner:** Camila Reyes (UX/Design lane)  
**Source findings:** `openplan/docs/ops/2026-03-01-critical-ux-risk-audit.md`  
**Gate rule:** Missing implementation **or runtime** proof = unresolved blocker.

## Current Scoreboard (live)
- **Total checks:** 7
- **PASS:** 0
- **PARTIAL:** 2
- **FAIL:** 5
- **P0 unresolved:** 2 (**automatic HOLD if unresolved at gate**)

---

## Verification Checklist (with owner + ETA)

| ID | Sev | Verification criterion (PASS only if all true) | Current | Proof gap (what is missing) | Owner | ETA | Evidence links |
|---|---|---|---|---|---|---|---|
| P0-UX-01 (B-05) | P0 | Post-purchase success flow explicitly shows what happens next (email -> create account -> activate access) with actionable CTA | **PARTIAL** | Runtime UI proof (screenshot/video) of live implemented state is missing | Camila + Iris | 09:00 gate packet | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-1622-b05-post-purchase-proof.log` · `openplan/openplan/src/app/(workspace)/billing/page.tsx` · `openplan/docs/ops/2026-03-01-critical-ux-risk-audit.md` |
| P0-UX-02 (B-06) | P0 | Payment/activation error states explicitly include charge-safety language + next-step CTA | **PARTIAL** | Runtime UI proof (screenshot/video) of safe-error state copy is missing | Camila + Iris | 09:00 gate packet | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-1620-b06-safe-error-route-tests.log` · `openplan/openplan/src/app/api/billing/checkout/route.ts` · `openplan/docs/ops/2026-03-01-critical-ux-risk-audit.md` |
| P1-UX-01 | P1 | Light header nav links readable at default zoom | **FAIL** | Implementation diff + runtime recheck screenshot missing | Camila + Iris | 09:00 gate packet | `agents/team/assistant-planner/reports/2026-02-28-light-mode-contrast-punch-list.md` · `openplan/openplan/src/components/top-nav.tsx` · `openplan/openplan/src/components/nav/nav-link-pill.tsx` |
| P1-UX-02 | P1 | Brand/logo clearly visible on light header | **FAIL** | Implementation proof + runtime screenshot missing | Camila + Iris | 09:00 gate packet | `agents/team/assistant-planner/reports/2026-02-28-light-mode-contrast-punch-list.md` · `openplan/openplan/src/components/top-nav.tsx` |
| P1-UX-03 | P1 | Helper/status text upgraded to readable contrast token | **FAIL** | Implementation proof + runtime screenshot missing | Camila + Iris | 09:00 gate packet | `agents/team/assistant-planner/reports/2026-02-28-light-mode-contrast-punch-list.md` · `agents/team/urban-design-expert/reports/2026-02-28-light-mode-contrast-polish-p1/TOKEN_CLASS_PATCHLIST_v1.md` |
| P1-UX-04 | P1 | Outline controls + onboarding CTAs show clear affordance | **FAIL** | Implementation proof + runtime screenshot missing | Camila + Iris | 09:00 gate packet | `agents/team/assistant-planner/reports/2026-02-28-light-mode-contrast-punch-list.md` · `agents/team/urban-design-expert/reports/2026-02-28-light-mode-contrast-polish-p1/TOKEN_CLASS_PATCHLIST_v1.md` |
| P1-UX-05 | P1 | Focus-visible ring clearly visible on links/buttons | **FAIL** | Runtime proof of focus states missing | Camila + Iris | 09:00 gate packet | `agents/team/assistant-planner/reports/2026-02-28-light-mode-contrast-punch-list.md` · `openplan/openplan/src/components/ui/button.tsx` · `openplan/openplan/src/components/ui/input.tsx` |

---

## Required evidence bundle to flip any item to PASS
1. **Implementation proof**: commit/PR path or exact changed file + line references.
2. **Runtime proof**: screenshot/video path from production-like UI state.
3. **Verification note**: one-line PASS statement tied to criterion.

If any one of the three is missing, status remains PARTIAL/FAIL and blocker stays open.

---

## Gate posture
- **Current posture: HOLD-risk** (P0 unresolved due missing runtime proof for B-05/B-06).
- This file is the UX lane source-of-truth for blocker owner/ETA/evidence mapping in gate packets.
