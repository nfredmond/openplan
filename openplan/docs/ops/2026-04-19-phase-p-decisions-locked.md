---
title: Phase P design decisions — locked (Claude answered on Nathaniel's delegation)
date: 2026-04-19
decision_pack: docs/ops/2026-04-19-phase-p-design-decision-pack.md
delegation_note: Nathaniel explicitly delegated the five asks with "You answer for me. Take this app to the next level."
---

# Phase P decisions — locked

Five asks from the 2026-04-19 decision pack. Nathaniel delegated; this doc records the choices that now govern the next engineering phases.

## Decisions

1. **T16 reader-surface pick — County-run detail page.**
   The honest answer: KPIs belong where the manifest lives. Option 2 (model detail evidence panel) risks exactly the screening-grade bleed the gate was written to prevent. Option 3 (workspace card) has the lowest planner utility.
   - **Unblocks:** Phase S.1 — caveat-gate wiring.
   - **Next code:** new reader section on `county-runs/[countyRunId]/page.tsx` calling `loadBehavioralOnrampKpisForWorkspace` with a visible banner + toggle mirroring `describeScreeningGradeRefusal(count)`.

2. **`rtp_posture` body — Compact inline summary with warm-gradient conditional.**
   One line: "Committed $X · remaining gap $Y · N awards on record" + reason phrase. Warm (amber) gradient only when `remainingFundingGap > 0`. Matches the frontend design constitution's calm-density posture.
   - **Unblocks:** Phase S.2 — RTP posture reader surfacing.
   - **Shipped this session:** `project-posture-unified.tsx` on `projects/[projectId]/page.tsx`.

3. **`aerial_posture` body — Unified project posture section paired with #2.**
   Both postures share one worksurface section on the project detail page. Single source of truth for the column.
   - **Unblocks:** Phase S.3 — aerial posture reader surfacing + mission-page rewire.
   - **Shipped this session:** same component as #2.
   - **Follow-up:** rewire mission detail page to read `aerial_posture` from the column instead of recomputing via `buildAerialProjectPosture` inline. Deferred this session.

4. **Quota — per-workspace scope + binary weight.**
   - 4a (scope): **Stay per-workspace.** Matches current behavior. Per-project would require schema + signature changes; real-world rural RTPA usage doesn't justify the complexity until pilots expose the need.
   - 4b (weight): **Binary weight. Model-run launches = 5 units, all other quota-gated actions = 1 unit.** Model-run launches are ~minutes of AequilibraE / ActivitySim compute; analysis and screening runs are seconds. Honest weighting without per-endpoint config drift.
   - **Unblocks:** Phase O — quota asymmetry closure.
   - **Next code:** extend `checkMonthlyRunQuota` signature to accept `weight: number`; add `QUOTA_WEIGHTS` constant (`MODEL_RUN_LAUNCH = 5`, default = 1); wire the gate across the 77 uncovered endpoints.

5. **90% plan example — Nevada County RTPA (NCTC).**
   Local relationship + existing pilot data at `openplan/data/screening-runs/nevada-county-runtime-norenumber-freeze-20260324/` makes this the cheapest honest pick. Rural + under-resourced framing aligns with the Nat Ford covenant. Tribal partner (Option 4) is the best long-term pick but needs explicit permission and is not a one-session decision.
   - **Unblocks:** Phase Q — 90% plan examples + Priorities.md `Now` item 4 + `Next` items 2–4.
   - **Next work:** data-packet authoring, demo lane URL, outbound-ready materials. Spans multiple sessions, intersects commercial lane.

## This session's slice (executed)

Phase S.2 + S.3 shipped behind decisions #2 and #3:

- Extended `ProjectRow` to include `rtp_posture`, `rtp_posture_updated_at`, `aerial_posture`, `aerial_posture_updated_at` (`src/app/(app)/projects/[projectId]/_components/_types.ts`).
- Extended the `.select(...)` on `projects` in `projects/[projectId]/page.tsx` to pull those four columns.
- Added `src/app/(app)/projects/[projectId]/_components/project-posture-unified.tsx` — compact dual-row worksurface reading the cached posture, warm-gradient conditional on `rtpPosture.remainingFundingGap > 0`.
- Rendered it on the project detail page directly after the `ProjectPostureHeader`.

**Writer/reader census update (from `2026-04-18-program-retrospective-update.md`):**

| # | Case | State (after this session) |
|---|---|---|
| 1 | T16 caveat gate | unchanged — design-locked, Phase S.1 next |
| 2 | T4 stale banner on `<RtpReportDetail>` | fixed (2026-04-17) |
| 3 | `projects.rtp_posture` body | **fixed** (this session) |
| 4 | `projects.aerial_posture` body | **fixed** (this session) — mission page recompute still active, follow-up deferred |
| 5 | T1 regenerate clears `rtp_basis_stale` | fixed (2026-04-18) |

Net: 4 of 5 writer/reader cases closed. T16 is the only remaining one and is now design-locked on decision #1.

## Verification

- `pnpm tsc --noEmit` → clean (0 errors).
- `pnpm test --run` → 761/169 passing, zero regression.
- `pnpm build` → green, `/projects/[projectId]` route compiles.

## Queued next sessions (in the order that burns least design debt)

1. **Phase O — Quota closure.** Mechanical wiring behind decision #4 across 77 endpoints. ~1 full session.
2. **Phase S.1 — T16 county-run reader.** New reader section + caveat-gate banner behind decision #1. ~1 session.
3. **Phase S.3 follow-up — mission page rewire.** Drop the inline recompute; read `aerial_posture` from the column. ~2 hours.
4. **Phase Q — NCTC 90% plan example.** Multi-session + commercial-lane work behind decision #5.

## Pointers

- Decision pack with full options analysis: `docs/ops/2026-04-19-phase-p-design-decision-pack.md`.
- Prior writer/reader census: `docs/ops/2026-04-18-program-retrospective-update.md`.
- T16 audit: `docs/ops/2026-04-16-caveat-gate-audit.md`.
- Quota evidence: `docs/ops/2026-04-18-phase-p-error-boundaries-proof.md`.
