# 2026-03-06 Wave 28C — Empty-Body Response Guard for JSON Fetch Utility

## Scope
Low-risk reliability hardening in shared HTTP fetch helper (`openplan/src/lib/data-sources/http.ts`) to handle successful no-body responses without treating them as JSON parse failures.

## Change Summary
- Added `shouldTreatResponseAsEmptyBody(method, status)` helper.
- Treats these successful responses as explicit empty payloads (`null`) without calling `response.json()`:
  - `HEAD` requests
  - HTTP `204 No Content`
  - HTTP `205 Reset Content`
- Preserves existing retry behavior and error handling for all other response types.
- Updated cache-return typing so cached empty payloads are returned as `T | null`.
- Empty payloads can now be cached when caching is enabled, avoiding unnecessary repeat requests.

## Validation
Added focused unit coverage in `openplan/src/test/http-fetch-json-retry.test.ts`:
- `treats 204 responses as successful empty payloads and caches them`
- `treats HEAD responses as successful empty payloads and caches them`

Both tests verify:
- No JSON parsing attempt is made (`response.json` not called)
- Cached behavior remains correct across repeat calls

## Verification Commands
```bash
cd openplan
npm run test -- src/test/http-fetch-json-retry.test.ts
npx eslint src/lib/data-sources/http.ts src/test/http-fetch-json-retry.test.ts
```
