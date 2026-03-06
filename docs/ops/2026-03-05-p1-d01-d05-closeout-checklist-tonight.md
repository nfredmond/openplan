# P1-D01..D05 Closeout Checklist (Tonight)

**Date (PT):** 2026-03-05  
**Branch:** `ship/phase1-core`  
**Purpose:** Clear final HOLD blockers for push-readiness recheck.

## Current truth
- Principal final verdict is **HOLD**.
- Remaining decisive blockers are **P1-D01..P1-D05** (trust/readability), open at closure-evidence level.

## A) Ownership lock (do first)
- [ ] Confirm execution owner for P1 UX fixes: **Camila** (backup: **Iris**).
- [ ] Confirm governance owner for evidence packet updates: **Owen**.
- [ ] Confirm final adjudication owner: **Elena**.
- [ ] Confirm COO verification owner: **Bartholomew**.

## B) Defect-by-defect closure evidence (required for each P1)
For each item (P1-D01..P1-D05), attach all three evidence types:

1) **Implementation evidence**
- [ ] Exact file(s) changed
- [ ] Commit hash (local is fine)
- [ ] One-line summary of what changed

2) **Runtime proof**
- [ ] Screenshot or runtime capture showing corrected state
- [ ] Path under `docs/ops/2026-03-05-test-output/`

3) **Verification note**
- [ ] Clear pass/fail statement
- [ ] Any residual caveat/risk

P1 list to close:
- [ ] P1-D01: Light-mode header nav contrast
- [ ] P1-D02: Light-mode logo trust cue
- [ ] P1-D03: Helper/status text contrast
- [ ] P1-D04: Outline controls/onboarding CTA assertiveness
- [ ] P1-D05: Focus-visible keyboard/accessibility states

## C) Same-cycle governance docs to update (no drift)
- [ ] `docs/ops/2026-03-01-critical-ux-implementation-verification-checklist.md`
- [ ] `docs/ops/2026-03-01-p0-p1-defect-ownership-list.md`
- [ ] `docs/ops/2026-03-05-p1-ux-mitigation-and-closure-memo.md`
- [ ] `docs/ops/2026-03-05-authoritative-governance-state.md`
- [ ] `docs/ops/2026-03-05-defect-shipboard-reconciliation.md`
- [ ] `docs/ops/2026-03-05-phase1-gate-packet.md`

## D) Engineering safety proof (post-fix)
- [ ] Run `npm run qa:gate`
- [ ] Save full output to timestamped log in `docs/ops/2026-03-05-test-output/`
- [ ] If any visual/accessibility checks are scripted, save those logs too

## E) Consolidated closure packet (single source for principal)
Create one memo that links all closure artifacts:
- [ ] `docs/ops/2026-03-05-p1-d01-d05-closure-evidence-packet.md`

Must include:
- [ ] Status per P1 item: CLOSED or MITIGATED (with executed mitigation evidence)
- [ ] Owner + ETA + evidence path (if any item not fully CLOSED)
- [ ] Explicit residual risk statement (if any)

## F) Decision sequence (mandatory)
1. [ ] **Principal recheck** updates `docs/ops/PRINCIPAL_QA_APPROVAL.md` with PASS/HOLD.
2. [ ] **Principal checklist** refreshed in `docs/ops/2026-03-05-principal-qa-checklist-phase1.md`.
3. [ ] **COO verification note** refreshed for same cycle.

## PASS criteria for tonight
All must be true:
- [ ] P1-D01..P1-D05 are no longer OPEN (CLOSED or formally MITIGATED with executed evidence).
- [ ] No doc drift across gate packet / reconciliation / authoritative state.
- [ ] Fresh `qa:gate` log is green and linked.
- [ ] Principal re-adjudication changes status to PASS.
- [ ] COO verification confirms packet completeness.

If any item fails -> remain **HOLD**.
