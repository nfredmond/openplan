# Sprint 1 Progress — 2026-03-06 — HTTP Data Fetch Hardening

## What shipped
Implemented a low-risk reliability improvement in the shared data-source HTTP utility (`fetchJsonWithRetry`):

1. **Caller abort signal now preserved**
   - Requests now combine the caller-provided signal with timeout protection.
   - This ensures upstream cancellations are respected (instead of being overwritten).

2. **Cache hygiene for long-running services**
   - Added pruning of expired cache entries before cache reads/writes.
   - Added a bounded in-memory cache limit to prevent unbounded growth.

3. **Focused unit test coverage added**
   - New tests verify:
     - active cache hits avoid extra network calls,
     - expired cache entries are pruned before new writes,
     - caller abort signals are honored.

## Why this matters
- Reduces risk of stale/abandoned requests continuing after caller cancellation.
- Prevents in-memory cache drift from accumulating expired entries over time.
- Hardens a shared utility used by multiple external data connectors (Census, transit, etc.) with minimal blast radius.

## Verification run
- `npx eslint src/lib/data-sources/http.ts src/test/http-fetch-json-retry.test.ts`
- `npm test -- src/test/http-fetch-json-retry.test.ts`
- `npm test`
