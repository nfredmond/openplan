# OpenPlan Admin Pilot Readiness Proof Packet

_Date: 2026-05-01_
_Last refreshed: 2026-05-10_
_Status: Buyer-safe proof export for supervised pilot and managed-service review_
_Audience: rural RTPA, county, tribe, transportation commission, or consultant buyer diligence_

## Buyer-Safe Summary
OpenPlan is ready to discuss as a supervised planning workbench with an Apache-2.0 open-source core and optional Nat Ford managed hosting, onboarding, implementation, support, and planning services.

This packet does not claim that OpenPlan is a fully self-serve municipal SaaS, a validated behavioral forecasting platform, a complete legal/compliance automation system, a grant award prediction product, or an autonomous AI planning product.

The static sales packet and the Admin Pilot Readiness export now reuse the same final-checklist sync, release-proof artifacts, and caveat list so buyer-facing diligence does not drift from the operator surface.

What has been proven for this release-to-sale posture:

- release-candidate checks across tests, lint, build, production health, audit, and public demo preflight;
- authenticated workspace and cross-workspace isolation behavior in local synthetic smoke;
- RTP/report packet creation, artifact generation, and release-review navigation;
- grants, funding awards, reimbursement, closeout, and RTP posture write-back;
- engagement public intake, moderation, public feedback publication, and report handoff;
- analysis/model-run output linked into scenarios and generated report artifacts;
- one seeded project record reused across RTP, grants, engagement, modeling evidence, reports, map, Data Hub, and aerial evidence;
- supervised request-access, reviewer triage, pilot workspace provisioning, owner invitation, and invited-owner acceptance;
- production Admin Operations access for the configured reviewer, with the service-lane intake unlocked and no prospect row capture;
- current billing posture with an explicit no-fresh-paid-canary waiver; and
- operator backup/restore procedure, completed staging restore drill, and managed-hosting service schedule language.

## Proof Snapshot
| Area | Status | What the evidence proves | Source |
| --- | --- | --- | --- |
| Release candidate baseline | PASS | `pnpm test`, `pnpm lint`, `pnpm build`, production health, production audit, and public demo preflight all passed for the May 1 RC gate. | `docs/ops/2026-05-01-openplan-rc-proof-log.md` |
| Public demo preflight | PASS | No-auth checks cover health, request-access page availability, protected billing-readiness access, Mapbox/CSP posture, and no token printing. | `openplan/docs/ops/2026-04-27-public-demo-preflight-proof.md`; `docs/ops/2026-05-01-openplan-phase0-proof-repair.md` |
| Admin Pilot Readiness surface | PASS | The readiness parser reads line-item `PASS:` evidence, `/admin/pilot-readiness` was recaptured on desktop/mobile, and the export now shares final-checklist/release-proof sections with this static packet. | `docs/ops/2026-05-01-openplan-phase0-proof-repair.md`; `docs/ops/2026-05-01-openplan-ui-ux-watch-recapture.md`; `openplan/src/lib/operations/pilot-readiness-packet.ts` |
| Workspace isolation | PASS | Two synthetic users could access their own workspace project URLs and were blocked from the other workspace, with session continuity after denial. | `docs/ops/2026-05-01-openplan-local-workspace-url-isolation-smoke.md` |
| RTP/report workflow | PASS | Local rendered smoke confirms RTP cycle creation, board-packet creation, artifact generation, registry packet navigation, and release-review anchor landing. | `docs/ops/2026-05-01-openplan-local-rtp-release-review-smoke.md` |
| Grants/funding workflow | PASS | Local rendered/API smoke confirms funding need, awarded opportunity, committed award, project RTP posture write-back, obligation milestone, paid reimbursement invoice, closeout, and funded/reimbursed posture. | `docs/ops/2026-05-01-openplan-local-grants-flow-smoke.md` |
| Engagement handoff | PASS | Local rendered/API smoke confirms public feedback intake, staff moderation, public publication, handoff report provenance, HTML artifact generation, and source-context traceability. | `docs/ops/2026-05-01-openplan-local-engagement-report-handoff-smoke.md` |
| Analysis/report linkage | PASS | Local rendered/API smoke confirms corridor run-template model, managed run launch, persisted source analysis output, scenario attachment, Analysis Studio deep link, report linkage, HTML artifact, and source-context traceability. | `docs/ops/2026-05-01-openplan-local-analysis-report-linkage-smoke.md` |
| Phase 1 shared spine | PASS | Local API/rendered smoke confirms one seeded NCTC project ID is reused across RTP, grants, engagement, scenario/analysis runs, county-run modeling evidence, reports, map, Data Hub, and aerial evidence packages without duplicate project creation. | `docs/ops/2026-05-02-openplan-local-spine-smoke.md` |
| Admin/support onboarding flow | PASS | Local rendered/API smoke confirms public intake, allowlisted reviewer triage, provision-only-after-contacted gating, pilot workspace creation, owner invitation, review-event audit trail, and invited-owner acceptance. | `docs/ops/2026-05-01-openplan-local-admin-support-flow-smoke.md` |
| Production Admin Operations access | PASS | Production authenticated browser smoke confirms the configured reviewer can load `/admin/operations`, see the service-lane intake surface unlocked, and avoid triage/provision actions or prospect row capture during proof. | `docs/ops/2026-05-01-openplan-production-admin-operations-authenticated-smoke.md` |
| Billing posture | PASS with explicit waiver | Billing is positioned as historical live payment evidence plus current non-money-moving proof. No fresh same-cycle paid checkout canary is claimed. | `docs/ops/2026-05-01-openplan-billing-current-cycle-waiver-proof.md` |
| Managed hosting posture | Buyer-reviewable template | The service schedule defines scoped managed-hosting responsibilities, support targets, backup/restore fields to fill, and out-of-scope items before signature. | `docs/sales/2026-05-01-openplan-managed-hosting-service-schedule.md` |
| Backup/restore posture | PASS | The operator procedure names durable state, backup cadence, restore decision gates, staging-first posture, validation, and customer communication boundaries. A dedicated staging Supabase project was created, migrated, restored from private production schema/public-data dumps, validated, and retired. | `openplan/docs/ops/2026-05-01-openplan-backup-restore-procedure.md`; `docs/ops/2026-05-01-openplan-restore-drill-staging-supabase.md` |
| Final checklist / managed support synchronization | PASS | The final pilot-readiness checklist, Wave 6 release-readiness summary, managed-support proof map, county-run manifest proof, and modeling evidence export proof now travel with both the Admin export and static sales packet. | `docs/ops/2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md`; `docs/sales/2026-05-10-openplan-managed-support-proof-map.md`; `docs/ops/2026-05-10-openplan-county-run-manifest-proof-ui.md`; `openplan/docs/ops/2026-05-10-openplan-modeling-evidence-export-proof.md`; `docs/ops/2026-05-10-openplan-wave6-release-readiness-summary.md`; `openplan/src/test/pilot-readiness-export-packet.test.ts` |

## Compact Proof Artifact Index
Use this index as the short operator map before buyer reliance. It names the current proof packet docs, generated static sales packet files, and preflight proof note without expanding the claim beyond supervised-pilot caveats.

| Artifact | Category | Buyer-safe caveat |
| --- | --- | --- |
| **Final pilot-readiness checklist** — `docs/ops/2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md` | Proof packet doc | PASS supports a supervised pilot-readiness conversation only; it is not a finished-suite launch certificate. |
| **Managed support proof map** — `docs/sales/2026-05-10-openplan-managed-support-proof-map.md` | Proof packet doc | Managed hosting, support, backup/restore, and pilot-closeout claims still require buyer-specific scope and terms. |
| **Pilot-readiness export source trace** — `openplan/docs/ops/2026-05-09-pilot-readiness-export-source-trace-proof.md` | Proof packet doc | Export traceability proves packet construction, not a fresh production smoke after later behavior changes. |
| **Static sales packet — Markdown** — `docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.md` | Static sales packet | Buyer-facing packet copy must travel with the caveat sheet and human review before external reliance. |
| **Static sales packet — HTML** — `docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.html` | Static sales packet | HTML is a generated presentation artifact; regenerate it when the Markdown/source helpers change. |
| **Static sales packet — PDF** — `docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.pdf` | Static sales packet | PDF is a generated snapshot; do not treat it as current if the proof helpers or checklist changed afterward. |
| **Wave 6 release-readiness summary** — `docs/ops/2026-05-10-openplan-wave6-release-readiness-summary.md` | Proof packet doc | Summary supports operator orientation for the May 10 merge train only; it is not a broad launch-readiness certificate. |
| **Pilot preflight operator proof** — `docs/ops/2026-05-10-openplan-pilot-preflight-operator-proof.md` | Preflight proof | The preflight is read-only operational confidence, not self-serve activation, schema approval, or production-write proof. |

## Final Pilot-Readiness Checklist Sync
- Checklist: docs/ops/2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md
- Verdict: PASS for a supervised pilot-readiness conversation; not a launch certificate for a finished planning suite.
- Operator instruction: Use this sync block before buyer reliance: confirm the final checklist, exported Admin Pilot Readiness packet filenames, and latest proof-lane artifacts still match the current caveats.
- Supervised-onboarding caveat: Onboarding is a supervised implementation step: no instant public workspace activation, no broad self-serve municipal SaaS claim, and no outbound reliance without human review.

### Exported proof packet filenames
- docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.md
- docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.html
- docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.pdf

### Latest proof lanes synchronized from the final checklist
- **Managed support diligence**: docs/sales/2026-05-10-openplan-managed-support-proof-map.md
  - Role: Connects managed hosting, onboarding, support, backup/restore, billing, and pilot closeout claims to proof.
  - Caveat: Buyer-specific reliance checks and per-engagement operations terms still need operator completion before contracting.
- **County-run manifest proof**: docs/ops/2026-05-10-openplan-county-run-manifest-proof-ui.md
  - Role: Keeps county-run evidence, source context, and caveats visible for pilot diligence.
  - Caveat: County-run output is evidence packaging, not validated forecasting or autonomous decision support.
- **Modeling evidence exports**: openplan/docs/ops/2026-05-10-openplan-modeling-evidence-export-proof.md
  - Role: Carries modeling caveats and source context into report and RTP export paths.
  - Caveat: Behavioral-onramp KPIs remain behind the proven SQL/RPC caveat gate; no validated behavioral forecasting claim is made.
- **Wave 6 release-readiness summary**: docs/ops/2026-05-10-openplan-wave6-release-readiness-summary.md
  - Role: Summarizes the May 10 proof/readiness merge train, validation posture, caveats, and merge risk for operator review.
  - Caveat: Use as a discoverability summary only; it is not a launch certificate or a substitute for fresh preflight before buyer reliance.
- **Release proof synchronization**: openplan/src/test/pilot-readiness-export-packet.test.ts
  - Role: Guards the Admin Pilot Readiness export against drift from Command Center release-proof copy and the final smoke checklist.
  - Caveat: Internal packet synchronization does not replace fresh smoke reruns after behavior changes.

## Release Proof Packet Alignment
OpenPlan is inspectable as an Apache-2.0 planning workbench plus Nat Ford managed hosting, onboarding, implementation, support, and planning services.
Sell the current wedge as supervised planning workbench support for rural RTPA/county workflows, not broad self-serve municipal SaaS.

### Required caveats
- No fresh same-cycle paid canary is claimed; current billing proof is waiver/non-money-moving posture.
- Onboarding remains a supervised implementation step, not instant self-serve activation; buyer use requires operator review before reliance.
- RPO/RTO commitments are filled per managed-hosting engagement, not promised globally here.
- Modeling outputs support planning review only inside the current proof boundary; no validated behavioral forecasting claim is made.
- OpenPlan is not sold as legal-grade LAPM/compliance automation or autonomous AI planning, and no grant award prediction claim is made.

### Proof artifacts synchronized with Command Center
- **Gates**: Release gates are collected and traceable. Source: docs/ops/2026-05-01-openplan-release-to-sale-plan.md
  - Supports: Sale readiness: names the current gate evidence operators may cite for the supervised offer.
  - Operator check: Use it to confirm a buyer or pilot claim maps to a PASS gate before it appears in demo copy, SOW language, or a readiness packet.
  - Caveats carried: Supervised onboarding (docs/ops/2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md); Modeling proof boundary (docs/ops/2026-05-08-openplan-modeling-caveat-kpi-sql-gate-proof.md); No legal/autonomous AI claim (docs/ops/2026-05-01-openplan-known-issues-register.md)
- **Packet**: Admin Pilot Readiness is the operator-facing packet check. Source: docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.md
  - Supports: Pilot readiness: turns smoke status and source documents into a reviewable operator packet.
  - Operator check: Use it immediately before a pilot demo to verify PASS lanes have named source docs and every pending/failing lane has a follow-up owner.
  - Caveats carried: Billing proof waiver (docs/ops/2026-05-01-openplan-billing-current-cycle-waiver-proof.md); Supervised onboarding (docs/ops/2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md); Per-engagement hosting terms (docs/ops/2026-05-01-openplan-known-issues-register.md)
- **Caveats**: Sales language must stay inside named caveats. Source: docs/ops/2026-05-01-openplan-known-issues-register.md
  - Supports: Sale readiness: keeps public, pricing, and buyer-facing language inside the current proof boundary.
  - Operator check: Use it as the stop-list before sharing examples, pricing language, implementation scopes, or managed-hosting commitments.
  - Caveats carried: Billing proof waiver (docs/ops/2026-05-01-openplan-billing-current-cycle-waiver-proof.md); Supervised onboarding (docs/ops/2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md); Per-engagement hosting terms (docs/ops/2026-05-01-openplan-known-issues-register.md); Modeling proof boundary (docs/ops/2026-05-08-openplan-modeling-caveat-kpi-sql-gate-proof.md); No legal/autonomous AI claim (docs/ops/2026-05-01-openplan-known-issues-register.md)
- **Next action**: Inspect readiness, then review intake positioning. Source: docs/sales/2026-05-01-openplan-buyer-safe-caveat-sheet.md
  - Supports: Sale and pilot readiness: gives the operator sequence after proof review, before external use.
  - Operator check: Use it as the final supervised-readiness walk-through: readiness packet, request-access language, examples, then buyer-safe caveat sheet.
  - Caveats carried: Billing proof waiver (docs/ops/2026-05-01-openplan-billing-current-cycle-waiver-proof.md); Supervised onboarding (docs/ops/2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md); Modeling proof boundary (docs/ops/2026-05-08-openplan-modeling-caveat-kpi-sql-gate-proof.md); No legal/autonomous AI claim (docs/ops/2026-05-01-openplan-known-issues-register.md)

## What Nat Ford Should Validate During Buyer Onboarding

Before a rural RTPA/county buyer relies on the pilot workspace, Nat Ford should validate the buyer-specific operating facts below.

| Onboarding validation | Why it matters |
| --- | --- |
| Name one workspace owner and support contact(s). | Keeps access, triage, and issue escalation accountable. |
| Select the first workflow: RTP/report, grants/funding, engagement handoff, analysis/report linkage, county-run evidence packaging, or managed-hosting setup. | Prevents a buyer conversation from expanding into unsupported full-suite claims. |
| Classify data sensitivity: public, internal, confidential, or mixed. | Determines what data belongs in OpenPlan, what should remain outside, and whether enhanced terms are needed. |
| Confirm the managed-hosting service schedule fields. | Support targets, backup/restore posture, billing posture, and any enhanced SLA terms must be filled before signature. |
| Re-run the relevant workspace-specific smoke after setup. | The May 1/May 10 proof is platform/release evidence; each pilot still needs its own scoped acceptance check. |
| Confirm Mapbox, Supabase, Vercel, Stripe, and model-provider posture for the chosen workflow. | Third-party dependencies are part of the hosted operating path and may affect procurement or availability expectations. |
| Decide whether procurement needs a fresh paid checkout canary. | The current packet explicitly waives same-cycle money-moving proof. |
| Review AI/modeling output caveats before external reliance. | AI-assisted and modeling outputs are planning-support materials, not autonomous or certified decisions. |
| Confirm client official-record retention outside OpenPlan. | OpenPlan exports and records do not replace public-records, legal-hold, or official archive duties. |

## Implementation-Specific Items Still To Scope

These items remain real work or engagement-specific decisions, not release-wide guarantees:

- buyer-specific data loading, cleanup, geocoding, GIS integration, and source-document review;
- SSO, private cloud, agency-cloud deployment, custom security review, or enhanced support/SLA terms;
- formal RPO/RTO commitments beyond the signed managed-hosting schedule;
- future quarterly restore drills for later production milestones;
- fresh same-cycle paid checkout proof if the buyer or procurement reviewer requires it;
- calibrated or certified behavioral-demand modeling and broader ActivitySim/MATSim readiness;
- no release-wide complete LAPM/legal/compliance automation, grant award prediction, certified grant scoring, or official legal sign-off;
- custom reports, integrations, migrations, or planning services beyond the scoped SOW; and
- aerial/field evidence workflows beyond the selected implementation scope.

## Buyer-Safe Language

Use:

> OpenPlan supports supervised planning workflows with evidence traceability and human review.

Use:

> OpenPlan is ready for scoped pilots and managed-service engagements where the first workflow, data posture, support path, and proof boundary are agreed up front.

Use:

> Managed hosting and implementation are service wrappers around the Apache-2.0 open-source core.

Avoid:

> Avoid claiming OpenPlan is fully self-serve municipal SaaS.

Avoid:

> Avoid claiming OpenPlan replaces planners, engineers, attorneys, grant writers, or agency review.

Avoid:

> Avoid claiming OpenPlan predicts grant awards or provides certified grant scoring.

Avoid:

> Avoid claiming billing was freshly re-proven with a paid checkout in this release cycle.

## Source Packet Links

- docs/ops/2026-05-01-openplan-rc-proof-log.md
- openplan/docs/ops/2026-04-27-public-demo-preflight-proof.md
- docs/ops/2026-05-01-openplan-phase0-proof-repair.md
- docs/ops/2026-05-01-openplan-ui-ux-watch-recapture.md
- openplan/src/lib/operations/pilot-readiness-packet.ts
- docs/ops/2026-05-01-openplan-local-workspace-url-isolation-smoke.md
- docs/ops/2026-05-01-openplan-local-rtp-release-review-smoke.md
- docs/ops/2026-05-01-openplan-local-grants-flow-smoke.md
- docs/ops/2026-05-01-openplan-local-engagement-report-handoff-smoke.md
- docs/ops/2026-05-01-openplan-local-analysis-report-linkage-smoke.md
- docs/ops/2026-05-02-openplan-local-spine-smoke.md
- docs/ops/2026-05-01-openplan-local-admin-support-flow-smoke.md
- docs/ops/2026-05-01-openplan-production-admin-operations-authenticated-smoke.md
- docs/ops/2026-05-01-openplan-billing-current-cycle-waiver-proof.md
- docs/sales/2026-05-01-openplan-managed-hosting-service-schedule.md
- openplan/docs/ops/2026-05-01-openplan-backup-restore-procedure.md
- docs/ops/2026-05-01-openplan-restore-drill-staging-supabase.md
- docs/ops/2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md
- docs/sales/2026-05-10-openplan-managed-support-proof-map.md
- docs/ops/2026-05-10-openplan-county-run-manifest-proof-ui.md
- openplan/docs/ops/2026-05-10-openplan-modeling-evidence-export-proof.md
- docs/ops/2026-05-10-openplan-wave6-release-readiness-summary.md
- openplan/src/test/pilot-readiness-export-packet.test.ts
- docs/ops/2026-05-01-openplan-release-to-sale-plan.md
- docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.md
- docs/ops/2026-05-01-openplan-known-issues-register.md
- docs/sales/2026-05-01-openplan-buyer-safe-caveat-sheet.md
- docs/ops/2026-05-08-openplan-modeling-caveat-kpi-sql-gate-proof.md
- openplan/docs/ops/2026-05-09-pilot-readiness-export-source-trace-proof.md
- docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.html
- docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.pdf
- docs/ops/2026-05-10-openplan-pilot-preflight-operator-proof.md
- docs/sales/2026-05-01-openplan-buyer-one-pager.md
- docs/sales/2026-05-01-openplan-managed-hosting-service-description.md
- docs/sales/2026-05-01-openplan-pilot-sow-template.md

## Packet Verdict

PASS for buyer-safe packaging: this packet makes the current proof posture readable for a supervised pilot or managed-service sale while preserving the explicit limits around production guarantees, billing proof, modeling, compliance, AI, backup/restore, and buyer-specific onboarding.
