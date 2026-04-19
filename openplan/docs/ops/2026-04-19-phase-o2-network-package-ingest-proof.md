---
title: Phase O.2 — Network-package ingest (auth patch + quota gate)
date: 2026-04-19
decisions_doc: docs/ops/2026-04-19-phase-p-decisions-locked.md
phase: O.2
---

# Phase O.2 — Network-package ingest

Closes the remaining candidate flagged by Phase O.1 as deferred because of a
**pre-existing auth gap** (no `supabase.auth.getUser()` check, no workspace
resolution, no membership check). Per the O.1 proof doc, this was split from
the quota-tranche session so the security hardening could land separately
from the rate-limit change. That split is honored: this phase ships as
**two commits**, not one.

## Scope split (two commits)

### Commit 1 — `fix(api): require auth + workspace membership for network-package ingest`

Security hardening only. No rate-limit change.

- 401 when no authenticated user (`supabase.auth.getUser()` returns null).
- 404 when the `packageId` path param does not resolve to a `network_packages`
  row.
- 403 when the authenticated user has no `workspace_members` row for the
  package's `workspace_id`.
- Audit events:
  `network_package_lookup_failed`, `workspace_membership_lookup_failed`,
  `workspace_access_denied`.
- Happy-path audit extended with `userId` + `workspaceId`.

New test: `src/test/network-package-ingest-route.test.ts` — 4 tests covering
401, 404, 403, and 200 happy path.

### Commit 2 — `feat(api): add subscription + quota gate to network-package ingest`

Rate-limit change on top of the now-secure route. Matches the O.1 pattern
(`/api/scenarios/[scenarioSetId]/spine/comparison-snapshots`):

- Fetch `workspaces.select("plan, subscription_plan, subscription_status")`
  for the package's `workspace_id`.
- `isWorkspaceSubscriptionActive` → 402 with `subscriptionGateMessage` when
  inactive.
- `checkMonthlyRunQuota` with `tableName: "runs"` and
  `weight: QUOTA_WEIGHTS.DEFAULT` → 500 on lookup error, 429 when exceeded.
- Audit events: `workspace_billing_lookup_failed`, `subscription_inactive`,
  `run_limit_count_failed`, `run_limit_reached`.

Tests extended: **+2 tests** (402 past-due, 429 exceeded). File total now 6.

## Why split rather than bundle

A single diff with auth + membership + subscription + quota is four concerns
woven together. If a reviewer or auditor needs to revert "the rate limit"
without reverting "the security fix," a bundled commit forces them to
hand-revert. Two commits keep the revert surface clean: either one can be
backed out without touching the other.

There are **zero existing callers** of the ingest route (grep across `src/`,
`scripts/`, and `supabase/` found only the route file itself and one
migration referencing the QA columns), so the product-lane cost of splitting
commits is zero — there's no in-flight integration that benefits from a
larger atomic change.

## Weight rationale (unchanged from O.1)

Ingesting a network-package version is "planning compute on the workspace's
analysis budget" — it runs QA checks, writes `qa_report_json` +
`manifest_json`, and transitions a version's `status`. Conceptually paired
with `/api/analysis`, `/api/reports/[reportId]/generate`, and
`/api/scenarios/[…]/spine/comparison-snapshots`, all of which use
`QUOTA_WEIGHTS.DEFAULT = 1` against the `runs` bucket.

## Honest note on gate accounting (unchanged from O.1)

This endpoint **reads from** the `runs` bucket but does **not insert** a
`runs` row when it succeeds. The gate functions as a soft cap, not strict
consumption accounting. Same deferral applies: revisit at Stripe-metering
time with either (a) insert a `runs` row per planning-compute op or
(b) separate `planning_ops` bucket.

## Verification

```
npx tsc --noEmit                        # clean
pnpm test --run                         # 774/170 passing (+6 vs Phase O.1)
pnpm build                              # ✓ Compiled successfully
```

No regressions. The new test file asserts every gate (401/404/403/402/429)
skips the downstream `network_package_versions` update.

## Writer/reader census (unchanged)

All 5 cases closed per the Phase S.3 follow-up proof earlier today. This
phase touches auth + quota, not writer/reader plumbing.

## Pointers

- Decisions doc: `docs/ops/2026-04-19-phase-p-decisions-locked.md`
- Phase O foundation: `docs/ops/2026-04-19-phase-o-quota-closure-proof.md`
- Phase O.1 (sibling gate): `docs/ops/2026-04-19-phase-o1-quota-tranche-proof.md`
- Wired route: `src/app/api/network-packages/[packageId]/versions/[versionId]/ingest/route.ts`
- New test file: `src/test/network-package-ingest-route.test.ts`
