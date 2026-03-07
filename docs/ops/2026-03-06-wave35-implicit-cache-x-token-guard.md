# 2026-03-06 Wave 35 — Implicit Cache Guard for `x-token` Header Variant

## Scope
Low-risk reliability/security hardening in the shared HTTP fetch helper (`openplan/src/lib/data-sources/http.ts`) to close a missing token-header variant in implicit response caching protections.

## Change Summary
- Added `x-token` to `IMPLICIT_CACHE_BLOCKED_HEADERS`.
- Extended focused unit coverage in `openplan/src/test/http-fetch-json-retry.test.ts` to include an `X-Token` request header case.
- Preserved explicit opt-in behavior: callers can still cache intentionally via `cacheKey`.

## Why This Matters
Some API integrations use a generic `x-token` header instead of `Authorization` or more specific `x-access-token`/`x-auth-token` names.

Without this guard, authenticated GET responses could be implicitly cached and replayed across subsequent calls keyed only by URL/method/body.

This closes the remaining token-header gap while keeping current cache semantics intact.

## Validation
Updated existing test:
- `does not implicitly cache GET requests with x-* token auth headers`

The test now verifies `x-access-token`, `x-auth-token`, `x-session-token`, and `X-Token` all bypass implicit caching.

## Verification Commands
```bash
cd openplan/openplan
npm test -- src/test/http-fetch-json-retry.test.ts
npx eslint src/lib/data-sources/http.ts src/test/http-fetch-json-retry.test.ts
```
