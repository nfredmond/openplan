# 2026-03-06 Wave 30 — Implicit Cache Guard for x-* Token Headers

## Scope
Low-risk cache-hardening update in shared HTTP fetch helper (`openplan/src/lib/data-sources/http.ts`) to prevent implicit response caching when token-bearing custom headers are present.

## Change Summary
- Expanded `IMPLICIT_CACHE_BLOCKED_HEADERS` with:
  - `x-access-token`
  - `x-auth-token`
  - `x-session-token`
- Preserved existing behavior where explicit cache keys (`cacheKey`) may still opt into caching intentionally.

## Why This Matters
Some integrations pass credentials via custom `x-*` token headers instead of `Authorization`.

Without this guard, implicit caching could persist private responses keyed only by URL/method and unintentionally replay sensitive data.

This update aligns header-based secret handling with the existing query-param and `Authorization` cache protections.

## Validation
Added focused unit coverage in `openplan/src/test/http-fetch-json-retry.test.ts`:
- `does not implicitly cache GET requests with x-* token auth headers`

The test verifies that requests with these headers are always fetched from network (no implicit cache entry created).

## Verification Commands
```bash
cd openplan/openplan
npx vitest run src/test/http-fetch-json-retry.test.ts
npx eslint src/lib/data-sources/http.ts src/test/http-fetch-json-retry.test.ts
```
