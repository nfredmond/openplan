# Sprint 1 Progress — 2026-03-06 — Preserve timeout behavior when `AbortSignal.timeout` is unavailable

Implemented a compatibility hardening in `fetchJsonWithRetry` (`src/lib/data-sources/http.ts`).

## What changed
- Added `buildTimeoutSignal(timeoutMs)` helper.
- `buildTimeoutSignal` now:
  - uses native `AbortSignal.timeout(timeoutMs)` when available,
  - falls back to a manual `AbortController` + `setTimeout` abort signal when unavailable.
- Updated `withTimeoutSignal(...)` to call `buildTimeoutSignal(...)` instead of directly requiring `AbortSignal.timeout`.

## Why this matters
- Some runtimes may not expose `AbortSignal.timeout`.
- Previous implementation would throw in that environment and fail requests immediately.
- This change keeps timeout enforcement deterministic across modern and older environments.

## Verification
- Added focused test in `src/test/http-fetch-json-retry.test.ts`:
  - `uses a manual timeout signal fallback when AbortSignal.timeout is unavailable`
- Re-ran targeted checks:
  - `npm test -- src/test/http-fetch-json-retry.test.ts`
  - `npm run lint -- src/lib/data-sources/http.ts src/test/http-fetch-json-retry.test.ts`
