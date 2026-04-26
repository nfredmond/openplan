# OpenPlan Supabase readiness sweep

**Checked:** 2026-04-25 Pacific  
**Scope:** Non-Stripe Supabase readiness only: schema/migrations, environment contract, RLS/auth boundaries, workspace persistence, and existing proof artifacts. No production writes, Stripe smoke, email delivery, or invitation-token exposure.

## Finding

OpenPlan is adequately addressed for the current non-Stripe Supabase readiness lane.

The repo has a live Supabase integration rather than placeholder persistence:

- `src/lib/supabase/server.ts` creates cookie-backed `@supabase/ssr` server clients and a non-persistent service-role client with explicit missing-env errors.
- `src/lib/supabase/client.ts` creates the browser client from `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Auth-gated app pages and route handlers use `supabase.auth.getUser()` before protected reads/writes.
- Workspace selection flows through `src/lib/workspaces/current.ts`, which resolves current `workspace_members` records and shell state.
- The migrations directory contains 83 SQL migration files through request-access provisioning (`20260424000077_access_request_provisioning_link.sql`).
- The local project is linked to Supabase project ref `aggphdqkanxsfzzoxlbk` via `supabase/.temp/project-ref`.

## Environment contract

Tracked key catalog: `.env.example`.

Required Supabase keys are present in the catalog:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Operational hygiene is documented in `docs/ops/2026-04-16-env-local-hygiene.md`: `.env.local` is local-safe only, production overrides belong in `.env.production.local`, and `.env*` files are gitignored.

## RLS and service-role posture

Local migration evidence shows broad RLS coverage:

```text
migration_count=83
enable_rls=70
create_policy=239
revoke_all=14
```

Current proof and test coverage:

- `docs/ops/2026-04-24-multi-tenant-isolation-audit-proof.md` documents the 38-table workspace RLS inventory and local live isolation harness.
- `src/test/rls-isolation.test.ts` locks the 38 direct `workspace_id` tables and the intentional service-only posture for `billing_webhook_receipts`.
- `src/test/access-requests-migration.test.ts` locks `access_requests` and `access_request_review_events` as service-role-only, RLS-enabled, no user policies, no `SECURITY DEFINER` recorder functions.
- `src/test/workspace-invitations-migration.test.ts` covers workspace invitation table posture.
- `src/test/current-workspace-route.test.ts` and `src/test/workspace-membership-current.test.ts` cover the current-workspace membership path.

## Validation run in this sweep

```text
npm test -- \
  src/test/rls-isolation.test.ts \
  src/test/access-requests-migration.test.ts \
  src/test/workspace-invitations-migration.test.ts \
  src/test/workspace-membership-current.test.ts \
  src/test/current-workspace-route.test.ts

# 5 files passed
# 22 tests passed, 4 skipped
```

Note: `pnpm` was not on this shell PATH, so the equivalent `npm test -- ...` path was used. This did not require external services.

## Residuals / next non-Stripe lane

No Supabase schema or auth blocker surfaced in this sweep.

Recommended next non-Stripe lane: run a browser-level workspace-A vs workspace-B URL smoke with synthetic users before issuing outside credentials. The existing RLS harness proves the data boundary; the browser smoke would prove route-level UX and URL handling with real sessions.
