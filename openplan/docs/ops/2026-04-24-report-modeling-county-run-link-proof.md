# Report modeling county-run link proof

**Shipped:** 2026-04-24 Pacific
**Scope:** Let generated reports bind to the intended county-run modeling evidence instead of inferring from the latest workspace runs.

## What shipped

Reports now have an explicit nullable `modeling_county_run_id` link to `county_runs`.

`POST /api/reports` accepts `modelingCountyRunId`, verifies that the county run belongs to the target workspace, and stores it on the report. Cross-workspace or missing county-run links are rejected before the report insert.

`POST /api/reports/[reportId]/generate` now prefers that report-linked county run for both RTP packet exports and project-status reports. Older reports remain compatible: when no explicit county-run link is present, generation falls back to the existing recent-workspace-runs evidence lookup.

## Database posture

Migration `20260424000070_reports_modeling_county_run_link.sql` adds:

- nullable `reports.modeling_county_run_id`,
- a foreign key to `county_runs(id)` with `ON DELETE SET NULL`,
- a partial index for linked reports,
- a pinned-search-path workspace guard function,
- a check constraint requiring the linked county run to belong to the same workspace as the report.

Migration `20260424000071_reports_modeling_county_run_link_grants.sql` explicitly revokes `anon` execute on the workspace guard function after remote schema verification showed Supabase default privileges had granted it. The migrations are additive and do not rewrite existing report rows.

## Safety posture

- Historical reports keep generating because the new link is nullable.
- Generation remains migration-tolerant through the existing fallback report select path.
- Explicit county-run lookups audit-warn if the linked run is missing, unreadable, or cross-workspace, then render no modeling evidence instead of borrowing another workspace or arbitrary run.
- Report creation rejects invalid explicit links before insert, and the database check constraint protects direct writes.

## Files shipped

Modified:

- `openplan/src/app/api/reports/route.ts`
- `openplan/src/app/api/reports/[reportId]/generate/route.ts`
- `openplan/src/test/reports-route.test.ts`
- `openplan/src/test/report-generate-route.test.ts`

Added:

- `openplan/supabase/migrations/20260424000070_reports_modeling_county_run_link.sql`
- `openplan/supabase/migrations/20260424000071_reports_modeling_county_run_link_grants.sql`
- `openplan/src/test/report-modeling-link-migration.test.ts`

## Gates

- `pnpm test src/test/reports-route.test.ts src/test/report-generate-route.test.ts src/test/report-modeling-link-migration.test.ts src/test/rtp-export.test.ts src/test/report-catalog.test.ts`: 5 files / 43 tests passing.
- `pnpm exec tsc --noEmit`: clean.
- `pnpm qa:gate`: clean.
  - Lint: clean.
  - `pnpm test`: 208 files / 1064 tests passing.
  - `pnpm audit --prod --audit-level=moderate`: 0 known vulnerabilities.
  - `pnpm build`: production build clean.

## Production rollout

- `pnpm supabase db push --linked --dry-run`: showed only `20260424000070_reports_modeling_county_run_link.sql`.
- `pnpm supabase db push --linked --yes`: applied `20260424000070_reports_modeling_county_run_link.sql`.
- Remote schema verification confirmed the report column, FK, partial index, and check constraint.
- `pnpm supabase db push --linked --dry-run`: showed only `20260424000071_reports_modeling_county_run_link_grants.sql`.
- `pnpm supabase db push --linked --yes`: applied `20260424000071_reports_modeling_county_run_link_grants.sql`.
- Final remote schema verification confirmed no `report_modeling_county_run_matches_workspace` grant to `anon`.

## Deferred

No report-composer UI picker shipped in this slice. The API and schema now support explicit linkage, and a later report-composition workflow can pass `modelingCountyRunId` once customers need to choose among multiple runs interactively.
