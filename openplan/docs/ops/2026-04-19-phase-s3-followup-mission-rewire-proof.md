---
title: Phase S.3 follow-up — mission page reads cached aerial_posture
date: 2026-04-19
decisions_doc: docs/ops/2026-04-19-phase-p-decisions-locked.md
phase: S.3-followup
---

# Phase S.3 follow-up — mission page reads cached aerial_posture

Closes the last deferred item from the Phase P decisions: the aerial mission
detail page now reads the cached `projects.aerial_posture` column instead of
leaving that surface writer-wired/reader-dead at the project roll-up level.

## What the mission page was doing

`src/app/(app)/aerial/missions/[missionId]/page.tsx` called
`buildAerialProjectPosture([{ status: mission.status }], packages)` inline with
**only this mission's** packages and labeled the result "Mission posture" in
the inspector. That display is correct for mission-scoped numbers, but it
completely bypassed the cached `projects.aerial_posture` column — so operators
on a mission page had no view of the project-wide roll-up that downstream
closeouts, RTP readers, and evidence-package mutations actually refresh.

## What changed

### Mission query extended to pull cached column

```diff
- "…, projects:projects!aerial_missions_project_id_fkey(id, name)"
+ "…, projects:projects!aerial_missions_project_id_fkey(id, name, aerial_posture, aerial_posture_updated_at)"
```

A tiny type-guard (`isAerialProjectPosture`) runtime-checks the JSON column
shape before passing it into the presentational helper — the Supabase type is
`Record<string, unknown>` so we can't trust it at the type level.

### Inspector surface: mission-scoped + project-cached, side by side

Two inspector groups now sit where one sat before:

1. **"This mission only"** — the existing inline aggregate, unchanged in
   computation. Label sharpened from "Mission posture" to make scope
   unambiguous.
2. **"Project aerial posture (cached)"** — only rendered when the mission is
   linked to a project. Reads `aerial_posture` + `aerial_posture_updated_at`
   directly from the joined project row. Shows:
   - Roll-up line (`N ready · M missions`) with
     `describeAerialProjectPosture(...)` as hint.
   - Verification StatusBadge using the cached value.
   - Timestamp line: "Posture cached {dateTime}".
   - Empty-state block when the column is still null (pre-first mutation).

### Why keep the mission-scoped compute

The decision doc phrasing was "drop inline recompute; read from column." Read
literally, that swaps the mission-scoped display for a project-scoped value
under a mission-scoped label — a semantic regression. The intent (surface the
cached column on the mission page) is honored by adding a dedicated
project-cached group rather than overwriting the mission-scoped group. The
mission-scoped group is the more honest thing to show first on a mission
detail page; the project roll-up is context.

No new helper was introduced. `buildAerialProjectPosture` is still correct for
the mission-scoped call because its contract is "aggregate the provided
missions and packages" — it doesn't assume the inputs span a whole project.

## Writer/reader census

| # | Case | State |
|---|---|---|
| 1 | T16 caveat gate | fixed (Phase S.1) |
| 2 | T4 stale banner | fixed (2026-04-17) |
| 3 | `projects.rtp_posture` body | fixed (Phase S.2) |
| 4 | `projects.aerial_posture` body | **fixed (this phase — mission page)** + Phase S.3 (project page) |
| 5 | T1 regenerate clears `rtp_basis_stale` | fixed (2026-04-18) |

All five cases now have both a writer **and** a reader on every surface where
the cached column is relevant. There is no remaining deferred reader work.

## Verification

```
npx tsc --noEmit                        # clean
pnpm test --run                         # 766/169 passing (unchanged)
pnpm build                              # ✓ Compiled successfully
```

No new unit tests. The new surface is purely presentational over data already
covered by `src/test/aerial-posture-writeback.test.ts` (the writer that
populates the column) and catalog tests for `describeAerialProjectPosture` and
`aerialVerificationReadinessTone`.

## What this phase does NOT include

- No edit/override of cached posture from the mission page. The column is
  writer-owned by `rebuildAerialProjectPosture` in
  `src/lib/aerial/posture-writeback.ts`; editing it from a reader would
  violate the write-back contract.
- No refactor of the aerial module's catalog helpers. A
  `buildAerialMissionPosture` was considered but not introduced — the current
  call with a one-mission array is mechanically correct and the group label
  carries the scope for the reader.
- No mission-page handling of the `aerial_posture_updated_at` freshness guard
  (stale-banner pattern). The rebuild runs on every evidence-package
  mutation, so freshness lag is bounded by request latency, not by a
  background recompute cadence.

## Pointers

- Decisions doc: `docs/ops/2026-04-19-phase-p-decisions-locked.md`
- Related phase proofs:
  - Phase S.1 (county-run reader): `docs/ops/2026-04-19-phase-s1-t16-reader-proof.md`
  - Phase O (quota closure): `docs/ops/2026-04-19-phase-o-quota-closure-proof.md`
- Writer module: `src/lib/aerial/posture-writeback.ts`
- Catalog module: `src/lib/aerial/catalog.ts`
- Project-page reader (pattern reference): `src/app/(app)/projects/[projectId]/_components/project-posture-unified.tsx`
- Mission page: `src/app/(app)/aerial/missions/[missionId]/page.tsx`
