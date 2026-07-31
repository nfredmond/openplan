# Public engagement body limit follow-up (2026-04-20)

> **DATED RECORD — 2026-04-20.** This describes what was true on the day it was written.
> It is kept because it records *why* decisions were made, which nothing else captures.
> **Do not treat any factual claim here as current** — verify against the code, the
> database, or `CHANGELOG.md` before acting on it. A stale doc that reads as current
> costs more than a missing one: on 2026-07-30 a roadmap in this folder listed two
> "remaining" items that had both already shipped, and nearly cost a full rebuild of a
> feature that already exists.


## What shipped

Continued the defensive-hardening lane after PR #7:

1. Merged PR #7 into `main`.
2. Enabled `main` branch protection with strict required checks for `verify (qa gate)` and `Vercel`.
3. Added an explicit 16 KB JSON body limit to the anonymous public engagement submission route.

## Changes

- `/api/engage/[shareToken]/submit` now reads JSON through `readJsonWithLimit(request, 16 * 1024)`.
- Oversized public submissions return 413 before campaign lookup, recent-submission checks, or service-role inserts.
- Oversized public submissions emit `audit.warn("engagement_public_submission_body_too_large", ...)` with the observed byte length and configured limit.
- The existing route test now covers the 413 path and asserts Supabase is not queried.

## Gates

Targeted checks:

```bash
pnpm exec vitest run src/test/engagement-public-submit-route.test.ts src/test/body-limit.test.ts
# exit 0; 2 files · 11 tests
```

Full gate:

```bash
pnpm qa:gate
# exit 0; lint + 177 files / 831 tests + audit (0 advisories) + build
```

## Files

- `openplan/src/app/api/engage/[shareToken]/submit/route.ts`
- `openplan/src/test/engagement-public-submit-route.test.ts`
