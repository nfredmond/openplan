# OpenPlan Ship Week Day 1 — Critical UX Risk Audit (Camila Lane)

**Date (PT):** 2026-03-01  
**Owner:** Camila Reyes (Urban Design & Graphic Systems)  
**Scope posture:** Ship-relevant clarity/trust risks only (no cosmetic scope creep)

## Scope Guardrails (No Scope Creep)
Included:
1. Checkout/post-purchase clarity and trust cues
2. Account creation + access activation clarity states
3. Light-mode readability/contrast defects that affect trust and comprehension

Excluded:
- New feature concepts
- Layout redesigns not required to resolve a P0/P1 trust risk
- Non-critical visual polish

---

## Executive Summary
- **P0 risks:** 2
- **P1 risks:** 5
- **Ship recommendation:** **PASS WITH TARGETED FIXES** if all P0 items are explicitly covered in UI copy/state handling before ship gate.

---

## Risk Register (Ship-Relevant Only)

### P0-UX-01 — Post-purchase “what happens next” is not guaranteed to be explicit
**Risk:** Users can complete payment without a clear, immediate next-step sequence (email, account creation, activation), creating trust drop and support load.

**Why ship-relevant:** Payment-to-access ambiguity directly impacts first-session activation and pilot trust.

**Evidence paths:**
- `agents/team/urban-design-expert/reports/product_checkout_messaging_clear_safe_conversion_v1.md` (recommended copy exists; implementation evidence not yet documented)
- `openplan/docs/ops/2026-03-01-team-tasking-matrix.md` (Camila lane explicitly scoped to critical UX clarity)

**Required fix (must-ship):**
- Add explicit 3-step “what happens next” block in post-purchase success state:
  1) check email, 2) create account, 3) activate access/sign in.

---

### P0-UX-02 — Error-state trust language not guaranteed in checkout/account activation
**Risk:** Failure states may not clearly tell users whether they were charged, whether duplicate charges are prevented, or what to do next.

**Why ship-relevant:** Ambiguous payment/activation error language is a direct trust and support escalator.

**Evidence paths:**
- `agents/team/urban-design-expert/reports/product_checkout_messaging_clear_safe_conversion_v1.md` (explicit safe error copy proposed)
- `openplan/docs/ops/2026-03-01-team-tasking-matrix.md`

**Required fix (must-ship):**
- Enforce plain safe-error copy for payment timeout/failed confirmation/activation failures.
- Always include a next action CTA (retry / resend activation / contact support).

---

### P1-UX-01 — Light header nav/link contrast is below readability comfort
**Risk:** Nav links on light header are too faint at small size; users may miss critical navigation and account actions.

**Evidence paths:**
- `agents/team/assistant-planner/reports/2026-02-28-light-mode-contrast-punch-list.md` (HIGH #1, FAIL)
- `agents/team/assistant-planner/inbox/screenshots-2026-02-28/Screenshot 2026-02-28 163255.png`
- `agents/team/assistant-planner/inbox/screenshots-2026-02-28/Screenshot 2026-02-28 121022.png`

**Required fix:**
- Darken header link token + raise legibility weight in light mode.

---

### P1-UX-02 — Brand/logo mark is weak on light header
**Risk:** Faint logo reduces brand trust signal in top-most UI zone.

**Evidence paths:**
- `agents/team/assistant-planner/reports/2026-02-28-light-mode-contrast-punch-list.md` (HIGH #2, FAIL)
- `agents/team/assistant-planner/inbox/screenshots-2026-02-28/Screenshot 2026-02-28 163255.png`

**Required fix:**
- Use dark-on-light logo variant or contrasting plate in light header state.

---

### P1-UX-03 — Small helper/status text too faint on light surfaces
**Risk:** Status/meta lines (autosave/helper text) are hard to scan, weakening confidence in system state.

**Evidence paths:**
- `agents/team/assistant-planner/reports/2026-02-28-light-mode-contrast-punch-list.md` (HIGH #3, FAIL)
- `agents/team/assistant-planner/inbox/screenshots-2026-02-28/Screenshot 2026-02-28 163255.png`
- `agents/team/assistant-planner/inbox/screenshots-2026-02-28/Screenshot 2026-02-28 121022.png`

**Required fix:**
- Raise helper/status token contrast and minimum readable weight.

---

### P1-UX-04 — Outline controls and onboarding card actions are visually weak
**Risk:** Faint borders/icons/text reduce action confidence and perceived clickability.

**Evidence paths:**
- `agents/team/assistant-planner/reports/2026-02-28-light-mode-contrast-punch-list.md` (MEDIUM #4, #5 FAIL)
- `agents/team/assistant-planner/inbox/screenshots-2026-02-28/Screenshot 2026-02-28 163255.png`
- `agents/team/assistant-planner/inbox/screenshots-2026-02-28/Screenshot 2026-02-28 163612.png`

**Required fix:**
- Strengthen border/text/icon contrast on outline and onboarding CTAs.

---

### P1-UX-05 — Focus-visible state likely too weak for keyboard trust/accessibility
**Risk:** Users may lose active-focus context on light controls.

**Evidence paths:**
- `agents/team/assistant-planner/reports/2026-02-28-light-mode-contrast-punch-list.md` (MEDIUM #6, FAIL provisional)

**Required fix:**
- Add clearly visible focus ring style with high contrast token.

---

## Fast-Apply Patch Artifact (Already Prepared)
Implementation-ready token/class guidance exists at:
- `agents/team/urban-design-expert/reports/2026-02-28-light-mode-contrast-polish-p1/TOKEN_CLASS_PATCHLIST_v1.md`
- Before/after evidence index: `agents/team/urban-design-expert/reports/2026-02-28-light-mode-contrast-polish-p1/DELIVERY_INDEX.md`

---

## Ship Gate Recommendation
To avoid trust-related HOLD posture, close these before Day 1 gate:
1. **P0-UX-01** post-purchase next-step clarity
2. **P0-UX-02** payment/activation safe-error messaging
3. At least HIGH contrast defects from light-mode audit (P1-UX-01/02/03)

If these are not evidenced in implementation, maintain **HOLD** for UX trust risk.
