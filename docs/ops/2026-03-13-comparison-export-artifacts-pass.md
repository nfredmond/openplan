# OpenPlan Comparison Export Artifacts Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — comparison artifacts now carry map-view context

## Summary
Extended the comparison workflow so it no longer stops at on-screen deltas.

Operators can now export comparison artifacts that include both:
- metric deltas
- current-vs-baseline map-view context

This closes the recent map-state persistence thread by ensuring the comparison surface can produce durable outputs that explain not just *what changed*, but *under what SWITRS / tract / overlay posture the comparison was made*.

## What changed
### Export helpers
Updated `src/lib/export/download.ts` to support generic multi-row record CSV export.

### Comparison workflow
Updated `src/app/(app)/explore/page.tsx` to add:
- comparison export row assembly
- **Export Comparison CSV** action
- **Export Comparison JSON** action

### Artifact content
Comparison exports now carry:
- metric delta rows
- map-view comparison rows
- current run id / baseline run id
- current map-view state
- baseline map-view state

### Tests
Updated export utility tests to cover multi-row record CSV serialization.

## Why this matters
OpenPlan can now produce a comparison artifact that is reviewable outside the live session.
That improves handoff quality and reduces ambiguity when the planner revisits a comparison later.

## Validation
- `npm run lint` ✅
- `npm test` ✅ (`28` files / `143` tests)
- `npm run build` ✅

## Recommended next step
1. Add explicit comparison artifact history / registry inside Reports or Run History
2. Attach comparison exports to report-generation workflow
3. Continue Data Hub geometry attachment so overlay context becomes richer over time
