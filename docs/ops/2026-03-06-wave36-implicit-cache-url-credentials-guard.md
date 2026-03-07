# 2026-03-06 Wave 36 — Implicit Cache Guard for URL-Embedded Credentials

## Scope
Low-risk privacy/reliability hardening in shared HTTP fetch utility (`openplan/src/lib/data-sources/http.ts`) to prevent accidental implicit caching when credentials are embedded in request URLs.

## Change Summary
- Added `hasImplicitCacheBlockedUrlCredentials(url)` to detect URL `username`/`password` components.
- Updated implicit cache eligibility logic so URL-embedded credentials disable implicit response caching.
- Preserved explicit opt-in behavior: callers can still intentionally cache by supplying `cacheKey`.

## Why This Matters
Some upstream integrations still pass Basic-auth style credentials inline in URLs (for example, `https://user:pass@host/...`).

Without this guard, authenticated GET responses could be implicitly cached and replayed based on URL/method/body keying, which is unsafe for shared helper semantics.

This closes that cache eligibility gap while keeping existing explicit-cache escape hatch behavior unchanged.

## Validation
Extended focused unit coverage in `openplan/src/test/http-fetch-json-retry.test.ts`:
- `does not implicitly cache GET requests with URL-embedded credentials`
- `allows caching URL-credential GET requests when an explicit cache key is supplied`

## Verification Commands
```bash
cd openplan/openplan
npm test -- src/test/http-fetch-json-retry.test.ts
npx eslint src/lib/data-sources/http.ts src/test/http-fetch-json-retry.test.ts
```
