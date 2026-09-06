# Safety acquisition custody repair

## Confirmed failure

The first-week run `2026-09-05T04-35-57-945Z` found a release blocker in
`04-safety-case`. A ready acquisition retained its 4,781 reported and 4,123
mappable totals but displayed zero fatal or serious-injury crashes after another
pull. Retrieving again restored 361. The run was deliberately interrupted during
job 05 when the database check confirmed overwritten acquisition membership.
It is not a completed twelve-job gate.

Read-only database inspection found zero rows under acquisitions
`63d1bfa8-4012-4d6c-a296-4a3cf9bb7457` and
`6c1c3e1c-a909-442d-9ef3-e58ca8daaff1`, with all 4,123 rows now under
`eb50a548-ed67-41ab-9a94-50cba0b01bc3`. All three still had ready metadata.
The first two memberships were overwritten, not proof of zero crashes.

Both crash and person upserts conflicted on workspace/source/external identity,
excluding acquisition identity. They updated `ingest_id` on existing rows.
Exact-acquisition readers then correctly found empty old acquisitions.

## Correction and limits

Nathaniel approved replacing the constraints. Migration
`20260905000002_safety_acquisition_custody.sql` adds acquisition identity to both
unique keys, without deleting or rewriting existing rows. Each new acquisition
records its actual stored count separately from reported and geocoded source
totals. Failed receipt writes cannot return ready.

The shared evidence reader reconciles unfiltered crash and person counts before
offering derived figures. An older non-truncated acquisition can be reconciled
against its recorded geocoded count. A truncated legacy acquisition has no exact
stored denominator and remains unavailable. Historical missing memberships are
not reconstructed from a newer pull. The original source totals remain visible.

Safety reads and downloads bind the exact displayed acquisition. Missing custody
withholds counts and exports; no acquisition is not zero crashes. New requests
cancel older reads so a late response cannot replace the new acquisition's
result. The project evidence package uses the newest project acquisition's
geometry instead of a union of repeated pulls. The assistant withholds an
unreconciled severity mix.

Workspace map layers use `safety_crashes_latest`, a security-invoker view with one
latest observation per workspace/source/case. Acquisition readers still use the
original table. This is deduplication for an overview, not method averaging or
historical snapshot repair.

## Verification checkpoint

Local logs are preserved under
`~/.local/state/openplan/release-checks/v044-2026-09-05/`.

- Before migration, the real producer regression failed because the new conflict
  key had no matching database constraint. After migration, repeated synthetic
  source pulls through the real producer retained both crash and person records,
  and the signed-in member's workspace view counted the source case once. A
  signed-in non-member saw no rows.
- All 135 live RLS checks passed, including the new custody regression and the
  nullable price-year RPC cases. The first custody attempt passed assertions but
  failed cleanup because user creation automatically creates a personal
  workspace. Cleanup was corrected, the suite reran successfully, and the two
  leftover synthetic users and their empty personal workspaces were removed.
- A no-op comment mutation survived. Removing retained-total reconciliation,
  the stored-count projection, person-count reconciliation, map custody gating,
  export custody gating, exact export identity, old-request cancellation, either
  new upsert key, or receipt-failure handling caused the expected assertions to
  fail. Source was restored after each mutation. The party-key mutation ran
  against the real local database and failed because both expected person rows
  were absent.
- A separate transaction-local security mutation changed the view to execute as
  its owner. The non-member assertion failed with `custody view exposed
  observations to a non-member`. Closing that failed transaction rolled back
  the mutation; the catalog again reported `security_invoker=true`. Other
  sessions never saw the altered view.
- The restored focused suites passed 72 tests. TypeScript passed. Full-suite
  diagnostics exposed stale fixture denominators and the intentionally stale
  direction-review pointer; those are not a passing full-suite claim.

These tests do not establish real-source coverage, geographic completeness,
browser reachability, or an untouched acceptance result. Browser proof,
final QA, remote CI/upgrade, and a fresh complete first-week outcome gate remain
required before release. The distributed-loading candidate remains retired and
inconclusive. Frozen model studies, holdouts, and production defaults are unchanged.
