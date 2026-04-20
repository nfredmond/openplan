# Phase C.2 slice 6 - Explore study brief controls (2026-04-20)

## What shipped

Extracted the Study brief control surface from `src/app/(app)/explore/page.tsx` into:

- `src/app/(app)/explore/_components/explore-study-brief-controls.tsx`

The parent Explore page still owns the analysis request, report generation, PDF download, map state, map lifecycle, project context rail, and map-view persistence. The new component owns only the form/control rendering for:

- query textarea and character count,
- prompt length warning,
- report template selector,
- run analysis button,
- HTML/PDF export buttons,
- validation error display.

## Why this slice

After slice 5 moved the state-bearing Run History handoff, the next low-risk boundary was the actual analysis form controls. This keeps the decomposition moving without touching the map initialization/effect stack or the Data Hub/project context rail.

## Changes

- Added `ExploreStudyBriefControls`.
- Replaced the page-local Study brief JSX with one component call.
- Removed page-local query-character display derivation.
- Kept `runAnalysis`, `generateReport`, and `downloadPdfReport` in the page so request/report side effects did not move with the presentation.
- Added focused component coverage for:
  - query value + character count,
  - prompt-length warning + disabled run action,
  - report template selection,
  - run/report/PDF callbacks,
  - hidden export actions before a run exists,
  - validation error rendering.

## Gates

```bash
pnpm exec vitest run src/test/explore-study-brief-controls.test.tsx src/test/explore-run-history.test.tsx src/test/explore-results-board.test.tsx src/test/explore-hover-inspector.test.tsx
pnpm exec tsc --noEmit
pnpm lint
git diff --check
pnpm qa:gate
```

Results:

- Focused Explore tests: 15 passed across study brief controls, run history, results board, and hover inspector.
- TypeScript: clean.
- Lint: clean.
- `git diff --check`: clean.
- `pnpm qa:gate`: lint clean, 858 tests / 184 files passed, production audit clean, Next build passed.

Known unrelated test noise remains unchanged:

- `report-detail-page.test.tsx` emits the pre-existing React `Received NaN for the children attribute` warning.
- npm emits pre-existing warnings about unknown `.npmrc` config keys while `qa:gate` shells through `npm run`.

## LOC

```text
1629 src/app/(app)/explore/page.tsx
 138 src/app/(app)/explore/_components/explore-study-brief-controls.tsx
  81 src/test/explore-study-brief-controls.test.tsx
```

The parent Explore page drops 1,709 -> 1,629 LOC.

## Not this slice

- No map lifecycle changes.
- No project/Data Hub context extraction.
- No Run History changes.
- No report route changes.
- No visual redesign.

## Next

The next best Phase C.2 slice is to extract the project/Data Hub context rail from `explore/page.tsx`, but keep dataset overlay state in the page unless the extraction can preserve the exact map overlay toggle semantics.
