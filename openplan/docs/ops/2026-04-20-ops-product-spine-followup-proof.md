# Operations and product-spine follow-up (2026-04-20)

## What shipped

Continued after the defensive hardening and public-submit body-limit PRs:

1. Opted the root GitHub Actions workflow into the Node 24 JavaScript action runtime.
2. Added explicit body-size limits to additional high-risk write routes.
3. Added an Admin operational warning watchboard with exact log query strings and first-response guidance.
4. Added a dashboard pilot workflow spine that moves one planning story from context to packet.
5. Re-checked the live Supabase security advisor residue.

## Changes

- `.github/workflows/ci.yml` now sets `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` for the `verify (qa gate)` job. The app runtime was already using `node-version: 24`; this targets the GitHub action-runtime deprecation annotation.
- `/api/assistant` caps JSON requests at 64 KB and returns 413 before auth/context lookup on oversize.
- `/api/report` caps legacy report export requests at 64 KB and returns 413 before auth/run lookup on oversize.
- `/api/reports/[reportId]/generate` caps structured report generation requests at 32 KB and returns 413 before auth/report lookup on oversize.
- `/api/network-packages/[packageId]/versions/[versionId]/ingest` caps inline GeoJSON prototype ingest requests at 2 MB and returns 413 before auth/package lookup on oversize.
- `src/lib/observability/operational-events.ts` defines the warning-event catalog and combined query string.
- `/admin/operations` now lists operational warning events for oversized requests, CSP report-only telemetry, and AI cost threshold warnings.
- `/admin` links to the operational warning watchboard as a live Admin module.
- `/dashboard` now includes a five-step pilot workflow spine:
  - project or county context,
  - analysis evidence,
  - engagement signal,
  - packet assembly,
  - readiness proof.

## Supabase state

Re-ran:

```bash
pnpm supabase db advisors --linked --type security
```

Live residue remains three advisor items:

- `ERROR rls_disabled_in_public` on `public.spatial_ref_sys`. Earlier SQL repair failed with `must be owner of table spatial_ref_sys`; this still needs a Supabase dashboard/support-owned change or a larger PostGIS relocation project.
- `WARN extension_in_public` for `postgis`. Accepted risk for this phase because moving PostGIS out of `public` would require a broad spatial SQL and AI-query migration.
- `WARN extension_in_public` for `pg_trgm`. Accepted risk for this phase unless a later extension-relocation project is approved.

No leaked-password-protection advisor remains.

## Gates

Targeted checks:

```bash
pnpm exec vitest run \
  src/test/assistant-route.test.ts \
  src/test/report-route.test.ts \
  src/test/report-generate-route.test.ts \
  src/test/network-package-ingest-route.test.ts \
  src/test/admin-page.test.tsx \
  src/test/admin-operations-page.test.tsx \
  src/test/dashboard-page.test.tsx
# exit 0; 7 files · 38 tests
```

Full gate:

```bash
pnpm qa:gate
# exit 0; lint + 178 files / 837 tests + audit (0 advisories) + build
```

## Files

- `.github/workflows/ci.yml`
- `openplan/src/app/api/assistant/route.ts`
- `openplan/src/app/api/report/route.ts`
- `openplan/src/app/api/reports/[reportId]/generate/route.ts`
- `openplan/src/app/api/network-packages/[packageId]/versions/[versionId]/ingest/route.ts`
- `openplan/src/lib/observability/operational-events.ts`
- `openplan/src/app/(app)/admin/page.tsx`
- `openplan/src/app/(app)/admin/operations/page.tsx`
- `openplan/src/components/dashboard/dashboard-pilot-workflow-spine.tsx`
- `openplan/src/app/(app)/dashboard/page.tsx`
- route and page tests listed above

## Not this slice

- Persisting operational warning counts in a database table. The current watchboard is log-backed and intentionally lightweight.
- Enforcing CSP. It remains report-only until warning telemetry has real observation time.
- Enabling RLS on `spatial_ref_sys` through SQL. The linked role is not the owner.
- Moving PostGIS or `pg_trgm` out of `public`.
