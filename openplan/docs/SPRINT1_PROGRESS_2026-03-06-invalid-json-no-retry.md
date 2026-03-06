# Sprint 1 Progress — 2026-03-06 — Skip retries on invalid JSON payloads

Implemented a low-risk reliability guard in `fetchJsonWithRetry` (`src/lib/data-sources/http.ts`).

## What changed
- Added a dedicated `try/catch` around `response.json()` parsing for successful (`2xx`) responses.
- If payload parsing fails (e.g., malformed JSON), the helper now returns `null` immediately instead of entering retry loops.
- Preserved existing retry behavior for transport errors and retriable HTTP status codes.

## Why this matters
- Invalid JSON from an upstream response is usually a payload contract/data issue, not a transient network failure.
- Avoiding retries in this case reduces unnecessary repeat traffic and shortens failure time for callers.
- Keeps the behavior deterministic without changing the function API.

## Verification
- Added focused test in `src/test/http-fetch-json-retry.test.ts` asserting malformed JSON returns `null`, performs no retries, and does not populate cache.
- Ran targeted Vitest command for `http-fetch-json-retry` coverage (see ship report for exact command/result).
