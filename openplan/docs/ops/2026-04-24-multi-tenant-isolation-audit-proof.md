# Multi-tenant isolation audit proof

**Shipped:** 2026-04-24 Pacific
**Scope:** C.4 paid-access hardening gate for direct workspace-scoped tables, Supabase advisor posture, and CSP enforcement readiness.

## What changed

Added `src/test/rls-isolation.test.ts`, a paid-access RLS inventory and live isolation harness for every direct `workspace_id` table currently exposed in the public schema.

The default test is safe for normal `pnpm test`: it asserts the 38-table audit inventory and the intentional service-only posture for `billing_webhook_receipts`.

The live path is opt-in with `OPENPLAN_RLS_LIVE_TEST=1`. It uses local Supabase only, creates two temporary users and two explicit workspaces, seeds one tenant-B fixture per audited table with the service role, then proves:

- service role can see the seeded fixtures,
- anon clients cannot see tenant-B rows,
- an authenticated tenant-A member cannot see tenant-B rows,
- tenant-B members can read normal workspace rows,
- service-only ledgers remain hidden from tenant-B members.

The live test cleans up the explicit RLS workspaces, the auth-trigger-created workspaces, and the temporary auth users. A post-run local query confirmed zero leftover `rls-%` workspaces.

Also flipped the global CSP header from `Content-Security-Policy-Report-Only` to enforcing `Content-Security-Policy` after a 48-hour Vercel runtime-log query returned no `csp_violation` lines. The sink remains live through `report-uri /api/csp-report`, and `src/test/security-headers.test.ts` now locks that enforce-mode posture.

## Production checks

All production checks in this slice were read-only. No production workspace, membership, invitation, billing, or customer data was inserted, updated, or deleted.

Captured evidence lives under:

```text
docs/ops/2026-04-24-test-output/multi-tenant-isolation-audit/
```

Production direct workspace table inventory:

```text
pnpm supabase db query --linked -o csv "select table_name from information_schema.columns where table_schema='public' and column_name='workspace_id' order by table_name;"
# 38 tables
```

Production RLS summary:

```text
pnpm supabase db query --linked -o csv "with workspace_tables as (...) select wt.table_name, c.relrowsecurity as rls_enabled, count(p.policyname) as policy_count ..."
# all 38 direct workspace tables have rls_enabled=true
```

Supabase security advisors:

```text
pnpm supabase db advisors --linked --type security --level info -o json
# INFO  billing_webhook_receipts has RLS enabled with no policies
# ERROR spatial_ref_sys has RLS disabled
# WARN  postgis extension is installed in public
# WARN  pg_trgm extension is installed in public
```

Residual posture:

- `billing_webhook_receipts` has no policies by design. It is service-role-only and all access flows through the Stripe webhook handler.
- `spatial_ref_sys` is a PostGIS-owned system table. It remains the same accepted Wave-3 item from the earlier advisor hardening work.
- `postgis` and `pg_trgm` remain in `public`; moving extensions is deferred because it is a higher-risk database operation than this paid-access audit needs.

CSP log evidence:

```text
vercel logs --environment production --since 48h --query csp_violation --json --scope natford --no-branch
# no matching log lines
```

The empty JSONL capture is committed as `vercel-csp-violation-logs.jsonl`.

## Verification

Local schema refresh:

```text
pnpm supabase db reset --local
# applied all migrations through 20260424000073_workspace_invitations.sql
```

Targeted default test:

```text
pnpm test src/test/rls-isolation.test.ts
# 1 passed, 4 skipped
```

Local live RLS test:

```text
OPENPLAN_RLS_LIVE_TEST=1 pnpm test src/test/rls-isolation.test.ts
# 5 passed
```

Post-run cleanup check:

```text
select count(*) as leftover_rls_workspaces
from public.workspaces
where slug like 'rls-%';
# 0
```

Header regression test:

```text
pnpm test src/test/security-headers.test.ts
# 1 passed
```

TypeScript:

```text
pnpm exec tsc --noEmit
# passed
```

Full gate:

```text
pnpm qa:gate
# lint passed
# test passed: 224 files, 1137 tests, 4 skipped
# pnpm audit --prod --audit-level=moderate: no known vulnerabilities
# next build --webpack passed
```

## URL penetration posture

A literal production browser walk as "workspace A user opening workspace B URLs" was not run in this slice because that requires a real demo-owner browser session and real resource URLs. This proof does not claim that smoke happened.

The automated substitute is stronger at the data boundary: the live RLS harness uses real local Supabase auth tokens, real RLS policies, and production-parity migrations to prove tenant-A reads return no tenant-B rows for every direct workspace-scoped table. The full route test suite also includes existing 403/404 membership and resource-boundary coverage for the main write/read APIs, including runs, reports, scenarios, network package ingest, stage-gate decisions, funding awards, engagement campaigns, invoices, and workspace invitations.

Before external credentials are issued, run one browser smoke with a synthetic workspace-A user against enumerated workspace-B detail URLs. That should be a no-data-risk final check, not a blocker on the schema/RLS proof landed here.

## Customer-readiness effect

This closes the main external-access isolation proof needed before a supervised paid pilot: billing readiness is already canary-ready, provisioning/invites are in place, and this slice proves direct workspace-scoped reads do not cross tenants under local RLS with production schema parity. The remaining non-legal readiness work is operational: monitoring, support posture, and request-access/onboarding surfaces.
