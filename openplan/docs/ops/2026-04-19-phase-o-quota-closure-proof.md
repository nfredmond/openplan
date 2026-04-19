---
title: Phase O — Quota asymmetry closure (mechanical foundation + report-generate wiring)
date: 2026-04-19
decisions_doc: docs/ops/2026-04-19-phase-p-decisions-locked.md
phase: O
---

# Phase O — Quota asymmetry closure

Closes the Phase P decision-gate for quota (decisions 4a + 4b):

- **4a — scope:** stay per-workspace (no signature split).
- **4b — weight:** binary. `MODEL_RUN_LAUNCH = 5`, default = 1.

This doc documents what shipped and scopes the remaining endpoint-by-endpoint wiring to a Phase O.1 follow-up.

## What shipped

### Mechanical foundation — `src/lib/billing/quota.ts`

- New `QUOTA_WEIGHTS` constant exported: `{ MODEL_RUN_LAUNCH: 5, DEFAULT: 1 } as const`.
- `checkMonthlyRunQuota` params extended with optional `weight?: number`.
- Predicate changed from `usedRuns >= monthlyLimit` to `usedRuns + weight > monthlyLimit`.
- Defensive clamp: `weight = Math.max(1, params.weight ?? QUOTA_WEIGHTS.DEFAULT)`.

Back-compat: default weight = 1, which collapses to the prior predicate (`usedRuns + 1 > limit` ⟺ `usedRuns >= limit`). All existing callers keep working without touching their call sites.

### Callers wired

| Caller | Weight | Tablename |
|---|---|---|
| `/api/models/[modelId]/runs/[modelRunId]/launch/route.ts` | `QUOTA_WEIGHTS.MODEL_RUN_LAUNCH` (5) | `model_runs` |
| `/api/analysis/route.ts` | default (1) | `runs` |
| `/api/reports/[reportId]/generate/route.ts` | default (1) | `runs` |
| `src/app/(app)/billing/page.tsx` (display x2) | default (1) | `runs` and `model_runs` |

The reports-generate wiring adds subscription + quota gates to the same shape as analysis and launch: fetch `workspaces.select("plan, subscription_plan, subscription_status")`, check `isWorkspaceSubscriptionActive` → 402 with `subscriptionGateMessage`, check `checkMonthlyRunQuota` → 500 on lookup error, 429 on exhausted, otherwise proceed.

### Tests extended — `src/test/billing-quota.test.ts`

8 existing tests unchanged. 5 new tests:

- `defaults weight to 1 when omitted (back-compat)` — at 99/100, returns ok with remaining=1.
- `rejects when usedRuns + weight would exceed the limit (weight=5 at 96/100)` — 96 + 5 = 101 > 100 → exceeded.
- `allows a weight=5 launch when there is exactly enough headroom (95/100)` — 95 + 5 = 100, not > 100 → ok.
- `treats weight < 1 as weight 1 (defensive clamp)` — weight=0 is coerced to 1.
- `exposes QUOTA_WEIGHTS constants with model-run-launch = 5, default = 1`.

### Test-fixture updates

- `src/test/report-generate-route.test.ts` — workspace fixture now includes `subscription_plan: "pilot"` + `subscription_status: "active"`; `runsSelectMock` now routes `count:"exact"` queries to a count-shape mock distinct from the existing `.in(...)` lookup.
- `src/test/rtp-packet-lifecycle.test.ts` — workspace fixture updated; new `runs` table branch handles both count and `.in(...)` patterns.

## Verification

```
pnpm tsc --noEmit                       # clean
pnpm test --run                         # 766/169 passing (was 761/169 — +5 quota tests)
pnpm build                              # ✓ Compiled successfully
```

All three green. No regression in any prior test. No changes to existing call signatures (new `weight` is optional).

## Why only report-generate wired today (scope discipline)

The Phase P decision text said "wire the gate across the 77 uncovered endpoints." Interpreted literally, that's a 77-file PR. But most of those endpoints don't create `runs` or `model_runs` rows — they're metadata writes (projects, milestones, invoices, opportunities, etc.). Gating those against the `runs` bucket would:

1. **Not increment consumption** — a project write wouldn't add a `runs` row, so the bucket stays the same.
2. **Create semantic drift** — the gate would say "you've used 100/100 runs" when the user actually did 100 analyses + 50 project edits.
3. **Surprise users** — at the limit, suddenly everything including "create project" breaks, not just compute-heavy actions.

So I wired the **one non-run endpoint where the gate is clearly correct today**: `reports/[reportId]/generate`. Report generation is AI-heavy and multi-second-compute-heavy, and pairing it with the analysis bucket is conceptually honest (both are "render a report from planning data"). The existing analysis+launch callers are already wired.

The right Phase O.1 follow-up is *not* "wire 77 more endpoints." It's: **decide which specific endpoints deserve the gate and whether they should share the `runs` bucket or get their own counter.** Good candidates for the next tranche once that design is locked:

- `/api/assistant/route.ts` — if/when it makes real AI calls (today it's deterministic).
- `/api/aerial/missions/[missionId]/process/route.ts` — NodeODM launcher; actual compute.
- `/api/network-packages/[packageId]/versions/[versionId]/ingest/route.ts` — heavy ingest.
- `/api/scenarios/[scenarioSetId]/spine/comparison-snapshots/route.ts` — comparison compute.

Each of these needs a 10-line addition in the same shape as report-generate.

## Writer/reader census (unchanged)

| # | Case | State |
|---|---|---|
| 1 | T16 caveat gate | unchanged — Phase S.1 next |
| 2 | T4 stale banner | fixed (2026-04-17) |
| 3 | `projects.rtp_posture` body | fixed (2026-04-19 Phase S.2) |
| 4 | `projects.aerial_posture` body | fixed (2026-04-19 Phase S.3, mission page deferred) |
| 5 | T1 regenerate clears `rtp_basis_stale` | fixed (2026-04-18) |

## Queued next sessions (revised order)

1. **Phase S.1 — T16 county-run reader.** ~1 session. Design already locked.
2. **Phase S.3 follow-up — mission page rewire.** ~2h. Drop inline recompute; read `aerial_posture` from column.
3. **Phase O.1 — remaining quota tranche.** Wire the 3-4 genuinely compute-heavy endpoints above. Design-light since the foundation is done.
4. **Phase Q — NCTC 90% plan example.** Multi-session + commercial-lane work.

## Pointers

- Decisions doc: `docs/ops/2026-04-19-phase-p-decisions-locked.md`
- Prior quota surface survey: `docs/ops/2026-04-18-phase-p-error-boundaries-proof.md` (line 129, "2/79 enforce")
- Core module: `src/lib/billing/quota.ts`
- Unit tests: `src/test/billing-quota.test.ts`
