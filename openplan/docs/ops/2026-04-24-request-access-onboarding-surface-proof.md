# Request access onboarding surface proof

**Shipped:** 2026-04-24 Pacific
**Scope:** C.2/C.7 first-customer request-access and supervised onboarding intake surface.

## What changed

Added a public request-access path that can collect first-customer interest without creating production workspaces, subscriptions, or outbound messages:

- `GET /request-access`
  - public early-access intake page,
  - server-rendered shell with one client form island,
  - language keeps provisioning, billing, and follow-up explicitly supervised.
- `POST /api/request-access`
  - public JSON route with a 16 KB body limit,
  - zod validation for agency/contact/workflow fields,
  - honeypot discard path,
  - service-role insert into `access_requests`,
  - duplicate-open-request handling through a partial unique index.
- `access_requests` migration
  - service-role-only prospect-contact table,
  - RLS enabled,
  - no anon/authenticated table grants or policies,
  - no `workspace_id` column, so it does not become tenant-readable workspace state,
  - partial unique index limiting one open request per normalized email.
- `/admin/operations`
  - new recent access-request review lane,
  - contact rows render only when the signed-in operator email is allowlisted by `OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS`,
  - when the env var is unset or the user is not allowlisted, the page renders a locked state and never opens the service-role client.

Public entry links were added from the landing page and pricing page. Existing sign-up and pricing lanes remain available; request-access is a review-first alternative, not a replacement.

## Guardrails

No outbound email is sent by this slice.

No workspace is automatically provisioned by this slice.

No pricing commitment is made beyond the existing pricing page.

Prospect contact data is stored behind service-role access only. The public route can write through the server-side service client, but anon/authenticated clients receive no table grants and no RLS policies.

The admin review surface is intentionally locked unless `OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS` contains the signed-in operator email. This avoids exposing prospect PII to ordinary workspace members or broad admin-page viewers.

Production POST smoke is intentionally skipped because it would create a real prospect-contact row. Live smoke should stay to non-mutating page checks unless Nathaniel approves a test row and cleanup plan.

## Test coverage

Added focused coverage for:

- access-request helper normalization, allowlist parsing, and source metadata hashing,
- migration guardrails for RLS, grants, no workspace-scoped column, pinned trigger search path, and append-only posture,
- `POST /api/request-access` success, validation failure, body cap, honeypot, duplicate-open-request, and insert failure behavior,
- public request-access page content and form submission behavior,
- admin operations locked state and allowlisted service-role review state.

Local verification:

```text
pnpm test src/test/access-requests.test.ts src/test/access-requests-migration.test.ts src/test/access-request-route.test.ts src/test/request-access-form.test.tsx src/test/request-access-page.test.tsx src/test/admin-operations-page.test.tsx src/test/pricing-page.test.tsx
# 7 files, 22 tests passed

pnpm exec tsc --noEmit
# passed

pnpm qa:gate
# passed: lint, 231 test files / 1161 tests passed, 4 skipped, prod audit clean, next build --webpack
```

## Production rollout

Completed:

- `pnpm supabase link --project-ref aggphdqkanxsfzzoxlbk --yes`
  - needed because the first `db push` attempted IPv6 and the environment requires the linked IPv4 connection path.
- `pnpm supabase db push --linked --yes`
  - applied `20260424000074_access_requests.sql` to production Supabase project `aggphdqkanxsfzzoxlbk`.

Read-only production verification returned:

```text
to_regclass('public.access_requests') = access_requests
relrowsecurity = true
pg_policies count for public.access_requests = 0
public.access_requests row count = 0
grantees = postgres, service_role only
indexes = access_requests_pkey, access_requests_status_created_idx, access_requests_email_idx,
          access_requests_provisioned_workspace_idx, access_requests_one_open_per_email_idx
```

`OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS` was not configured in Vercel Production in this slice. That is intentional: choosing the operator email allowed to view prospect PII is a separate access-control decision. Until it is configured, `/admin/operations` renders the locked intake state and does not open the service-role review client.

Code deployment, Vercel Ready verification, and non-mutating live page smoke run after commit/push.
