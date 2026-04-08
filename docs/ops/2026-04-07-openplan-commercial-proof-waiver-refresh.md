# OpenPlan Commercial Proof Waiver Refresh — 2026-04-07

**Date (PT):** 2026-04-07  
**Decision owner:** Nathaniel Ford Redmond (CEO)  
**Recorded by:** Bartholomew Hale (COO)

## Decision

Nathaniel explicitly waived the requirement to run a fresh supervised paid Starter canary in the current April 2026 closeout cycle.

## Exact written instruction

> "I don't have money, let's assume the canary works. We tested it a month ago and it worked."

## Why this waiver is reasonable

This is not blind optimism. It rests on a narrower but still real evidence base:

1. prior live payment testing existed and is part of the existing OpenPlan proof history;
2. the current canonical alias proof lane is now technically ready on `openplan-natford`;
3. the current supervised paid canary preflight is green on the canonical alias;
4. the canary is being waived for cash-preservation reasons, not because the distinction stopped mattering.

## What this waiver does

1. removes the requirement to execute a real money-moving canary in the current cycle;
2. allows the team to treat the payment lane as operationally sufficient for present pilot-readiness decisions;
3. converts the remaining canary step from an active gate into an accepted evidence boundary.

## What this waiver does NOT do

1. It does **not** prove that a fresh same-cycle paid happy-path checkout completed on 2026-04-07.
2. It does **not** authorize claims that billing was freshly re-proven today with a real charge.
3. It does **not** erase the distinction between:
   - historical live payment evidence,
   - current non-money-moving production billing proof,
   - and a fresh same-cycle commercial canary.
4. It does **not** justify broad self-serve commercial overclaiming.

## Operating rule after this waiver

Use this posture going forward:
- **Operational posture:** payments are treated as operationally sufficient for the current supervised pilot boundary.
- **Evidence posture:** the canary preflight is ready, but no fresh same-cycle real paid checkout was executed.
- **Disclosure posture:** if billing-proof strength matters, describe it as historical live payment evidence plus current production billing proof plus explicit CEO waiver of the fresh paid canary.

## Re-open condition

Re-open the paid canary lane only if one of the following becomes true:
1. a real billing regression appears;
2. a customer/support incident requires stronger current proof;
3. cash is available later and Nathaniel wants the strongest possible commercial packet.

## Related current-cycle proof notes

- `docs/ops/2026-04-07-openplan-canonical-proof-alias-decision.md`
- `docs/ops/2026-04-07-openplan-canonical-alias-protection-path-unblock.md`
- `docs/ops/2026-04-07-openplan-canary-preflight-ready.md`
- `docs/ops/2026-04-07-test-output/20260407T201100Z-supervised-paid-canary-preflight/preflight-summary.md`

## Recommendation

Treat the paid-canary lane as **waived for this cycle**, not as unresolved chaos.

Move the team back to the remaining high-value closeout work:
- refreshed Principal QA adjudication,
- external language lock,
- pilot ops pack,
- go / no-go memo.
