# OpenPlan Migration Inventory Preflight Proof

**Date:** 2026-05-10
**Scope:** read-only Supabase migration inventory / operator guard
**Product posture:** supervised OpenPlan pilot readiness; no production data writes and no schema apply.

## What This Proves

OpenPlan now has a local operator preflight that inventories migration files before any Supabase work is considered. The guard is intentionally read-only:

- reads `supabase/migrations` from disk only,
- never connects to Supabase,
- never applies migrations,
- never prints environment secrets,
- checks naming, duplicate timestamps, duplicate slugs, empty files, and operator-review patterns.

## Command

```bash
cd openplan
npm run ops:check-migration-inventory -- --max-review 6
```

## Current Local Result

```text
OpenPlan Supabase migration inventory (read-only)
Status: OK

Migrations: 85
First: 20260219000001_gtfs_schema.sql
Latest: 20260508000079_modeling_caveat_kpi_sql_gate.sql
Duplicate timestamps: none
Duplicate slugs: none
Invalid SQL filenames: none
Empty migrations: none
Operator-review patterns: 55
```

Operator-review patterns are informational by default because historical migrations legitimately include RLS policies, storage policies, privilege changes, drops, and `SECURITY DEFINER` functions. Use `--fail-on-review` for a stricter manual release gate when reviewing a new migration batch.

## Validation

```bash
npm test -- --run src/test/migration-inventory-script.test.ts
```

Result: 5 tests passing.

## Release Handling

This proof supports the admin/support/hosting lane in the pilot-readiness checklist. It does not replace Supabase local start, migration replay, staging restore drills, production backup checks, or human approval for schema changes.
