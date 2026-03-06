# Sprint 1 Progress — 2026-03-06 — Preserve caller abort semantics when `AbortSignal.any` is unavailable

Implemented a compatibility hardening in `fetchJsonWithRetry` (`src/lib/data-sources/http.ts`).

## What changed
- Updated `withTimeoutSignal(...)` to preserve both timeout and caller-cancel semantics even on runtimes without `AbortSignal.any`.
- Added a manual signal-composition fallback using `AbortController` + one-time abort listeners:
  - aborts when upstream caller signal aborts,
  - aborts when timeout signal aborts,
  - removes opposite listener on first abort to avoid leaks.
- Kept existing behavior unchanged for environments where `AbortSignal.any` exists.

## Why this matters
- Prior fallback returned only the timeout signal when `AbortSignal.any` was missing.
- In that scenario, caller cancellation could be ignored during an in-flight request, causing unnecessary waiting/retry behavior.
- This fix keeps cancellation deterministic across modern and older runtimes.

## Verification
- Added a focused test in `src/test/http-fetch-json-retry.test.ts`:
  - `respects caller aborts even when AbortSignal.any is unavailable`
- Ran targeted test and lint:
  - `npm test -- src/test/http-fetch-json-retry.test.ts`
  - `npm run lint -- src/lib/data-sources/http.ts src/test/http-fetch-json-retry.test.ts`
