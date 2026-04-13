# OpenPlan Day 1 Execution Checklist — RTP Create/Generate Loop Closure

**Date:** 2026-04-13  
**Owner:** Bartholomew Hale  
**Primary implementation owner:** Iris Chen  
**Planning QA:** Elena Marquez  
**Sprint:** 2026-04-13 OpenPlan 2-week integration sprint  
**Purpose:** translate Day 1 of the integration sprint into an exact execution checklist for closing the RTP first-packet create/generate loop.

## Day 1 Objective

Close the RTP first-packet operating path so an operator can:
1. identify an RTP cycle with no packet,
2. create the first packet record from a live operating surface,
3. generate the first artifact in the same coherent flow,
4. land in a truthful post-action state,
5. and see queue/runtime posture update without stale confusion.

## Definition of done

Day 1 is done only if all of the following are true:
- the RTP create + generate path is fully real from at least one live operating surface,
- the post-action state no longer reads like the cycle still has `No packet`,
- the queue and runtime stop recommending first-packet creation after success,
- failures are explicit and recoverable,
- and the touched seam has focused regression coverage.

## Midday implementation note

### Confirmed seam
- The RTP first-packet path already existed, but it was duplicated across multiple client surfaces instead of flowing through one shared action helper.
- The duplication existed in the RTP registry row action, dominant queue shortcut, queue command board, bulk artifact actions, RTP report creator, and assistant copilot execution path.

### Day 1 implementation progress completed
- Added a shared client helper at `openplan/src/lib/reports/client.ts` for:
  - RTP packet record creation
  - immediate first-artifact generation
  - warning-count normalization
- Rewired the live RTP create/generate surfaces to use the shared helper.
- Added focused regression coverage in `openplan/src/test/reports-client.test.ts`.
- Validated the touched slice with focused Vitest coverage and targeted ESLint.

### Remaining Day 1 gate still open
- `pnpm exec tsc --noEmit` is not currently a clean proof gate for this repo because unrelated pre-existing test/type errors remain outside the RTP packet loop slice.
- Treat Day 1 as code-grounded and locally validated for the touched seam, but not yet globally type-clean.

---

## Scope for today

### In scope
- report-record creation path for RTP packets
- immediate generation handoff after creation
- post-action re-grounding
- workspace/registry queue update after success
- focused tests on the create/generate seam
- local validation on the exact touched flow

### Explicitly out of scope today
- broad RTP public-review UI
- broad semantics cleanup across all modules
- grants work
- modeling write-back beyond what is required to avoid obvious contradiction
- aesthetic UI polish beyond what is needed for truthful post-action state

---

## Exact execution checklist

## 1. Confirm the current create/generate path in code
- [ ] Inspect `openplan/src/app/api/reports/route.ts`
- [ ] Inspect `openplan/src/app/api/reports/[reportId]/generate/route.ts`
- [ ] Inspect `openplan/src/lib/assistant/operations.ts`
- [ ] Inspect RTP packet command surfaces under:
  - [ ] `openplan/src/app/(app)/rtp/page.tsx`
  - [ ] `openplan/src/app/(app)/rtp/[rtpCycleId]/page.tsx`
  - [ ] relevant RTP/report controls components
- [ ] Trace how `create_rtp_packet_record` currently resolves destination state

### Success condition
We can name the exact current execution path and identify where post-action truth is drifting.

---

## 2. Identify the specific post-action failure mode
- [ ] Confirm whether create already triggers generate or only implies it
- [ ] Confirm whether generate returns enough state to re-ground UI/runtime
- [ ] Confirm whether registry and command queue recompute correctly after success
- [ ] Confirm whether report detail and cycle detail disagree after first generation

### Success condition
We can describe the failure precisely in one sentence, not vaguely as “RTP is inconsistent.”

---

## 3. Patch the create + generate flow
- [ ] Ensure first-packet creation returns enough context for immediate generation handoff
- [ ] Ensure generation updates packet metadata/artifact state consistently
- [ ] Ensure the action path lands in one canonical stable review state
- [ ] Avoid split outcomes where one surface updates and another remains stale

### Success condition
One action path takes the user from no packet to generated packet without needing hidden second steps.

---

## 4. Patch post-action re-grounding
- [ ] Verify the destination surface reflects the new packet posture
- [ ] Verify RTP registry no longer recommends first-packet creation for the affected cycle
- [ ] Verify runtime/assistant action posture stops acting as if no packet exists
- [ ] Verify queue counts or lead commands update correctly

### Success condition
After a successful run, all touched surfaces agree the cycle now has a packet and a different next action.

---

## 5. Add focused regression coverage
- [ ] Add or update tests for first-packet create/generate transition
- [ ] Add or update tests for post-action posture on RTP registry or detail surface
- [ ] Add or update tests for queue/runtime state if helper logic is touched

### Preferred test posture
Favor focused tests around the exact seam rather than broad snapshot noise.

### Success condition
The bug class is harder to reintroduce silently.

---

## 6. Run local validation
- [ ] Run the smallest relevant test set first
- [ ] Run broader relevant tests only if touched helpers require it
- [ ] Run `pnpm build`
- [ ] If needed, run a local browser or route-level smoke on the RTP flow

### Success condition
The touched slice is build-clean and locally validated.

---

## 7. Capture proof notes for handoff
- [ ] Write down what changed
- [ ] Note which surfaces now agree
- [ ] Note any remaining known bounded gap that is intentionally deferred to Day 2

### Success condition
A later proof packet can be assembled quickly without reconstructing the story from chat.

---

## Required file seams to inspect first

### Highest priority
- `openplan/src/app/api/reports/route.ts`
- `openplan/src/app/api/reports/[reportId]/generate/route.ts`
- `openplan/src/lib/assistant/operations.ts`
- `openplan/src/app/(app)/rtp/page.tsx`
- `openplan/src/app/(app)/rtp/[rtpCycleId]/page.tsx`

### Likely supporting seams
- `openplan/src/lib/reports/catalog.ts`
- `openplan/src/lib/assistant/rtp-packet-posture.ts`
- `openplan/src/lib/operations/workspace-summary.ts`
- RTP/report control components touched by create/generate or post-action state

---

## Day 1 proof gate

Before calling Day 1 complete, answer yes to all:
- [ ] Can an RTP packet be created and generated from a live operating path?
- [ ] Does the system stop saying `No packet` after success?
- [ ] Do registry, detail, and runtime agree on the new state?
- [ ] Is the touched seam covered by focused tests?
- [ ] Is the slice build-clean?

If any answer is no, Day 1 is not done.

---

## Not-now enforcement for today

Do not let today drift into:
- grants cleanup
- modeling expansion beyond direct contradiction prevention
- broad UI redesign
- broad semantic cleanup outside touched RTP create/generate seams
- unrelated repo cleanup

Today is for one thing:

**close the RTP first-packet create/generate loop truthfully.**
