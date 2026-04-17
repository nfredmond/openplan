---
title: OpenPlan stale-mark reader audit (follow-up on 2026-04-17 retro)
date: 2026-04-17
head_sha: 9f61820
scope: T3 (rtp_basis_stale) / T4 (scenario writeback stale propagation)
---

# Stale-mark reader audit

## Why this audit

The 2026-04-17 program retrospective flagged a "writer wired, reader
dead" pattern after the T16 caveat-gate audit. Action item: inventory
stale-mark columns (T3/T4) and confirm at least one reader per column
before calling them integrated.

## Method

Grepped `rtp_basis_stale` and the two writer helpers
(`markScenarioLinkedReportsBasisStale`,
`touchScenarioLinkedReportPackets`) across `src/`, classifying each
hit as **writer / reader / test**.

## Findings

### `rtp_basis_stale` column (T3/T4)

**Status: fully wired loop. Not a dead-reader case.**

| Caller | Role | Path |
| --- | --- | --- |
| `markScenarioLinkedReportsBasisStale` | writer helper | `src/lib/reports/scenario-writeback.ts:83` |
| `POST /api/models/[modelId]/runs` | writer (run create, stale branch) | `src/app/api/models/[modelId]/runs/route.ts:455` |
| `PATCH /api/models/[modelId]/runs/[modelRunId]` | writer (run update) | `src/app/api/models/[modelId]/runs/[modelRunId]/route.ts:155` |
| `/reports/[reportId]/page.tsx` | **reader** (renders stale banner) | `src/app/(app)/reports/[reportId]/page.tsx:453, 1636, 1642, 1645, 1662` |

The report detail page reads all four stale columns
(`rtp_basis_stale`, `rtp_basis_stale_reason`, `rtp_basis_stale_run_id`,
`rtp_basis_stale_marked_at`) and renders a banner with reason + marked
timestamp. Regenerating the packet clears the staleness.

### `touchScenarioLinkedReportPackets` helper

The *soft* variant — just bumps `reports.updated_at` instead of setting
the stale flag — is called from **five** production routes when a
scenario mutation shouldn't invalidate the report basis but should
refresh the "last touched" timestamp:

- `src/app/api/models/[modelId]/runs/route.ts:430`
- `src/app/api/models/[modelId]/runs/[modelRunId]/route.ts:130`
- `src/app/api/scenarios/[scenarioSetId]/route.ts:433`
- `src/app/api/scenarios/[scenarioSetId]/spine/comparison-snapshots/route.ts:340`
- `src/app/api/scenarios/[scenarioSetId]/entries/[entryId]/route.ts:174`

Readers are every surface that shows `reports.updated_at` — reports
list page, report detail page, workspace-operations summary. No
concern about the reader side here.

## Verdict

T3 and T4 are **integrated**: writers fire in real API routes, the
reader surface renders the result, a full round-trip is possible
without any design-gap escalation. The "writer wired, reader dead"
pattern from T16 is (so far) a one-off — not a recurring systemic
issue across the 2026-04-16 program.

## What this does not cover

- **No live proof of the full round-trip.** Unit tests exercise both
  writers and the reader against mocks. A live proof would require
  seeding a scenario set with an attached model run, triggering a
  run-status transition, and observing the report banner surface. That
  would fit well on the T4 live-proof slot in the retro's deferred
  list — recommended as the next stale-mark work, not this audit.
- **Other potential stale-marks.** Only `rtp_basis_stale` and the
  `touchScenario*` helpers were audited. If new stale-mark columns
  are added by future tickets (e.g., `aerial_posture_stale` for when
  a mission is cancelled, or `funding_award_stale` for closeout
  drift), repeat this pattern: grep writer → reader → UI surface.

## Recommendation

Amend the 2026-04-17 retrospective: T3/T4 are fully integrated at
the reader level. Leave T16 as the one outstanding reader-dead case.
Promote "live-proof the scenario writeback round-trip" from the
deferred list to the active queue.
