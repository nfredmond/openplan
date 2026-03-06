# Sprint 1 Progress — 2026-03-06 — Avoid implicit caching for authenticated HTTP requests

Implemented a low-risk reliability/security hardening in `fetchJsonWithRetry` (`src/lib/data-sources/http.ts`).

## What changed
- Added a guard that disables **implicit response caching** when sensitive auth/session headers are present and no explicit cache key is provided.
- Guarded headers:
  - `Authorization`
  - `Proxy-Authorization`
  - `Cookie`
  - `X-API-Key`
- Preserved explicit opt-in behavior:
  - If the caller passes `cacheKey`, caching is still allowed even when auth headers are present.
- Existing cache behavior for unauthenticated `GET`/`HEAD` requests remains unchanged.

## Why this matters
- Prevents accidental in-memory reuse of responses tied to authenticated/session-scoped requests when callers only set `cacheTtlMs`.
- Reduces the chance of cross-context data leakage from overly broad implicit cache keys.
- Keeps current architecture and API stable (no breaking changes, additive guard only).

## Verification
- Added focused tests in `src/test/http-fetch-json-retry.test.ts` covering:
  - authenticated `GET` requests are **not** implicitly cached without `cacheKey`,
  - authenticated `GET` requests are cached when `cacheKey` is explicitly supplied.
- Ran focused verification:
  - `npm run test -- src/test/http-fetch-json-retry.test.ts`
  - `npm run lint`
