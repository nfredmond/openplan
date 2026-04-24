# Request access review event trail proof

**Shipped:** 2026-04-24 Pacific
**Scope:** Service-role-only audit trail for supervised request-access triage.

## What changed

Added a narrow review-event trail for the allowlisted request-access reviewer lane:

- `access_request_review_events`
  - stores one row per reviewer status transition,
  - links to `access_requests`,
  - stores reviewer user id, previous status, next status, event type, and timestamp,
  - does not store prospect message bodies or outbound email payloads.
- `record_access_request_triage(...)`
  - `SECURITY INVOKER`,
  - executable only by `service_role`,
  - updates the request status and writes the review event in one database call.
- `POST /api/admin/access-requests/[accessRequestId]`
  - still requires authenticated reviewer allowlist membership before service-role use,
  - now records status updates through the triage RPC,
  - returns only id/status/review timestamp/review event id.
- `/admin/operations`
  - shows a compact per-request review trail for allowlisted reviewers,
  - keeps the locked state unchanged for non-allowlisted users.

No outbound email is sent by this slice. Marking `contacted` or `invited` records the reviewer status decision only.

## Guardrails

The review-event table remains service-role-only:

- RLS enabled,
- no anon/authenticated grants,
- no RLS policies,
- no `SECURITY DEFINER` function.

The route still rejects unauthenticated and non-allowlisted users before opening the service-role client.

## Validation

Focused local gate:

```text
pnpm test src/test/access-requests.test.ts src/test/access-requests-migration.test.ts src/test/access-request-triage-route.test.ts src/test/access-request-status-controls.test.tsx src/test/admin-operations-page.test.tsx
# 5 files, 28 tests passed

pnpm exec tsc --noEmit
# passed
```

## Production note

Applied `supabase/migrations/20260424000076_access_request_review_events.sql` to linked production Supabase project `aggphdqkanxsfzzoxlbk` before pushing route code.

```text
pnpm supabase db push --linked --dry-run
# would push 20260424000076_access_request_review_events.sql

pnpm supabase db push --linked --yes
# applied 20260424000076_access_request_review_events.sql

pnpm supabase migration list --linked
# 20260424000076 present locally and remotely
```
