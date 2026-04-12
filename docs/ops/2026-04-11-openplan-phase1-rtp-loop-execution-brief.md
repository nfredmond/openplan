# OpenPlan Phase 1 RTP Loop Execution Brief

**Date:** 2026-04-11  
**Owner:** Bartholomew Hale  
**Phase:** 1, RTP flagship loop closure  
**Purpose:** convert the ruthless execution board into the exact implementation brief for the first active build wave, grounded in the current code seams.

## Executive Summary

The current implementation wave should close the RTP flagship loop in the product, not just in planning docs.

The immediate target is this operator flow:
1. identify the lead RTP cycle that still lacks a packet,
2. create the first packet record from the live operating surface,
3. generate the first packet artifact immediately,
4. re-ground the UI and runtime into the new state,
5. normalize review/release posture across surfaces,
6. prove the flow with a current smoke and proof packet.

The important thing is that this should feel like **one coherent operating workflow**, not a set of adjacent routes that happen to exist.

---

## 1. What is already real in code

The repo already contains the core seams needed for this slice.

### Existing packet creation seam
- `openplan/src/app/api/reports/route.ts`
- existing `reports.create` logic already supports RTP cycle packet record creation
- queue trace metadata is already written for RTP cycle report creation

### Existing packet generation seam
- `openplan/src/app/api/reports/[reportId]/generate/route.ts`
- existing generation route already writes packet artifact metadata and queue-trace updates

### Existing runtime/action seam
- `openplan/src/lib/assistant/operations.ts`
- current assistant quick links already describe `create_rtp_packet_record` with `generateAfterCreate: true`
- current cycle and registry contexts already treat this as a first-class operator action

### Existing status semantics seam
- `openplan/src/lib/assistant/rtp-packet-posture.ts`
- `openplan/src/lib/reports/catalog.ts`
- current freshness labels already include:
  - `No packet`
  - `Refresh recommended`
  - `Packet current`

### Existing UI packet review seam
- `openplan/src/components/reports/report-detail-controls.tsx`
- `openplan/src/components/reports/rtp-report-section-controls.tsx`
- packet detail controls and RTP section tuning already exist

### Existing shared command seam
- `openplan/src/lib/operations/workspace-summary.ts`
- current workspace summary already knows how to surface first-packet and refresh pressure

This is good news. We do **not** need to invent the whole RTP loop from scratch.
We need to close the seams and make the flow feel complete.

---

## 2. Phase 1 scope

## In scope now

### A. First packet creation from live operating surfaces
Users should be able to trigger first-packet creation from:
- RTP registry context
- RTP cycle detail context
- relevant in-panel assistant/runtime action surfaces

### B. Immediate generation after creation
The product should not stop at “record created.”
If the action is framed as `Create + generate`, the first artifact should actually be generated in the same operating sequence.

### C. Post-action re-grounding
After create/generate succeeds:
- packet posture should update
- the destination surface should show the correct next action
- the assistant/runtime should stop acting like the cycle still has no packet

### D. Review/release semantics normalization
The meanings of:
- no packet
- refresh recommended
- current
- ready for review
- blocked for release
must stay consistent across:
- registry
- cycle detail
- report detail
- runtime quick links
- workspace command board

### E. Proof refresh
The end of this wave should produce one current proof artifact for the RTP flagship loop.

## Explicitly not in scope for this first slice
- broad grants implementation
- large engagement/public-review redesign
- general modeling UI expansion beyond packet-basis propagation
- aerial integration work
- broad runtime action registry expansion outside RTP closure

---

## 3. Required implementation outcomes

## Outcome 1, first-packet action is fully real
### Definition
From a cycle with no packet, an operator can trigger one action path that:
1. creates the report record,
2. generates the first packet artifact,
3. returns the product to a stable review-ready state.

### Acceptance criteria
- no manual hidden second step is required if the UI/runtime says `Create + generate`
- failures are explicit and recoverable
- audit/queue metadata remains intact

## Outcome 2, post-action state is truthful
### Definition
After first-packet creation/generation, all key surfaces agree that the cycle no longer has `No packet` posture.

### Acceptance criteria
- registry no longer recommends first-packet creation for that cycle
- cycle detail reflects the new packet state
- report detail opens with current packet controls
- assistant/runtime prompt changes from create/generate posture to review/release posture

## Outcome 3, release semantics are normalized
### Definition
RTP packet status language should no longer drift between modules.

### Acceptance criteria
- shared labels are reused rather than page-local synonyms
- release-review posture reads the same way in registry, report, runtime, and workspace command surfaces

## Outcome 4, proof exists
### Definition
A fresh proof note demonstrates the end-to-end RTP loop.

### Acceptance criteria
- one documented cycle path
- screenshots or equivalent proof artifacts
- explicit note on what remains bounded vs fully real

---

## 4. Code seams to touch first

## Highest-probability files in scope

### Runtime and assistant
- `openplan/src/lib/assistant/operations.ts`
  - verify `create_rtp_packet_record` execution path really closes the loop
  - verify post-action prompt and workflow transition

### Report creation
- `openplan/src/app/api/reports/route.ts`
  - confirm RTP packet record creation stays grounded and auditable
  - confirm returned payload supports immediate generation handoff cleanly

### Report generation
- `openplan/src/app/api/reports/[reportId]/generate/route.ts`
  - confirm first-artifact generation updates metadata and state consistently
  - confirm generated response contains enough state for post-action re-grounding

### Status/freshness semantics
- `openplan/src/lib/reports/catalog.ts`
- `openplan/src/lib/assistant/rtp-packet-posture.ts`
  - confirm canonical freshness/review labels and next-action summaries

### Shared command surfaces
- `openplan/src/lib/operations/workspace-summary.ts`
  - verify first-packet and refresh pressure recompute correctly after action

### UI review surfaces
- `openplan/src/components/reports/report-detail-controls.tsx`
- `openplan/src/components/reports/rtp-report-section-controls.tsx`
  - verify the user lands in a coherent review state after generation

### RTP pages and surrounding work surfaces
- relevant RTP registry and RTP cycle page components under `openplan/src/app/(app)/rtp`
- relevant report detail surfaces under `openplan/src/app/(app)/reports`

---

## 5. Implementation sequence

## Step 1, verify the `Create + generate` execution path end to end
- trace the runtime action from quick link to mutation path
- confirm first create returns enough context to trigger generate
- confirm generate returns enough context to re-ground the UI/runtime

## Step 2, normalize the post-action destination state
- after generation, the user should land in one stable review context
- decide whether the canonical destination is cycle detail, report detail, or a stable in-panel review frame
- avoid ambiguous split outcomes

## Step 3, unify packet posture language
- use shared posture helpers
- remove page-local drift in wording where possible
- keep the operator mental model simple

## Step 4, verify workspace and registry command updates
- first-packet queue count should drop
- recommended next command should update
- release-review posture should surface naturally if appropriate

## Step 5, refresh proof
- run the RTP loop
- capture proof
- document the current truth boundary

---

## 6. Validation plan

## Required checks before shipping
- relevant unit/integration tests if current coverage exists for touched seams
- local workflow smoke for RTP first-packet creation and generation
- local or production-style browser verification of the resulting operator flow
- explicit check that audit/queue metadata still updates correctly

## Required proof after shipping
- fresh docs/ops proof note for the RTP loop
- screenshots for:
  - cycle before packet exists
  - create/generate action
  - resulting packet review state
  - updated queue or command posture

---

## 7. Risks to avoid

### Risk 1, false closure
The code may already create and generate successfully, but still leave one or more surfaces reading as `No packet` because of stale local state or drift in status helpers.

### Risk 2, split mental model
If registry, cycle detail, and report detail use different review/release language, the product will still feel incomplete even if the underlying routes work.

### Risk 3, half-automated path
If the runtime advertises `Create + generate` but the user still needs hidden manual follow-through, trust drops immediately.

### Risk 4, proof lag
If the slice ships without a fresh proof artifact, the product will be stronger than the docs again, and we will lose execution clarity.

---

## 8. Definition of success for this phase brief

This brief is successful when it produces a shipped slice where:
- RTP first-packet creation is real from live operating surfaces,
- immediate generation is real,
- post-action re-grounding is calm and truthful,
- review/release semantics are more consistent,
- and one fresh proof artifact documents the flow.

That closes the first and most important seam in the RTP flagship loop and sets up the next steps cleanly.
