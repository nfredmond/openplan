# OpenPlan Admin Pilot Readiness Proof Packet

_Date: 2026-05-01_
_Status: Buyer-safe proof export for supervised pilot and managed-service review_
_Audience: rural RTPA, county, tribe, transportation commission, or consultant buyer diligence_

## Buyer-Safe Summary

OpenPlan is ready to discuss as a supervised planning workbench with an Apache-2.0 open-source core and optional Nat Ford managed hosting, onboarding, implementation, support, and planning services.

This packet does not claim that OpenPlan is a fully self-serve municipal SaaS, a validated behavioral forecasting platform, a complete legal/compliance automation system, or an autonomous AI planning product.

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
|---|---|---|---|
| Release candidate baseline | PASS | `pnpm test`, `pnpm lint`, `pnpm build`, production health, production audit, and public demo preflight all passed for the May 1 RC gate. | `docs/ops/2026-05-01-openplan-rc-proof-log.md` |
| Public demo preflight | PASS | No-auth checks cover health, request-access page availability, protected billing-readiness access, Mapbox/CSP posture, and no token printing. | `openplan/docs/ops/2026-04-27-public-demo-preflight-proof.md`; `docs/ops/2026-05-01-openplan-phase0-proof-repair.md` |
| Admin Pilot Readiness surface | PASS | The readiness parser now reads line-item `PASS:` evidence, and `/admin/pilot-readiness` was recaptured on desktop and mobile with passing local proof state. | `docs/ops/2026-05-01-openplan-phase0-proof-repair.md`; `docs/ops/2026-05-01-openplan-ui-ux-watch-recapture.md` |
| Workspace isolation | PASS | Two synthetic users could access their own workspace project URLs and were blocked from the other workspace, with session continuity after denial. | `docs/ops/2026-05-01-openplan-local-workspace-url-isolation-smoke.md` |
| RTP/report workflow | PASS | Local rendered smoke confirms RTP cycle creation, board-packet creation, artifact generation, registry packet navigation, and release-review anchor landing. | `docs/ops/2026-05-01-openplan-local-rtp-release-review-smoke.md` |
| Grants/funding workflow | PASS | Local rendered/API smoke confirms funding need, awarded opportunity, committed award, project RTP posture write-back, obligation milestone, paid reimbursement invoice, closeout, and funded/reimbursed posture. | `docs/ops/2026-05-01-openplan-local-grants-flow-smoke.md` |
| Engagement handoff | PASS | Local rendered/API smoke confirms public feedback intake, staff moderation, public publication, handoff report provenance, HTML artifact generation, and source-context traceability. | `docs/ops/2026-05-01-openplan-local-engagement-report-handoff-smoke.md` |
| Analysis/report linkage | PASS | Local rendered/API smoke confirms corridor run-template model, managed run launch, persisted source analysis output, scenario attachment, Analysis Studio deep link, report linkage, HTML artifact, and source-context traceability. | `docs/ops/2026-05-01-openplan-local-analysis-report-linkage-smoke.md` |
| Phase 1 shared spine | PASS | Local API/rendered smoke confirms one seeded NCTC project ID is reused across RTP, grants, engagement, scenario/analysis runs, county-run modeling evidence, project-targeted report/report runs, Data Hub, map corridor rows, aerial missions, and aerial evidence packages without duplicate project creation. | `docs/ops/2026-05-01-openplan-local-spine-smoke.md` |
| Admin/support onboarding flow | PASS | Local rendered/API smoke confirms public intake, allowlisted reviewer triage, provision-only-after-contacted gating, pilot workspace creation, owner invitation, review-event audit trail, and invited-owner acceptance. | `docs/ops/2026-05-01-openplan-local-admin-support-flow-smoke.md` |
| Production Admin Operations access | PASS | Production authenticated browser smoke confirms the configured reviewer can load `/admin/operations`, see the service-lane intake surface unlocked, and avoid triage/provision actions or prospect row capture during proof. | `docs/ops/2026-05-01-openplan-production-admin-operations-authenticated-smoke.md` |
| Billing posture | PASS with explicit waiver | Billing is positioned as historical live payment evidence plus current non-money-moving proof. No fresh same-cycle paid checkout canary is claimed. | `docs/ops/2026-05-01-openplan-billing-current-cycle-waiver-proof.md` |
| Managed hosting posture | Buyer-reviewable template | The service schedule defines scoped managed-hosting responsibilities, support targets, backup/restore fields to fill, and out-of-scope items before signature. | `docs/sales/2026-05-01-openplan-managed-hosting-service-schedule.md` |
| Backup/restore posture | PASS | The operator procedure names durable state, backup cadence, restore decision gates, staging-first posture, validation, and customer communication boundaries. A dedicated staging Supabase project was created, migrated, restored from private production schema/public-data dumps, validated, and retired. | `openplan/docs/ops/2026-05-01-openplan-backup-restore-procedure.md`; `docs/ops/2026-05-01-openplan-restore-drill-staging-supabase.md` |

## What Nat Ford Should Validate During Buyer Onboarding

Before a rural RTPA/county buyer relies on the pilot workspace, Nat Ford should validate the buyer-specific operating facts below.

| Onboarding validation | Why it matters |
|---|---|
| Name one workspace owner and support contact(s). | Keeps access, triage, and issue escalation accountable. |
| Select the first workflow: RTP/report, grants/funding, engagement handoff, analysis/report linkage, or managed-hosting setup. | Prevents a buyer conversation from expanding into unsupported full-suite claims. |
| Classify data sensitivity: public, internal, confidential, or mixed. | Determines what data belongs in OpenPlan, what should remain outside, and whether enhanced terms are needed. |
| Confirm the managed-hosting service schedule fields. | Support targets, backup/restore posture, billing posture, and any enhanced SLA terms must be filled before signature. |
| Re-run the relevant workspace-specific smoke after setup. | The May 1 proof is platform/release evidence; each pilot still needs its own scoped acceptance check. |
| Confirm Mapbox, Supabase, Vercel, Stripe, and model-provider posture for the chosen workflow. | Third-party dependencies are part of the hosted operating path and may affect procurement or availability expectations. |
| Decide whether procurement needs a fresh paid checkout canary. | The May 1 packet explicitly waived same-cycle money-moving proof. |
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
- complete LAPM/legal/compliance automation, grant scoring, or official legal sign-off;
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

> OpenPlan is fully self-serve municipal SaaS.

Avoid:

> OpenPlan replaces planners, engineers, attorneys, grant writers, or agency review.

Avoid:

> Billing was freshly re-proven with a paid checkout in this release cycle.

## Source Packet Links

- Release-to-sale plan: `docs/ops/2026-05-01-openplan-release-to-sale-plan.md`
- Buyer one-pager: `docs/sales/2026-05-01-openplan-buyer-one-pager.md`
- Buyer caveat sheet: `docs/sales/2026-05-01-openplan-buyer-safe-caveat-sheet.md`
- Managed-hosting service description: `docs/sales/2026-05-01-openplan-managed-hosting-service-description.md`
- Managed-hosting service schedule: `docs/sales/2026-05-01-openplan-managed-hosting-service-schedule.md`
- Pilot SOW template: `docs/sales/2026-05-01-openplan-pilot-sow-template.md`
- Backup/restore procedure: `openplan/docs/ops/2026-05-01-openplan-backup-restore-procedure.md`
- Staging restore drill: `docs/ops/2026-05-01-openplan-restore-drill-staging-supabase.md`
- RC proof log: `docs/ops/2026-05-01-openplan-rc-proof-log.md`
- Phase 1 spine smoke: `docs/ops/2026-05-01-openplan-local-spine-smoke.md`
- Admin/support smoke: `docs/ops/2026-05-01-openplan-local-admin-support-flow-smoke.md`
- Production admin operations auth smoke: `docs/ops/2026-05-01-openplan-production-admin-operations-authenticated-smoke.md`
- Billing waiver proof: `docs/ops/2026-05-01-openplan-billing-current-cycle-waiver-proof.md`

## Packet Verdict

PASS for buyer-safe packaging: this packet makes the current proof posture readable for a supervised pilot or managed-service sale while preserving the explicit limits around production guarantees, billing proof, modeling, compliance, AI, backup/restore, and buyer-specific onboarding.
