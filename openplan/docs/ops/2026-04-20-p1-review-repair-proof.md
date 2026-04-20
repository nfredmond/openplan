# P1 review repair — build-safe markdown + feed-scoped GTFS policies (2026-04-20)

## What shipped

Fixed both P1 reviewer findings:

1. `src/lib/markdown/render.ts` no longer imports a DOM-backed sanitizer, so the production server bundle no longer pulls `jsdom` into route/page-data collection.
2. GTFS child table SELECT policies now inherit `gtfs_feeds` public/workspace visibility instead of granting every child row to every caller.

## Why this pairing

Both findings were deploy blockers against the same patch set: one broke `pnpm build`, the other created a tenant-boundary read leak for workspace-scoped GTFS feeds. Keeping them together makes the review repair atomic: the app is buildable and the database policy posture is no longer over-broad.

## Changes

- Replaced the markdown sanitizer with a DOM-free safe `marked` renderer:
  - raw HTML is unsupported and stripped,
  - dangerous raw blocks are stripped before and after rendering,
  - markdown link/image URLs are allowlisted after HTML-entity decoding,
  - safe markdown links, GFM tables, and table overflow wrapping are preserved.
- Removed `isomorphic-dompurify` from `package.json` and `pnpm-lock.yaml`.
- Corrected `20260420000062_public_data_select_policies.sql` for fresh local resets.
- Added `20260420000064_scope_gtfs_child_feed_visibility.sql` as the forward repair for environments where `20260420000062` was already applied.
- Applied `20260420000064` to prod project `aggphdqkanxsfzzoxlbk` via `pnpm supabase db query --linked --file ...` and repaired migration history with `pnpm supabase migration repair 20260420000064 --status applied --linked`.
- Added `src/test/gtfs-child-policies.test.ts` and one markdown link regression test.
- Updated the prior proof docs and continuity log to remove stale DOM-sanitizer claims.

## Gates

From `openplan/`:

```bash
pnpm exec tsc --noEmit                         # exit 0
pnpm exec vitest run src/test/markdown-render.test.ts src/test/gtfs-child-policies.test.ts
# exit 0; 2 files · 19 tests
pnpm test -- --run                             # exit 0; 175 files · 824 tests
pnpm lint                                      # exit 0; 0 warnings
pnpm build                                     # exit 0
pnpm audit --prod --audit-level=moderate       # No known vulnerabilities found
pnpm qa:gate                                   # exit 0; lint + 824 tests + audit + build
```

The build now reaches `Collecting page data`, generates all 59 static pages, and completes successfully; the prior `ENOENT ... browser/default-stylesheet.css` failure did not recur.

## Verify

- Inspect `src/lib/markdown/render.ts`: no `isomorphic-dompurify`, no DOM import, and raw HTML routes through `safeRenderer.html`.
- Inspect `pnpm-lock.yaml`: no `isomorphic-dompurify` package entry remains.
- Inspect GTFS child policies in both migration files: each policy joins `public.gtfs_feeds` and checks `feed.workspace_id IS NULL OR feed.workspace_id IN (...)`.
- Run `pnpm qa:gate` from `openplan/`.

## Files

- `openplan/src/lib/markdown/render.ts`
- `openplan/src/test/markdown-render.test.ts`
- `openplan/src/test/gtfs-child-policies.test.ts`
- `openplan/package.json`
- `openplan/pnpm-lock.yaml`
- `openplan/supabase/migrations/20260420000062_public_data_select_policies.sql`
- `openplan/supabase/migrations/20260420000064_scope_gtfs_child_feed_visibility.sql`
- `openplan/docs/ops/2026-04-20-markdown-dompurify-hardening-proof.md`
- `openplan/docs/ops/2026-04-20-security-advisor-wave1-proof.md`
- `CLAUDE.md`

## Not this slice

- CI workflow changes. Next defensive-hardening slice should update the existing root workflow to run `pnpm qa:gate`.
- API request body limits.
- AI cost threshold warnings.
- Enforcing CSP.

## Pointers

- Reviewer finding 1 maps to `src/lib/markdown/render.ts`.
- Reviewer finding 2 maps to `supabase/migrations/20260420000062_public_data_select_policies.sql`.
- Next hardening plan remains the handoff order: CI `qa:gate`, body-size limits, AI cost threshold warnings, then dashboard-only Supabase security toggles.
