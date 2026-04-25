# Admin operations owner-invite readiness proof

**Shipped:** 2026-04-25 Pacific
**Scope:** Non-mutating reviewer smoke readiness after request-access provisioning.

## What changed

- `/admin/operations` now shows linked owner-invitation status for provisioned access-request rows.
- The admin surface displays only workspace id prefix, invitation id prefix, invitation status, and expiration or acceptance timing.
- The operator smoke checklist now includes a no-token/no-url check for linked owner-invitation status.
- The production health-check script test no longer opens a local TCP server; it uses a child-process fetch preload so the full unit suite can run in restricted sandboxes.

## Guardrails

No request-access rows were updated.

No workspace or invitation state was created.

No outbound email was sent.

No invitation token, token prefix, manual-delivery URL, cookie, auth header, service-role key, or reviewer session value is queried or rendered by the owner-invitation status panel.

## Validation

```text
npm test -- src/test/access-request-provision-controls.test.tsx src/test/admin-operations-page.test.tsx src/test/access-requests.test.ts src/test/prod-health-check-script.test.ts
# 4 files, 24 tests passed

npm run lint -- --quiet
# passed

npm exec tsc -- --noEmit
# passed

npm test
# 235 files, 1197 tests passed, 4 skipped

npm run build
# passed
```
