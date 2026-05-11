# Wave 18/19 guardrail release evidence note

**Date:** 2026-05-10
**Scope:** internal factual release/evidence note for the late Wave 18/19 guardrail work.
**Status:** shipped on `main` as of `a628d02`; docs-only summary.

## Summary

Wave 18/19 tightened buyer-safe and operator-safe boundaries around OpenPlan's public URL posture, workspace membership messaging, admin request-access review, billing copy, and manual access provisioning. This note does not add new production proof or marketing claims; it indexes the shipped commits and the nearest evidence/docs paths so later operators can reconstruct the guardrail chain without rereading the full commit train.

## Shipped guardrails

| Area | Commit | What changed | Evidence / source paths |
| --- | --- | --- | --- |
| Public URL canonicalization | `b6aa806` `test: guard OpenPlan canonical public URL` | Locked public metadata and URL defaults to the current canonical OpenPlan production alias. | `openplan/docs/ops/2026-05-10-openplan-public-url-canonicalization.md`; `openplan/src/test/public-page-metadata-canonical-url.test.ts` |
| Member boundary / no-workspace state | `780fb61` `Harden workspace membership boundary copy` | Clarified no-workspace responses and UI copy so signed-in users without membership do not see over-broad access language. | `openplan/src/app/api/workspaces/current/route.ts`; `openplan/src/components/workspaces/workspace-membership-required.tsx`; `openplan/src/test/current-workspace-route.test.ts`; `openplan/src/test/workspace-membership-required.test.tsx` |
| Admin actionability | `f073406` `Improve admin access request actionability` | Improved admin operations request rows and activity summary so operators can see next actions more clearly before provisioning. | `openplan/src/components/operations/access-request-activity-summary.tsx`; `openplan/src/components/operations/recent-access-requests.tsx`; `openplan/src/test/access-request-activity-summary.test.tsx`; `openplan/src/test/admin-operations-page.test.tsx` |
| Request-access trace evidence | `52f5eac` `Document request access admin operations trace evidence` | Added a concise trace from public request-access copy to admin operations review/provisioning evidence. | `docs/ops/2026-05-10-openplan-public-request-access-admin-operations-trace-evidence.md`; `openplan/docs/ops/2026-05-10-request-access-copy-to-admin-guard-trace.md` |
| Billing boundary | `362ea17` `Harden OpenPlan billing boundary copy` | Reworded billing surfaces so users see the billing lane as supervised/manual where appropriate, not as a fully automated self-serve guarantee. | `openplan/src/app/(app)/billing/page.tsx`; `openplan/src/app/api/billing/checkout/route.ts`; `openplan/src/components/billing/billing-checkout-launcher.tsx`; `openplan/src/test/billing-checkout-launcher.test.tsx`; `openplan/src/test/billing-checkout-route.test.ts` |
| Manual provisioning guard | `a628d02` `Harden manual workspace provisioning guard` | Required explicit manual no-email provisioning acknowledgement before service-role lookup, workspace insert, owner-invite creation, billing mutation, or provisioning RPC. | `openplan/src/app/api/admin/workspaces/provision/route.ts`; `openplan/src/test/workspace-provision-route.test.ts`; `openplan/docs/ops/2026-05-10-access-request-manual-provisioning-guard-proof.md`; `openplan/docs/ops/RUNBOOK.md` |

## Operator boundary

- This is an internal release/evidence note only.
- It does not claim a fresh paid checkout canary, autonomous provisioning, or validated production onboarding for external customers.
- The billing posture remains bounded by the existing waiver/evidence language: historical live payment evidence plus current non-money-moving proof, with no fresh same-cycle paid canary claimed here.
- Manual access provisioning remains intentionally operator-mediated. The guard requires explicit acknowledgement before any provisioning-side mutation path runs.

## Follow-up if this lane is cited externally

Use the product-safe public language in the public surfaces and release-to-sale docs, not this internal note. If a buyer asks about billing or provisioning strength, cite the relevant evidence path and state the boundary plainly rather than converting these guardrails into launch rhetoric.
