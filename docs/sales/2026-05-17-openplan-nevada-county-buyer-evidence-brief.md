# Nevada County Buyer Evidence Brief — 2026-05-17

Static screening-run snapshot for supervised OpenPlan conversations.

## Posture

internal prototype only; screening-grade only; not production model validation

## Copyable brief

Nevada County buyer evidence brief
Static screening-run snapshot for supervised OpenPlan conversations

Run: nevada-county-runtime-norenumber-freeze-20260324
Engine: AequilibraE screening runtime
Counts source: Caltrans 2023 priority counts (five-station subset)
Status: internal prototype only
Gate reason: At least one core facility has 237.62% absolute percent error, above the 50.00% critical-facility threshold.
Key metric: 237.62% Max APE — Above the 50% critical-facility threshold — disqualifies this run from outward modeling claims.

Caveats to keep attached:
- screening-grade only
- OSM default speeds/capacities
- tract fragments are not calibrated TAZs
- jobs are estimated from tract-scale demographic proxies
- external gateways are inferred from major boundary-crossing roads

Buyer use: Use this brief to explain how OpenPlan keeps evidence, caveats, and next-step scoping together before buyer reliance.
Not proof of: This brief does not prove current runtime state, calibrated forecasts, production data setup, account/workspace creation, immediate customer activation, payment flow, or legal/compliance determination.
Next step: Scope one supervised first workflow: geography, data owner, review owner, hosting lane, and evidence standard.
Proof doc: docs/ops/2026-04-18-modeling-nevada-county-live-proof.md

## Use boundary

Use this as a buyer conversation aid only after the proof boundary has been stated. It does not expand OpenPlan capability claims, does not replace human review, and does not prove production workflow readiness.
