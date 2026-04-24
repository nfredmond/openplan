# Request access triage controls proof

**Shipped:** 2026-04-24 Pacific
**Scope:** Operator triage controls for service-role-only request-access intake.

## What changed

Added a narrow operator workflow for request-access status review:

- `POST /api/admin/access-requests/[accessRequestId]`
  - authenticated route,
  - requires the signed-in operator email to be in `OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS`,
  - uses service-role access only after auth and allowlist checks pass,
  - updates only `status`, `reviewed_by_user_id`, and `reviewed_at`,
  - returns only id/status/review timestamp, not prospect contact fields.
- `src/lib/access-request-status.ts`
  - centralizes status labels and allowed transitions,
  - keeps `deferred`, `declined`, and `provisioned` terminal from the triage UI.
- `/admin/operations`
  - allowlisted rows now render a small client-side triage control,
  - available transitions follow the path `new -> reviewing -> contacted -> invited -> deferred/declined`,
  - no control sends email, creates workspaces, changes pricing, or provisions access.

No database migration was required because the previous request-access migration already added `status`, `reviewed_by_user_id`, and `reviewed_at`.

## Guardrails

`OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS` was not configured in this slice. The production admin lane remains locked until Nathaniel chooses the reviewer email(s).

No production access request rows were updated.

No outbound email is sent by the route or UI.

No workspace is provisioned by the route or UI.

The route rejects unauthenticated and non-allowlisted users before opening the service-role client.

## Test coverage

Added focused coverage for:

- triage transition rules and terminal statuses,
- allowlisted route success updating only status/review fields,
- unauthenticated and non-allowlisted denial before service-role access,
- invalid ids, unsupported statuses, missing rows, invalid transitions, and update failures,
- client control POST behavior and terminal-state rendering,
- admin operations rendering triage controls only on the allowlisted row path.

Focused verification:

```text
pnpm test src/test/access-requests.test.ts src/test/access-request-triage-route.test.ts src/test/access-request-status-controls.test.tsx src/test/admin-operations-page.test.tsx
# 4 files, 21 tests passed

pnpm exec tsc --noEmit
# passed
```

Full local gate:

```text
pnpm qa:gate
# passed on 2026-04-24
```

- lint passed,
- 233 test files passed,
- 1177 tests passed, 4 skipped,
- production audit returned no known vulnerabilities,
- `next build --webpack` passed and listed `/api/admin/access-requests/[accessRequestId]`.

## Production rollout

Post-commit rollout checklist:

- push `main`,
- verify Vercel production deployment is Ready,
- smoke non-mutating `GET /request-access`, `GET /api/health`, and unauthenticated `POST /api/admin/access-requests/<uuid>` returning `401`.

Do not run a live successful triage update until Nathaniel chooses reviewer email(s) and approves updating a real or disposable access-request row.
