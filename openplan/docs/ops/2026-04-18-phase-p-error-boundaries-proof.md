---
title: Phase P — Route-level error boundaries, 10 mega-page folders
date: 2026-04-18
program_doc: docs/ops/2026-04-16-openplan-integrated-deep-dive-review.md
supersedes_section_in: docs/ops/2026-04-18-phase-n-legal-pages-proof.md
phase: P
---

# Phase P — mega-page error boundaries

The Phase N proof doc (2026-04-18) listed "error boundaries: 3
total, 10 mega-page folders bare" as a deterministic
pilot-readiness gap queued for Phase P. This doc closes that gap.

A spot re-survey during Phase P planning also corrected an
earlier number: the quota-asymmetry gap is **2/79 routes**
enforcing `checkMonthlyRunQuota`, not 2/19 as the Phase N plan
suggested. Phase O is still design-gated (signature is
workspace-scoped only; per-project quota needs extension).

## What shipped

Ten folder-root `error.tsx` boundaries, one per mega-page area
under `src/app/(app)/`:

| Surface | File | Back link |
|---|---|---|
| Projects | `projects/error.tsx` | /projects |
| Reports | `reports/error.tsx` | /reports |
| Grants | `grants/error.tsx` | /grants |
| RTP | `rtp/error.tsx` | /rtp |
| Programs | `programs/error.tsx` | /programs |
| Scenarios | `scenarios/error.tsx` | /scenarios |
| Models | `models/error.tsx` | /models |
| Plans | `plans/error.tsx` | /plans |
| Aerial | `aerial/error.tsx` | /aerial |
| Engagement | `engagement/error.tsx` | /engagement |

Each boundary mirrors the template shape of `src/app/(app)/error.tsx`:
`"use client"` + `useEffect` console.error with area-specific
namespace + `StateBlock tone="danger"` with area-specific title,
description, and back-action. No new UI primitives; no changes
to `StateBlock` itself.

Per Next.js semantics, a folder-root `error.tsx` catches throws
from both the list page and any nested detail page inside the
folder. Phase P's 10 boundaries cover 10 list pages + all their
detail routes (e.g., `projects/error.tsx` covers both
`/projects` and `/projects/[projectId]` — the latter is the 2863
LOC mega-page with the highest crash risk).

## Why not one boundary per detail page

Considered and rejected for Phase P:

- `projects/[projectId]/error.tsx` would differentiate detail-page
  messaging from list-page messaging. But no detail page is a
  recurring crash site today; adding nested boundaries
  speculatively duplicates the template without new signal.
- The folder-root boundary *already* catches detail-page throws.
  If `projects/[projectId]/page.tsx` throws and there is no
  nested boundary, Next.js walks up and `projects/error.tsx`
  handles it. Nested boundaries can be added later when a
  specific detail page becomes a repeat offender.

## Why not the other 7 `(app)/*` folders

The 7 non-mega-page folders (`admin`, `billing`, `command-center`,
`county-runs`, `dashboard`, `data-hub`, `explore`) continue to
rely on `(app)/error.tsx`. Reasons:

- Simpler pages with less data-fetching surface → lower crash
  risk.
- `(app)/error.tsx` is functional as a generic fallback for
  these.
- Keeping Phase P bounded means it stays a one-session slice.

If any of those surfaces becomes a repeat crash site, a
templated boundary can be added in a ~15 LOC follow-up.

## Per-area messaging

The 10 boundaries only differ in three string fields compared to
the base template:

- **Log namespace:** `"[openplan/app-error]"` →
  `"[openplan/projects-error]"`, `"[openplan/reports-error]"`,
  etc. Keeps grep-filtering by surface possible in production
  logs.
- **Title:** `"The {area} surface hit an error."`
- **Description:** `"Reference {digest}. Try again, or return to
  the {area} list."` when a digest is present.
- **Back action:** `<Link href="/{area}">Back to {area}</Link>`
  instead of the generic Dashboard link.

For RTP and Aerial, the back-action label is
`"Back to RTP cycles"` and `"Back to Aerial"` respectively, to
match the actual feature framing in the app rail.

## Verification

```
pnpm tsc --noEmit           # clean
pnpm test --run             # 761 passed / 169 files (unchanged — Phase P adds
                            # client components with no logic; no new tests)
pnpm build                  # green; 10 new error.tsx files compile as
                            # part of their folder's route bundle
```

Route manifest diff: no new paths. Error boundaries are not
standalone routes; they're per-folder handlers and do not appear
in the route list.

Manual smoke (not committed):
- Temporarily added `throw new Error("phase-p-smoke");` to the
  top of `projects/page.tsx`, visited `/projects` in the dev
  server, observed the new boundary rendering "The projects
  surface hit an error. Reference {digest}. Try again, or return
  to the projects list." with Retry + Back to Projects actions,
  and sidebar navigation preserved (other route groups unharmed).
  Reverted the throw before committing.

## Updated pilot-readiness scorecard

| Gap | Before Phase P | After Phase P |
|---|---|---|
| Legal pages | 3/4 (DPA deferred) | 3/4 (unchanged — Phase Q or later) |
| **Error boundaries** | **3 total, 10 mega-pages bare** | **13 total, 10 mega-pages covered** (3 layout-level + 10 folder-level) |
| Quota asymmetry | 2/79 routes enforce quota gate | 2/79 unchanged — Phase O, design-gated |

## Design asks for Nathaniel (Phase O unblock)

These do not block Phase P. They do block Phase O:

1. **Quota scope.** `checkMonthlyRunQuota` is workspace-scoped
   only. Should quota stay per-workspace, or should it split
   per-project for larger agencies running multiple RTPs
   concurrently? Per-project would require extending the
   function signature and updating the 2 current callers
   (`/api/analysis`, `/api/models/[modelId]/runs/[modelRunId]/launch`).
2. **Quota weight.** Should all consumption types count equally,
   or are model-run-launches weighted more than analysis runs?
   Today both consume the same quota bucket with the same
   weight.

Once those two are answered, Phase O is a mechanical wiring
phase across the 77 uncovered endpoints.

## Successor ladder (unchanged)

- **Phase O — Quota asymmetry closure.** Unblocked when the two
  design calls above are answered. 77 endpoints need the gate.
- **Phase Q — 90% plan examples (Priorities.md #4).** Needs
  Nathaniel input on which agency example to build.
- **Phase R — UI/UX Phase 4 browser visual review.** Can run in
  parallel with any phase.
- **Phase S — Design-gated unlocks** (T16 caveat-gate reader,
  `projects.rtp_posture` body, `projects.aerial_posture` body).
- **Phase T — `projects/[projectId]/page.tsx` decomposition**
  (2863 LOC).

## Pointers

- Approved plan:
  `/home/narford/.claude/plans/eager-munching-spark.md`
- Template boundary:
  `src/app/(app)/error.tsx`
- Primitive reused:
  `src/components/ui/state-block.tsx` (`StateBlock`, `tone="danger"`)
- Prior phase doc:
  `docs/ops/2026-04-18-phase-n-legal-pages-proof.md`
