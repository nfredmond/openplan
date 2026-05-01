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
- [x] Draft buyer one-pager: `../sales/2026-05-01-openplan-buyer-one-pager.md`.
- [x] Convert the buyer one-pager into a designed external visual package: `../sales/2026-05-01-openplan-buyer-one-pager.html` and `../sales/2026-05-01-openplan-buyer-one-pager.pdf`.

### Pilot SOW

- [x] Existing draft: `docs/sales/2026-02-24-openplan-pilot-sow-one-pager.md`.
- [x] Refreshed May 1 template: `../sales/2026-05-01-openplan-pilot-sow-template.md`.
- [x] Labeled older February sales docs as historical before reuse.

### Managed-Hosting Service Description

- [x] Public pricing page describes open-source core, managed hosting/support, and implementation lanes.
- [x] Request-access intake captures service lane, deployment posture, data sensitivity, first workflow, and onboarding needs.
- [x] Draft managed-hosting service description: `../sales/2026-05-01-openplan-managed-hosting-service-description.md`.
- [x] Contract-ready service schedule template: `../sales/2026-05-01-openplan-managed-hosting-service-schedule.md`.

### Implementation Services Menu

- [x] Pricing page names onboarding, data setup, workflow configuration, training, custom reports, and planning workflow setup.
- [x] Draft implementation menu: `../sales/2026-05-01-openplan-implementation-services-menu.md`.

### Demo Workspace Script

- [x] Flagship smoke evidence proves the demoable flows.
- [x] Draft 30-minute guided demo script: `../sales/2026-05-01-openplan-demo-workspace-script.md`.

### Buyer-Specific Demo / Outreach Package

- [x] Prepared first buyer-specific Nevada County / NCTC demo workspace and outreach package: `../sales/2026-05-01-openplan-nevada-county-demo-outreach-package.md`.
- [x] Package keeps the demo buyer-safe: Nevada County / NCTC geography and public-data-style proofing only; no endorsement, active partnership, procurement signal, or non-public NCTC data claim.

### Caveat Sheet

- [x] Current proof docs name unsupported claims.
- [x] Billing waiver doc prevents overclaiming paid-canary proof.
- [x] Draft buyer-safe caveat sheet: `../sales/2026-05-01-openplan-buyer-safe-caveat-sheet.md`.

### Proof Packet Export

- [x] Admin Pilot Readiness now parses line-item PASS evidence.
- [x] Export a fresh Admin Pilot Readiness proof packet: `../sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.md`, `../sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.html`, and `../sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.pdf`.

### Operator Procedures

- [x] Incident triage runbook: `openplan/docs/ops/RUNBOOK.md`.
- [x] Backup, restore, and recovery-drill procedure: `openplan/docs/ops/2026-05-01-openplan-backup-restore-procedure.md`. Quarterly drill cadence; per-engagement RPO/RTO commitments are filled on the managed-hosting service schedule, not promised here.
- [ ] Run the first quarterly restore drill into a staging Supabase project and log under `docs/ops/YYYY-MM-DD-openplan-restore-drill-<slug>.md` before the next external paid milestone. Preflight plan: `2026-05-01-openplan-restore-drill-preflight-plan.md`; this does not complete the actual staging drill.

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

1. [x] Buyer one-pager external visual package created: `../sales/2026-05-01-openplan-buyer-one-pager.html` and `../sales/2026-05-01-openplan-buyer-one-pager.pdf`.
2. [x] Admin Pilot Readiness proof packet exported: `../sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.html` and `../sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.pdf`.
3. [x] First buyer-specific Nevada County / NCTC demo workspace and outreach package prepared: `../sales/2026-05-01-openplan-nevada-county-demo-outreach-package.md`.

## Verdict

PASS: The current app is not "finished" as the full 18-month planning OS, but it is now framed and proof-backed enough for a supervised release-to-sale motion if sales language stays inside the gates above.
