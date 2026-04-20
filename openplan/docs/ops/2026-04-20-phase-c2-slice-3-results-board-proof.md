# Phase C.2 slice 3 - Explore results board extraction (2026-04-20)

## What shipped

Continued the Explore decomposition by extracting the result board, comparison board, export controls, supporting geospatial briefing, and release-disclosure surfaces from `src/app/(app)/explore/page.tsx` into `src/app/(app)/explore/_components/explore-results-board.tsx`.

The parent Explore page still owns analysis execution, current run state, comparison selection, report generation, map state, map-view persistence, and Run History callbacks. The new component only owns read-only result presentation, comparison presentation, display derivations, and result/comparison export button handlers.

## Why this slice

After slice 2 extracted the hover inspector, the next cohesive read-heavy block in `explore/page.tsx` was the result/comparison area. It had accumulated:

- metric export callbacks,
- comparison CSV/JSON export callbacks,
- comparison delta derivations,
- source-transparency derivations,
- planning-signal and disclosure copy,
- roughly 1,000 lines of JSX.

Moving this into a component reduces the page to orchestration and leaves a clearer next boundary for the eventual Run History handoff.

## Changes

- Added `ExploreResultsBoard`.
- Moved current-result export handlers into the component.
- Moved comparison export handlers into the component.
- Moved comparison delta, map-context comparison, source-transparency, planning-signal, score-tile, and disclosure derivations into the component.
- Replaced the old page-local conditional result stack with a single `ExploreResultsBoard` call.
- Added component coverage for:
  - no analysis selected,
  - current result rendering with exports, source checks, and disclosures,
  - comparison rendering with baseline clearing.

## Gates

```bash
pnpm exec vitest run src/test/explore-results-board.test.tsx
pnpm exec tsc --noEmit
pnpm lint
pnpm exec vitest run src/test/explore-results-board.test.tsx src/test/explore-hover-inspector.test.tsx
pnpm qa:gate
```

Results:

- Focused results-board test: 3 passed.
- Focused Explore component tests: 6 passed across hover inspector + results board.
- TypeScript: clean.
- Lint: clean.
- `pnpm qa:gate`: lint clean, 849 tests / 182 files passed, production audit clean, Next build passed.

Known unrelated test noise remains unchanged:

- `report-detail-page.test.tsx` emits the pre-existing React `Received NaN for the children attribute` warning.
- npm emits pre-existing warnings about unknown `.npmrc` config keys while `qa:gate` shells through `npm run`.

## LOC

```text
1858 src/app/(app)/explore/page.tsx
1099 src/app/(app)/explore/_components/explore-results-board.tsx
 176 src/test/explore-results-board.test.tsx
```

The parent Explore page drops 2,921 -> 1,858 LOC.

## Files

- `src/app/(app)/explore/page.tsx`
- `src/app/(app)/explore/_components/explore-results-board.tsx`
- `src/test/explore-results-board.test.tsx`

## Not this slice

- No map-state ownership changes.
- No Run History extraction.
- No report/PDF route changes.
- No visual redesign.
- No split of `ExploreResultsBoard` into smaller current/comparison/briefing subcomponents.

## Next

The next best Phase C.2 slice is to split `ExploreResultsBoard` internally into smaller read-only subcomponents: current result, comparison narrative, geospatial briefing, and disclosure. After that, extract the state-bearing Run History handoff carefully.
