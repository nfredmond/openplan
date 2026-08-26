# OpenPlan development roadmap

<!-- openplan-active-roadmap
reviewed_commit: ed3b8061
current_release: v0.34.0
review_by: 2026-09-07
paths:
- openplan/src/lib/projects/portfolio-import.ts
- openplan/src/lib/projects/portfolio-workbook.ts
- openplan/src/app/api/projects/import/route.ts
- openplan/src/components/projects/project-portfolio-importer.tsx
- openplan/supabase/migrations/20260825000001_reviewed_portfolio_import.sql
- openplan/supabase/migrations/20260825000002_direct_workbook_portfolio_import.sql
- openplan/docs/ops/V033_REVIEWED_PORTFOLIO_IMPORT_PROOF_2026-08-25.md
- openplan/docs/ops/V034_DIRECT_WORKBOOK_PORTFOLIO_IMPORT_PROOF_2026-08-25.md
- docs/modeling/MANDATORY_TOUR_2017_SUCCESSOR_RESULT_2026-08-24.md
- docs/modeling/SEALED_STUDY_EXECUTION_PROTOCOL.md
- docs/product/PORTFOLIO_SPREADSHEET_IMPORT_RESEARCH_2026-08-24.md
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

## Completed: crash-safe sealed evidence execution

- Do not rerun or reconstruct the consumed 2017 exercise. A future successor
  study requires a genuinely untouched source and a separately frozen,
  streaming evaluator.
- Standardize one-host leases, durable one-opening receipts, bounded-memory
  ZIP-to-SQLite staging, aggregate-only validation, and interruption recovery
  before another sealed study is attempted. No new feature lane is scheduled
  from this result.

The reusable runner, schemas, frozen 2017 hash guard, interruption recovery,
bounded-memory proof, and protocol landed in `edfe829b`. The 2017 evidence files
remain byte-for-byte unchanged.

## Completed — v0.33 reviewed portfolio CSV import

- Let a planner bring a multi-row project table into the existing Projects
  portfolio without re-entering every project.
- Store the source before any project write, map only named fields, and require
  currency, cost scale, and price year when a cost column is mapped.
- Default every valid row to `skip`, allow explicit `create`, and block repeated
  source IDs. Name matches are warnings that require individual confirmation
  and never update keys.
- Create only the rows a human confirms. The first slice does not update or
  merge existing projects.
- Preserve source hash, row number, mapped source ID, row fingerprint, mapping,
  actor, import time, and created project ID so a rerun cannot create copies.
- Keep the write human-only and record the assistant-action refusal when it
  ships.

The scope research remains in
`docs/product/PORTFOLIO_SPREADSHEET_IMPORT_RESEARCH_2026-08-24.md`; the parser,
atomic commit, source-custody, live-RLS, mutation, and desktop/mobile browser
evidence landed in `3ee6dafa` and is recorded in
`openplan/docs/ops/V033_REVIEWED_PORTFOLIO_IMPORT_PROOF_2026-08-25.md`. Official
agency examples are usually XLS or XLSX, so CSV was deliberately the first
parsed format rather than the final format boundary.

## Completed — v0.34 direct workbook portfolio import

- Read stored CSV, XLS, XLSX, and ODS sources directly, with bounded archive
  expansion before compressed workbooks reach the parser.
- Inspect every worksheet without selecting one automatically. Keep each
  selected sheet's header, mappings, defaults, and cost units independent.
- Combine selected sheets in physical order, preserve typed cells, require
  row-level confirmation for cached formulas and name matches, and block
  formula errors and duplicate source IDs across the whole batch.
- Commit through one versioned transaction that rechecks role, source scope,
  hash, format, sheet identity, rows, and current duplicates while retaining
  v0.33 CSV compatibility.
- Preserve sheet-aware immutable row provenance without letting source location
  text populate a project's map fields.

Implementation, public-file parsing, mutation proof, full tests, workers, live
RLS, build, and the populated upgrade rehearsal are recorded in
`openplan/docs/ops/V034_DIRECT_WORKBOOK_PORTFOLIO_IMPORT_PROOF_2026-08-25.md`.
The real Chrome journey found and closed a missing cost-metadata request seam,
then passed desktop and 390px sign-in, import, created-project, durable-history,
console, request-failure, and horizontal-overflow checks.

## Later

- Additional jurisdiction-specific legal bundles.
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
