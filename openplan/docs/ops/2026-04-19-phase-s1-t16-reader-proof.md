---
title: Phase S.1 — T16 reader surface (county-run behavioral-onramp KPIs)
date: 2026-04-19
decisions_doc: docs/ops/2026-04-19-phase-p-decisions-locked.md
phase: S.1
---

# Phase S.1 — T16 reader surface

Closes the T16 writer-wired/reader-dead case. The caveat-gate writer
(`partitionScreeningGradeRows`, `loadBehavioralOnrampKpisForWorkspace`) was
already wired through the manifest-ingest path, but no UI consumed the
output — so the gate's refusal signal was invisible to operators.

Per decision #1 in `2026-04-19-phase-p-decisions-locked.md`:

> **T16 reader-surface pick — County-run detail page.**
> KPIs belong where the manifest lives.

This phase adds the reader on `county-runs/[countyRunId]/page.tsx`.

## What shipped

### New server component

`src/app/(app)/county-runs/[countyRunId]/_components/county-run-behavioral-kpis.tsx`

- Renders a `module-section-surface` with the same shape as other Phase-C
  section components (iconified header + description + body).
- Pulls KPIs for the current county run from the workspace-wide result.
- Warm-gradient refusal banner when this run is in the rejected list AND
  consent is not given. Copy mirrors `describeScreeningGradeRefusal(count)`
  exactly — the same string produced by the write path.
- Toggle: a prefetch=false link to `?includeScreening=1` to accept the
  caveat. When consent is already accepted, shows a revert link back to
  the default.
- Empty state when KPIs haven't been written yet (pre-manifest-ingest).
- Error state when the underlying load failed.

### Page wiring

`src/app/(app)/county-runs/[countyRunId]/page.tsx`

- Adds `searchParams?: Promise<{ includeScreening?: string }>` to the
  server-component props.
- Parses `includeScreening === "1"` into `acceptScreeningGrade` consent.
- Calls `loadBehavioralOnrampKpisForWorkspace` with the consent.
- Renders `CountyRunDetailClient` (unchanged) followed by a new
  `<section>` hosting `<CountyRunBehavioralKpisSection>`.

### Why URL-state, not client useState

A URL-based toggle (`?includeScreening=1`) keeps the reader a pure server
component. That means:

1. Consent is shareable — a planner can copy the URL and hand it to a
   reviewer with the screening caveat already accepted.
2. SSR renders the correct content on first paint — no client hydration
   flash where the banner briefly appears before consent loads.
3. The reader stays in the server-component tree, so no "use client"
   boundary needs to be crossed to hit the Supabase server client.

This matches the Phase C pattern of server-side data loading with
purpose-built section components.

## Writer/reader census update

| # | Case | State |
|---|---|---|
| 1 | T16 caveat gate | **fixed** (this phase) |
| 2 | T4 stale banner | fixed (2026-04-17) |
| 3 | `projects.rtp_posture` body | fixed (2026-04-19 Phase S.2) |
| 4 | `projects.aerial_posture` body | fixed (2026-04-19 Phase S.3, mission page deferred) |
| 5 | T1 regenerate clears `rtp_basis_stale` | fixed (2026-04-18) |

**All 5 writer/reader cases are now closed.** The 18-ticket integration
program's only remaining gap was T16's reader surface; that is now live.

## Verification

```
pnpm tsc --noEmit                       # clean
pnpm test --run                         # 766/169 passing (unchanged)
pnpm build                              # ✓ Compiled successfully
```

No new unit tests. The KPI loader (`loadBehavioralOnrampKpisForWorkspace`)
and the caveat gate (`partitionScreeningGradeRows`,
`describeScreeningGradeRefusal`) already have exhaustive unit coverage in
`src/test/behavioral-onramp-kpis.test.ts` and `src/test/caveat-gate.test.ts`.
The new section component is a presentational wrapper over those — its
behavior is entirely determined by the data it receives.

## What Phase S.1 does NOT include

- Per-row drill-in (clicking a KPI to see breakdown_json). The reader
  shows the name/value/unit triple only; that's enough to satisfy the
  caveat-gate write-side contract.
- Edit/override affordances on individual KPIs. KPIs are ingest-only;
  editing them from the reader would violate the write-back contract.
- A global "always include screening grade" workspace preference. The
  per-URL toggle is strictly per-session — no durable consent state.
  This is intentional: screening-grade acceptance should be an explicit
  per-visit decision, not a setting the planner forgets they flipped.

## Queued next sessions (revised)

1. **Phase S.3 follow-up — mission page rewire.** ~2h. Drop inline
   recompute; read `aerial_posture` from the column.
2. **Phase O.1 — quota wiring for genuinely compute-heavy endpoints.**
   Small tranche (aerial mission process, network-package ingest,
   scenario comparison snapshots). ~1 session.
3. **Phase Q — NCTC 90% plan example.** Multi-session + commercial-lane.

## Pointers

- Decisions doc: `docs/ops/2026-04-19-phase-p-decisions-locked.md`
- Prior caveat-gate audit: `docs/ops/2026-04-16-caveat-gate-audit.md`
- Writer module: `src/lib/models/behavioral-onramp-kpis.ts`
- Gate module: `src/lib/models/caveat-gate.ts`
- New reader section: `src/app/(app)/county-runs/[countyRunId]/_components/county-run-behavioral-kpis.tsx`
- Page wiring: `src/app/(app)/county-runs/[countyRunId]/page.tsx`
