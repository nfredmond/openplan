# OpenPlan Admin Ops → Production Health Evidence Bridge

**Date:** 2026-05-10  
**Status:** Bounded operator bridge  
**Scope:** Connect `/admin/operations` proof runs to post-deploy production-health evidence logging.  
**Posture:** Read-only / no-production-write / no-secret / no-PII evidence discipline.

## Purpose

When a change touches Admin Operations, request-access intake, reviewer gating, manual provisioning guardrails, pilot-readiness exports, or the docs used to prove those flows, the operator needs two separate facts before saying the deployed proof is current:

1. the production deployment is actually `Ready` and the public `/api/health` contract passes; and
2. the Admin Operations proof flow was run inside its no-write, no-PII boundary.

This bridge keeps those facts adjacent. It does not add a new production harness, database write, Supabase migration, magic-link flow, Vercel mutation, or buyer-facing claim.

## When to Use This Bridge

Use this bridge after a meaningful `main` deploy when any changed slice affects one of these areas:

- `/admin/operations` route, components, copy, reviewer lock/unlock behavior, or action activity posture;
- `/request-access` intake, access-request status controls, or manual owner-invite provisioning guardrails;
- admin/support proof docs, pilot-readiness proof exports, buyer proof packets, or managed-support diligence copy;
- production smoke language that could imply Admin Operations is proven on the current deploy.

Do not use this bridge to justify triage clicks, provisioning actions, email sends, billing changes, production Supabase inspection, or prospect-row capture.

## Bridge Sequence

| Step | Action | Pass condition | Evidence boundary |
|---|---|---|---|
| 1. Confirm deploy target | Identify the intended production alias and deployment/commit. | Target is the intended OpenPlan production lane, normally `https://openplan-natford.vercel.app`. | Deployment URL, state, commit if already visible; no tokens or environment values. |
| 2. Log production health evidence | Run the [prod health evidence-log helper](2026-05-10-prod-health-evidence-log-helper.md) after Vercel reports `Ready`. | Generated log says `Gate decision: PASS`. | Local Markdown evidence log only; no Supabase, secrets, or production writes. |
| 3. Run admin ops preflight | Run the [Admin Operations Smoke Runbook](2026-05-10-openplan-admin-operations-smoke-runbook.md) preflight with the allowlisted reviewer email. | Health, request-access, unauthenticated admin redirect, and unauthenticated admin API denial pass, or `--skip-network` is clearly labeled rehearsal-only. | Mask reviewer email; do not print allowlist values, cookies, service-role keys, or Vercel tokens. |
| 4. Optional authenticated page smoke | Only if reviewer session creation is separately approved, load `/admin/operations` as the allowlisted reviewer. | Required admin sections render and reviewer lane is not locked. | Record section visibility only; no prospect PII, screenshots of rows, row details, or mutation clicks. |
| 5. Write a bridge note | Add the generated prod-health log path and the admin proof result to the operator handoff. | Both facts are present or the blocker is explicit. | Summary only; no customer/prospect data and no secret material. |

## Minimum Handoff Shape

Use this compact handoff when an admin-ops proof lane follows a deploy:

```text
production alias:
deployment URL/state:
commit:
prod health evidence log path:
prod health gate decision: PASS/HOLD
admin ops preflight command:
admin ops preflight status:
skip-network used: yes/no
reviewer masked:
authenticated page smoke used: yes/no
required admin sections visible: yes/no/not run
prospect PII captured: no
rows changed: no
triage/provisioning clicks: no
emails sent: no
Supabase writes or migrations: no
remaining blocker:
```

## Safety Boundaries

- This bridge is a sequencing rule, not a new operational permission.
- The production health logger proves only shallow public health plus Vercel Ready state. It does not prove Supabase, billing, Mapbox, support SLA, or authenticated workflow correctness.
- The Admin Operations smoke proves supervised reviewer access posture only. It does not prove self-serve onboarding, automated provisioning, buyer activation, or compliance-grade operations.
- No production Supabase writes, schema changes, service-role reads, billing mutations, emails, or invitation creation are in scope.
- No prospect PII, cookies, magic links, invitation URLs, service-role keys, Supabase tokens, Vercel tokens, or raw environment-variable values may be copied into evidence.

## Related Proof

- [Prod health evidence-log helper](2026-05-10-prod-health-evidence-log-helper.md)
- [Admin Operations Smoke Runbook](2026-05-10-openplan-admin-operations-smoke-runbook.md)
- [Access request manual provisioning guard proof](../../openplan/docs/ops/2026-05-10-access-request-manual-provisioning-guard-proof.md)
- [Final pilot-readiness smoke checklist](2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md)
