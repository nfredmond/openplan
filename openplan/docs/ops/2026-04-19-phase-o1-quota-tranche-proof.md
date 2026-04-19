---
title: Phase O.1 — Quota tranche (scenario comparison-snapshots wired)
date: 2026-04-19
decisions_doc: docs/ops/2026-04-19-phase-p-decisions-locked.md
phase: O.1
---

# Phase O.1 — Quota tranche

Continues the Phase O scope-discipline: **wire the quota gate only where
semantics are honest today**. After inspecting the four candidates from the
Phase O proof, only one qualifies for clean wiring this session. The other
three are held for a follow-up (O.2) with per-endpoint reasons documented
below.

## What shipped

### Wired — `/api/scenarios/[scenarioSetId]/spine/comparison-snapshots`

Added the same subscription + quota gate shape as `reports/[reportId]/generate`
(Phase O), placed immediately after the existing scenario-set access check:

- Fetch `workspaces.select("plan, subscription_plan, subscription_status")` for
  `access.scenarioSet.workspace_id`.
- `isWorkspaceSubscriptionActive` → 402 with `subscriptionGateMessage` when
  inactive.
- `checkMonthlyRunQuota` with `tableName: "runs"` and
  `weight: QUOTA_WEIGHTS.DEFAULT` → 500 on lookup error, 429 when exceeded.
- Audit events: `workspace_billing_lookup_failed`, `subscription_inactive`,
  `run_limit_count_failed`, `run_limit_reached`.

The gate runs before the entry/assumption/data-package lookups and before any
`scenario_comparison_snapshots` / `scenario_comparison_indicator_deltas`
inserts, so rejected requests do zero downstream work.

### Tests extended — `src/test/scenario-comparison-snapshots-route.test.ts`

- Existing test unchanged in intent. Added `workspaces` + `runs` branches to
  `fromMock`, plus default fixtures: `subscription_status: "active"` and
  `count: 0`.
- **+1 test:** returns 402 when `subscription_status: "past_due"` and never
  inserts a snapshot.
- **+1 test:** returns 429 when the `runs` count exceeds the plan limit and
  never inserts a snapshot.

3 tests now in this file (was 1). Full suite: 768/169 (was 766/169).

## Not wired — why

| Candidate | Status | Reason |
|---|---|---|
| `/api/aerial/missions/[missionId]/process` | Skipped | Returns HTTP 501 with an honest integration-boundary payload. No compute runs. Gating a no-op is semantic noise, not load-shedding. Revisit when NodeODM is wired. |
| `/api/assistant` | Skipped | Still deterministic (`buildAssistantResponse` — no Anthropic/OpenAI/AI SDK calls). The Phase O doc specifically conditioned this on "if/when it makes real AI calls." Revisit when the assistant actually calls a model. |
| `/api/network-packages/[packageId]/versions/[versionId]/ingest` | Deferred to O.2 | **Pre-existing auth gap.** The endpoint has no `supabase.auth.getUser()` check, no workspace-membership check, and no workspace-id resolution. Adding the full auth+membership+subscription+quota chain is a 4-concern diff that goes beyond "add the quota gate to an already-secure endpoint." Scope-honest to split it. |

## Why not "just wire it" to network-package-ingest too

Adding a quota gate to a route that is **currently unauthenticated** would
couple a security fix with a rate-limiting change, making both harder to
review and to revert independently. The correct sequence is:

1. **O.2 step 1** — patch auth (401 for anonymous, 403 for non-members) with
   a new test covering both. That is a security hardening, not a rate-limit
   change, and should land separately.
2. **O.2 step 2** — then add subscription + quota gate on top, matching the
   O.1 pattern.

There are **zero existing callers** of the ingest route (grep across
`src/`, `scripts/`, and `supabase/` found only the route file itself and one
migration referencing its QA columns), so this deferral has no product-lane
cost.

## Verification

```
npx tsc --noEmit                        # clean
pnpm test --run                         # 768/169 passing (+2 vs Phase O)
pnpm build                              # ✓ Compiled successfully
```

No regressions. The new tests assert both 402 (subscription) and 429 (quota)
paths skip the downstream insert.

## Weight rationale

Comparison-snapshot creation is "planning compute on the workspace's analysis
budget" — not a model-run launch. It inserts a comparison row, up to 100
indicator-delta rows, and triggers a report-packet writeback. Conceptually
paired with `reports/generate` and `/api/analysis`, all three use
`QUOTA_WEIGHTS.DEFAULT = 1` against the `runs` bucket. Only
`/api/models/[…]/launch` uses `QUOTA_WEIGHTS.MODEL_RUN_LAUNCH = 5` against
the `model_runs` bucket.

## Honest note on gate accounting

As under Phase O's report-generate wiring, this endpoint **reads from** the
`runs` bucket but does **not insert** a `runs` row when it succeeds. The gate
therefore functions as a cap ("don't allow planning compute beyond this
month's analysis budget") rather than strict consumption accounting
("comparison snapshots consume from the analysis budget"). This is defensible
for a pilot-grade product but should be revisited when Stripe metering goes
live, at which point the choice is:

- **(a)** insert a `runs` row per planning-compute op, or
- **(b)** introduce a separate `planning_ops` bucket with its own monthly
  limit tied to plan tier.

That decision is a billing-design question, not a wiring question, and is
tracked as part of the commercial-lane (Phase Q / pricing work).

## Writer/reader census (unchanged)

All 5 cases closed per the Phase S.3 follow-up proof earlier today.

## Pointers

- Decisions doc: `docs/ops/2026-04-19-phase-p-decisions-locked.md`
- Phase O foundation: `docs/ops/2026-04-19-phase-o-quota-closure-proof.md`
- Phase S.3 follow-up: `docs/ops/2026-04-19-phase-s3-followup-mission-rewire-proof.md`
- Wired route: `src/app/api/scenarios/[scenarioSetId]/spine/comparison-snapshots/route.ts`
- Updated tests: `src/test/scenario-comparison-snapshots-route.test.ts`
- Deferred O.2 target: `src/app/api/network-packages/[packageId]/versions/[versionId]/ingest/route.ts`
