# Request access intake hardening proof

**Shipped:** 2026-04-24 Pacific
**Scope:** Follow-up hardening slice for the public request-access intake path.

## What changed

Added abuse controls to the public access-request route without changing the supervised onboarding posture:

- `src/lib/access-requests.ts`
  - adds source and request-content fingerprints,
  - evaluates recent source rate limits,
  - detects recent duplicate request content,
  - keeps raw IP address, contact email, and use-case body out of metadata fingerprints.
- `POST /api/request-access`
  - checks recent `access_requests` metadata before insert,
  - returns `429` when the same source has submitted too many requests in the short window,
  - returns a success-shaped duplicate response when matching recent request content is already present,
  - keeps the existing one-open-request-per-email database guard as the final duplicate backstop.
- `20260424000075_access_request_intake_hardening.sql`
  - adds expression indexes for `metadata_json->>'source_fingerprint'` and `metadata_json->>'body_fingerprint'`,
  - does not add grants, policies, data writes, or workspace-scoped columns.

## Guardrails

No production prospect/contact rows were inserted.

No reviewer allowlist was configured. `OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS` remains a human access-control decision because it determines who can view prospect PII in `/admin/operations`.

The public route still writes only through the server-side service client. The table remains RLS-enabled with no anon/authenticated grants or policies.

## Test coverage

Added focused coverage for:

- body/source fingerprint generation,
- metadata not containing raw IP, contact email, or use-case text,
- rate-limit and recent-duplicate detection,
- route behavior for recent lookup failure, rate limit, and duplicate recent content,
- hardening migration guardrails.

Local verification:

```text
pnpm test src/test/access-requests.test.ts src/test/access-requests-migration.test.ts src/test/access-request-route.test.ts
# 3 files, 18 tests passed

pnpm exec tsc --noEmit
# passed

pnpm qa:gate
# passed: lint, 231 test files / 1167 tests passed, 4 skipped, prod audit clean, next build --webpack
```

## Production rollout

Completed before commit:

- `pnpm supabase db push --linked --yes`
  - applied `20260424000075_access_request_intake_hardening.sql` to production Supabase project `aggphdqkanxsfzzoxlbk`.

Read-only production verification returned:

```text
indexes present:
  access_requests_body_fingerprint_created_idx
  access_requests_source_fingerprint_created_idx

pg_policies count for public.access_requests = 0
public.access_requests row count = 0
```

To complete after commit/push:

- verify Vercel production deployment is Ready,
- smoke non-mutating `GET /request-access` and `GET /api/health`.

Production POST smoke remains intentionally skipped unless Nathaniel approves creating and cleaning up a test prospect row.
