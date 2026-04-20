# Public engagement body limit follow-up (2026-04-20)

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
