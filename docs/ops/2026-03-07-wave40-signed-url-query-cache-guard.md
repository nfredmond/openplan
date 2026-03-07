# OpenPlan Wave 40 — Signed URL implicit-cache guard (2026-03-07)

## Scope
Ship one tightly scoped reliability hardening in HTTP data-source caching.

## Change shipped
- Extended `fetchJsonWithRetry` implicit cache-sensitive query param blocklist to include common cloud signed URL credential fields:
  - `x-amz-signature`, `x-amz-credential`, `x-amz-security-token`
  - `x-goog-signature`, `x-goog-credential`
  - `sharedaccesssignature`
- Added focused regression test coverage for AWS/GCP signed URL parameters.

## Files
- `openplan/src/lib/data-sources/http.ts`
- `openplan/src/test/http-fetch-json-retry.test.ts`
- `openplan/docs/SPRINT1_PROGRESS_2026-03-07-signed-url-query-cache-guard.md`

## Verification run
- `npm run lint -- src/lib/data-sources/http.ts src/test/http-fetch-json-retry.test.ts`
- `npm test -- src/test/http-fetch-json-retry.test.ts`

## Result
- Lint: pass
- Tests: pass (1 file, 37 tests)

## Impact
Reduces risk of accidentally reusing cached responses tied to signed URL credentials when callers rely on implicit cache TTL behavior.
