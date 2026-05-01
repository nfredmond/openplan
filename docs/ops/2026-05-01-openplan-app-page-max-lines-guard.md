# OpenPlan App Page Max-Lines Guard

**Date:** 2026-05-01
**Status:** PASS
**Scope:** `openplan/src/app/(app)/**/page.tsx` page-size guard after Grants and Dashboard decomposition

## Purpose

The 2026-04-16 integrated deep-dive set a cross-cutting rule to cap monolithic app pages after the Grants and Dashboard decomposition work landed. This slice turns that rule into an active lint gate instead of a documentation-only convention.

## Change

- Added an ESLint `max-lines` rule for `src/app/(app)/**/page.tsx`.
- Limit: 1,200 lines per app page, with blank lines and comments ignored.
- Existing shared components, helpers, API routes, generated types, tests, and docs are not covered by this page-only cap.

Changed file:

- `openplan/eslint.config.mjs`

## Current Page-Size Snapshot

Largest current app pages after the guard:

| Page | Lines |
|---|---:|
| `src/app/(app)/reports/[reportId]/page.tsx` | 1,179 |
| `src/app/(app)/reports/page.tsx` | 1,157 |
| `src/app/(app)/programs/[programId]/page.tsx` | 1,127 |
| `src/app/(app)/plans/[planId]/page.tsx` | 1,126 |
| `src/app/(app)/billing/page.tsx` | 1,123 |
| `src/app/(app)/grants/page.tsx` | 664 |
| `src/app/(app)/dashboard/page.tsx` | 261 |

## Validation

Commands run from `openplan/`:

```bash
find src/app/'(app)' -name 'page.tsx' -print0 | xargs -0 wc -l | sort -nr | sed -n '1,16p'
pnpm lint
```

Result:

- All current app pages are below the 1,200-line cap.
- `pnpm lint` passes with the new guard enabled.

## Verdict

PASS: the post-decomposition page-size rule is now enforced by CI lint. Future app-page growth has to move into components, helpers, or a deliberate decomposition rather than silently recreating mega-pages.
