# Request access onboarding E2E smoke proof

**Run:** 2026-04-24 Pacific
**Scope:** Production end-to-end smoke for the supervised request-access to workspace invitation handoff.

## What was verified

Ran the real production onboarding path with disposable smoke-only records:

1. Submitted a public `POST /api/request-access` row.
2. Authenticated as the allowlisted reviewer using a Supabase admin-generated magic-link session for `nfredmond@gmail.com`.
3. Posted real admin triage transitions:
   - `new -> reviewing`
   - `reviewing -> contacted`
4. Posted `POST /api/admin/access-requests/[accessRequestId]/provision`.
5. Verified the route created:
   - pilot workspace,
   - pilot subscription snapshot,
   - manual owner invitation,
   - `contacted -> provisioned` review event.
6. Rendered the returned invite URL through `/sign-up`.
7. Created a disposable owner auth user without sending email.
8. Signed in as that disposable owner and accepted the invitation through `POST /api/workspaces/invitations/accept`.
9. Verified the owner membership, accepted invitation state, token-hash storage, and final access request linkage in Supabase.

## Successful smoke artifacts

```text
access_request_id: c7e6d731-b1ca-4814-bb3a-1ec93509e056
workspace_id:      678f5415-b3c9-4ccf-9ea9-9ac3e3e44d61
workspace_slug:    openplan-onboarding-smoke-20260425013856
invitation_id:     870b30b4-6fea-4a3a-b47f-446b4b3070d8
owner_user_id:     0e8ed790-2ddd-442e-98f5-922984105aa7
reviewer_user_id:  ccd53264-4b47-4993-8c71-abe814e9b6c0
```

Final verified state:

```text
access request status:       provisioned
workspace plan:              pilot
workspace subscription:      pilot
invitation status:           accepted
membership role:             owner
invite page rendered:        true
accepted through route:      true
manual delivery:             true
outbound email sent:         false
invitation token hash stored true
```

Review event path:

```text
new -> reviewing
reviewing -> contacted
contacted -> provisioned
```

## Guardrails

No real prospect row was used.

No real customer workspace was used.

No outbound email was sent. The invite was created as manual delivery, and the disposable owner account was created directly with Supabase admin auth for smoke verification.

No auth tokens, invitation tokens, service-role keys, reviewer session values, or disposable owner password were printed or stored.

The reviewer session was generated with Supabase admin magic-link verification; the real reviewer password was not changed.

No cleanup or destructive delete was run after the smoke. Disposable production records were left in place for auditability.

## Aborted first pass

An earlier smoke pass reached provisioning but stopped before invitation acceptance because the script asserted on overly specific sign-up-page text while the page itself returned `200`.

That row remains disposable and provisioned with a pending owner invitation:

```text
access_request_id: fafaed29-46b8-4957-8a48-1716ddaa2366
workspace_id:      dd20df65-38be-4492-9719-c17674662143
invitation_id:     aa7d5eae-8970-4846-ac3f-3d6eb553309f
invitation status: pending
```

No invitation token was printed, persisted in the repo, or recovered from the database. The invitation table stores token hashes and prefixes only.

## Post-smoke health

```text
pnpm ops:check-prod-health
# OpenPlan health check passed: https://openplan-natford.vercel.app/api/health
# checkedAt=2026-04-25T01:39:32.512Z

GET /api/health -> 200
status ok, service openplan, app ok, database not_checked, billing not_checked
```
