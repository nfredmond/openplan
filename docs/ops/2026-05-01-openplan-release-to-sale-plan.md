# OpenPlan Release-to-Sale Plan

**Date:** 2026-05-01
**Status:** Active release-to-sale operating checklist
**Product truth:** Apache-2.0 planning software plus Nat Ford managed hosting, onboarding, implementation, support, and planning services
**Near-term sale:** supervised planning workbench, not broad self-serve municipal SaaS

## Decision Boundary

OpenPlan can be presented as a supervised, evidence-backed planning workbench for agencies and consultants when the offer is scoped around managed hosting, implementation, onboarding, support, and planning services.

Do not sell this release as:

- fully self-serve SaaS,
- validated behavioral forecasting,
- complete LAPM/legal compliance automation,
- autonomous AI planning,
- or a finished all-in-one planning suite.

## Release Gates

| Gate | Owner | Required Evidence | Status |
|---|---|---|---|
| Proof repair | Ops | public preflight, Pilot Readiness parser, Mapbox posture, UI watch recapture | PASS - `2026-05-01-openplan-phase0-proof-repair.md` |
| RC baseline | Ops | lint, test, build, audit, prod health, public demo preflight | PASS - `2026-05-01-openplan-rc-proof-log.md` |
| Workspace isolation | Platform | cross-workspace browser denial and session continuity | PASS - `2026-05-01-openplan-local-workspace-url-isolation-smoke.md` |
| RTP workflow | Product/Ops | cycle, packet, artifact, release-review landing | PASS - `2026-05-01-openplan-local-rtp-release-review-smoke.md` |
| Grants workflow | Product/Ops | opportunity, award, reimbursement, closeout, RTP write-back | PASS - `2026-05-01-openplan-local-grants-flow-smoke.md` |
| Engagement workflow | Product/Ops | public submission, moderation, report handoff, artifact provenance | PASS - `2026-05-01-openplan-local-engagement-report-handoff-smoke.md` |
| Analysis workflow | Product/Ops | managed run, scenario attachment, report linkage, generated artifact | PASS - `2026-05-01-openplan-local-analysis-report-linkage-smoke.md` |
| Admin/support workflow | Ops | request access, reviewer triage, provisioning, owner invite acceptance | PASS - `2026-05-01-openplan-local-admin-support-flow-smoke.md` |
| Billing posture | CEO/Ops | explicit waiver plus current non-money-moving proof | PASS - `2026-05-01-openplan-billing-current-cycle-waiver-proof.md` |

## Sales Package Checklist

### Buyer Narrative

- [x] Position OpenPlan as open-source planning OS plus managed services.
- [x] Keep public pricing/service lanes aligned to self-hosted core, managed hosting/support, and implementation/planning services.
- [x] Carry the billing waiver honestly: no fresh same-cycle paid canary claimed.
- [ ] Prepare a one-page external buyer PDF from this plan.

### Pilot SOW

- [x] Existing draft: `docs/sales/2026-02-24-openplan-pilot-sow-one-pager.md`.
- [ ] Refresh the SOW against May 1 product truth before sending externally.
- [ ] Remove or label older fixed-fee/monthly pricing that conflicts with current public pricing.

### Managed-Hosting Service Description

- [x] Public pricing page describes open-source core, managed hosting/support, and implementation lanes.
- [x] Request-access intake captures service lane, deployment posture, data sensitivity, first workflow, and onboarding needs.
- [ ] Convert managed-hosting duties into a customer-facing service schedule: uptime posture, backups, support target, scope boundaries, and escalation.

### Implementation Services Menu

- [x] Pricing page names onboarding, data setup, workflow configuration, training, custom reports, and planning workflow setup.
- [ ] Convert implementation menu into buyer-safe scoped service options: RTP setup, Grants OS setup, Engagement handoff, Analysis setup, Data Hub migration, and Aerial/field evidence setup.

### Demo Workspace Script

- [x] Flagship smoke evidence proves the demoable flows.
- [ ] Write a 30-minute guided demo script that follows: command center -> RTP packet -> grants/reimbursement -> engagement handoff -> analysis report -> admin/support posture.

### Caveat Sheet

- [x] Current proof docs name unsupported claims.
- [x] Billing waiver doc prevents overclaiming paid-canary proof.
- [ ] Create a short buyer-safe caveat sheet: production-backed, prototype/beta, not-yet-supported, human-review-required.

### Proof Packet Export

- [x] Admin Pilot Readiness now parses line-item PASS evidence.
- [ ] Export a fresh Admin Pilot Readiness proof packet after this release-to-sale plan is merged.

## Current Sellable Wedge

Sell the first paid/supervised offer around:

1. Planning workbench spine: projects, plans, programs, scenarios, models, reports.
2. RTP/report packet loop: packet creation, stale-basis posture, artifact generation.
3. Grants/funding operations: opportunities, awards, reimbursement posture, closeout route.
4. Engagement evidence: public/share intake, moderation, summaries, report handoff.
5. Analysis/maps: corridor analysis, managed run output, report linkage.
6. Managed-hosting operations: request access, admin triage, provisioning, billing posture, audit trails.

## Operating Commands

Run before any external release or paid-pilot packet:

```bash
cd openplan
pnpm lint
pnpm test
pnpm build
pnpm audit --prod --audit-level=moderate
pnpm ops:check-prod-health
pnpm ops:check-public-demo-preflight
```

Run when local dependencies are available:

```bash
cd openplan
pnpm ops:check-public-demo-preflight -- --mapbox-env-file .env.local
pnpm ops:check-admin-operations-smoke -- --reviewer-email <operator-reviewer-email>
pnpm seed:workspace-isolation
cd ../qa-harness
npm run local-workspace-url-isolation-smoke -- --fixture fixtures/workspace-url-isolation.local.json
npm run local-rtp-release-review-smoke
npm run local-grants-flow-smoke
npm run local-engagement-report-handoff-smoke
npm run local-analysis-report-linkage-smoke
OPENPLAN_ACCESS_REQUEST_REVIEW_EMAILS=openplan-local-admin-reviewer@natfordplanning.com npm run local-admin-support-flow-smoke
```

## Stop Conditions

Pause external sales or pilot expansion if:

- proof docs drift from current public/product copy,
- workspace isolation or RLS smoke fails,
- request-access/admin provisioning creates automatic outbound commitments,
- billing language implies a fresh same-cycle paid canary,
- a workflow claim requires unsupported modeling/legal/compliance validation,
- or the buyer asks for broad self-serve operation without managed support.

## Next Build Queue

1. Buyer one-pager.
2. Refreshed pilot SOW.
3. Managed-hosting service schedule.
4. Implementation services menu.
5. Demo workspace script.
6. Buyer-safe caveat sheet.
7. Fresh Admin Pilot Readiness proof packet export.

## Verdict

PASS: The current app is not "finished" as the full 18-month planning OS, but it is now framed and proof-backed enough for a supervised release-to-sale motion if sales language stays inside the gates above.
