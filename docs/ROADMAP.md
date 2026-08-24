# OpenPlan development roadmap

<!-- openplan-active-roadmap
reviewed_commit: 4b089a75
current_release: v0.31.0
review_by: 2026-09-07
paths:
- workers/county_onramp_worker/main.py
- openplan/src/app/api/county-runs/[countyRunId]/manifest/route.ts
- openplan/src/app/api/county-runs/[countyRunId]/cancel/route.ts
- openplan/scripts/ops/disposable-restore-drill.sh
- openplan/supabase/migrations/20260824000005_county_run_worker_lifecycle.sql
- .github/workflows/upgrade-path.yml
- docs/ops/2026-08-24-v031-integrity-mutation-proof.md
- docs/ops/2026-08-24-v031-browser-check.md
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

## Completed — v0.31 model-run and recovery integrity

- Isolate every county-worker attempt under its county-run and job identifiers.
- Bind authenticated callbacks to the active job, record heartbeats, and expose
  queued, running, cancelling, cancelled, completed, and failed states.
- Keep model runtime unlimited by default. Give a signed-in planner a cancel
  control, while refusing model-run cancellation as an assistant action.
- Prove database, evidence-custody, and storage recovery in disposable local
  Supabase stacks, then run live RLS against the restored target.
- Rehearse upgrades with representative tenant, evidence, and storage metadata.

The release evidence is recorded in
`docs/ops/2026-08-24-v031-integrity-mutation-proof.md`,
`docs/ops/2026-08-24-v031-browser-check.md`, and the CI run attached to the
v0.31 tag.

## Now — first-week reliability

- Make worker liveness and stale-heartbeat state unmistakable on the planner
  surface.
- Add per-workspace reminder preferences while reporting scheduler health
  honestly.
- Record exact crash-source cutoffs when a source publishes one.
- Research corridor-score bands or suppression when required inputs are absent;
  do not change the arithmetic to make screening estimates look precise.
- Run the preregistered 2017 NHTS mandatory-tour successor study once its five
  unresolved contracts are frozen. Preserve a negative or inconclusive result
  without changing defaults.

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
