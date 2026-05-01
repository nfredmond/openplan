# OpenPlan RC Proof Log

**Date:** 2026-05-01  
**Commit:** `d065c5f`  
**Status:** PASS  
**Purpose:** Fresh Phase 0 release-candidate proof after proof repair, Data Hub fixture repair, UI watch recapture, admin operations preflight, and local workspace URL isolation proof.

## Commands

All commands were run from `openplan/` unless noted.

```bash
pnpm test
```

Result: PASS, 253 files, 1274 passing, 4 skipped.

```bash
pnpm lint
```

Result: PASS.

```bash
pnpm build
```

Result: PASS.

```bash
pnpm audit --prod --audit-level=moderate
```

Result: PASS, no known vulnerabilities found.

```bash
pnpm ops:check-prod-health
```

Result: PASS against `https://openplan-natford.vercel.app/api/health`.

```bash
pnpm ops:check-public-demo-preflight
```

Result: PASS with expected local-token warning. Production token values were not inspected by this command.

Checked:

- `GET/HEAD /api/health` return the shallow no-store app health contract.
- `GET /request-access` returns the services intake page without submitting a request.
- `GET /api/billing/readiness` is not publicly readable.
- CSP includes Mapbox API, events, tile/image, and worker allowances.

```bash
pnpm ops:check-public-demo-preflight -- --mapbox-env-file .env.local
```

Result: PASS.

Additional local-env check:

- Mapbox public token format is `pk.*` for the local public token key; token values were not printed.

## Related Proof

- `2026-05-01-openplan-phase0-proof-repair.md`
- `2026-05-01-openplan-ui-ux-watch-recapture.md`
- `2026-05-01-openplan-admin-operations-smoke-preflight.md`
- `2026-05-01-openplan-local-workspace-url-isolation-smoke.md`
