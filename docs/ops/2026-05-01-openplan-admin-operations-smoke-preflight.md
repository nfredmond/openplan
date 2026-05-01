# OpenPlan Admin Operations Smoke Preflight

**Date:** 2026-05-01  
**Status:** PASS with manual authenticated smoke still required  
**Scope:** non-mutating public/unauthenticated preflight plus Vercel env-name verification

## Result

The admin operations smoke prerequisites pass for the public production origin. This does not complete the authenticated browser smoke, because that still requires a real allowlisted reviewer account and a normal browser session.

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

## Remaining Manual Smoke

Run only with the actual allowlisted reviewer identity:

1. Sign in manually as the allowlisted reviewer.
2. Open `https://openplan-natford.vercel.app/admin/operations`.
3. Confirm the page renders Warning watchboard, Recent supervised onboarding requests, and Assistant action activity.
4. Confirm the access-request lane is not locked for the reviewer.
5. Do not click triage buttons, create workspaces, send email, or record prospect PII unless separately approved.

## Interpretation

The route and API denial posture are ready for authenticated operator review. The final proof gap is not code-level preflight; it is the manual confirmation that the configured production reviewer can see the allowlisted access-request operations lane in a browser session.
