# Security-advisor Wave-1 + W2.1 — proof (2026-04-20)

## What shipped

Three migrations against prod project `aggphdqkanxsfzzoxlbk`. Closes every Wave-1 code slice + Wave-2's SECURITY DEFINER ERROR from the scoping doc at `docs/ops/2026-04-20-security-advisor-backlog.md`.

### M1 — `20260420000061_pin_function_search_paths.sql` (W1.1 + W1.5)

- 34 `ALTER FUNCTION public.<name>(...) SET search_path = public, pg_temp;` statements.
- `COMMENT ON TABLE public.billing_webhook_receipts` documenting intentional service-role-only posture.

### M2 — `20260420000062_public_data_select_policies.sql` (W1.2)

- 10 SELECT policies wrapped in `IF NOT EXISTS` guards.
- Covers GTFS child tables (`agencies`, `routes`, `stops`, `trips`, `stop_times`, `calendar`, `calendar_dates`, `shapes`) + Census/LODES base tables (`census_tracts`, `lodes_od`).
- Census/LODES remain permissive (`USING (true)`) because they are public-domain base data. GTFS child rows inherit `gtfs_feeds` visibility: public feeds are readable by anyone, workspace-scoped feeds are readable only to members of that workspace.
- `COMMENT ON POLICY` on each pointing back to the scoping doc.

### M2 repair — `20260420000064_scope_gtfs_child_feed_visibility.sql`

Reviewer pass caught that the first applied version of M2 had overly broad GTFS child-table policies. This forward migration drops/recreates the 8 GTFS child policies so environments that already applied `20260420000062` are repaired without rewriting migration history. The original migration file is also corrected for fresh local resets.

### M3 — `20260420000063_public_views_security_invoker.sql` (W2.1)

- `ALTER VIEW ... SET (security_invoker = true)` on `public.census_tracts_computed` and `public.lodes_by_tract`.
- Depends on M2 — the views now run as caller, so the underlying tables need permissive SELECT policies (added in M2) for the views to return data.

## Advisor diff

Live `mcp__supabase__get_advisors(type=security)` counts, before → after:

| Level | Before | After | Delta |
|---|---|---|---|
| ERROR | 3 | 1 | −2 |
| WARN | 37 | 3 | −34 |
| INFO | 11 | 1 | −10 |
| **Total** | **51** | **5** | **−46** |

**Remaining 3 items** after the P1 follow-up and leaked-password toggle:

1. `rls_disabled_in_public` ERROR — `public.spatial_ref_sys`. PostGIS system table is not owned by the linked SQL role; direct SQL returned `ERROR: must be owner of table spatial_ref_sys`.
2. `extension_in_public` WARN × 2 — `postgis`, `pg_trgm`. Accepted risk (see scoping doc W2.2 option 1). Moving is a breaking change not worth the cost/benefit at current scale.

Closed after this proof was first written:

- `auth_leaked_password_protection` WARN — enabled through the Supabase Management API with `password_hibp_enabled: true`.
- `rls_enabled_no_policy` INFO — no longer present in the advisor output after the Wave-1 posture documentation.

## Data-path verification

Post-migration on prod:

```sql
SELECT count(*) FROM public.census_tracts;          -- 0 (not seeded yet)
SELECT count(*) FROM public.census_tracts_computed; -- 0 (view passthrough)
SELECT count(*) FROM public.lodes_od;                -- 0 (not seeded yet)
SELECT count(*) FROM public.lodes_by_tract;          -- 0 (view passthrough)
```

Zero rows is the expected baseline — Census/LODES have never been loaded into this Supabase project. The views correctly passthrough under `security_invoker = true` with the new `public_read_*` policies on their base tables. When Census+LODES seeds land, queries will return data without policy changes.

GTFS child-table policy posture after the repair:

```sql
EXISTS (
  SELECT 1
  FROM public.gtfs_feeds feed
  WHERE feed.id = <child_table>.feed_id
    AND (
      feed.workspace_id IS NULL
      OR feed.workspace_id IN (
        SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
      )
    )
)
```

This preserves the documented public-feed behavior while preventing workspace-scoped feed rows from leaking across tenants.

## Gates

Run from `openplan/`:

```bash
pnpm exec tsc --noEmit                                                   # exit 0
pnpm exec vitest run src/test/markdown-render.test.ts src/test/gtfs-child-policies.test.ts  # exit 0; 2 files · 19 tests
pnpm test -- --run                                                       # exit 0; 175 files · 824 tests
pnpm lint                                                                # exit 0; 0 warnings
pnpm build                                                               # exit 0
```

`src/test/gtfs-child-policies.test.ts` is the regression tripwire for the review finding.

## Files

- `openplan/supabase/migrations/20260420000061_pin_function_search_paths.sql`
- `openplan/supabase/migrations/20260420000062_public_data_select_policies.sql`
- `openplan/supabase/migrations/20260420000063_public_views_security_invoker.sql`
- `openplan/supabase/migrations/20260420000064_scope_gtfs_child_feed_visibility.sql`

## Next actions

Wave-1 follow-up state:

- **W1.3** — `spatial_ref_sys` remains open; linked SQL role cannot alter the PostGIS-owned system table.
- **W1.4** — Leaked Password Protection is enabled.

The remaining extension warnings are accepted risk for this phase. Wave-3 is complete — no further SQL slices needed from the scoping doc unless a Supabase owner-level path appears for `spatial_ref_sys`.
