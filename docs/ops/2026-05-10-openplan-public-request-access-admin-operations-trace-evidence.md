# OpenPlan Public Request-Access → Admin Operations Trace Evidence

**Date:** 2026-05-10  
**Scope:** durable internal evidence packet for the public request-access lane through Admin Operations triage, manual provisioning guard, and pilot-readiness evidence handoff.  
**Canonical production URL:** `https://openplan-natford.vercel.app`  
**Production posture for this packet:** documentation and local tests only; no production Supabase writes, no provisioning smoke, no outbound email, no customer communication, no schema migration, and no Vercel deploy action.

## Executive finding

The current OpenPlan evidence chain supports this bounded claim:

> A public visitor can submit a supervised request-access intake. The request is treated as a prospect signal for human review, not as self-serve account activation. Admin Operations review is allowlist-gated, triage/provisioning is audit-trailed, owner-invite creation is manually acknowledged, and the pilot-readiness surface carries the same caveats before buyer or pilot reliance.

This packet does **not** claim fully automated onboarding, legal/compliance automation, autonomous AI planning, automatic email follow-up, automatic workspace creation, or production pilot readiness without a fresh operator review.

## Traceability map

| Step | Source / intent | Canonical app surface | Guarded fact | Durable evidence |
|---|---|---|---|---|
| 1 | Public prospect asks to be reviewed for OpenPlan access. | `GET /request-access` on `https://openplan-natford.vercel.app` | Public copy frames intake as review-first; it is not a live workspace, hosted subscription, service commitment, billing action, implementation scope, or automatic customer communication. | `openplan/src/test/request-access-page.test.tsx`; `openplan/docs/ops/2026-05-10-request-access-copy-to-admin-guard-trace.md` |
| 2 | Intake form captures source context and onboarding intent. | `RequestAccessForm` posting to `POST /api/request-access` | Form copy preserves service lane, deployment posture, data sensitivity, first workflow, and onboarding needs while stating requests are triaged before commitment. | `openplan/src/test/request-access-form.test.tsx`; `openplan/src/lib/access-request-query.ts`; `openplan/src/lib/access-request-intake.ts` |
| 3 | Request is stored as a service-role-only prospect row. | `POST /api/request-access` | Successful intake returns `status: new`; it does not provision a workspace, send email, mutate billing, or accept the prospect. Duplicate/body-cap/honeypot guards remain covered. | `openplan/src/test/access-request-route.test.ts`; `openplan/src/test/access-requests.test.ts`; `openplan/src/test/access-requests-migration.test.ts` |
| 4 | Allowlisted operator reviews the intake queue. | `/admin/operations` | Prospect rows render only for configured request-access reviewers. Admin Operations shows the supervised evidence bridge so the operator sees intake → triage → manual provisioning → pilot-readiness posture in one place. | `openplan/src/test/admin-operations-page.test.tsx`; `openplan/src/test/supervised-onboarding-evidence-flow.test.tsx`; `openplan/docs/ops/2026-05-10-supervised-onboarding-evidence-flow-proof.md` |
| 5 | Reviewer records triage/contact state. | `POST /api/admin/access-requests/[accessRequestId]` | Triage is status-transition controlled and recorded through the review-event RPC; it does not send email or provision resources. | `openplan/src/test/access-request-triage-route.test.ts`; `openplan/docs/ops/2026-04-24-request-access-review-event-trail-proof.md` |
| 6 | Operator may manually provision only after contact/invite readiness. | `POST /api/admin/access-requests/[accessRequestId]/provision` | Provisioning requires a valid status plus the exact acknowledgement `manual_provisioning_no_email` before service-role lookup, workspace insert, owner invitation, billing mutation, or provisioning RPC. | `openplan/src/test/access-request-provision-route.test.ts`; `openplan/src/test/access-request-provision-controls.test.tsx`; `openplan/docs/ops/2026-05-10-access-request-manual-provisioning-guard-proof.md` |
| 7 | Pilot-readiness evidence carries the caveats forward. | `/admin/pilot-readiness` and generated readiness packet | Readiness proof must remain a supervised preflight/handoff artifact, not a launch certificate or finished-suite claim. | `openplan/src/test/admin-ops-prod-health-evidence-bridge.test.ts`; `docs/ops/2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md`; `docs/ops/2026-05-10-openplan-admin-ops-to-prod-health-evidence-bridge.md` |

## Source and intent posture

The request-access path records enough intent for a human operator to understand what kind of onboarding conversation is being requested:

- **Source / campaign context:** query parsing is centralized in `openplan/src/lib/access-request-query.ts` so public links can carry structured source context without changing the review boundary.
- **Service lane:** managed hosting/support, implementation, self-hosting support, or planning-services framing is normalized in `openplan/src/lib/access-request-intake.ts`.
- **Deployment posture:** managed cloud, self-hosted, hybrid, evaluation, or undecided posture is captured as intake context only.
- **First workflow:** RTP, grant readiness, engagement, scenario/modeling, aerial evidence, or admin operations intent helps triage the conversation.
- **Data sensitivity:** the form distinguishes public/planning data from confidential, sensitive infrastructure, and mixed/unknown cases so the operator does not over-assume safe handling.

None of these fields creates acceptance, commitment, workspace activation, billing activation, support entitlement, outbound email, or implementation scope by itself.

## Canonical URL discipline

For current proof interpretation, use the canonical production alias:

- `https://openplan-natford.vercel.app`

If a future proof packet uses another preview or alias, it must say so explicitly and should not be cited as canonical production evidence unless paired with the Admin Ops → Production Health Evidence Bridge.

## No-automation boundaries

This evidence packet preserves the following boundaries:

1. Public request-access is **review-first intake**, not self-serve SaaS activation.
2. Admin Operations access is **allowlist-gated** and prospect PII should not be copied into public proof notes.
3. Triage events are **operator actions**, not automatic customer communications.
4. Provisioning is **manual and acknowledgement-gated**; `manual_provisioning_no_email` is required for the provisioning route.
5. No outbound email automation is implied by request-access, triage, or owner-invite proof.
6. No production provisioning smoke should be run without explicit approval for the exact row/action.
7. Pilot-readiness packets are supervised evidence artifacts, not legal/compliance certification, grant-award prediction, validated behavioral forecasting, or autonomous planning approval.

## Validation run for this packet

Run from `openplan/` inside the repository worktree:

```bash
corepack pnpm exec vitest run \
  src/test/request-access-copy-to-admin-guard-trace.test.ts \
  src/test/request-access-page.test.tsx \
  src/test/request-access-form.test.tsx \
  src/test/access-request-route.test.ts \
  src/test/access-request-triage-route.test.ts \
  src/test/access-request-provision-route.test.ts \
  src/test/access-request-provision-controls.test.tsx \
  src/test/admin-operations-page.test.tsx \
  src/test/supervised-onboarding-evidence-flow.test.tsx \
  src/test/admin-ops-prod-health-evidence-bridge.test.ts
```

Focused lint, if any implementation file changes:

```bash
corepack pnpm exec eslint \
  src/lib/access-request-query.ts \
  src/lib/access-request-intake.ts \
  src/lib/access-request-status.ts \
  src/lib/operations/supervised-onboarding-evidence.ts \
  src/components/operations/supervised-onboarding-evidence-flow.tsx \
  src/test/request-access-copy-to-admin-guard-trace.test.ts \
  src/test/request-access-page.test.tsx \
  src/test/request-access-form.test.tsx \
  src/test/access-request-route.test.ts \
  src/test/access-request-triage-route.test.ts \
  src/test/access-request-provision-route.test.ts \
  src/test/access-request-provision-controls.test.tsx \
  src/test/admin-operations-page.test.tsx \
  src/test/supervised-onboarding-evidence-flow.test.tsx \
  src/test/admin-ops-prod-health-evidence-bridge.test.ts
```

## Operator checklist before citing this packet externally

- Confirm the production deployment being discussed is the canonical alias or document the exact alias used.
- Pair any admin-affecting production deploy with `docs/ops/2026-05-10-openplan-admin-ops-to-prod-health-evidence-bridge.md`.
- Do not cite stale request-access/admin proof after changing form copy, route side effects, reviewer allowlist behavior, provisioning acknowledgement, invitation behavior, or pilot-readiness caveats.
- Do not include prospect PII, invitation tokens, auth headers, service-role credentials, cookies, or one-time owner-invite URLs in proof artifacts.

## Packet status

- **Schema changes:** none.
- **Code changes required:** none for this packet.
- **Production writes:** none.
- **Outbound messages:** none.
- **Current use:** internal source-of-truth packet for public request-access → Admin Operations traceability and no-automation posture.
