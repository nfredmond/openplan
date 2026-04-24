# Request access reviewer activation proof

**Shipped:** 2026-04-24 Pacific
**Scope:** Production activation of the supervised request-access reviewer lane.

## What changed

Configured Vercel Production with:

```text
OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS=nfredmond@gmail.com
```

The variable was added as a sensitive Vercel environment variable for the `openplan` project under the `natford` scope.

Production was redeployed from the last Ready deployment so the new allowlist value is visible to:

- `/admin/operations`,
- `POST /api/admin/access-requests/[accessRequestId]`.

No code migration was required. The previous request-access and triage-control slices already shipped the storage table, locked review surface, and status-only admin route.

## Guardrails

Only `nfredmond@gmail.com` was allowlisted.

No real prospect row was intentionally created, modified, printed, or copied for this activation.

The production smoke created one disposable fake intake row and immediately deferred it through the real admin triage route:

```text
disposable request id: ad369430-e890-4627-8e05-adff08285901
final status: deferred
```

The smoke generated a temporary reviewer session through Supabase admin auth for route verification. Auth tokens were not printed, stored in the repo, or written to a file.

The admin page smoke only asserted that the allowlisted review lane rendered; it did not print access-request row content.

## Production verification

Vercel environment inventory showed:

```text
OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS  Encrypted  Production
```

Redeploy:

```text
deployment: dpl_EnTNL76iUo7uWFnvXzmx4hmMWDcB
url: https://openplan-bc3gyd7by-natford.vercel.app
alias: https://openplan-natford.vercel.app
status: Ready
```

Disposable route smoke:

```text
POST /api/request-access -> 201
POST /api/admin/access-requests/ad369430-e890-4627-8e05-adff08285901 -> 200
verified final status: deferred
verified reviewed_at present: true
verified reviewed_by_user_id present: true
verified admin review lane visible for allowlisted reviewer: true
```

Unauthenticated admin surface still redirects:

```text
GET /admin/operations -> 307 /sign-in?redirect=%2Fadmin%2Foperations
```

Production health:

```text
GET /api/health -> 200
status ok, service openplan, app ok, database not_checked, billing not_checked

pnpm ops:check-prod-health
# OpenPlan health check passed

GitHub Production Health workflow run 24912476865
# passed
```

Local gate:

```text
pnpm qa:gate
# passed: lint, 233 test files / 1177 tests passed, 4 skipped, prod audit clean, next build --webpack
```

## Remaining operator step

Nathaniel can now sign in as `nfredmond@gmail.com` and use `/admin/operations` to review real request-access rows. The route still does not send email, create workspaces, provision invitations, or make pricing commitments.
