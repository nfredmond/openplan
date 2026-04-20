# Phase C.2 slice 5 - Explore run history handoff (2026-04-20)

## What shipped

Extracted the state-bearing Run History handoff out of `src/app/(app)/explore/page.tsx` into:

- `src/app/(app)/explore/_components/use-explore-run-history.ts`
- `src/app/(app)/explore/_components/explore-run-history-panel.tsx`

The parent Explore page still owns the analysis form, map state, active result, report generation, and map-view persistence. The new hook owns the Run History boundary:

- pinned baseline state,
- loading a saved run into the current result stack,
- clearing the baseline when the pinned baseline is loaded as current,
- compare-run validation,
- scenario/deep-link hydration from `runId` and `baselineRunId`,
- URL query sync for the current/baseline run pair.

The panel owns the prop mapping from Explore-specific state into the shared `RunHistory` component.

## Why this slice

After slices 3 and 4 split the read-only result surfaces, the next meaningful Explore boundary was the Run History handoff. That code was still keeping comparison state, deep-link behavior, and URL synchronization inside the parent page, even though it only existed to support the saved-run timeline.

Moving it behind a hook keeps the page focused on the live analysis/map workflow and gives future Run History work a dedicated place to evolve.

## Changes

- Added `useExploreRunHistory`.
- Added `ExploreRunHistoryPanel`.
- Removed direct `RunHistory`, `Run`, and `next/navigation` usage from `explore/page.tsx`.
- Removed page-local `comparisonRun` state.
- Moved `loadRun`, `compareRun`, `clearComparison`, deep-link hydration, and URL sync into the hook.
- Kept current result/map setter effects unchanged by passing the same setters into the hook.
- Added focused tests for:
  - valid baseline pinning and URL sync,
  - loading the pinned baseline as current and clearing baseline state,
  - compare refusal when no current analysis is loaded,
  - Explore-to-RunHistory prop mapping,
  - generated current-run title fallback.

## Gates

```bash
pnpm exec vitest run src/test/explore-run-history.test.tsx src/test/explore-results-board.test.tsx src/test/explore-hover-inspector.test.tsx
pnpm exec tsc --noEmit
pnpm lint
git diff --check
pnpm qa:gate
```

Results:

- Focused Explore tests: 11 passed across run history, results board, and hover inspector.
- TypeScript: clean.
- Lint: clean.
- `git diff --check`: clean.
- `pnpm qa:gate`: lint clean, 854 tests / 183 files passed, production audit clean, Next build passed.

Known unrelated test noise remains unchanged:

- `report-detail-page.test.tsx` emits the pre-existing React `Received NaN for the children attribute` warning.
- npm emits pre-existing warnings about unknown `.npmrc` config keys while `qa:gate` shells through `npm run`.

## LOC

```text
1709 src/app/(app)/explore/page.tsx
 224 src/app/(app)/explore/_components/use-explore-run-history.ts
  41 src/app/(app)/explore/_components/explore-run-history-panel.tsx
 241 src/test/explore-run-history.test.tsx
```

The parent Explore page drops 1,858 -> 1,709 LOC.

## Not this slice

- No Run History UI redesign.
- No changes to the shared `RunHistory` component.
- No changes to run deletion or run-fetch limits.
- No changes to map-view persistence.
- No changes to report generation.

## Next

The next best Phase C.2 slice is to split the remaining parent Explore page into a map/workbench shell and an analysis form/control surface. The page is now below the original mega-page threshold, so the next slice should be conservative and avoid changing map lifecycle behavior.
