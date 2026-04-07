# OpenPlan Canonical Proof Alias Decision — 2026-04-07

**Date:** 2026-04-07  
**Owner:** Bartholomew Hale (COO)  
**Status:** ACTIVE DECISION  
**Purpose:** remove alias ambiguity from the OpenPlan billing/proof lane so same-cycle v1 closeout work can proceed cleanly.

## Decision

**Keep `https://openplan-natford.vercel.app` as the canonical proof alias.**

`https://openplan-zeta.vercel.app` remains a **legacy compatibility alias only** and should not be used as the default surface for current billing proof, canary execution, or v1 closeout documentation unless an artifact explicitly states that it is testing legacy alias behavior.

## Why this decision is being reaffirmed

The current repo already contains a canonical alias policy naming `openplan-natford` as the active production alias. However, fresh proof work on 2026-04-07 exposed an operational split:

- `openplan-natford` matches the current canonical policy and webhook posture,
- but browser proof on that alias is blocked by Vercel deployment protection without a valid bypass or authenticated session,
- while `openplan-zeta` is more reachable for browser proof but is not the correct default canonical surface for current closeout work.

That split is dangerous because it can produce a fake sense of closure by proving browser behavior on one alias and webhook/commercial posture on another.

We should not allow that.

## Governing interpretation

For all **current v1 closeout work**, the proof lane must satisfy the following rule:

> The alias used for browser-visible billing proof, webhook verification, and closeout documentation must be the same canonical alias unless the artifact explicitly documents a deliberate legacy-path exception.

For this cycle, that canonical alias is:

- **`https://openplan-natford.vercel.app`**

## Operational consequence

The immediate blocker is **not** alias uncertainty anymore.
The immediate blocker is now strictly:

1. obtain a valid path through Vercel deployment protection for `openplan-natford`, via either:
   - `OPENPLAN_VERCEL_PROTECTION_BYPASS_SECRET`, or
   - an intentionally authenticated browser session,
2. then run the supervised paid canary on that exact alias,
3. then capture the resulting billing/webhook proof packet against that same alias.

## Explicit non-decision

This memo does **not** declare `openplan-zeta` broken or forbidden.

`openplan-zeta` can still be used for:
- legacy compatibility checks,
- historical evidence interpretation,
- explicit debugging when an alias-specific discrepancy is being investigated.

But it is **not** the default proof surface for the current v1 closeout lane.

## What must not happen

The following are now out of bounds for the current proof lane:

1. Running browser proof on `openplan-zeta` and treating that as closure for `openplan-natford`.
2. Mixing screenshots/logs from `zeta` with webhook/commercial checks from `natford` in one “complete” packet without explicit disclosure.
3. Writing new operational docs that casually switch between aliases.
4. Using the more convenient alias merely because deployment protection is inconvenient on the canonical one.

That would weaken the truthfulness of the commercial proof story.

## Required next action

Before the supervised paid canary is re-attempted, the operator must supply one of:

- a valid `OPENPLAN_VERCEL_PROTECTION_BYPASS_SECRET`, or
- an authenticated browser path that is intentionally approved for proof execution on `openplan-natford`.

If neither path is available, the canary should remain **blocked**, not quietly rerouted to `openplan-zeta` and called done.

## Documentation rule for this cycle

All new current-cycle closeout artifacts should:
- default to `openplan-natford`,
- mention `openplan-zeta` only when relevant as a legacy/debug alias,
- and explicitly disclose any alias override in the document body.

## Acceptance criteria for alias closure

This alias decision is considered operationally closed when:
- the proof runner can access `openplan-natford` through an approved protection path,
- the supervised paid canary is executed against `openplan-natford`,
- and the resulting packet uses one alias consistently across browser proof, webhook proof, and narrative closeout.

## Related source artifacts

- `docs/ops/2026-04-05-openplan-alias-reference-policy.md`
- `docs/ops/2026-04-05-openplan-proof-ops-runbook.md`
- `docs/ops/2026-04-07-openplan-proof-rerun-preflight-refresh.md`
- `docs/ops/2026-04-07-openplan-v1-closeout-plan.md`
- `docs/ops/2026-04-07-openplan-v1-execution-board.md`

## Bottom line

The decision is simple:

- **Canonical proof alias:** `openplan-natford`
- **Legacy compatibility alias:** `openplan-zeta`
- **Real blocker:** protection-path access on `openplan-natford`, not alias uncertainty

That gives the billing proof lane one clean target and removes the temptation to prove the easy thing instead of the right thing.
