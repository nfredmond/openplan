# Access request manual provisioning guard proof

**Date:** 2026-05-10  
**Scope:** bounded guardrail improvement for `/admin/operations` access-request provisioning readiness.

## What changed

- `POST /api/admin/access-requests/[accessRequestId]/provision` now requires the explicit payload acknowledgement `manual_provisioning_no_email` before any service-role lookup, workspace insert, owner-invite creation, billing mutation, or provisioning RPC can run.
- `/admin/operations` provisioning controls now require an operator checkbox before the "Create invite" action is enabled.
- The UI copy states that the action is manual operator provisioning only and that no outbound email is sent.

## Boundaries preserved

- No production writes were performed.
- No Supabase migration was needed.
- No autonomous provisioning was added; the route is harder to call accidentally.
- Tests use synthetic fixture data only and assert that owner email/contact fields are not returned by provisioning responses.

## Validation

- `corepack pnpm exec vitest run src/test/access-request-provision-route.test.ts src/test/access-request-provision-controls.test.tsx src/test/admin-operations-page.test.tsx`
- `corepack pnpm exec eslint src/lib/access-request-status.ts src/lib/access-requests.ts 'src/app/api/admin/access-requests/[accessRequestId]/provision/route.ts' src/components/operations/access-request-provision-controls.tsx src/test/access-request-provision-route.test.ts src/test/access-request-provision-controls.test.tsx`
- `corepack pnpm build`
