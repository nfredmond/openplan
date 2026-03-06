# Sprint 1 Progress — 2026-03-06 — Prevent implicit caching of authenticated requests

Implemented a low-risk reliability/safety hardening in `fetchJsonWithRetry` (`src/lib/data-sources/http.ts`).

## What changed
- Added an implicit-cache guard for sensitive request headers.
- Implicit response caching (cache TTL without explicit `cacheKey`) is now disabled when request headers include:
  - `authorization`
  - `proxy-authorization`
  - `cookie`
  - `x-api-key`
- Preserved explicit opt-in behavior:
  - Callers can still cache authenticated requests when they provide an explicit `cacheKey`.
- Existing retry, timeout, abort, and backoff behavior is unchanged.

## Why this matters
- Implicit cache keys do not encode auth context, so authenticated `GET` requests could be cached/reused across mismatched credentials in shared runtime contexts.
- This guard reduces cross-context cache bleed risk while keeping existing deterministic cache patterns available through explicit keys.
- Scope is tightly contained to cache eligibility logic (no API shape changes).

## Verification
- Added focused tests in `src/test/http-fetch-json-retry.test.ts`:
  - `does not implicitly cache authenticated GET requests without an explicit cache key`
  - `allows caching authenticated GET requests when an explicit cache key is supplied`
- Ran focused checks:
  - `npm run lint -- src/lib/data-sources/http.ts src/test/http-fetch-json-retry.test.ts`
  - `npm test -- src/test/http-fetch-json-retry.test.ts`
