# Phase C.2 — explore decomposition proof (2026-04-18 evening, slice 1)

## What landed

`src/app/(app)/explore/page.tsx` dropped from **3814 → 3256 LOC** (−558, −14.6%) on a deliberately conservative first slice. Pure-structure extraction only: 11 types + 15 pure helpers moved to sibling modules, and 2 state-light JSX sections swapped for component invocations. Pattern follows Phase C.1 (`projects/[projectId]`), C.3 (`reports/[reportId]`), and C.4 (`rtp/page.tsx`) — now four surfaces on the same template.

| File | LOC |
|---|---|
| `page.tsx` (after) | 3256 |
| `_components/_types.ts` | 163 |
| `_components/_helpers.ts` | 380 |
| `_components/explore-empty-result-board.tsx` | 15 |
| `_components/explore-layer-visibility-controls.tsx` | 92 |
| **Total after** | **3,906** |

Net LOC rose ~92 lines (prop typing + component shells). Much smaller than C.1/C.3/C.4 because this slice deliberately avoided extracting the state-heavy sections.

## Why this slice is smaller than C.1/C.3/C.4

The approved plan named explore as "higher risk because of map + chat state." Scanning the component confirmed it:

- 30 `useState` calls
- 19 `useMemo` memos
- 19 `useEffect` effects
- 2 `useRef` handles (Mapbox `Map` instance, deep-link guard)
- `"use client"` component — no server-side split possible
- Mapbox imperative layer management spread across effects, callbacks, and event handlers

Unlike C.1/C.3/C.4 (server components or mostly-static client surfaces), every large explore subtree reads from **multiple** local state slices and writes back via multiple setters. Extracting the result board (712 LOC), hover inspector (135 LOC), or comparison cards would require hoisting state wiring across component boundaries with 20+ props per extracted unit, or inventing a context/reducer pattern. Both moves are bigger-than-structural and properly belong to a later slice once binding value (not line-count optics) justifies the lift.

This slice therefore limits itself to the two mechanical wins:

1. **Pure types** that don't depend on component state.
2. **Pure helpers** (geometry math, formatters, overlay paint expressions, crash layer filter) that are already module-level and have no local state dependencies.
3. **JSX sections that take only callbacks + primitive state** — two identified:
   - `ExploreLayerVisibilityControls` (10 props, all primitives + callbacks)
   - `ExploreEmptyResultBoard` (zero props, purely presentational)

## What moved

**`_components/_types.ts`** (163 LOC) — 11 types:

- `Position`, `Polygon`, `MultiPolygon`, `CorridorGeometry`
- `AnalysisResult` (with full nested metrics shape)
- `CurrentWorkspaceResponse`, `WorkspaceBootstrapResponse`, `AnalysisContextResponse`
- `WorkspaceLoadState`, `AnalysisContextLoadState`, `ReportTemplate`
- `HoveredTract`, `HoveredCrash`, `TractLegendItem`

**`_components/_helpers.ts`** (380 LOC) — 15 pure functions + 1 internal const:

- `collectPositions`, `getBoundsFromGeometry`, `formatRunTimestamp`, `titleize`, `formatSourceToken`, `buildRunTitle`
- `prioritizeMapComparisonRows`, `getComparisonNarrativeLead`
- `formatCurrency`, `coerceNumber`, `formatPercent`
- `canRenderDatasetCoverageOverlay`, `canRenderDatasetThematicOverlay`
- `buildThematicOverlayPaintExpression`, `buildPointThematicOverlayColorExpression`, `buildCrashLayerFilter`
- `MAP_CONTEXT_PRIORITY` (internal const, only consumed by `prioritizeMapComparisonRows`)

**`_components/explore-layer-visibility-controls.tsx`** (92 LOC) — client component, 10 props: `mapReady`, `showPolygonFill + onTogglePolygonFill`, `showTracts + onToggleTracts`, `showCrashes + onToggleCrashes`, `switrsPointLayerAvailable`, `tractMetric + onChangeTractMetric`.

**`_components/explore-empty-result-board.tsx`** (15 LOC) — stateless, zero-prop.

## What stayed in page.tsx

- `MAPBOX_ACCESS_TOKEN` (env-coupled, component-local)
- `COMPARISON_HEADLINE_KEYS` (only consumed inside the comparison pipeline within the component body)
- All 30 `useState` / 19 `useMemo` / 19 `useEffect` declarations
- All Mapbox map setup + imperative layer/source management
- Workspace + analysis-context loading logic
- Corridor upload integration, query setup, report generation, and AI interpretation flow
- All remaining JSX: intro overlay, workspace/intake, corridor upload + analysis context card, query + outputs, result board (current + comparison), `RunHistory`, hover inspector

## Deviations from the plan

The plan contemplated a fuller C.2 ("explore/page.tsx decomposition — 3814 LOC, worst offender remaining, higher risk"). This first slice does structural extraction only and defers the state-heavy JSX sections to a follow-up. Frame: C.2 is the entire explore decomposition; this commit is C.2 slice 1.

Rationale for splitting:

1. Pattern-proof on a client component with this much local state wasn't obvious a priori. Ship the mechanical extraction, confirm zero regression, then reopen for state-bearing sections with a deliberate props-vs-context decision.
2. A single atomic C.2 that attempted result board + hover inspector + comparison cards at once would carry non-trivial regression surface across every explore workflow. Splitting confines risk.
3. LOC optics are a bad reason to force large state-bearing extractions before binding value justifies them.

## Verification

```
pnpm tsc --noEmit   → clean (exit 0)
pnpm test --run     → 761/169 passing (zero regression)
pnpm build          → green; /explore route unchanged in manifest
```

LOC check:
```
wc -l src/app/(app)/explore/page.tsx
  → 3256
wc -l src/app/(app)/explore/_components/*.{ts,tsx}
  → 650 total
```

## Successor ladder (after this slice)

- **Phase C.2 slice 2 (optional)** — extract result board + hover inspector + comparison cards. Requires a deliberate decision on state wiring: pass-props-through vs. lift-to-context vs. extract-with-local-slice. Defer until LOC floor on page.tsx meaningfully hurts navigability or binding value appears.
- **Phase C.1.1 / C.2.1 / C.3.1 / C.4.1 (all optional)** — extract data-loaders for each decomposed page. Defer.
- **Phase O** — Quota asymmetry closure (77 routes). Design-gated on Phase P asks.
- **Phase Q** — 90% plan examples. Design-gated on Nathaniel's agency-example pick.
- **Phase S** — Design-gated unlocks (T16 reader, `rtp_posture` body, `aerial_posture` body).
- **Phase R.1** — Two small Phase-4 drift cleanups (explore gradient, programs chip clusters). Needs Nathaniel's eye.

## Phase P design asks (re-surfaced)

Still unresolved and gate everything design-flavored:

1. **Quota weight + scope** — how should the quota asymmetry banner rank across 77 route surfaces?
2. **90% plan example selection** — which agency/RTPA anchors the "plans at 90%" showcase?
3. **`rtp_posture` body content** — T16 reader needs design sign-off on copy + gradient treatment.
4. **`aerial_posture` body content** — same pattern, aerial module.

Nathaniel's call on these unblocks Phase O, Q, S, and R.1.
