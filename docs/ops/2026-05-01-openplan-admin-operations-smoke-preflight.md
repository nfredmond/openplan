# OpenPlan Admin Operations Smoke Preflight

**Date:** 2026-05-01
**Status:** PASS; authenticated production browser smoke completed separately
**Scope:** non-mutating public/unauthenticated preflight plus Vercel env-name verification

## Result

The admin operations smoke prerequisites pass for the public production origin. The authenticated reviewer browser proof is now recorded separately in `2026-05-01-openplan-production-admin-operations-authenticated-smoke.md`.

Command run from `openplan/`:

```bash
pnpm ops:check-admin-operations-smoke -- --reviewer-email operator@openplan.test
```

Result:

- PASS: reviewer email shape accepted; the synthetic value was masked in script output.
- PASS: `GET /api/health` returned `200` with `status=ok`.
- PASS: `GET /request-access` returned public HTML.
- PASS: unauthenticated `GET /admin/operations` redirects to sign-in with the admin path preserved.
- PASS: unauthenticated admin API triage request returns `401` before service-role access.
- WARN: `OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS` is not present in the local shell.

Vercel production env-name check:

```bash
vercel env ls production
```

Result:

- PASS: `OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS` exists for Production in Vercel.
- Token/secret values were not recorded in this proof note.

## Authenticated Smoke Follow-Up

Completed in `2026-05-01-openplan-production-admin-operations-authenticated-smoke.md` with the actual allowlisted reviewer identity:

1. Generated a Supabase admin magic-link reviewer session without changing the reviewer password.
2. Opened `https://openplan-natford.vercel.app/admin/operations`.
3. Confirmed Warning watchboard, service lane intake queue, and recent audited operator action activity rendered.
4. Confirmed the access-request lane was not locked for the reviewer.
5. Did not click triage buttons, create workspaces, send email, or record prospect PII.

## Interpretation

The route and API denial posture passed before authentication, and the production browser smoke confirmed that the configured reviewer can see the allowlisted access-request operations lane.
