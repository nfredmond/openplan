# 2026-03-06 Wave 22 — FARS Timeout Fallback Hardening

## Scope
Low-risk reliability hardening for the crash data source path when `AbortSignal.timeout` is unavailable in the runtime.

## Change Summary
- Added a `buildTimeoutSignal` helper in `src/lib/data-sources/crashes.ts` with a manual `AbortController` fallback.
- Applied timeout cleanup (`cleanup()`) after each yearly FARS request attempt so fallback timers/listeners do not linger.
- Replaced direct `AbortSignal.timeout(10000)` usage with the compatibility helper (`FARS_TIMEOUT_MS`).

## Validation
- Added focused regression test:
  - `uses a manual timeout fallback when AbortSignal.timeout is unavailable`

## Verification Command
```bash
npm run test -- src/test/crashes-data-source.test.ts
```
