# OpenPlan V1 Execution Queue — Tonight / Tomorrow

**Date:** 2026-03-15  
**Owner:** Bartholomew Hale (COO)  
**Status:** ACTIVE  
**Intent:** immediate execution queue derived from the live v1 command board and the original OpenPlan plan.

## Operating Goal
Move OpenPlan from "real product with meaningful progress" toward an honest **pilot-ready v1**, while continuing to build in the direction of the original full-platform thesis.

## Scope Rule
Prioritize tasks that improve one or more of the following:
1. trust and operator confidence,
2. deterministic workflow completion,
3. pilot-readiness / launch safety,
4. original-plan platform spine.

If a task is merely decorative, speculative, or detached from operator value, defer it.

---

## P0 — Start Immediately (Tonight)

### P0.1 — Authenticated production smoke on real records
**Why now:** This is the biggest verification gap after the latest Models / Plans / Programs wave.

**Objective**
Verify the real logged-in deployed experience for:
- `/models`
- `/plans`
- `/programs`
- representative detail pages with actual records

**Acceptance criteria**
- authenticated session established on production
- model catalog loads and filters work on real data
- plan detail loads and shows supporting model basis correctly
- program detail loads and shows models section correctly
- any regressions are captured as concrete issues with route, record, and behavior

**Ship output**
- smoke note/evidence doc in `openplan/docs/ops/`
- blocker list if failures appear

**Owner**
- COO / engineering execution lane

---

### P0.2 — Workflow proof pack for planning-domain continuity
**Why now:** We have more module surface than proof. We need evidence that the product works coherently, not just that routes exist.

**Objective**
Assemble and verify the create/edit/save/reload/cross-link proof path across:
- Project
- Plan
- Program
- Model

**Acceptance criteria**
- create or use a representative project context
- verify model linkage appears correctly in plan detail
- verify plan-linked model context appears correctly in program detail
- verify key metadata survives save/reload
- document any broken continuity points

**Ship output**
- concise workflow proof artifact in `openplan/docs/ops/`
- explicit pass/fail notes for each step

**Owner**
- COO / engineering execution lane

---

### P0.3 — Auth/access closure pass
**Why now:** V1 claims are not credible without strong identity/access proof.

**Objective**
Refresh current evidence for auth/session and membership/role enforcement in the rebuilt Option C app.

**Acceptance criteria**
- sign-in route and protected-route redirects validated
- representative protected API routes reviewed/verified
- membership and role-sensitive actions tested where feasible
- known auth gaps documented as P0/P1 items, not left implicit

**Ship output**
- updated auth/access evidence note
- bug list or mitigation notes if gaps remain

**Owner**
- engineering lane

---

## P1 — Next High-Leverage Block (Tonight if time, otherwise Tomorrow)

### P1.1 — Billing / commerce evidence refresh
**Why now:** This remains a red lane on the command board.

**Objective**
Refresh current verification for:
- checkout
- webhook handling
- in-app subscription state
- cancel/refund operational posture

**Acceptance criteria**
- current evidence assembled against live app state
- webhook path confirmed current, not only historical
- cancel/refund procedure documented or revalidated
- any drift between old billing evidence and current product posture identified

**Ship output**
- updated billing evidence artifact
- risk notes if production canary is needed again

---

### P1.2 — Reliability / error-state hardening pass
**Why now:** We are accumulating useful product surface; we need the failure modes to be trustworthy.

**Objective**
Tighten critical-route error handling, user-facing failure copy, and supportability for core planning workflows.

**Focus areas**
- route/API failure states
- save/update failures
- empty states vs actual error states
- operator guidance when linked data is missing/incomplete

**Acceptance criteria**
- highest-risk routes reviewed and improved
- failure states are explicit, not ambiguous
- docs capture any remaining weak spots

**Ship output**
- focused hardening commit(s)
- short ops note summarizing what was hardened

---

### P1.3 — Original-plan-aligned next foundation slice
**Why now:** We should keep moving toward the original OpenPlan vision while stabilizing v1.

**Preferred candidate order**
1. engagement foundation tightening
2. planning/report orchestration
3. compliance/readiness scaffolding
4. assistant workflow surface

**Decision rule**
Choose the slice that most strengthens the product spine without destabilizing current v1 closure work.

**Acceptance criteria**
- selected slice is justified in one paragraph
- scope is small, real, and shippable
- implementation improves the platform thesis, not just visual breadth

---

## Deferred / Not Tonight Unless a Dependency Forces It
- broad moonshot demand-model implementation
- public-facing engagement portal expansion beyond the current useful foundation
- compliance megasystem build-out
- document authoring overreach
- speculative AI chrome without workflow value

---

## Recommended Execution Order
1. authenticated production smoke
2. workflow proof pack
3. auth/access closure pass
4. billing evidence refresh
5. reliability hardening
6. one original-plan-aligned next foundation slice

---

## Success Condition For This Work Block
This work block is a success if by the end of the next execution cycle we have:
- real authenticated production verification of the newest planning-domain surfaces,
- a documented workflow proof pack,
- a clearer auth/billing truth state,
- at least one more meaningful shipped hardening or platform-foundation slice.

## Notes
- Current command board: `openplan/docs/ops/2026-03-15-openplan-v1-command-board.md`
- Ship board: `openplan/docs/ops/2026-03-01-openplan-ship-board.md`
- The queue should be updated after each shipped wave rather than replaced casually.
