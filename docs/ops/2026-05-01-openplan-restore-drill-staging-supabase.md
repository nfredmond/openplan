# OpenPlan Restore Drill — Staging Supabase

**Date:** 2026-05-01
**Operator:** Codex acting as trusted OpenPlan operator under Nathaniel approval
**Approver:** Nathaniel Ford Redmond
**Source environment:** production Supabase
**Target environment:** dedicated non-production Supabase project `openplan-restore-drill-20260501`
**Backup id / timestamp:** private operator dump timestamp `20260501-144536`
**Started:** 14:44 PDT
**Completed:** 15:09 PDT
**Cleanup posture:** retire/delete dedicated staging project after validation
**Result:** pass

## Scope

This drill validated a staging Supabase restore path without mutating production. It restored OpenPlan schema and public-schema data into a dedicated non-production Supabase project, ran objective validation checks, and then retired the dedicated project.

Storage object replay was not in scope. Storage validation checked bucket/object posture and report-artifact metadata consistency.

## Steps Run

- Created ignored private operator directory `.operator-private/restore-drill-20260501/`.
- Generated a private staging database password under `.operator-private/`; no secret files were committed.
- Created dedicated Supabase project `openplan-restore-drill-20260501` in `us-west-2`.
- Verified the dedicated staging target was distinct from the linked production project.
- Captured private production schema dump under `.operator-private/restore-drill-20260501/supabase-backups/`.
- Captured private production `public` schema data dump under `.operator-private/restore-drill-20260501/supabase-backups/`.
- Ran `supabase db push --dry-run` against the staging DB URL.
- Applied OpenPlan migrations to staging with `supabase db push --db-url <private staging db url>`.
- Replayed the private `public` data dump into staging using Docker `postgres:15-alpine` and `psql`.
- Ran post-restore validation queries against staging only.
- Ran read-only production count comparison against the linked production project.
- Deleted the dedicated staging project after validation.
- Re-listed Supabase projects and confirmed the dedicated staging project was absent after cleanup.

## Validation

| Check | Expected | Actual | Result |
|---|---:|---:|---|
| Staging migration history count | repo migrations applied | 84 | PASS |
| Staging workspaces | matches production count | 104 | PASS |
| Staging workspace memberships | matches production count | 104 | PASS |
| Staging projects | matches production count | 29 | PASS |
| Staging reports | matches production count | 2 | PASS |
| Staging report artifacts | matches production count | 1 | PASS |
| Staging model runs | matches production count | 15 | PASS |
| Staging county runs | matches production count | 1 | PASS |
| Public tables with RLS enabled | nonzero restored policy posture | 70 | PASS |
| Public policy count | nonzero restored policy posture | 231 | PASS |
| Anon-visible private projects | 0 | 0 | PASS |
| Storage buckets | buckets present | 3 | PASS |
| `report-artifacts` bucket present | 1 | 1 | PASS |
| Storage objects | no object replay in scope | 0 | PASS |
| Report artifact storage misses | 0 | 0 | PASS |
| Dedicated staging project cleanup | project absent after delete | absent | PASS |

## Gaps Found

- The Supabase `public` data dump emitted a circular foreign-key warning for scenario tables, but replay completed successfully under `psql` with `ON_ERROR_STOP=1`.
- `supabase db query --file` could not replay `COPY ... FROM stdin` dump format; Docker `psql` was required.
- Docker needed host networking to reach the Supabase database endpoint from this environment.
- Storage object replay was not exercised in this drill; only bucket presence and report-artifact metadata consistency were validated.
- A new `.operator-private/` ignore rule was needed because the backup/restore procedure already references that private path.

## Follow-Up

- Keep `.operator-private/` out of git and remove private dump/password artifacts according to local operator retention practice.
- For the next quarterly drill, decide whether storage object replay should be included in scope.
- If a future drill requires PITR instead of dump replay, use the Supabase dashboard/PITR workflow and record sanitized evidence in a new dated log.
