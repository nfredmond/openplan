# OpenPlan Grants → Reports Funding Snapshot Slice

Date: 2026-04-12

## Objective
Make funding posture part of report truth, not a separate grants-only side lane.

## What shipped
- Added a shared `ProjectFundingSnapshot` contract in `openplan/src/lib/projects/funding.ts`.
- Reports generation now captures `sourceContext.projectFundingSnapshot` from live:
  - project funding profile
  - funding awards
  - funding opportunities
  - billing invoice records
- Project report HTML packets now render funding posture inside the packet content.
- Reports catalog now parses and summarizes stored funding snapshots alongside evidence-chain and comparison metadata.
- `/reports` now surfaces funding posture directly on report cards.
- `/reports/[reportId]` now shows:
  - funding posture summary in controls
  - funding posture summary card in the header
  - funding drift against the latest artifact snapshot
  - a direct link back to the project’s focused grants lane

## Validation
- `npm run test -- src/test/report-catalog.test.ts`
- `npm run build`

## Why this matters
This is the first real Grants → Reports write-back seam. Funding need, award posture, pipeline coverage, and reimbursement state now travel with the report artifact instead of living only in `/grants` or project detail.

## Next likely seam
Push the same funding snapshot into RTP/release-review truth, especially cycle-level packet review where funding posture should influence readiness and packet drift, not just project-status reports.
