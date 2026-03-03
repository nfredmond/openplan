# B-01 External Replay Blocker — Failure Point, Mitigation Plan, Next-Best Deterministic Proof

- Date (PT): 2026-03-01 evening update
- Owner: Iris Chen
- Scope: OpenPlan P0-D01 webhook lifecycle evidence

## 1) Exact failure point (external replay)

During closure run, direct fetch of historical Stripe canary event `evt_1T5z5sFRyHCgEytnojyHBuxt` returned `404` in current environment key scope.

Evidence:
- `openplan/docs/ops/2026-03-01-test-output/2026-03-01-2049-b01-closure-bundle.log`

Observed condition:
- Current pulled env key prefix is `sk_test` and `checkout.session.completed` event list is empty in this scope for the targeted lineage.
- Result: direct replay/ack against the original historical event ID cannot be completed in the current key scope.

## 2) Mitigation plan (morning gate packet)

1. Use active Stripe key scope to generate a fresh checkout lifecycle with UUID workspace metadata.
2. Capture fresh native Stripe event IDs from the same scope (`checkout.session.completed`, `customer.subscription.created`, `customer.subscription.deleted` as available).
3. Replay/ack these events to production webhook and capture:
   - webhook response status,
   - `billing_webhook_receipts` rows,
   - `billing_events` correlation (`payload.providerEventId`),
   - workspace subscription mutation before/after.
4. Revert workspace state post-proof and record revert log.
5. Publish one consolidated morning bundle log and link from ship evidence index.

ETA to execute after gate open: 45–60 minutes.

## 3) Next-best deterministic proof artifact (available now)

A full signed synthetic lifecycle was executed end-to-end against production webhook, proving deterministic processing path even with external replay blockage:

- Synthetic lifecycle proof log:
  - `openplan/docs/ops/2026-03-01-test-output/2026-03-01-2219-b01-synthetic-lifecycle-proof.log`

This artifact includes:
- Stripe-signed replay POST results (`200`) for three lifecycle events.
- Matching `billing_webhook_receipts` (3 processed rows).
- Matching `billing_events` correlation (3 rows by `providerEventId`).
- Workspace subscription mutation proof (`pilot/free -> active/starter -> canceled/starter`).
- Workspace revert proof back to baseline (`pilot/free`, stripe IDs null).

## 4) Supporting evidence bundle paths

- Replay blocker + partial closure bundle:
  - `openplan/docs/ops/2026-03-01-test-output/2026-03-01-2049-b01-closure-bundle.log`
- Workspace revert hygiene (previous run):
  - `openplan/docs/ops/2026-03-01-test-output/2026-03-01-2051-b01-workspace-revert.log`
- Ship index update anchor:
  - `openplan/docs/ops/2026-03-01-ship-evidence-index.md`
