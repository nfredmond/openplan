# OpenPlan Billing Workspace Selection — Elena Review Handoff

**Date:** 2026-03-16  
**Owner:** Bartholomew Hale (COO)  
**Audience:** Elena Marquez, Principal Planner  
**Status:** **HOLD — current packet is review-ready, but not yet final external ship**

## Executive Summary
This handoff closes the next honest v1 billing lane after proof-packet commit `aa3f8ef`.

### What changed in this lane
- I inspected the current `/billing` workspace-selection behavior in code and against the live canary evidence.
- I confirmed the ambiguity is a **real product / UX bug on a billing-critical route**, not an intentional fallback worth defending.
- I implemented a **tight, low-risk billing-only fix**:
  - multi-workspace users must now explicitly choose a workspace before viewing billing,
  - `/billing?workspaceId=<uuid>` now targets a specific accessible workspace,
  - invalid workspace IDs no longer silently fall back to some other workspace,
  - once selected, the billing page shows a workspace switcher so the operator can confirm what context they are in.
- Local validation passed: `pnpm test`, `pnpm lint`, `pnpm build`.

### Honest current recommendation
**Recommendation: HOLD.**

Reason:
- this lane materially reduces the billing ambiguity that blocked confidence in the live canary,
- but final v1 ship posture still requires **Principal Planner review of the current 2026-03-16 packet**, and
- the commercial evidence still stops short of a real paid live Stripe completion / refreshed cancel-refund closeout.

---

## Current V1 Proof Packet Snapshot
The current baseline evidence packet remains the 2026-03-16 bundle assembled at commit `aa3f8ef`.

Primary packet documents for this review:
- `docs/ops/2026-03-16-openplan-v1-proof-packet.md`
- `docs/ops/2026-03-16-openplan-v1-internal-ship-gate.md`
- `docs/ops/2026-03-16-openplan-production-alias-promotion-closure.md`
- `docs/ops/2026-03-16-openplan-production-authenticated-smoke.md`
- `docs/ops/2026-03-16-openplan-production-edit-update-smoke.md`
- `docs/ops/2026-03-16-v1-provisioning-hardening.md`
- `docs/ops/2026-03-16-billing-identity-review-hardening.md`
- `docs/ops/2026-03-16-openplan-live-billing-hold-canary.md`

### Strongest supported claims from the packet
- Current public production alias is aligned to fresh production.
- Authenticated create/list/detail continuity is live-proven on production.
- Authenticated edit/update persistence is live-proven for Plans, Models, and Programs.
- Billing purchaser-identity hold logic is production-proven through the live app/webhook/UI/DB path.
- Provisioning cleanup, planning save rollback, and billing identity-review hardening are implemented and locally validated.

### Still-true packet caveats
- The current-cycle principal artifact now exists, but it remains HOLD / unsigned pending Elena review of this exact 2026-03-16 packet.
- No real paid live canary was completed; the live billing hold proof remains strong but intentionally non-money-moving.
- Prior to this lane, multi-workspace billing selection remained ambiguous enough to muddy operator confidence.

---

## What I Found About The Billing Ambiguity
## Code-path finding
Before this fix, `/billing` loaded workspace context via:
- `workspace_members`
- filtered only by `user_id`
- then `.limit(1)`
- with no explicit workspace selection contract

In practice, that means a multi-workspace user could hit `/billing` and see **whichever membership row happened to be returned first**.

### Why this is a real bug, not an acceptable fallback
This behavior is especially unsafe on billing because the page is not merely informational. It also:
- displays workspace-specific billing state,
- shows identity-review warnings for one exact workspace,
- provides checkout actions that mutate billing state for one exact workspace.

So a silent first-row fallback is not a neutral UX convenience. It can make the operator:
- inspect the wrong billing status,
- miss the workspace that actually has the hold attached,
- or start checkout on the wrong workspace.

### How the live canary exposed it
The canary documented in `docs/ops/2026-03-16-openplan-live-billing-hold-canary.md` proved that:
- the hold logic itself worked,
- but the first UI read missed because `/billing` rendered a different workspace than the one initially targeted during the canary.

That is sufficient evidence to classify the ambiguity as a **real billing UX bug / operator-risk bug**.

---

## Resolution Implemented In This Lane
## Chosen fix
A billing-only fix, intentionally scoped small and safe:

1. **Single-workspace users:** behavior remains effectively unchanged.
2. **Multi-workspace users hitting `/billing` without a target:** the page now requires an explicit workspace choice before showing billing state.
3. **Explicit targeting:** `/billing?workspaceId=<uuid>` selects that workspace if the signed-in user is actually a member.
4. **Invalid target:** the page shows a safe chooser instead of silently falling back to some other workspace.
5. **After selection:** the billing page shows a visible workspace switcher so the user can confirm which workspace they are managing.

## Why this was the right scope
This resolves the risk on the highest-consequence surface without trying to invent a full cross-app workspace-selection system inside this lane.

It is safer than picking a new default heuristic because heuristics still leave room for accidental billing actions against the wrong workspace.

---

## Files Changed In This Lane
Application code:
- `openplan/src/app/(app)/billing/page.tsx`
- `openplan/src/lib/workspaces/current.ts`
- `openplan/src/test/workspace-membership-current.test.ts`

Validation artifacts added:
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-workspace-selection-tests.log`
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-workspace-selection-lint.log`
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-workspace-selection-build.log`

---

## Validation Results
All local safety gates passed in `openplan/`:
- `pnpm test` ✅
- `pnpm lint` ✅
- `pnpm build` ✅

Recorded logs:
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-workspace-selection-tests.log`
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-workspace-selection-lint.log`
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-workspace-selection-build.log`

### Production verification note
I did **not** attach a fresh authenticated production browser verification artifact in this lane.

Reason:
- the risk was tightly characterized in code and prior live evidence,
- the fix is small and deterministic,
- and this handoff is intended to support the next Principal review decision rather than pretend a fresh production browser proof already happened.

Recommended follow-through after deploy:
- re-open `/billing` as a multi-workspace user on the deployed alias,
- confirm the chooser appears with no `workspaceId`,
- confirm the held workspace warning renders when the matching `workspaceId` is selected,
- confirm checkout links preserve the intended workspace target.

---

## Exact Questions For Principal Planner Review
1. **Do you agree this ambiguity was a real billing UX bug rather than an acceptable temporary fallback?**
   - My recommendation: **yes**.

2. **Is the chosen billing-only remedy the correct v1 move?**
   - Explicit workspace choice for multi-workspace billing is safer than silent auto-selection.

3. **Does this change reduce the ship-gate ambiguity enough to remove that item as a primary blocker?**
   - My recommendation: **yes, technically**.
   - It should now be treated as **resolved in code**, with only deployment/review confirmation remaining.

4. **Is the remaining commercial caveat acceptable for current v1 posture?**
   - Specifically: billing hold logic is production-proven short of a real paid live charge.

5. **Given the packet plus this fix, should the overall gate stay HOLD or move to PASS for any internal scope?**
   - My recommendation: keep the overall gate at **HOLD** until Principal review is issued for the current-cycle packet.

---

## Principal-Review Recommendation
## Recommended status: HOLD

### Basis for HOLD
1. **Governance hold remains real** — the current-cycle principal artifact is now posted, but it remains HOLD / unsigned for this exact 2026-03-16 v1 packet until Elena adjudicates it.
2. **Commercial caveat remains real** — no real paid live canary / refreshed cancel-refund closeout in this cycle.
3. **But the specific multi-workspace billing ambiguity is now materially reduced** — it is fixed in code and no longer needs to remain an undefined or fuzzy blocker.

### Narrower truth after this lane
The right current phrasing is:
- billing workspace ambiguity was real,
- it has now been addressed with a small, safe billing-only UX guardrail,
- the remaining hold should rest mainly on **Principal review + commercial-risk posture**, not on unresolved confusion about which workspace billing is acting against.

---

## Bottom Line For Elena
This lane did not try to manufacture a final PASS.

It did the more useful thing:
- classified the billing ambiguity honestly,
- fixed it where it mattered,
- validated the fix locally,
- and converted a fuzzy blocker into a crisp review question.

**My recommendation to Elena:** review the 2026-03-16 proof packet together with this memo, keep the overall v1 gate at **HOLD** unless you are satisfied both governance and commercial posture are sufficiently closed, and treat the multi-workspace billing-selection ambiguity itself as **resolved in code pending deployment confirmation**.
