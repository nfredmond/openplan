# Request access workspace invite handoff proof

**Shipped:** 2026-04-24 Pacific
**Scope:** Convert reviewed request-access rows into pilot workspace owner invitations from `/admin/operations`.

## What changed

Added an allowlisted operator handoff from the request-access review lane to workspace provisioning:

- `POST /api/admin/access-requests/[accessRequestId]/provision`
  - requires an authenticated user whose email is in `OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS`,
  - rejects unauthenticated and non-allowlisted requests before opening the service-role client,
  - accepts only an optional workspace name, slug, and stage-gate template id,
  - creates a `pilot` workspace and normalized `pilot` subscription snapshot,
  - creates a pending owner invitation for the request contact,
  - records the request as `provisioned` through a service-role-only RPC,
  - returns the manual invitation URL to the operator and does not send email.
- `record_access_request_provisioning(...)`
  - `SECURITY INVOKER`,
  - executable only by `service_role`,
  - atomically sets `access_requests.status = 'provisioned'`,
  - stores `provisioned_workspace_id`,
  - writes a review event with workspace and owner-invitation ids.
- `/admin/operations`
  - now renders a `Workspace invite` control beside the existing status-only triage controls,
  - enables the create action only for `contacted` or `invited` rows,
  - displays already-linked workspace ids without allowing a second provisioning action.

## Guardrails

No outbound email is sent. The route creates a manual owner invite only; a human operator still owns delivery.

No pricing or plan commitment is exposed. The route fixes the workspace and subscription status to `pilot` and rejects arbitrary plan payloads.

No prospect email address is returned in the API response or written into route audit context. The only sensitive value returned is the manual invitation URL, which is necessary for the allowlisted operator handoff and is not logged.

The provisioning RPC preserves the access-request service-role posture:

- no RLS policy added,
- no anon/authenticated execute grant,
- no `SECURITY DEFINER`,
- transition guard requires current status `contacted` or `invited`,
- optimistic status guard returns conflict on concurrent review changes.

Partial provisioning failures clean up workspace members, workspace invitations, and the workspace row before returning an error.

## Verification

Focused local tests:

```text
pnpm test src/test/access-requests.test.ts src/test/access-requests-migration.test.ts src/test/access-request-triage-route.test.ts src/test/access-request-provision-route.test.ts src/test/access-request-status-controls.test.tsx src/test/access-request-provision-controls.test.tsx src/test/admin-operations-page.test.tsx
# 7 files passed
# 43 tests passed
```

TypeScript:

```text
pnpm exec tsc --noEmit
# passed
```

Production Supabase migration:

```text
pnpm supabase db push --linked --yes
# applied 20260424000077_access_request_provisioning_link.sql
```

Read-only production verification:

```text
record_access_request_provisioning exists
security_definer: false
result: TABLE(id uuid, status text, reviewed_at timestamptz, review_event_id uuid, provisioned_workspace_id uuid)
service_role execute: true
authenticated execute: false
```

Full local gate:

```text
pnpm qa:gate
# passed
```

## Production note

The schema migration is applied to production project `aggphdqkanxsfzzoxlbk`.

No production workspace, owner invitation, email, checkout, Stripe write, or real prospect mutation was run as a smoke test. A successful live provisioning test should be done only against an explicitly chosen real or disposable request-access row because the route intentionally creates customer-facing workspace and invitation state.
