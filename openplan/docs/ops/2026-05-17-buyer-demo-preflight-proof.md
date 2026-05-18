# OpenPlan buyer-demo preflight proof

**Date:** 2026-05-17
**Scope:** no-approval, read-only/local-first buyer-demo readiness bundle.
**Current checkpoint:** updated through `35bfa58e`; the latest change tightens checklist stop-condition copy only and does not expand functional proof.

## Command

```bash
npm run ops:check-buyer-demo-preflight
```

Default behavior is intentionally local-first. The bundle runs:

1. `test:sales-proof-claim-boundaries` — guards sales boundary copy and the current buyer proof packet.
2. `npm test -- --run src/test/nevada-county-example-fixture.test.ts` — guards the shared Nevada County evidence fixture, including the internal-prototype gate, Max APE caveat, story beats, and forbidden buyer claims.
3. `npm test -- --run src/test/buyer-demo-talk-track.test.ts` — guards the 90-second spoken-script boundary so operator copy cannot drift into overclaiming.
4. `ops:check-pilot-preflight -- --skip-health --skip-vercel` — checks local env and migration posture while intentionally skipping production health and Vercel reads.

For the final operator rehearsal, allow read-only external checks explicitly. In live-read mode the bundle also runs `ops:check-public-demo-preflight`, which verifies `/api/health`, `/request-access`, `/examples`, protected billing-readiness posture, and public CSP/Mapbox posture without secrets or writes:

```bash
npm run ops:check-buyer-demo-preflight -- --live-reads
```

Command Center now repeats this live-read command in the Buyer Demo Handoff section so the app surface and operator runbook point to the same final pre-demo check. It also surfaces a compact demo rehearsal checklist, the Nevada County caveats as a `Caveats to say out loud` rail, and the 90-second opening script source so the operator does not soften the public evidence record during a buyer walkthrough.

Equivalent environment flag:

```bash
OPENPLAN_BUYER_DEMO_PREFLIGHT_LIVE_READS=1 npm run ops:check-buyer-demo-preflight
```

## Safety boundary

The buyer-demo bundle is read-only and does not perform:

- production writes
- schema changes or migration applies
- seed/provisioning actions
- checkout, billing, or spend actions
- secret-value printing
- evidence-file writes

Live production health and Vercel inspect reads are opt-in only. A default local-first run may report skipped live-read attention inside the pilot preflight and still pass the bundle when those are the only attention items.

## Validation added

Added a focused script test file:

```bash
npm test -- --run src/test/buyer-demo-preflight-script.test.ts
```

Coverage now verifies:

- Command Center displays the live-read buyer-demo preflight command beside the buyer handoff path
- Command Center surfaces a compact read-only demo rehearsal checklist with explicit stop conditions
- Command Center surfaces the Nevada County caveats operators should say out loud
- Command Center surfaces the 90-second opening script as operator guidance, not new buyer functionality
- the buyer-demo preflight command plan includes the Nevada County fixture guard and talk-track guard
- live-read buyer-demo preflight includes the public demo preflight so `/examples` is checked alongside request access
- default local-first command plan
- opt-in live-read command plan
- environment flag behavior
- fail-closed unknown argument handling
- ordered execution with first-failure stop
- successful completion when all bundled checks pass

## Caveat

This command proves demo-readiness guardrails and preflight posture. It does not replace a human walkthrough of the live buyer script, nor does the default local-first mode prove current production deployment health. Use `--live-reads` for the final pre-demo operator check.
