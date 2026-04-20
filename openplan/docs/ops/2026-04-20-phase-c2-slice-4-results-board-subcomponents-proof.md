# Phase C.2 slice 4 - Explore results board subcomponents (2026-04-20)

## What shipped

Split the newly extracted `ExploreResultsBoard` into smaller read-only presentation components while keeping the same public props and behavior for the parent Explore page.

`ExploreResultsBoard` now owns the memoized view models, comparison derivations, source-transparency derivations, and export handlers. The actual JSX for the current result, comparison result, geospatial briefing, and disclosure surfaces moved into sibling components:

- `src/app/(app)/explore/_components/explore-current-result-card.tsx`
- `src/app/(app)/explore/_components/explore-run-comparison-card.tsx`
- `src/app/(app)/explore/_components/explore-geospatial-briefing.tsx`
- `src/app/(app)/explore/_components/explore-disclosure-card.tsx`
- `src/app/(app)/explore/_components/explore-results-types.ts`

## Why this slice

Slice 3 got the result/comparison surface out of `explore/page.tsx`, but left a 1,099-line component that mixed:

- memoized data preparation,
- export orchestration,
- current-result rendering,
- baseline-comparison rendering,
- source briefing rendering,
- disclosure rendering.

This slice makes the result board easier to review and gives the next state-bearing Run History extraction a cleaner boundary.

## Changes

- Added `ExploreCurrentResultCard` for current-run summary, source checks, metric exports, and GeoJSON export.
- Added `ExploreRunComparisonCard` for pinned-baseline comparison, map-context differences, delta tables, and comparison exports.
- Added `ExploreGeospatialBriefing` for planning signals and source snapshot cards.
- Added `ExploreDisclosureCard` for method, assumption, and AI-use disclosure rows.
- Added `explore-results-types.ts` for shared read-only view-model types.
- Reduced `ExploreResultsBoard` to orchestration only: empty state, memoized view models, export handlers, and component composition.

## Gates

```bash
pnpm lint
pnpm exec vitest run src/test/explore-results-board.test.tsx
pnpm exec tsc --noEmit
pnpm exec vitest run src/test/explore-results-board.test.tsx src/test/explore-hover-inspector.test.tsx
pnpm qa:gate
git diff --check
```

Results:

- Lint: clean.
- Focused results-board test: 3 passed.
- TypeScript: clean.
- Focused Explore component tests: 6 passed across hover inspector + results board.
- `pnpm qa:gate`: lint clean, 849 tests / 182 files passed, production audit clean, Next build passed.

Known unrelated test noise remains unchanged:

- `report-detail-page.test.tsx` emits the pre-existing React `Received NaN for the children attribute` warning.
- npm emits pre-existing warnings about unknown `.npmrc` config keys while `qa:gate` shells through `npm run`.

## LOC

```text
 445 src/app/(app)/explore/_components/explore-results-board.tsx
 242 src/app/(app)/explore/_components/explore-current-result-card.tsx
 474 src/app/(app)/explore/_components/explore-run-comparison-card.tsx
  97 src/app/(app)/explore/_components/explore-geospatial-briefing.tsx
  49 src/app/(app)/explore/_components/explore-disclosure-card.tsx
  55 src/app/(app)/explore/_components/explore-results-types.ts
```

`ExploreResultsBoard` drops 1,099 -> 445 LOC. Parent `explore/page.tsx` remains 1,858 LOC.

## Not this slice

- No state ownership changes.
- No Run History extraction.
- No report generation changes.
- No map persistence changes.
- No visual redesign.
- No new test fixtures; existing result-board coverage remains the behavior guard.

## Next

The next best Phase C.2 slice is the state-bearing Run History handoff. It should move the saved-run list, baseline pinning controls, and history callbacks into a dedicated component without changing the current Explore page's run-loading semantics.
