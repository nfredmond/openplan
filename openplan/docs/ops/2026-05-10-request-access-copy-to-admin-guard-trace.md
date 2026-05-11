# Request Access Copy to Admin Guard Trace

**Date:** 2026-05-10  
**Scope:** bounded docs/test trace from the public `/request-access` copy to the `/admin/operations` manual provisioning guard.  
**Schema:** no schema changes.  
**Production posture:** no Supabase production writes, no provisioning smoke, and no outbound email automation.

## Trace summary

This note ties the buyer-visible request-access language to the operator-only provisioning guard without adding self-serve activation or running any mutating production smoke.

| Step | Surface | Guarded fact | Proof artifact |
|---|---|---|---|
| 1 | `/request-access` public page | Public copy says a request is reviewed first and is not a live workspace, hosted subscription, service commitment, automatic workspace creation, billing action, implementation scope, or customer communication. | `openplan/src/test/request-access-page.test.tsx` |
| 2 | `RequestAccessForm` | Form-side copy says requests are triaged before workspace/support commitment, no outbound message is sent automatically, and self-hosting/managed hosting/billing/onboarding/paid implementation remain separate supervised steps. | `openplan/src/test/request-access-form.test.tsx` |
| 3 | `POST /api/request-access` | The intake route stores a service-role-only request row and returns `status: new`; it does not provision a workspace or send email. | `openplan/src/test/access-request-route.test.ts` |
| 4 | `/admin/operations` | Prospect rows are allowlist-gated; the operator sees the supervised onboarding evidence bridge and manual provisioning guard before any owner-invite action. | `openplan/src/test/admin-operations-page.test.tsx` |
| 5 | Provision route/control | Owner-invite creation requires contacted/invited status plus `manual_provisioning_no_email` before service-role lookup, workspace insert, owner-invite creation, billing mutation, or provisioning RPC. | `openplan/docs/ops/2026-05-10-access-request-manual-provisioning-guard-proof.md` |

## Non-negotiable boundaries

- The public request-access surface is an intake/review lane, not automatic public self-serve workspace activation.
- No email automation is implied or added; outbound follow-up stays under human control.
- No provisioning is allowed during Admin Operations smoke/proof checks unless Nathaniel separately approves the exact production action.
- No production writes were performed for this trace.
- No Supabase production writes, migrations, grants, RLS changes, or RPC changes were needed.
- No workspace, invitation, billing, or support records were created by this trace.

## Why this exists

The app already had proof for public intake, admin review, and manual owner-invite provisioning. The gap was operator readability: the safe public promise on `/request-access` needed a direct, testable trail to the guard that prevents accidental or automated provisioning in `/admin/operations`.

This trace is intentionally narrow. It documents and tests the chain; it does not expand onboarding automation.

## Validation

Targeted validation for this trace:

```bash
corepack pnpm exec vitest run \
  src/test/request-access-copy-to-admin-guard-trace.test.ts \
  src/test/request-access-page.test.tsx \
  src/test/request-access-form.test.tsx \
  src/test/admin-operations-page.test.tsx \
  src/test/access-request-provision-controls.test.tsx
```

Optional focused lint:

```bash
corepack pnpm exec eslint \
  src/test/request-access-copy-to-admin-guard-trace.test.ts \
  src/test/request-access-page.test.tsx \
  src/test/request-access-form.test.tsx
```

## Supabase assessment

No Supabase production write was required or performed. This slice is docs plus local tests only; it does not apply migrations, call Supabase, provision workspaces, create owner invitations, send email, or mutate production data.
