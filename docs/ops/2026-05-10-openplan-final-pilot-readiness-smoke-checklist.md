# OpenPlan Final Pilot-Readiness Smoke Checklist

**Date:** 2026-05-10
**Status:** Current internal pilot-diligence index
**Scope:** supervised pilot readiness, release-to-sale evidence, and proof-lane caveats
**Product truth:** Apache-2.0 OpenPlan core plus Nat Ford managed hosting, onboarding, implementation, support, and planning services.

## Readiness Verdict

**PASS for a supervised pilot-readiness conversation.** The current proof package is strong enough to walk a prospective rural county, RTPA, tribe, agency, or planning consultant through a managed OpenPlan pilot if the operator keeps the caveats below visible.

This checklist is **not** a launch certificate for a finished planning suite. It indexes the latest proof lanes and the final smoke checks an operator should run before using the current evidence in a buyer conversation, demo, or pilot kickoff packet.

## Explicit Stop-List

Do not use this checklist to claim any of the following:

- fully self-serve municipal SaaS availability,
- validated behavioral forecasting,
- legal-grade LAPM/compliance automation,
- autonomous AI planning,
- a finished all-in-one planning suite,
- fresh same-cycle paid checkout proof,
- global RPO/RTO/SLA commitments,
- or survey-grade, engineering-grade, photogrammetry, orthomosaic, point-cloud, or centimeter-level aerial output.

Those topics remain either out of scope, supervised-service scope, per-engagement contract scope, or future proof lanes.

## Final Smoke Checklist

| Smoke item | Operator check | Current proof links | Caveat to carry forward |
|---|---|---|---|
| Product and sales posture | Confirm every buyer-facing sentence says open-source core plus managed services, not broad self-serve SaaS. | [Release-to-sale plan](2026-05-01-openplan-release-to-sale-plan.md); [buyer-safe caveat sheet](../sales/2026-05-01-openplan-buyer-safe-caveat-sheet.md); [managed support proof map](../sales/2026-05-10-openplan-managed-support-proof-map.md) | Supervised planning workbench only; no finished-suite or self-serve activation claim. |
| Known-issue alignment | Confirm any caveat mentioned in a demo, SOW, or proof packet appears in the active register first. | [Known issues register](2026-05-01-openplan-known-issues-register.md); [modeling KPI SQL gate proof](2026-05-08-openplan-modeling-caveat-kpi-sql-gate-proof.md) | Open caveats are release-language constraints, not defects to hide. |
| Baseline release gate | Confirm the RC proof gate remains the cited baseline before external reuse and record fresh post-main-push health evidence after any production deploy using `npm run ops:log-prod-health-evidence -- --vercel-inspect-json /tmp/openplan-vercel-inspect.json --require-vercel-ready` and artifact path `docs/ops/YYYY-MM-DD-test-output/prod-health-evidence/YYYYMMDDTHHMMSSZ-prod-health-evidence.md`. | [RC proof log](2026-05-01-openplan-rc-proof-log.md); [Phase 0 proof repair](2026-05-01-openplan-phase0-proof-repair.md); [public demo preflight](../../openplan/docs/ops/2026-04-27-public-demo-preflight-proof.md); [prod health evidence-log helper](2026-05-10-prod-health-evidence-log-helper.md); [admin ops to prod-health bridge](2026-05-10-openplan-admin-ops-to-prod-health-evidence-bridge.md) | Re-run standard gates before external use if app behavior changes after this checklist. |
| Workspace and admin support | Confirm request access, reviewer triage, provisioning, invite acceptance, and admin readiness remain manual/supervised. | [Admin operations smoke runbook](2026-05-10-openplan-admin-operations-smoke-runbook.md); [admin ops to prod-health bridge](2026-05-10-openplan-admin-ops-to-prod-health-evidence-bridge.md); [Admin support flow smoke](2026-05-01-openplan-local-admin-support-flow-smoke.md); [production admin operations smoke](2026-05-01-openplan-production-admin-operations-authenticated-smoke.md); [admin pilot readiness proof packet](../sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.md) | Onboarding is a supervised implementation step; no instant public workspace activation. |
| Workspace isolation | Confirm cross-workspace denial and session continuity are still part of the diligence packet. | [Workspace URL isolation smoke](2026-05-01-openplan-local-workspace-url-isolation-smoke.md); [multi-tenant isolation audit proof](../../openplan/docs/ops/2026-04-24-multi-tenant-isolation-audit-proof.md) | The browser smoke is read-side proof; write-side RLS remains a separate proof lane. |
| Shared planning spine | Confirm one project is still the reusable record across RTP, grants, engagement, analysis, maps, reports, and aerial evidence. | [Phase 1 spine smoke](2026-05-02-openplan-local-spine-smoke.md); [full OS roadmap](2026-05-01-openplan-full-os-roadmap.md) | This proves the seeded local spine loop, not every future module or migration path. |
| RTP and adoption posture | Confirm the demo packet names board-packet, chapter/adoption readiness, artifact generation, and stale-basis posture. | [RTP release-review smoke](2026-05-01-openplan-local-rtp-release-review-smoke.md); [RTP adoption record proof test](../../openplan/src/test/rtp-adoption-record-proof.test.ts); [RTP export test](../../openplan/src/test/rtp-export.test.ts) | Board-ready means demoable packet posture; it is not agency adoption or legal approval. |
| Grants and funding posture | Confirm funding need, award, reimbursement, closeout, and evidence-readiness cues stay traceable to project records. | [Grants flow smoke](2026-05-01-openplan-local-grants-flow-smoke.md); [grants evidence readiness test](../../openplan/src/test/grants-evidence-readiness.test.ts) | Grants readiness is planning evidence support, not award prediction or compliance automation. |
| Engagement handoff | Confirm public/share intake, moderation, categorization, comment matrix posture, and report handoff stay buyer-safe. | [Engagement report handoff smoke](2026-05-01-openplan-local-engagement-report-handoff-smoke.md); [engagement readiness test](../../openplan/src/test/engagement-readiness.test.ts); [engagement summary test](../../openplan/src/test/engagement-summary.test.ts) | Public input stays moderated and evidence-backed; no autonomous response or representation claim. |
| Data Hub lineage | Confirm datasets carry source, license, vintage, geography, QA posture, and dependent-output context where represented. | [Data Hub lineage readiness test](../../openplan/src/test/dataset-lineage-readiness.test.ts); [known issues register R2](2026-05-01-openplan-known-issues-register.md#carried-forward-from-2026-02-25) | Lineage proof covers current surfaces; do not claim every future export is automatically covered. |
| Scenario and modeling posture | Confirm scenario comparisons and county-run outputs expose source context, caveats, and unsupported-use warnings. | [Analysis report linkage smoke](2026-05-01-openplan-local-analysis-report-linkage-smoke.md); [modeling caveat gate proof](2026-05-01-openplan-modeling-caveat-gate-proof.md); [modeling KPI SQL gate proof](2026-05-08-openplan-modeling-caveat-kpi-sql-gate-proof.md); [modeling evidence export proof](../../openplan/docs/ops/2026-05-10-openplan-modeling-evidence-export-proof.md); [county-run manifest proof UI](2026-05-10-openplan-county-run-manifest-proof-ui.md) | Planning-analysis support only; no validated behavioral forecasting or legal-grade decision automation. |
| Aerial and field evidence | Confirm aerial records are framed as project/report evidence with provenance and attachment readiness. | [Aerial evidence smoke](2026-05-02-openplan-local-aerial-evidence-smoke.md); [aerial catalog test](../../openplan/src/test/aerial-catalog.test.ts); [aerial source context test](../../openplan/src/test/report-aerial-source-context.test.ts) | No survey-grade, engineering-grade, photogrammetry, orthomosaic, point-cloud, or centimeter-level claim. |
| Report artifact traceability | Confirm reports show source context, modeling/aerial provenance, regeneration posture, and scanable history where relevant. | [report modeling evidence summary test](../../openplan/src/test/report-modeling-evidence-summary.test.ts); [report provenance aerial test](../../openplan/src/test/report-provenance-audit-aerial.test.tsx); [report detail page test](../../openplan/src/test/report-detail-page.test.tsx) | Report evidence is citeable only for the surfaces covered by the linked tests and proof docs. |
| Command center and release proof | Confirm Command Center, Pilot Readiness, and release-proof copy carry the same proof artifacts and required caveats. | [release proof copy guards](../../openplan/src/test/release-proof-copy-guards.test.ts); [release proof packet panel test](../../openplan/src/test/release-proof-packet-panel.test.tsx); [Pilot Readiness export test](../../openplan/src/test/pilot-readiness-export-packet.test.ts); [Pilot Readiness page test](../../openplan/src/test/pilot-readiness-page.test.tsx) | Exported packets are internal diligence aids; re-run stale or unknown lanes before buyer reliance. |
| Buyer demo script | Confirm the demo walkthrough links each step to proof and caveat language before it is reused. | [Demo workspace script](../sales/2026-05-01-openplan-demo-workspace-script.md); [demo proof-link guard](../../openplan/src/test/demo-workspace-script-proof-links.test.ts); [Nevada County demo outreach package](../sales/2026-05-01-openplan-nevada-county-demo-outreach-package.md) | NCTC/Nevada County language is demo geography only; no endorsement, partnership, procurement, or non-public data claim. |
| Managed support and operations | Confirm support, backup/restore, billing, and pilot closeout claims map to proof and buyer reliance checks. | [Managed support proof map](../sales/2026-05-10-openplan-managed-support-proof-map.md); [backup and restore procedure](../../openplan/docs/ops/2026-05-01-openplan-backup-restore-procedure.md); [staging restore drill](2026-05-01-openplan-restore-drill-staging-supabase.md); [billing waiver proof](2026-05-01-openplan-billing-current-cycle-waiver-proof.md) | RPO/RTO/SLA terms are per-engagement schedule fields; no fresh same-cycle paid checkout canary is claimed. |

## Latest Proof-Lane Index

These are the newest proof lanes that should be considered before a final pilot-readiness conversation:

| Lane | What it adds | Proof link | Caveat |
|---|---|---|---|
| Managed support diligence | Ties hosted operations, onboarding, support, backup/restore, billing, and closeout claims to evidence. | [Managed support proof map](../sales/2026-05-10-openplan-managed-support-proof-map.md) | Buyer-specific reliance checks still need to be filled before contracting. |
| County-run manifest proof | Makes county-run evidence and caveats more visible in the UI and test surface. | [County-run manifest proof UI](2026-05-10-openplan-county-run-manifest-proof-ui.md); [county onramp test](../../openplan/src/test/county-onramp.test.ts); [county run detail client test](../../openplan/src/test/county-run-detail-client.test.tsx) | County-run output is evidence packaging, not validated forecasting. |
| Modeling evidence exports | Carries modeling caveats and source context into report and RTP export paths. | [Modeling evidence export proof](../../openplan/docs/ops/2026-05-10-openplan-modeling-evidence-export-proof.md); [report modeling evidence test](../../openplan/src/test/report-modeling-evidence-summary.test.ts); [RTP export test](../../openplan/src/test/rtp-export.test.ts) | Behavioral-onramp KPIs remain behind the proven SQL/RPC caveat gate. |
| Data Hub lineage readiness | Surfaces dataset lineage readiness for planner review and dependent-output confidence. | [Dataset lineage readiness test](../../openplan/src/test/dataset-lineage-readiness.test.ts) | Source-context coverage must not be generalized beyond proved surfaces. |
| RTP adoption record proof | Adds adoption-record scanability to the RTP readiness lane. | [RTP adoption record proof test](../../openplan/src/test/rtp-adoption-record-proof.test.ts) | Does not imply actual board adoption or legal sufficiency. |
| Grants evidence readiness | Adds missing-evidence and next-action cues for grant/funding operations. | [Grants evidence readiness test](../../openplan/src/test/grants-evidence-readiness.test.ts) | Does not predict grant award outcomes. |
| Engagement public review guard | Tightens public-review language and moderation/categorization handoff cues. | [Engagement readiness test](../../openplan/src/test/engagement-readiness.test.ts); [engagement campaign detail page test](../../openplan/src/test/engagement-campaign-detail-page.test.tsx) | Public engagement remains moderated and staff-reviewed; not autonomous public representation. |
| Scenario source context | Preserves comparison source context and legacy-snapshot caveats. | [Scenario comparison board test](../../openplan/src/test/scenario-comparison-board.test.ts); [scenario source context test](../../openplan/src/test/scenario-comparison-snapshots-route.test.ts); [scenario provenance pending test](../../openplan/src/test/scenario-provenance-schema-pending.test.ts) | Scenario outputs support planning discussion, not autonomous final decisions. |
| Aerial provenance | Clarifies aerial report provenance, source context, and empty/attachment states. | [Aerial catalog test](../../openplan/src/test/aerial-catalog.test.ts); [report aerial source context test](../../openplan/src/test/report-aerial-source-context.test.ts); [report provenance aerial test](../../openplan/src/test/report-provenance-audit-aerial.test.tsx) | No survey-grade or photogrammetry-grade promise. |
| Release proof synchronization | Keeps Command Center, Pilot Readiness export, and release-proof copy in the same caveat posture. | [Release proof copy guards](../../openplan/src/test/release-proof-copy-guards.test.ts); [release proof packet panel test](../../openplan/src/test/release-proof-packet-panel.test.tsx); [workspace command board test](../../openplan/src/test/workspace-command-board.test.tsx); [workflow next-action groups test](../../openplan/src/test/workflow-next-action-groups.test.ts) | Internal packet synchronization does not replace fresh smoke reruns after behavior changes. |
| Production health evidence logger | Ensures post-main-push closure records both Vercel Ready state and the public health check before claiming production proof. Canonical command: `npm run ops:log-prod-health-evidence -- --vercel-inspect-json /tmp/openplan-vercel-inspect.json --require-vercel-ready`; generated artifact path: `docs/ops/YYYY-MM-DD-test-output/prod-health-evidence/YYYYMMDDTHHMMSSZ-prod-health-evidence.md`. | [Prod health evidence-log helper](2026-05-10-prod-health-evidence-log-helper.md); [admin ops to prod-health bridge](2026-05-10-openplan-admin-ops-to-prod-health-evidence-bridge.md); [prod health evidence log script test](../../openplan/src/test/prod-health-evidence-log-script.test.ts); [prod health doc-index guard](../../openplan/src/test/prod-health-evidence-doc-index.test.ts) | This is a shallow uptime/deployment evidence gate only; it does not prove Supabase, billing, Mapbox, or SLA readiness. |
| Buyer demo evidence links | Ensures each demo step has a proof artifact and caveat boundary. | [Demo workspace script](../sales/2026-05-01-openplan-demo-workspace-script.md); [demo proof-link guard](../../openplan/src/test/demo-workspace-script-proof-links.test.ts) | Demo geography is illustrative; no buyer endorsement or procurement signal. |

## Minimum Re-Run Before External Use

For a docs-only proof-packet refresh, re-run at least the markdown proof guards:

```bash
cd openplan
npm test -- --run \
  src/test/final-pilot-readiness-smoke-checklist.test.ts \
  src/test/prod-health-evidence-doc-index.test.ts \
  src/test/managed-support-proof-map.test.ts \
  src/test/demo-workspace-script-proof-links.test.ts \
  src/test/release-proof-copy-guards.test.ts
npm run lint
```

For any app-behavior change after this checklist, use the release-to-sale standard gate from [the roadmap](2026-05-01-openplan-full-os-roadmap.md#standard-release-proof) and the applicable local smoke harness before relying on this packet externally.

## Blockers and Human Decisions

- **No fresh paid canary:** billing remains historical-payment plus current non-money-moving proof unless Nathaniel approves a supervised workspace-specific live activation.
- **Per-engagement operations terms:** RPO/RTO/SLA language must be filled in the managed-hosting service schedule for each buyer.
- **No outbound reliance without review:** buyer-specific emails, public posts, or signed SOW language still require human approval.
