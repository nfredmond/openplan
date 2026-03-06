# Sprint 1 Progress — 2026-03-06 — Caller Abort Retry Short-Circuit

## What shipped
Implemented a low-risk reliability hardening update in `fetchJsonWithRetry` (`src/lib/data-sources/http.ts`):

1. Added caller-abort short-circuit checks before request attempts.
2. Added caller-abort short-circuit checks in the error path and before retry backoff sleep.
3. Preserved existing retry behavior for non-abort failures (timeouts, 5xx, network errors).

## Why this matters
- Prevents wasted retries when a user/API caller has already canceled a request.
- Reduces avoidable latency from retry backoff after explicit cancellation.
- Low blast radius: no API contract changes, only retry-loop guardrails.

## Focused verification
- `npx eslint src/lib/data-sources/http.ts src/test/http-fetch-json-retry.test.ts`
- `npm test -- src/test/http-fetch-json-retry.test.ts`
