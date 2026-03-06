# Sprint 1 Progress — 2026-03-06 — Restrict retries to idempotent HTTP methods by default

Implemented a reliability/safety hardening in `fetchJsonWithRetry` (`src/lib/data-sources/http.ts`).

## What changed
- Added an idempotency-aware retry gate:
  - Retries now default to **idempotent methods only** (`GET`, `HEAD`, `OPTIONS`, `PUT`, `DELETE`).
  - Non-idempotent methods (for example `POST`) now fail fast instead of retrying transient failures by default.
- Added explicit opt-in escape hatch:
  - New option: `retryNonIdempotentMethods?: boolean`.
  - When set to `true`, retry behavior for non-idempotent methods is enabled.
- Preserved existing behavior for:
  - bounded retries/backoff,
  - retry-after handling,
  - timeout and abort semantics,
  - response caching policy.

## Why this matters
- Default retries on non-idempotent requests can create duplicate side effects upstream (duplicate writes/mutations).
- This change makes the default safer while still allowing deliberate override where the caller has idempotency guarantees.
- No breaking API shape for existing call-sites (new option is additive and optional).

## Verification
- Added focused tests in `src/test/http-fetch-json-retry.test.ts` covering:
  - no retries for retriable `POST` failures by default,
  - no retries for network failures on `POST` by default,
  - successful `POST` retry path when `retryNonIdempotentMethods: true`.
- Ran full quality gate (`npm run qa:gate`) successfully after implementation.
