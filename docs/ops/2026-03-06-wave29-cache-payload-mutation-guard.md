# 2026-03-06 Wave 29 — Cache Payload Mutation Guard for JSON Fetch Utility

## Scope
Low-risk cache-hardening update in shared HTTP fetch helper (`openplan/src/lib/data-sources/http.ts`) to prevent caller-side object mutation from corrupting cached payloads.

## Change Summary
- Added `cloneCachedPayload` helper with this strategy:
  - Uses `structuredClone` when available.
  - Falls back to `JSON.parse(JSON.stringify(...))`.
  - Gracefully returns original payload if cloning fails.
- Updated cache read path to return a clone of cached data, so each caller gets an isolated copy.
- Updated cache write path to store a cloned payload instead of the live object returned by `response.json()`.
- Kept existing behavior unchanged for `null`/`undefined` payloads and retry/caching controls.

## Why This Matters
Without this guard, a caller could mutate an object returned by `fetchJsonWithRetry`, and that mutation could leak into future reads served from cache.

This update ensures:
- Cache integrity across consumers.
- No cross-request state contamination through shared object references.

## Validation
Added focused unit coverage in `openplan/src/test/http-fetch-json-retry.test.ts`:
- `isolates cached object payloads from caller mutation`

The test verifies:
- First response mutation does not alter cached source data.
- Repeated cached reads return clean copies even after prior caller mutations.
- Only one network fetch occurs while cache TTL is active.

## Verification Commands
```bash
cd openplan/openplan
npx vitest run src/test/http-fetch-json-retry.test.ts
npm test
npx eslint src/lib/data-sources/http.ts src/test/http-fetch-json-retry.test.ts
```
