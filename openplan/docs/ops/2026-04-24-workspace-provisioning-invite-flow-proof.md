# Workspace provisioning and invite flow proof

**Shipped:** 2026-04-24 Pacific
**Scope:** First C.3 implementation slice for supervised customer workspace provisioning and invitation acceptance.

## What changed

Added the narrow operator and member-invite path needed before a first external paid workspace can be created:

- `POST /api/admin/workspaces/provision`
  - service-only route gated by `OPENPLAN_WORKSPACE_PROVISIONING_SECRET`,
  - creates a workspace with the current California stage-gate binding,
  - creates a direct owner membership when `ownerUserId` is known,
  - or creates a manual-delivery owner invitation when only `ownerEmail` is known,
  - writes the normalized billing subscription snapshot through `applyBillingSubscriptionMutation`,
  - cleans up the partially created workspace if membership, billing, or owner-invitation creation fails.
- `POST /api/workspaces/invitations`
  - authenticated owner/admin route for member/admin invitations,
  - returns a manual-delivery invitation URL and never sends email.
- `POST /api/workspaces/invitations/accept`
  - authenticated acceptance route,
  - verifies the signed-in user's email against the invite email,
  - calls the new Postgres `accept_workspace_invitation(...)` function so membership mutation and invitation status change happen atomically.
- `POST /api/workspaces/invitations/decline`
  - authenticated decline route,
  - verifies email ownership and records the decline without touching membership.
- Sign-up/sign-in now preserve `invite=` tokens and accept the invitation immediately after successful sign-in.

The schema migration adds `workspace_invitations` with RLS enabled, token-hash-only storage, a one-pending-invite-per-workspace/email partial unique index, and service-role-only mutation posture. The acceptance function is `SECURITY INVOKER`, has a pinned `search_path`, and only grants execute to `service_role`.

## Guardrails

No outbound email was sent. The API surfaces manual-delivery URLs only, so Nathaniel still controls any real prospect message.

No customer workspace was provisioned during this slice. The provisioning route is code-ready, but using it for a real agency remains an operator decision because it creates production workspace and membership state.

Invitation tokens are returned once by the service route, then only the SHA-256 hash is stored. Audit payloads include invitation ids and normalized email context, not plaintext tokens.

## Test coverage

Added focused coverage for:

- invitation helper normalization, hashing, URL construction, expiry, insertion, and reissue,
- invitation migration guardrails: no plaintext token column, RLS/grants, pinned function search path, atomic acceptance function,
- service-only workspace provisioning auth, billing sync, owner membership, owner invitation, and cleanup on failure,
- owner/admin workspace invitation creation,
- accept/decline routes including email mismatch and expired-token handling,
- sign-up/sign-in invite-token preservation and sign-in acceptance.

Local verification:

```text
pnpm test src/test/workspace-invitations.test.ts src/test/workspace-invitations-migration.test.ts src/test/workspace-provision-route.test.ts src/test/workspace-invitations-route.test.ts src/test/workspace-invitation-accept-decline-route.test.ts src/test/sign-in-page.test.tsx src/test/sign-up-page.test.tsx
# 7 files, 30 tests passed

pnpm exec tsc --noEmit
# passed

pnpm lint
# passed

pnpm test
# 222 files, 1135 tests passed
```

## Production rollout

Completed before commit:

- `pnpm qa:gate` passed: lint, 222 test files / 1135 tests, `pnpm audit --prod --audit-level=moderate`, and `next build --webpack`.
- `20260424000073_workspace_invitations.sql` was applied to the production Supabase project `aggphdqkanxsfzzoxlbk` via `pnpm supabase db push --linked --yes`.
- Production verification returned:
  - `to_regclass('public.workspace_invitations') = workspace_invitations`,
  - `to_regprocedure('public.accept_workspace_invitation(uuid,uuid,uuid,text)') = accept_workspace_invitation(uuid,uuid,uuid,text)`,
  - `workspace_invitations` row count = 0,
  - expected indexes including `workspace_invitations_one_pending_per_email_idx`.
- `OPENPLAN_WORKSPACE_PROVISIONING_SECRET` was added as an encrypted Vercel Production env var.

The code deployment and non-mutating production guard checks run after commit/push. The guard check should prove missing/wrong credentials are rejected. It must not create a real workspace until Nathaniel identifies the customer/operator record to provision.
