# Dead-code lint-warning cleanup (2026-04-20)

## What shipped

`pnpm lint` went from **52 warnings → 0 warnings** across 13 files, and the codebase dropped **17 unused Supabase `Promise.all` queries** — real database round-trips that were being issued per-page-load and thrown away. Zero behavior change. All gates green.

## Gates

From `openplan/`:

```bash
pnpm exec tsc --noEmit     # exit 0
pnpm lint                  # 0 warnings (was 52)
pnpm test -- --run         # 172 files · 809 tests · 11.51s
```

Test count unchanged (809/172 before → 809/172 after) — this was a pure cleanup slice.

## Breakdown

### High-value: dead `Promise.all` Supabase queries removed

These were destructured from `Promise.all([...])` blocks but never referenced. Every one issued a Postgres round-trip on every page render, consumed RLS pool, and counted against Supabase egress.

| File | Queries removed |
|---|---|
| `src/app/(app)/data-hub/page.tsx` | 5 (`plans`, `programs`, `reports`, `funding_opportunities`, `project_funding_profiles`) |
| `src/app/(app)/plans/[planId]/page.tsx` | 5 (workspace-scoped programs/plans/reports/funding_opportunities/project_funding_profiles) |
| `src/app/(app)/plans/page.tsx` | 4 (workspace-scoped programs/funding_opportunities/reports/project_funding_profiles) |
| `src/app/(app)/programs/[programId]/page.tsx` | 3 (workspace-scoped programs/funding_opportunities/project_funding_profiles) |
| `src/app/(app)/programs/page.tsx` | 3 (workspace-scoped plans/reports/project_funding_profiles) |

**17 DB round-trips eliminated** on the five decomposed page components. Pattern: Phase C mega-page decomposition extracted everything these queries fed into sibling section components; the section components load their own data, but the parent pages weren't cleaned up.

### Medium: unused computed state & memos

| File | Removed |
|---|---|
| `src/app/(app)/explore/page.tsx` | `filteredCrashPointCount` (50-LOC `useMemo`), `activeOverlayLegend` (90-LOC `useMemo`), `mapExperienceReady`, `analysisSummary`, `activeOverlayGeometryLabel` |

That's ~145 LOC of dead memoization. The `useMemo`s were re-running on dependency changes and allocating unused objects.

### Medium: unused imports

| File | Removed |
|---|---|
| `src/app/(app)/explore/page.tsx` | `LngLatBoundsLike`, `Sparkles` (lucide), `titleizeMapViewValue` |
| `src/app/(app)/rtp/[rtpCycleId]/page.tsx` | `projectFundingReimbursementTone` import, `projectStatusTone` local function |
| `src/app/(app)/aerial/missions/[missionId]/page.tsx` | `AerialMissionType` type |
| `src/app/(app)/models/page.tsx` | `MODEL_FAMILY_OPTIONS` constant |
| `src/lib/reports/catalog.ts` | `PacketFreshnessLabel` type |
| `src/app/(app)/grants/page.tsx` | 13 unused imports (`WorkspaceCommandQueueItem`, `DecisionFilter`, `StatusFilter`, 6 `buildFocusedGrants*` helpers, `compareProjectGrantModelingEvidenceForQueue`, `formatCurrency`, `getOpportunityPriority`, `isDecisionSoon`) |

### Low: unused top-level script constants

| File | Removed |
|---|---|
| `aerial-evidence-proof.mjs` | `WORKSPACE_ID` → `_WORKSPACE_ID` (prefix convention, kept for reference) |
| `rtp-cycle-proof.mjs` | `WORKSPACE_ID`, `PROJECT_ID`, `AWARD_ID` → `_`-prefixed |

Kept but prefixed — these are proof scripts that future debug runs may want to reference.

### Low: unused state setters with used getters

`src/app/(app)/explore/page.tsx`: `setShowPoints` → `_setShowPoints`, `setCameraMode` → `_setCameraMode`. Getters (`showPoints`, `cameraMode`) are live (feed `fitBounds` pitch, layer visibility). Setters are never called — kept state pinned at defaults, pending a UI control that wires them up.

## Why this matters beyond "cosmetic"

Two concrete wins:

1. **Fewer DB round-trips.** 17 queries × five high-traffic pages = real load reduction on Supabase, especially as workspace member counts grow. The removed queries weren't cheap — most included `.order("updated_at")` and workspace-scoped `.eq()` filters that hit indexed columns but still consumed pool slots.

2. **Smaller client bundles.** Unused imports from `lucide-react`, `mapbox-gl`, and utility modules get tree-shaken by the production bundler, but tree-shaking is imperfect. Removing the imports at source is faster and more predictable.

## Files touched

13 files:

- `src/app/(app)/data-hub/page.tsx`
- `src/app/(app)/plans/[planId]/page.tsx`
- `src/app/(app)/plans/page.tsx`
- `src/app/(app)/programs/[programId]/page.tsx`
- `src/app/(app)/programs/page.tsx`
- `src/app/(app)/rtp/[rtpCycleId]/page.tsx`
- `src/app/(app)/explore/page.tsx`
- `src/app/(app)/aerial/missions/[missionId]/page.tsx`
- `src/app/(app)/models/page.tsx`
- `src/app/(app)/grants/page.tsx`
- `src/lib/reports/catalog.ts`
- `aerial-evidence-proof.mjs`
- `rtp-cycle-proof.mjs`

## Not this slice

- **Quota sweep (77 endpoints).** Bigger, separate slice.
- **CSP headers.** Next layer of defense-in-depth after markdown renderer hardening; separate slice.
- **Dashboard-only W1.3 + W1.4.** Supabase Studio toggles — no code needed.
