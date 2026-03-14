# OpenPlan Analysis Context Geometry Hardening Pass

Date: 2026-03-13
Owner: Bartholomew (COO)
Status: COMPLETE — explicit contract coverage for corridor and crash-point thematic-ready datasets

## Summary
Followed the new corridor and crash-point geometry-attachment work with a focused contract hardening pass.

This pass adds explicit analysis-context test coverage so the product contract now verifies that:
- corridor-attached datasets can become `thematicReady`
- crash-point-attached datasets can become `thematicReady`

## What changed
Updated:
- `src/test/analysis-context-route.test.ts`

Added explicit cases for:
- `analysis_corridor` + corridor dataset + `safetyScore`
- `analysis_crash_points` + point dataset + `severityBucket`

## Why this matters
The geometry-attachment ladder now spans three tiers:
- tracts
- corridor/route geometry
- crash-point geometry

This test pass reduces the risk of silently regressing those newer non-tract branches while continuing future Data Hub work.

## Validation
- `npm run lint` ✅
- `npm test` ✅ (`28` files / `146` tests)
- `npm run build` ✅

## Recommended next step
1. Surface point-attachment posture more explicitly in map inspectors/legends over time
2. Add asset / observation-style point attachment models beyond crash points
3. Consider a small comparison/report note when active overlay geometry attachment type changes between runs
