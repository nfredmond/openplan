# Phase C.2 slice 2 - Explore hover inspector extraction (2026-04-20)

## What shipped

Continued the deferred Explore decomposition with one safe state-bearing extraction: the live tract/crash hover inspector now lives in `src/app/(app)/explore/_components/explore-hover-inspector.tsx`.

The main Explore client page dropped from 3,129 LOC to 2,921 LOC. This is not a rewrite and does not change map state ownership. The parent page still owns Mapbox state, hover state, layer toggles, run history, analysis execution, and exports; the new component only renders the read-only inspector from props.

## Why this slice

The initially proposed Grants to RTP posture write-back slice is already live in this codebase:

- `supabase/migrations/20260416000052_projects_rtp_posture.sql`
- `src/lib/projects/rtp-posture-writeback.ts`
- `src/app/api/funding-awards/route.ts`
- `src/test/rtp-posture-writeback.test.ts`

Rather than duplicate a shipped write-back path, this slice takes the next concrete code-only gap documented by Phase C.2: continue reducing the large Explore client page without changing behavior.

## Changes

- Added `ExploreHoverInspector` for the map intelligence / tract legend / crash inspector section.
- Moved `TractMetric` into the shared Explore `_types.ts` so layer controls and inspector share one type.
- Updated `ExploreLayerVisibilityControls` to import the shared `TractMetric`.
- Removed page-local tract legend and hovered-tract metric memoization from `page.tsx`.
- Added direct component coverage for:
  - hidden state when both layers are unavailable,
  - populated tract inspector,
  - populated crash inspector.

## Gates

```bash
pnpm exec vitest run src/test/explore-hover-inspector.test.tsx
pnpm exec tsc --noEmit
pnpm qa:gate
```

Results:

- Focused test: 3 passed.
- TypeScript: clean.
- `pnpm qa:gate`: lint clean, 846 tests / 181 files passed, production audit clean, Next build passed.

Known unrelated test noise remains unchanged: `report-detail-page.test.tsx` emits the pre-existing React `Received NaN for the children attribute` warning.

## LOC

```text
2921 src/app/(app)/explore/page.tsx
 254 src/app/(app)/explore/_components/explore-hover-inspector.tsx
  81 src/test/explore-hover-inspector.test.tsx
```

## Files

- `src/app/(app)/explore/page.tsx`
- `src/app/(app)/explore/_components/_types.ts`
- `src/app/(app)/explore/_components/explore-layer-visibility-controls.tsx`
- `src/app/(app)/explore/_components/explore-hover-inspector.tsx`
- `src/test/explore-hover-inspector.test.tsx`

## Not this slice

- No Mapbox effect extraction.
- No result-board extraction.
- No hover-state ownership changes.
- No visual redesign of Explore.
- No quota, security-advisor, or Supabase changes.

## Pointers

- Prior C.2 slice: `docs/ops/2026-04-18-phase-c2-explore-decomposition-proof.md`
- Design constitution: `docs/ops/2026-04-08-openplan-frontend-design-constitution.md`
