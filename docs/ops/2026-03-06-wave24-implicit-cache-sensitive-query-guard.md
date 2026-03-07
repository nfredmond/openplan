# 2026-03-06 Wave 24 — Implicit Cache Guard for Sensitive Query Params

## Scope
Low-risk privacy/reliability hardening in shared HTTP fetch utility (`src/lib/data-sources/http.ts`) to avoid accidental in-memory caching of tokenized URLs.

## Change Summary
- Added `IMPLICIT_CACHE_BLOCKED_QUERY_PARAMS` for sensitive URL params, including:
  - `access_token`, `api_key`, `apikey`, `auth`, `authorization`, `id_token`, `jwt`, `key`, `oauth_token`, `refresh_token`, `sig`, `signature`, `token`
- Added `hasImplicitCacheBlockedQueryParams(url)` with JWT-like value detection for query values that look like three-part base64url tokens.
- Updated implicit cache eligibility logic:
  - Existing guardrails remain (safe methods + blocked auth headers).
  - New behavior: if URL contains sensitive query params, implicit cache is disabled.
  - Explicit `cacheKey` still overrides and allows intentional caching.

## Validation
Added unit coverage in `src/test/http-fetch-json-retry.test.ts`:
- `does not implicitly cache GET requests containing sensitive query params`
- `allows caching sensitive-query GET requests when an explicit cache key is supplied`
- `treats jwt and refresh_token query params as sensitive for implicit caching`
- `treats oauth_token and id_token query params as sensitive for implicit caching`
- `treats JWT-like query values as sensitive for implicit caching`

## Verification Commands
```bash
npm run test -- src/test/http-fetch-json-retry.test.ts
npx eslint src/lib/data-sources/http.ts src/test/http-fetch-json-retry.test.ts
```
