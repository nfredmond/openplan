# Sprint 1 Progress — 2026-03-06 — Honor `Retry-After` hints during throttling

Implemented a low-risk reliability enhancement in `fetchJsonWithRetry` (`src/lib/data-sources/http.ts`).

## What changed
- Added parsing for HTTP `Retry-After` response headers (seconds or HTTP-date formats).
- When a retriable response (notably `429`) includes `Retry-After`, retry backoff now uses that hint.
- Invalid/malformed `Retry-After` values safely fall back to existing exponential backoff behavior.

## Why this matters
- Reduces API hammering during upstream throttling windows.
- Improves interoperability with standards-compliant rate-limit responses.
- Preserves existing retry behavior for endpoints that do not provide `Retry-After`.

## Verification
- Added focused tests in `src/test/http-fetch-json-retry.test.ts`:
  - Uses `Retry-After` seconds for delay selection.
  - Falls back cleanly when `Retry-After` is invalid.
- Ran targeted verification:
  - `npm run test -- src/test/http-fetch-json-retry.test.ts`
