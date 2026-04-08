# OpenPlan Billing Operator Clarity Pass — 2026-04-07

**Date (PT):** 2026-04-07 18:31  
**Owner:** Bartholomew Hale (COO)  
**Scope:** tighten operator understanding of which workspace is being billed and how checkout targeting works

## Executive summary

The billing lane did not need a behavioral reset today.
It needed a clearer operator surface.

Current code already requires explicit workspace selection for multi-workspace billing review and POST-only checkout launch for a chosen workspace. The weakness was that the UI could still be read a little too casually by an operator moving quickly.

This pass tightens that.

## What was already true before this pass

1. Multi-workspace billing contexts require explicit workspace selection.
2. Invalid `workspaceId` does not silently fall back.
3. Checkout launches only through explicit POST, not prefetchable links.
4. Billing checkout is role-gated to owner/admin.

## What this pass changed

### Billing page
- strengthened the multi-workspace banner so it states plainly that any checkout below applies only to the currently viewed workspace,
- added a direct **Re-open workspace chooser** action,
- surfaced a workspace-id badge in the billing status card.

### Checkout launcher
- added an explicit warning block that checkout target is locked before Stripe opens,
- named the exact workspace in that warning,
- surfaced the workspace-id snippet in the warning,
- tightened button accessibility labeling so the target workspace is part of the checkout action label.

## Resulting supported behavior

The honest operator rule is now:

> Billing review and Stripe launch are tied to one explicit workspace target at a time. If the operator is in the wrong workspace surface, they should switch workspaces before starting checkout.

## Validation note

Component coverage was extended so the safeguard copy and workspace-target labeling are exercised in the billing checkout launcher test surface.

## Remaining truth

This pass improves clarity, not commercial proof scope.
It does **not** change the existing April commercial boundary:
- no fresh same-cycle real paid happy-path checkout,
- supervised pilot posture only,
- no broad self-serve overclaiming.

## Bottom line

The billing lane is now a little harder to misread under operator pressure, which is exactly what this pass was meant to do.
