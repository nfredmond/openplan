# OpenPlan Managed Support Proof Map

_Date: 2026-05-10_
_Status: Buyer-facing diligence aid; review before external send._

## Purpose

This proof map ties OpenPlan managed-hosting, support, onboarding, backup/restore, billing, and pilot-closeout claims to the current proof artifacts and caveat boundaries.

Use it when a buyer asks, "what can Nat Ford actually operate for us today?" It is intentionally narrower than a full service schedule or SOW. The safe answer is: Apache-2.0 OpenPlan core plus Nat Ford managed hosting, onboarding, implementation, support, and planning services for a scoped supervised workflow.

## Product Truth

OpenPlan is open-source planning software with optional Nat Ford managed services. The current saleable motion is a supervised planning workbench, not a broad self-serve municipal SaaS platform.

Managed-support claims must stay inside three boundaries:

1. **Proof-backed:** cite the specific smoke, runbook, schedule, or proof packet that supports the claim.
2. **Scoped:** name the first workflow, data sensitivity posture, buyer owner, support contact, and service tier before reliance.
3. **Caveated:** keep support, recovery, billing, modeling, AI, legal/compliance, and self-serve activation limits visible.

## Claim-To-Proof Map

| Buyer-facing claim | Proof artifacts to cite | Caveat boundary | Before buyer reliance |
|---|---|---|---|
| Nat Ford can operate a hosted OpenPlan workspace with a clear support path. | [Managed-hosting service description](2026-05-01-openplan-managed-hosting-service-description.md); [managed-hosting service schedule](2026-05-01-openplan-managed-hosting-service-schedule.md); [operator incident runbook](../../openplan/docs/ops/RUNBOOK.md) | Baseline support is email-based and scoped by the signed schedule; no global uptime percentage, service credits, or 24/7 incident response is included unless an enhanced SLA is attached. | Fill the support tier, named support contacts, escalation path, maintenance-window posture, and any enhanced SLA addendum before signature. |
| Request-access, reviewer triage, provisioning, and owner invitation have proof, but onboarding remains supervised. | [Local admin/support flow smoke](../ops/2026-05-01-openplan-local-admin-support-flow-smoke.md); [production admin operations authenticated smoke](../ops/2026-05-01-openplan-production-admin-operations-authenticated-smoke.md); [admin pilot readiness proof packet](2026-05-01-openplan-admin-pilot-readiness-proof-packet.md) | The proof shows controlled reviewer triage and manual invitation posture; it is not automatic public self-serve workspace activation. | Confirm the buyer owner, access roles, data sensitivity posture, first workflow, and whether manual or automated invites are authorized. |
| Backup and restore posture can be discussed as an operator procedure plus completed staging drill. | [Backup, restore, and recovery-drill procedure](../../openplan/docs/ops/2026-05-01-openplan-backup-restore-procedure.md); [staging Supabase restore drill](../ops/2026-05-01-openplan-restore-drill-staging-supabase.md); [managed-hosting service schedule](2026-05-01-openplan-managed-hosting-service-schedule.md) | RPO/RTO commitments are per-engagement schedule fields, not global product promises; client records retention and legal hold duties remain outside OpenPlan. | Fill backup mechanism, retention target, restore request target, client-retained records, and any required recovery objectives in the service schedule. |
| Billing/support ledger posture is available for managed hosting conversations. | [Billing current-cycle waiver proof](../ops/2026-05-01-openplan-billing-current-cycle-waiver-proof.md); [managed-hosting service schedule](2026-05-01-openplan-managed-hosting-service-schedule.md); [buyer-safe caveat sheet](2026-05-01-openplan-buyer-safe-caveat-sheet.md) | The May 1 release-to-sale packet uses historical live payment evidence plus current non-money-moving proof; no fresh same-cycle paid checkout canary is claimed. | Decide before signature whether procurement accepts the waiver or requires a supervised workspace-specific paid activation proof. |
| A supervised first workflow can be packaged for pilot diligence and closeout. | [Guided demo script](2026-05-01-openplan-demo-workspace-script.md); [pilot SOW template](2026-05-01-openplan-pilot-sow-template.md); [buyer-safe caveat sheet](2026-05-01-openplan-buyer-safe-caveat-sheet.md); [release-to-sale plan](../ops/2026-05-01-openplan-release-to-sale-plan.md) | The pilot should prove one selected workflow first; do not imply a finished all-in-one suite, autonomous AI planning, validated behavioral forecasting, or legal/LAPM automation. | Scope the first workflow, buyer reviewer, success artifact, caveat review, closeout memo, and stop conditions. |

## Not Claimed By This Proof Map

This document does not claim:

- fully self-serve municipal SaaS operation;
- automatic workspace creation from a public form;
- 24/7 support, global uptime, service credits, or financially backed availability;
- global RPO/RTO targets outside a filled service schedule;
- fresh same-cycle paid checkout proof;
- validated behavioral forecasting;
- autonomous AI planning;
- legal, engineering, procurement, grant-submission, or LAPM/compliance sign-off;
- grant award prediction, certified grant scoring, or guaranteed funding competitiveness;
- private cloud, agency cloud, SSO, custom security review, or enhanced SLA without separate scoping.

## Recommended Buyer Sentence

> OpenPlan can be hosted and supported by Nat Ford as a supervised planning workbench, with onboarding, support, backup/restore, billing, and first-workflow proof tied to specific artifacts and finalized per engagement in the managed-hosting schedule or SOW.

## Operator Use Checklist

Before sending this proof map with a buyer packet:

- confirm the buyer one-pager and caveat sheet are attached or linked;
- choose one first workflow instead of presenting the full 18-month roadmap as already complete;
- fill or explicitly defer the managed-hosting schedule fields for support, backup/restore, billing, data sensitivity, and enhanced SLA needs;
- preserve the billing waiver language unless a fresh paid canary has been run and documented;
- preserve the modeling/AI/legal/compliance caveats before any external reliance.
