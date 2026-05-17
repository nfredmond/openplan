# OpenPlan Current Buyer / Demo Proof Packet — 2026-05-17

_Date:_ 2026-05-17  
_Status:_ Current buyer-safe demo packet for supervised OpenPlan conversations  
_Audience:_ Nathaniel / Nat Ford operators preparing a rural RTPA, county, tribe, transportation commission, or consultant demo  
_Base production URL:_ `https://openplan-natford.vercel.app`

## Buyer-Safe Summary

OpenPlan can be shown today as an Apache-2.0 open-source planning workbench with optional Nat Ford managed hosting, onboarding, implementation, support, and planning services.

The safe demo claim is narrow:

> OpenPlan supports supervised planning workflows with evidence traceability, human review, and managed-service onboarding. The current proof packet supports scoped buyer demos and pilot diligence, not broad self-serve municipal SaaS or autonomous planning claims.

This packet consolidates the latest May 17 proof on top of the May 1 / May 10 release-to-sale packet. It should travel with the existing buyer caveat sheet and managed-support proof map.

## Evidence Currency Note

This packet was rechecked against commits through `44457d6` (`test: clean OpenPlan TypeScript baseline`). Fresh shallow production-health evidence now shows the canonical production alias reporting deployed commit `44457d6`. Treat that as deployment/health currency for the code baseline only; the `44457d6` slice itself is test-fixture cleanup, not new buyer functionality or a substitute for workflow-specific smoke tests.

## What Is Proven In Today's Slice

| Proof lane | Current status | What it proves | Source |
|---|---:|---|---|
| Production health | PASS, bounded to shallow deployed health | The canonical production alias responded with the shallow health contract for deployed commit `44457d6`; Vercel deployment state was verified Ready before closing the evidence gate. Database and billing dependency checks remain intentionally outside this shallow endpoint. | `docs/ops/2026-05-17-test-output/prod-health-evidence/20260517T220335Z-prod-health-evidence.md` |
| Authenticated project report deep link | PASS | A bounded QA user signed into production, created an isolated workspace/project, generated a real project-linked report artifact, and clicked from the project report card into the report detail packet-work anchor. | `docs/ops/2026-05-17-openplan-production-project-report-deeplink-smoke.md` |
| Command Center / governance attention | PASS for the current lane | Project-level report/governance holds are treated as attention-worthy issues, governance-only report holds are prioritized, duplicate attention counts are suppressed, and report cards link to packet work. | `openplan/docs/ops/2026-05-17-openplan-launch-evidence-checklist.md`; commits `1a0aec0`, `d802dd9`, `7e9d940`, `07444c1` |
| Mobile request-access polish | PASS within CTA/intake boundary | Public `Request access` CTAs preserve the `open-source-services-review` intent note without incorrectly preselecting legacy implementation/onboarding defaults; focused CTA + pilot preflight tests passed in the May 17 launch evidence pass. | `openplan/docs/ops/2026-05-17-openplan-launch-evidence-checklist.md`; commit `87d1b58` |
| Known issue closure | PASS / controlled | The known-issues register shows zero open blockers. The recent report-detail `Received NaN` warning is closed by count coercion and regression coverage. Medium watch items remain visible rather than hidden. | `docs/ops/KNOWN_ISSUES.md`; commit `cac5f7b` |
| TypeScript/test baseline cleanup | PASS as local code-quality evidence | Commit `44457d6` tightens test fixtures so the TypeScript baseline is clean. This is useful QA evidence, but it is not by itself a production smoke or buyer functionality claim. | commit `44457d6`; `npx tsc --noEmit`; `npm run test:sales-proof-claim-boundaries` |

## Demo Narrative To Use

Use this sequence for a buyer or partner demo:

1. **Positioning:** OpenPlan is open-source civic planning software; Nat Ford sells implementation, managed hosting, onboarding, support, planning services, and custom extensions around it.
2. **Governance posture:** The workspace is built around evidence and review, not black-box automation. Project-level report/governance holds now surface as attention items.
3. **Project report path:** The project detail page can point directly to report packet work; the May 17 production smoke verified a real authenticated deep link into `#drift-since-generation`.
4. **Access posture:** Request access remains supervised. Public CTAs can capture open-source / managed-services fit review intent without implying instant public workspace activation.
5. **Caveat discipline:** Modeling, billing, recovery, legal/compliance, and self-serve activation boundaries remain explicit and buyer-specific.

## Do Not Overclaim

Do **not** claim:

- fully self-serve municipal SaaS operation;
- automatic public workspace creation from a request form;
- autonomous AI planning or replacement of planner/engineer/legal review;
- validated behavioral forecasting, calibrated demand modeling, certified grant scoring, or grant-award prediction;
- legal-grade LAPM/compliance automation;
- fresh same-cycle paid checkout proof;
- global uptime, 24/7 support, service credits, or universal RPO/RTO commitments outside a signed managed-hosting schedule.

## Caveats Still Active

The current known-issues register has **0 open blockers**, but these buyer-relevant watch items remain active:

- **Billing:** no fresh same-cycle paid checkout canary is claimed; direct OpenPlan tier checkout routes to fit review instead of Stripe checkout.
- **Modeling:** county-run and behavioral-onramp evidence must remain screening-grade / human-review language, not calibrated or validated forecasting.
- **Recovery:** a staging restore drill passed, but future restore confidence depends on repeated drills and engagement-specific RPO/RTO fields.
- **Tooling:** Node.js action runtime warnings are CI hygiene, not a buyer-facing blocker.

## Current Artifact Set

Primary current packet:

- `docs/sales/2026-05-17-openplan-current-buyer-demo-proof-packet.md`

Supporting proof artifacts:

- `docs/ops/2026-05-17-test-output/prod-health-evidence/20260517T220335Z-prod-health-evidence.md`
- `docs/ops/2026-05-17-openplan-production-project-report-deeplink-smoke.md`
- `docs/ops/2026-05-17-test-output/2026-05-17-prod-project-report-deeplink-01-project-detail.png`
- `docs/ops/2026-05-17-test-output/2026-05-17-prod-project-report-deeplink-02-report-detail.png`
- `openplan/docs/ops/2026-05-17-openplan-launch-evidence-checklist.md`
- `docs/ops/KNOWN_ISSUES.md`

Standing buyer/sales packet to keep attached:

- `docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.md`
- `docs/sales/2026-05-01-openplan-buyer-safe-caveat-sheet.md`
- `docs/sales/2026-05-10-openplan-managed-support-proof-map.md`
- `docs/sales/2026-05-01-openplan-managed-hosting-service-schedule.md`

## Operator Checklist Before External Use

- Confirm the production alias health still passes and reports the intended deployed commit if more code has shipped after `44457d6`; keep test-baseline cleanup separate from buyer workflow/functionality claims.
- Re-run a scoped authenticated smoke if the project detail/report card flow changes.
- Attach the buyer caveat sheet and managed-support proof map.
- Pick one first workflow for the buyer rather than presenting the whole roadmap as complete.
- Fill buyer-specific owner, data sensitivity, support, backup/restore, billing, and pilot success fields before SOW reliance.

## Packet Verdict

PASS for a current supervised buyer/demo conversation. The May 17 proof closes the prior authenticated deep-link gap and keeps production health, governance attention, mobile request-access posture, and known-issue closure visible without expanding the claim beyond open-source software plus Nat Ford managed services.
