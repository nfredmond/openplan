# Defensive hardening follow-up — CI, body limits, cost warning, Supabase toggles (2026-04-20)

## What shipped

Continued the defensive-hardening lane after the P1 review repair:

1. Applied the GTFS child-policy repair migration to prod.
2. Updated the root GitHub Actions workflow to run `pnpm qa:gate`.
3. Added explicit JSON body-size limits to `/api/csp-report` and `/api/analysis`.
4. Added observation-only AI cost threshold warnings on `/api/analysis`.
5. Enabled Supabase leaked-password protection through the Management API.

## Why this pairing

These are all low-surface defensive controls that lock in the security posture already established today. CI prevents local gate drift, body limits bound request processing cost, cost warnings make Anthropic spend greppable, and the Supabase toggles reduce the live advisor surface without changing user-facing behavior.

## Changes

- `.github/workflows/ci.yml` now runs `pnpm qa:gate` from `openplan/` on PRs and pushes to `main`, reusing the local lint/test/audit/build sequence instead of a partial CI sequence.
- `src/lib/http/body-limit.ts` adds `readJsonWithLimit(request, maxBytes)`.
- `/api/csp-report` caps JSON report payloads at 16 KB and returns 413 on oversize while preserving 204 for malformed/empty non-oversize reports.
- `/api/analysis` caps JSON payloads at 64 KB and returns 413 before validation/auth/data-fetching work.
- `src/lib/ai/cost-threshold.ts` adds the single-call warning threshold (`>$0.50`).
- `/api/analysis` now emits `audit.warn("analysis_cost_threshold_exceeded", …)` after `analysis_completed` when estimated single-call cost crosses that threshold. It does not block or quota requests.
- Supabase prod project `aggphdqkanxsfzzoxlbk`: `password_hibp_enabled` patched from `false` to `true`.

## Supabase state

- `20260420000064_scope_gtfs_child_feed_visibility.sql` was applied to prod with `pnpm supabase db query --linked --file ...`.
- Migration history was repaired with `pnpm supabase migration repair 20260420000064 --status applied --linked`.
- Live `pg_policies` verification shows all eight GTFS child policies join through `gtfs_feeds`.
- Live security advisors are now 3 items:
  - `rls_disabled_in_public` on `public.spatial_ref_sys` — attempted SQL fix failed with `must be owner of table spatial_ref_sys`.
  - `extension_in_public` for `postgis` — accepted risk.
  - `extension_in_public` for `pg_trgm` — accepted risk.

## Gates

Targeted checks:

```bash
pnpm exec vitest run src/test/body-limit.test.ts src/test/csp-report-route.test.ts src/test/api-smoke.test.ts
# exit 0; 3 files · 15 tests
pnpm exec vitest run src/test/ai-cost-threshold.test.ts src/test/interpret.test.ts
# exit 0; 2 files · 7 tests
```

Full gate:

```bash
pnpm qa:gate
# exit 0; lint + 177 files / 830 tests + audit (0 advisories) + build
```

## Files

- `.github/workflows/ci.yml`
- `openplan/src/lib/http/body-limit.ts`
- `openplan/src/app/api/csp-report/route.ts`
- `openplan/src/app/api/analysis/route.ts`
- `openplan/src/lib/ai/cost-threshold.ts`
- `openplan/src/test/body-limit.test.ts`
- `openplan/src/test/csp-report-route.test.ts`
- `openplan/src/test/api-smoke.test.ts`
- `openplan/src/test/ai-cost-threshold.test.ts`
- `openplan/docs/ops/2026-04-20-security-advisor-wave1-proof.md`
- `openplan/docs/ops/2026-04-20-p1-review-repair-proof.md`

## Not this slice

- Enforcing CSP. It remains report-only until violation logs have observation time.
- Blocking or quotaing AI calls by cost. This slice only emits warning telemetry.
- Moving PostGIS extensions out of `public`; that remains accepted risk for this phase.
- Fixing `spatial_ref_sys` RLS by SQL. The linked role cannot alter that PostGIS-owned table.

## Pointers

- Official Supabase docs identify leaked-password protection as an Auth password security setting and note it requires Pro or above: https://supabase.com/docs/guides/auth/password-security
- Supabase Management API exposes `password_hibp_enabled` on project auth config: https://supabase.com/docs/reference/api
