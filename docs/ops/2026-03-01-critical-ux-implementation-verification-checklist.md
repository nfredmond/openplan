# Critical UX Trust/Clarity — Implementation Verification Checklist (Day 1)

**Date (PT):** 2026-03-01 12:59  
**Owner:** Camila Reyes (UX/Design lane)  
**Source findings:** `openplan/docs/ops/2026-03-01-critical-ux-risk-audit.md`  
**Gate rule:** Missing implementation proof = unresolved blocker (per hold criteria snapshot).

## Current Scoreboard (for 13:00 gate)
- **Total checks:** 7
- **PASS:** 0
- **FAIL:** 7
- **P0 unresolved:** 2 (**automatic HOLD if still unresolved at gate**)

---

## Verification Checklist

| ID | Sev | Design finding | Implementation verification criterion (PASS only if all true) | Current | Blocker reason | Evidence links |
|---|---|---|---|---|---|---|
| P0-UX-01 | P0 | Post-purchase next-step clarity | Success state visibly shows 3-step sequence: email -> create account -> activate access; next-step CTA present | **FAIL** | No runtime implementation proof linked | Finding: `openplan/docs/ops/2026-03-01-critical-ux-risk-audit.md` · Copy spec: `agents/team/urban-design-expert/reports/product_checkout_messaging_clear_safe_conversion_v1.md` · Candidate implementation surface: `openplan/openplan/src/app/(workspace)/billing/page.tsx` |
| P0-UX-02 | P0 | Safe error-state trust messaging | Payment/activation errors explicitly state charge safety + retry/support next-step CTA | **FAIL** | No runtime implementation proof linked | Finding: `openplan/docs/ops/2026-03-01-critical-ux-risk-audit.md` · Copy spec: `agents/team/urban-design-expert/reports/product_checkout_messaging_clear_safe_conversion_v1.md` · Candidate implementation surfaces: `openplan/openplan/src/app/(workspace)/billing/page.tsx`, `openplan/openplan/src/app/(auth)/sign-up/page.tsx` |
| P1-UX-01 | P1 | Light header nav/link contrast | Light-mode nav links are readable at default zoom; contrast no longer appears faint in screenshot recheck | **FAIL** | No implementation recheck screenshots linked | Finding: `agents/team/assistant-planner/reports/2026-02-28-light-mode-contrast-punch-list.md` · Candidate UI: `openplan/openplan/src/components/top-nav.tsx`, `openplan/openplan/src/components/nav/nav-link-pill.tsx` |
| P1-UX-02 | P1 | Logo contrast on light header | Brand/logo remains clearly visible on light header states | **FAIL** | No implementation recheck screenshots linked | Finding: `agents/team/assistant-planner/reports/2026-02-28-light-mode-contrast-punch-list.md` · Candidate UI: `openplan/openplan/src/components/top-nav.tsx` |
| P1-UX-03 | P1 | Helper/status text too faint | Small helper/status text upgraded to readable token in runtime | **FAIL** | No implementation recheck screenshots linked | Finding: `agents/team/assistant-planner/reports/2026-02-28-light-mode-contrast-punch-list.md` · Patch spec: `agents/team/urban-design-expert/reports/2026-02-28-light-mode-contrast-polish-p1/TOKEN_CLASS_PATCHLIST_v1.md` |
| P1-UX-04 | P1 | Outline controls + onboarding CTA affordance weak | Outline/button/icon text treatment shows clear affordance in light mode | **FAIL** | No implementation recheck screenshots linked | Finding: `agents/team/assistant-planner/reports/2026-02-28-light-mode-contrast-punch-list.md` · Patch spec: `agents/team/urban-design-expert/reports/2026-02-28-light-mode-contrast-polish-p1/TOKEN_CLASS_PATCHLIST_v1.md` |
| P1-UX-05 | P1 | Focus-visible weak | Keyboard focus ring is clearly visible on links/buttons in runtime recheck | **FAIL** | No implementation recheck screenshots or test notes linked | Finding: `agents/team/assistant-planner/reports/2026-02-28-light-mode-contrast-punch-list.md` · Candidate styles: `openplan/openplan/src/components/ui/button.tsx`, `openplan/openplan/src/components/ui/input.tsx`, `openplan/openplan/src/components/ui/textarea.tsx` |

---

## Required Evidence to flip FAIL -> PASS
For each checklist row:
1. **Implementation proof** (PR/commit or file diff path)
2. **Runtime proof** (updated screenshot path(s) showing fixed state)
3. **Verification note** (short pass statement tied to criterion)

Until all three are present, item remains FAIL and blocker-active.

---

## 13:00 Gate Posture
- **Current posture: HOLD-risk** (P0 unresolved with missing implementation proof).
- If P0-UX-01 and P0-UX-02 are not evidenced by gate packet, retain HOLD per governance rules.
