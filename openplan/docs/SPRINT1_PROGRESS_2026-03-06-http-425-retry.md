# Sprint 1 Progress — 2026-03-06 — Retry transient HTTP 425 responses

Implemented a low-risk reliability hardening in `fetchJsonWithRetry` (`src/lib/data-sources/http.ts`).

## What changed
- Added explicit retriable status handling for HTTP `425 Too Early`.
- `isRetriableStatus(...)` now treats `425` as transient alongside existing `408`, `429`, and `5xx` behavior.

## Why this matters
- Some upstream gateways/CDNs can emit 425 during early-data or handshake edge cases.
- Retrying once (within existing bounded retry rules) improves resilience for transient upstream timing issues.
- No API shape changes and no downstream call-site changes.

## Verification
- Added a focused test in `src/test/http-fetch-json-retry.test.ts` proving a 425 response retries and succeeds on the next attempt.
- Ran targeted lint + test commands for the updated retry utility.
