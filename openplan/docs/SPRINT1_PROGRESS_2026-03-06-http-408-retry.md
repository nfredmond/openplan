# Sprint 1 Progress — 2026-03-06 — Retry transient HTTP 408 responses

Implemented a small reliability hardening in `fetchJsonWithRetry` (`src/lib/data-sources/http.ts`).

## What changed
- Added explicit retriable status handling for HTTP `408 Request Timeout` (alongside existing `429` and `5xx` behavior).
- Centralized retryable-status logic behind `isRetriableStatus(...)` for clarity and easier future extension.

## Why this matters
- Some upstream APIs return 408 during transient network/load events.
- Treating 408 as retriable improves resilience without changing the function signature or downstream call sites.
- Keeps retry behavior predictable and explicit for known transient classes.

## Verification
- Added focused test in `src/test/http-fetch-json-retry.test.ts` proving a 408 response retries and succeeds on the next attempt.
- Ran targeted test command for retry logic (see final ship report for exact command/result).
