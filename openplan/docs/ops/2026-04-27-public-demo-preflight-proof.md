# Public Demo Preflight Proof

**Shipped:** 2026-04-27 Pacific
**Scope:** no-secret production/demo preflight for external-demo readiness.

## What Shipped

Added `pnpm ops:check-public-demo-preflight`, a no-auth preflight that checks:

- `GET` and `HEAD /api/health` return the shallow no-store health contract.
- `GET /request-access` returns the supervised public intake page without submitting a request.
- `GET /api/billing/readiness` is deployed but not publicly readable. Secret-backed readiness facts still require the existing operator dry run.
- The public origin CSP still allows Mapbox API, events, tile/image, and worker surfaces required by demo maps.
- Local or selected env-file `NEXT_PUBLIC_MAPBOX_*` values use public `pk.*` token format when visible. Token values are never printed.

The existing `pnpm ops:check-prod-health` CLI behavior was preserved while exposing its core check function for in-process tests, so the health contract remains covered even in sandboxes that block nested process spawning.

## Command

```bash
cd openplan
pnpm ops:check-public-demo-preflight -- --origin https://openplan-natford.vercel.app
```

Optional local Mapbox format check:

```bash
cd openplan
pnpm ops:check-public-demo-preflight -- --mapbox-env-file .env.local
```

## Guardrails

- No cookies, auth headers, service-role keys, Vercel tokens, Supabase tokens, Stripe tokens, or billing readiness secrets are accepted.
- Against public origins, the script only uses `GET` and `HEAD`.
- It does not submit `/api/request-access`.
- It does not call billing readiness `POST`.
- It does not write to Stripe, Supabase, or email systems.
- It never prints Mapbox token values.

## Validation

- `pnpm exec vitest run src/test/public-demo-preflight-script.test.ts`
- `pnpm exec vitest run src/test/prod-health-check-script.test.ts src/test/public-demo-preflight-script.test.ts`
- `pnpm exec eslint scripts/ops/check-public-demo-preflight.mjs src/test/public-demo-preflight-script.test.ts src/test/fixtures/public-demo-preflight-mock-fetch.mjs`
- `pnpm exec tsc --noEmit`

## Limitation

This preflight proves public/demo posture, not billing ledger truth. To inspect billing readiness facts, an operator must separately run the existing secret-backed `POST /api/billing/readiness` dry run from the billing readiness proof.
