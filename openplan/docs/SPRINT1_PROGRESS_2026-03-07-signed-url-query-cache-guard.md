# Sprint 1 Progress — 2026-03-07 — Block implicit caching for signed-URL query params

Implemented a low-risk reliability/safety hardening in `fetchJsonWithRetry` (`src/lib/data-sources/http.ts`).

## What changed
- Expanded implicit cache-sensitive query parameter guards to include common cloud signed-URL fields:
  - `x-amz-signature`
  - `x-amz-credential`
  - `x-amz-security-token`
  - `x-goog-signature`
  - `x-goog-credential`
  - `sharedaccesssignature`
- Preserved explicit opt-in behavior:
  - Callers can still cache these requests when they provide an explicit `cacheKey`.
- Existing retry, timeout, abort, and backoff behavior is unchanged.

## Why this matters
- Signed URLs often carry short-lived credentials in query params.
- Implicit response cache keys do not encode caller identity/context; caching signed-URL responses implicitly can create accidental cross-context reuse risk.
- This change narrows that risk while keeping deterministic cache behavior available via explicit cache keys.

## Verification
- Added focused test in `src/test/http-fetch-json-retry.test.ts`:
  - `does not implicitly cache GET requests containing cloud signed-url query params`
- Ran focused checks:
  - `npm run lint -- src/lib/data-sources/http.ts src/test/http-fetch-json-retry.test.ts`
  - `npm test -- src/test/http-fetch-json-retry.test.ts`
