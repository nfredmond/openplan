# Production monitoring foundation proof

**Shipped:** 2026-04-24 Pacific
**Scope:** C.5a monitoring foundation without vendor spend or external account commitments.

## What changed

Added `GET /api/health` and `HEAD /api/health` as a public, cache-disabled uptime probe for the deployed Next.js application route.

The endpoint intentionally does not touch Supabase, Stripe, Mapbox, Anthropic, report storage, or billing meters. Its payload says those dependencies are `not_checked`, so it can be used by uptime tooling without being mistaken for a full readiness probe.

Response shape:

```json
{
  "status": "ok",
  "service": "openplan",
  "checkedAt": "2026-04-24T00:00:00.000Z",
  "checks": {
    "app": "ok",
    "database": "not_checked",
    "billing": "not_checked"
  }
}
```

Added `docs/ops/RUNBOOK.md` for first-customer operations. It covers the first five minutes of triage plus app outage, Supabase/auth degradation, billing checkout/webhook failures, usage flush failures, quota lockout, CSP violations, PDF generation failure, Mapbox failure, and customer data exposure concerns.

## Guardrails

No monitoring vendor was configured in this slice. No Datadog, Sentry, BetterStack, Axiom, Logflare, domain, or paid service commitment was made.

No production data was mutated. The health route has no database client and no service-role access.

The endpoint avoids env-derived diagnostic values so it cannot leak configured secrets. It also returns `Cache-Control: no-store, max-age=0` to keep uptime checks from hiding a broken route behind cached output.

## Test coverage

Added `src/test/health-route.test.ts`:

- verifies `GET /api/health` returns status `200`, cache-disabled headers, and the intended payload;
- stubs representative production secrets and proves none of them, nor sensitive key names, appear in the response body;
- verifies `HEAD /api/health` returns `200` with no body.

Local targeted verification:

```text
pnpm test src/test/health-route.test.ts
# 1 file, 3 tests passed
```

## Production verification

The full gate and live deployment verification are completed as part of the commit/push/deploy closeout for this slice:

```text
pnpm qa:gate
# lint passed
# test passed: 225 files, 1140 tests, 4 skipped
# pnpm audit --prod --audit-level=moderate: no known vulnerabilities
# next build --webpack passed and listed /api/health
```

Post-deploy smoke:

```text
curl -i https://openplan-natford.vercel.app/api/health
# expected: HTTP 200, Cache-Control: no-store, JSON status ok
```

## Customer-readiness effect

OpenPlan now has a stable public health check and a first-customer incident runbook. This is enough to connect a free uptime monitor or Vercel log alerting in a later slice without changing the application surface again.
