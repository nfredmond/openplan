# Admin operations authenticated smoke checklist

**Shipped:** 2026-04-24 Pacific
**Scope:** Safer, reproducible proof path for `/admin/operations` as an allowlisted request-access reviewer.

## What changed

Added a no-secret preflight command:

```text
pnpm ops:check-admin-operations-smoke -- --origin https://openplan-natford.vercel.app --reviewer-email <allowlisted-email>
```

The command performs only public or unauthenticated checks:

- `GET /api/health` returns the expected OpenPlan health payload,
- `GET /request-access` returns public HTML,
- unauthenticated `GET /admin/operations` redirects to sign-in with the admin path preserved,
- unauthenticated `POST /api/admin/access-requests/<uuid>` returns the route-level `401` JSON response before service-role access.

It also checks the local shell's `OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS` value if present, without printing it. If the env var is absent locally, the command warns and leaves production env verification as an operator checklist item.

## Guardrails

The preflight does not accept cookies, auth headers, service-role keys, Vercel tokens, Supabase tokens, or browser storage files.

Do not automate login from this proof path. The authenticated portion is a manual browser smoke using an already authorized reviewer account.

Do not click triage buttons, mark statuses, create workspaces, send email, alter billing, or copy prospect PII during this smoke unless Nathaniel separately approves that specific mutation.

## Reviewer smoke procedure

1. Confirm the target Vercel production deployment is Ready for the commit being tested.
2. Confirm `OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS` is configured in Vercel Production and includes the reviewer email.
3. Run the preflight command above from `openplan/`.
4. In a normal browser, sign in manually as the allowlisted reviewer.
5. Open `https://openplan-natford.vercel.app/admin/operations`.
6. Confirm the page renders:
   - `Warning watchboard`,
   - `Recent supervised onboarding requests`,
   - `Assistant action activity`.
7. Confirm the access-request lane is not showing the locked reviewer message.
8. If rows are present, record only non-PII evidence: timestamp, deployment URL, row count, and whether the review controls are visible. Crop or blur screenshots before sharing outside the operator environment.
9. Leave all request rows unchanged unless a disposable test row and mutation have been explicitly approved.

## Evidence template

```text
target:
deployment:
commit:
preflight:
reviewer email allowlisted in Vercel Production: yes/no
manual browser sign-in completed by reviewer: yes/no
/admin/operations rendered for allowlisted reviewer: yes/no
access-request lane locked: yes/no
rows changed: no
emails sent: no
workspaces created: no
billing actions: no
remaining blocker:
```
