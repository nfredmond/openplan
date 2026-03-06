# Sprint 1 Progress — 2026-03-06 — Analysis Query Length Guard

## What shipped
Implemented a low-risk reliability/UX hardening for analysis prompt input:

1. **Server-side validation cap for `queryText`**
   - Added shared limit constant: `ANALYSIS_QUERY_MAX_CHARS = 600`.
   - `POST /api/analysis` now enforces `queryText` max length via Zod schema.
   - Over-limit requests fail fast with HTTP 400 (`Invalid input`) before any data-source work.

2. **Client-side UX alignment in Explore flow**
   - Added `maxLength` to the query textarea in `/explore`.
   - Added live character count (`current/600`) so users can self-correct before submit.
   - Added client-side guard to block submit and show a clear message when loading legacy runs with oversized prompts.

3. **Focused regression test coverage**
   - Added API smoke test asserting oversized analysis prompts return HTTP 400.

## Why this matters
- Prevents accidental or abusive oversized prompt payloads from reaching expensive analysis logic.
- Keeps UI and API validation behavior aligned to reduce confusing user failures.
- Reduces avoidable compute churn with minimal blast radius.

## Verification run
- `npx eslint 'src/app/api/analysis/route.ts' 'src/app/(public)/explore/page.tsx' 'src/test/api-smoke.test.ts' 'src/lib/analysis/query.ts'`
- `npm test -- src/test/api-smoke.test.ts`
