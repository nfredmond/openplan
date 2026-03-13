# OpenPlan Run History + Comparison Map Context Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — persisted map-view state surfaced in run history and comparisons

## Summary
Extended the recent map-view persistence work so operators can actually see and use that context in the product UI.

This pass surfaces saved map posture in two places:
- Run History cards
- Run Comparison workflow

That means the SWITRS / tract / overlay state is no longer hidden metadata — it is now visible to the planner when deciding which run to reload or compare.

## What changed
### Shared map-view helpers
Added:
- `src/lib/analysis/map-view-state.ts`

Provides:
- map-view state types
- normalization helper
- crash user-filter labels
- run/comparison-friendly summary formatting

### Run History UI
Updated:
- `src/components/runs/RunHistory.tsx`

Each run card now surfaces a compact saved map-context summary, including:
- tract theme
- tract visibility
- SWITRS lane visibility posture
- crash filter stack
- project overlay selection posture

### Comparison workflow
Updated:
- `src/app/(app)/explore/page.tsx`

The Run Comparison panel now includes a **Map View Context** section that shows:
- current run map posture
- baseline run map posture
- same vs different state markers for each map-view dimension

## Why this matters
Metric deltas alone can be misleading if the two runs were viewed under different map conditions.
This pass makes that operator context visible, which improves traceability and prevents false equivalence when comparing runs.

## Validation
- `npm run lint` ✅
- `npm test` ✅ (`28` files / `142` tests)
- `npm run build` ✅

## Recommended next step
1. Add map-view metadata chips to report/download history surfaces
2. Bind map-view context into comparison export artifacts
3. Continue deeper Data Hub geometry attachment so overlay context becomes more meaningful over time
