# 2026-03-06 Wave 21 — HTTP Timeout Fallback Cleanup

## Scope
Low-risk reliability hardening for `fetchJsonWithRetry` in legacy runtimes where `AbortSignal.timeout` is unavailable.

## Change Summary
- Added explicit timeout cleanup plumbing (`signal + cleanup`) in `src/lib/data-sources/http.ts`.
- Ensured per-attempt timeout resources are cleaned in a `finally` block after each fetch attempt.
- Preserved existing retry/abort semantics while preventing fallback timeout timers/listeners from lingering after successful requests.

## Validation
- Focused test added:
  - `cleans up fallback timeout timers after successful requests`
- Existing timeout fallback/abort test coverage remains in place.

## Verification Command
```bash
npm run test -- src/test/http-fetch-json-retry.test.ts
```
