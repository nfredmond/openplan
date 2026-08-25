# OpenPlan development roadmap

<!-- openplan-active-roadmap
reviewed_commit: 92fb82e0
current_release: v0.32.0
review_by: 2026-09-07
paths:
- workers/aequilibrae_worker/worker_heartbeat.py
- workers/activitysim_worker/worker_heartbeat.py
- openplan/src/lib/models/worker-health.ts
- openplan/src/lib/notifications/reminder-preferences.ts
- openplan/src/lib/safety/sources/types.ts
- openplan/src/lib/analysis/score-presentation.ts
- openplan/supabase/migrations/20260824000006_worker_health_reminder_preferences_and_crash_cutoff.sql
- .github/workflows/upgrade-path.yml
- docs/ops/V032_OPERATIONAL_HEALTH_PROOF_2026-08-24.md
- docs/ops/2026-08-24-v032-browser-check.md
- docs/product/CORRIDOR_SCORE_PRESENTATION_RESEARCH_2026-08-24.md
- docs/modeling/MANDATORY_TOUR_2017_SUCCESSOR_RESULT_2026-08-24.md
- docs/product/LAND_USE_PLANS_CONTRACT.md
- docs/ADRs/ADR-004-mcp-server-surface.md
npm_commands:
- ops:restore-drill
- test:workers
- test:rls-live
- qa:gate
-->

This is OpenPlan's only active development queue. Dated records under
`docs/ops/`, research results, release evidence, and ADRs remain evidence; they
are not queues. Reconcile this file against the repository by the review date
above. Work advances when its evidence gate passes, not on a calendar promise.

## Completed — v0.32 operational health and evidence honesty

- Surface fresh, stale, absent, conflicting, and unknown AequilibraE and
  ActivitySim worker capabilities without treating liveness loss as run failure.
- Let owners and admins configure a 1–30 day reminder window and email digests,
  while keeping in-app reminders and scheduler-health warnings mandatory.
- Carry exact crash-source publication cutoffs only when the source supplies one.
- Withhold corridor component and composite scores whose required evidence is
  unavailable across the interface, reports, exports, comparisons, and assistant
  facts; retain supported component evidence and the stored arithmetic.
- Refuse assistant changes to reminder preferences and model-run cancellation.

The release evidence is recorded in
`docs/ops/V032_OPERATIONAL_HEALTH_PROOF_2026-08-24.md`,
`docs/ops/2026-08-24-v032-browser-check.md`, and the CI run attached to the
v0.32 tag.

## Completed — sealed 2017 NHTS successor checkpoint

- The five unresolved contracts, official archives, candidate, evaluator, and
  thresholds were frozen before outcome access. Mutation checks proved the
  decision, safety-domain, replicate, leakage, and one-opening gates.
- The durable receipt was written before source loading, but the evaluator
  process terminated before committing aggregate metrics. The opening is
  permanently consumed, so the result is inconclusive, no candidate is
  registered, and no default changes.

The preregistration and result are recorded in
`docs/modeling/MANDATORY_TOUR_2017_SUCCESSOR_PREREGISTRATION_2026-08-24.md` and
`docs/modeling/MANDATORY_TOUR_2017_SUCCESSOR_RESULT_2026-08-24.md`.

## Now — preserve the evidence boundary

- Do not rerun or reconstruct the consumed 2017 exercise. A future successor
  study requires a genuinely untouched source and a separately frozen,
  streaming evaluator. No new feature lane is scheduled from this result.

## Later

- Additional jurisdiction-specific legal bundles.
- Portfolio CSV import with provenance.
- Provenance-carrying road-name geocoding.
- Printable street backgrounds.

These move forward only when a planner outcome or new evidence justifies them.
No new module is scheduled.

## Rejected

- Averaging AequilibraE and ActivitySim. Agreement is sensitivity evidence, not
  accuracy, and both values retain their provenance.
- Changing a model default to rescue a failed or inconclusive study.
- Runtime cutoffs for long model runs. Explicit cancellation handles stuck work
  without trading away accuracy.
- Treating unsupported road coverage as zero.

## Deferred

- Crash rates per modeled VMT, until modeled road coverage supports a defensible
  denominator.
- MCP and Buzz control surfaces. ADR-004 preserves the accepted server-only
  architecture, but implementation waits until the existing modules are mature.
- The `1.0` release. It requires worker integrity, a successful restore drill,
  populated upgrade rehearsal, all seven fresh-account journeys, mutation
  evidence, live RLS, build, and CI against one candidate commit.
