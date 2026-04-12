# OpenPlan RTP Funding Release-Review Slice — 2026-04-12

## Purpose
Extend the new Grants → Reports funding truth into RTP packet release review so board-packet records can show funding readiness and funding drift at the cycle level, not just chapter/readiness drift.

## What changed
- Added a shared aggregate helper in `openplan/src/lib/projects/funding.ts`:
  - `PortfolioFundingSnapshot`
  - `buildPortfolioFundingSnapshot(...)`
- Extended RTP packet generation in `openplan/src/app/api/reports/[reportId]/generate/route.ts` to:
  - load funding profile, award, opportunity, and invoice truth for linked RTP projects
  - build an aggregate RTP portfolio funding snapshot
  - store it into report artifact `sourceContext.rtpFundingSnapshot`
- Extended RTP report detail loading in `openplan/src/app/(app)/reports/[reportId]/page.tsx` to:
  - load live funding truth for linked RTP projects
  - parse stored `rtpFundingSnapshot`
  - compute current aggregate funding posture for drift comparison
- Extended `openplan/src/components/reports/rtp-report-detail.tsx` to surface:
  - generation-time vs current RTP funding posture
  - reimbursement posture alongside packet readiness/workflow posture
  - a new funding drift row in release review
  - generation-time funding metrics in packet source trace

## Why this matters
This closes the first RTP-side loop where grants/funding posture materially affects packet release review. A current RTP packet can now be reviewed not only for chapter/readiness drift, but also for whether the linked project portfolio funding story changed since generation.

## Validation
- Local build passed:
  - `npm run build`

## Recommended next step
- Decide whether to add a dedicated RTP production smoke for funding drift, or fold this check into the existing RTP release-review production harness.
- Likely best move: extend the existing RTP production smoke rather than creating a second overlapping RTP harness.
