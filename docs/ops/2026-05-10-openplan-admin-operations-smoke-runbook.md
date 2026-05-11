# OpenPlan Admin Operations Smoke Runbook

**Date:** 2026-05-10  
**Status:** Operator checklist for supervised pilot/admin evidence  
**Scope:** `/admin/operations` preflight and authenticated page smoke after the `--reviewer-email` and `--skip-network` changes.  
**Posture:** Buyer-safe readiness evidence only; not automatic workspace activation, prospect outreach, billing, or production provisioning.

## Purpose

Use this runbook when the operator needs fresh evidence that the Admin Operations surface is reachable, reviewer-gated, and safe to reference in a supervised pilot-readiness conversation.

The sequence proves access posture. It must not become an onboarding workflow. No production application data should be created, updated, deleted, provisioned, emailed, or copied while running this smoke.

## Hard Stop Rules

- **No production writes:** do not mutate `access_requests`, workspaces, invitations, billing, support records, reports, comments, or any other production app data.
- **No prospect PII:** do not print, paste, screenshot, transcribe, export, or summarize prospect names, emails, phone numbers, notes, or request details.
- **No provisioning clicks:** do not click triage, contacted, invited, provision, billing, email, or owner-invite controls unless Nathaniel separately approves that exact production action.
- **No secret capture:** do not record service-role keys, Supabase tokens, Vercel tokens, magic-link tokens, cookies, browser storage, or invitation URLs.
- **No buyer overclaim:** describe the result as supervised admin readiness only, not self-serve onboarding or finished SaaS operations.

The current code-level provisioning guard is documented in [Access request manual provisioning guard proof](../../openplan/docs/ops/2026-05-10-access-request-manual-provisioning-guard-proof.md). That guard is additional safety evidence, not permission to click provisioning controls during this smoke.

## Checklist

| Step | Command or action | Pass condition | Evidence to record |
|---|---|---|---|
| 1. Confirm target | Verify the intended production alias and deployment are the ones being discussed. | Target is `https://openplan-natford.vercel.app` unless an operator deliberately names another lane. | Origin, deployment/commit if known, timestamp. |
| 2. Confirm reviewer | Verify the reviewer email is the allowlisted operator account. | Reviewer is present in Vercel Production `OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS`. | Masked reviewer only, e.g. `n***@domain.com`. |
| 3. Run preflight | `cd openplan && pnpm ops:check-admin-operations-smoke -- --origin https://openplan-natford.vercel.app --reviewer-email <allowlisted-email>` | Health, request-access page, unauthenticated admin redirect, and unauthenticated admin API denial pass. | PASS/ATTENTION status, no secret values. |
| 4. Use skip-network only for rehearsal | `cd openplan && pnpm ops:check-admin-operations-smoke -- --reviewer-email <allowlisted-email> --skip-network` | Reviewer format/local allowlist posture is checked and output warns that network checks were skipped. | Record `skip-network used: yes`; do not treat as final buyer/pilot proof. |
| 5. Load admin page as reviewer | Sign in as the allowlisted reviewer, or run the approved authenticated smoke only when session creation has been explicitly allowed. | `/admin/operations` renders for the reviewer and is not locked. | Page rendered yes/no; no row contents. |
| 6. Verify visible surfaces | Confirm `Warning watchboard`, `Recent supervised onboarding requests`, `Supervised onboarding evidence flow`, `Assistant action activity`, and `Supervised action triage` are visible. | Required sections render, including the no-write action activity posture and the manual/no-email onboarding evidence bridge. | Section names only; row count only if needed. |
| 7. Exit without mutation | Leave the page without clicking triage/provisioning controls. | Rows unchanged; no emails/workspaces/invitations/billing actions. | `rows changed: no`; `provisioning clicks: no`. |


## Post-Deploy Production Health Bridge

If this Admin Operations smoke is being used after a `main` deploy, run the [Admin Ops → Production Health Evidence Bridge](2026-05-10-openplan-admin-ops-to-prod-health-evidence-bridge.md) before calling the proof current. That bridge requires a passing [prod health evidence-log helper](2026-05-10-prod-health-evidence-log-helper.md) output with `Gate decision: PASS` plus the no-write admin proof result.

Do not substitute a successful `/admin/operations` page load for Vercel Ready verification, and do not substitute a passing public health check for the reviewer-gated admin smoke. They are separate facts that must stay adjacent in the handoff.

## Authenticated Smoke Boundary

The production harness `qa-harness/openplan-prod-admin-operations-auth-smoke.js` creates a reviewer auth session only and requires `OPENPLAN_PROD_ADMIN_OPERATIONS_ALLOW_MAGIC_LINK=1`. Treat that flag as an explicit operator approval gate for session creation. It is not approval to mutate production app data.

If this harness is used, acceptable evidence is limited to:

- masked reviewer email,
- target origin,
- final path,
- required section visibility,
- locked/unlocked reviewer state,
- statement that no triage/provision controls were clicked.

Do not keep screenshots that expose request rows. If a screenshot is unavoidable for internal proof, crop or blur prospect areas before it leaves the operator machine.

## Evidence Template

```text
origin:
deployment/commit:
reviewer masked:
preflight command:
preflight status:
skip-network used: yes/no
admin page rendered for reviewer: yes/no
review lane locked: yes/no
warning watchboard visible: yes/no
recent supervised onboarding requests visible: yes/no
supervised onboarding evidence flow visible: yes/no
manual no-email guard proof visible: yes/no
assistant action activity visible: yes/no
supervised action triage visible: yes/no
no-write action posture visible: yes/no
prospect PII captured: no
rows changed: no
provisioning clicks: no
emails sent: no
workspaces/invitations/billing actions: no
remaining blocker:
```

## Buyer-Safe Summary

Use restrained language after a clean run:

> We ran the Admin Operations smoke for the allowlisted reviewer account. The preflight and reviewer page check confirmed the supervised intake surface is reachable and reviewer-gated. The smoke did not write production application data, capture prospect PII, send email, or provision workspaces. This supports a supervised pilot/admin readiness conversation; it is not self-serve onboarding or automated provisioning proof.

## Related Proof

- [Admin Ops → Production Health Evidence Bridge](2026-05-10-openplan-admin-ops-to-prod-health-evidence-bridge.md)
- [Prod health evidence-log helper](2026-05-10-prod-health-evidence-log-helper.md)
- [Final pilot-readiness smoke checklist](2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md)
- [Supervised onboarding evidence flow proof](../../openplan/docs/ops/2026-05-10-supervised-onboarding-evidence-flow-proof.md)
- [Access request manual provisioning guard proof](../../openplan/docs/ops/2026-05-10-access-request-manual-provisioning-guard-proof.md)
- [Production admin operations authenticated smoke](2026-05-01-openplan-production-admin-operations-authenticated-smoke.md)
- [Local admin support flow smoke](2026-05-01-openplan-local-admin-support-flow-smoke.md)
- [Admin operations authenticated smoke checklist](../../openplan/docs/ops/2026-04-24-admin-operations-authenticated-smoke-checklist.md)
