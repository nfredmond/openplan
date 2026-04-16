# OpenPlan RTP Review-Loop Implementation Update

**Date:** 2026-04-16  
**Owner:** Bartholomew Hale  
**Status:** Implemented in repo, proof note refreshed  
**Purpose:** record what was actually shipped in the RTP review-loop closure pass, what is now materially real, and what bounded gap remains.

## Executive Read

The RTP loop moved from "packet freshness only" toward a more truthful release-review posture.

OpenPlan now materially proves all of the following inside the repo:

1. RTP packet semantics are normalized around first packet, refresh, and release review.
2. RTP cycle and packet detail surfaces expose a bounded public-review and comment-response foundation.
3. RTP packet detail compares generation-time review-loop posture against current live review-loop posture.
4. RTP packet exports now carry that same review-loop summary into the artifact itself.
5. RTP report controls no longer imply that every current packet is automatically ready for release review.

That is a meaningful closure step.
The product is still not at a full civic-engagement operating system, but it now has a bounded, honest review-loop foundation instead of only implied readiness.

---

## What shipped in this pass

### 1. RTP packet semantics normalization
**Commit:** `3066f66` — `fix: align RTP packet work semantics`

Shipped:
- shared RTP packet action vocabulary in `openplan/src/lib/reports/catalog.ts`
- missing first packet now outranks stale packet refresh in shared priority
- registry row actions and dominant queue shortcuts now use the same normalized packet language

Why it matters:
- first generation, refresh, and release-review posture no longer drift as easily across registry surfaces

---

### 2. Bounded public-review foundation on RTP cycle detail
**Commit:** `7a3e6c3` — `feat: surface RTP public review foundation`

Shipped:
- `buildRtpPublicReviewSummary(...)` in `openplan/src/lib/rtp/catalog.ts`
- cycle-level view of review window, campaign linkage, and moderated comment basis on `openplan/src/app/(app)/rtp/[rtpCycleId]/page.tsx`

Why it matters:
- RTP cycle review posture is now a real summarized object, not just scattered status/date fields

---

### 3. Live review-loop posture on RTP packet detail
**Commit:** `b16143a` — `feat: surface live RTP review loop on packet detail`

Shipped:
- report detail data loading now pulls RTP campaign and engagement-item counts
- `openplan/src/components/reports/rtp-report-detail.tsx` now shows:
  - whole-cycle review targets
  - chapter review targets
  - ready comments
  - pending comments
  - live public-review summary

Why it matters:
- packet detail now reflects actual review-loop state, not only artifact age

---

### 4. Generation-vs-current review-loop drift on RTP packet detail
**Commit:** `fc6c7c3` — `feat: compare RTP review loop snapshots`

Shipped:
- report generation route now snapshots public-review summary and comment/campaign counts into artifact source context
- RTP report detail now compares generation-time review posture against current review posture

Why it matters:
- the artifact can now prove whether review-loop state changed after generation

---

### 5. Review-loop posture inside RTP packet exports
**Commit:** `869a323` — `feat: carry RTP review loop into packet exports`

Shipped:
- `openplan/src/lib/rtp/export.ts` now accepts and renders public-review summary data
- `openplan/src/app/api/reports/[reportId]/generate/route.ts` now passes review-loop counts and summary into export HTML
- focused export test added in `openplan/src/test/rtp-export.test.ts`

Why it matters:
- exported RTP packet artifacts now say something truthful about comment-response readiness instead of only mirroring structural packet content

---

### 6. Release-review controls aligned to comment-loop posture
**Commit:** `9de8e17` — `feat: align RTP release review controls with comment loop posture`

Shipped:
- `buildRtpReleaseReviewSummary(...)` in `openplan/src/lib/rtp/catalog.ts`
- RTP report detail now distinguishes between:
  - `Release review ready`
  - `Review loop still open`
  - `Comment basis still forming`
- report controls now surface release-review posture and the next operator move

Why it matters:
- a current packet is no longer treated as automatically settled when moderation/comment-response work is still active

---

## Current truth after this pass

## What is now materially real
- first RTP packet creation and generation
- normalized RTP packet action semantics
- bounded public-review summary object
- live comment-response posture on RTP packet detail
- generation-vs-current review-loop drift
- review-loop posture inside RTP packet exports
- release-review controls that respect comment-response readiness

## What is still bounded, not complete
- no full comment-response authoring workspace exists yet
- no dedicated board-ready response memo object exists yet
- runtime/workspace command surfaces still need a final pass so all release-review prompts use the same review-loop-aware summary, not only packet freshness
- no fresh browser-smoke/proof packet was captured in this pass

---

## Validation completed

Targeted tests passed:
- `src/test/report-catalog.test.ts`
- `src/test/rtp-catalog.test.ts`
- `src/test/rtp-report-detail.test.tsx`
- `src/test/rtp-export.test.ts`

Build status:
- `npm run build` passed after the review-loop export and release-review control changes

---

## Files materially involved in the shipped RTP review-loop pass

Core logic:
- `openplan/src/lib/reports/catalog.ts`
- `openplan/src/lib/rtp/catalog.ts`
- `openplan/src/lib/rtp/export.ts`

RTP/report surfaces:
- `openplan/src/app/(app)/rtp/[rtpCycleId]/page.tsx`
- `openplan/src/app/(app)/reports/[reportId]/page.tsx`
- `openplan/src/components/reports/rtp-report-detail.tsx`
- `openplan/src/components/reports/report-detail-controls.tsx`
- `openplan/src/components/rtp/rtp-registry-next-action-shortcut.tsx`
- `openplan/src/components/rtp/rtp-registry-packet-row-action.tsx`

Generation/export path:
- `openplan/src/app/api/reports/[reportId]/generate/route.ts`

Tests:
- `openplan/src/test/report-catalog.test.ts`
- `openplan/src/test/rtp-catalog.test.ts`
- `openplan/src/test/rtp-report-detail.test.tsx`
- `openplan/src/test/rtp-export.test.ts`

---

## Best next bounded move

### Option A, recommended
Do one more narrow semantics pass through shared runtime/workspace/report-list action surfaces so the rest of OpenPlan stops treating "packet current" as sufficient release-review truth for RTP packets.

### Option B
Run a fresh browser-smoke/proof packet for the RTP review loop and publish screenshots plus route-level evidence.

### Option C
Begin the next major loop in `/grants`, now that RTP packet review posture is materially more honest.

## Recommendation
Take **Option A first**, then **Option B**, then move harder into `/grants`.

Reason:
- the repo now has the right RTP review-loop primitives
- the remaining risk is semantic drift across shared control surfaces
- after that, a proof packet will mean more because the wording and action posture will already be aligned

---

## Bottom Line

This pass did not create the full civic-review universe.
It did something better for this stage:

It made OpenPlan more truthful.

A current RTP packet is now closer to meaning:
- the artifact is fresh,
- the review window is visible,
- comment targets are linked,
- moderated input is counted,
- and release review can distinguish between setup, active moderation, and genuine comment-response readiness.
