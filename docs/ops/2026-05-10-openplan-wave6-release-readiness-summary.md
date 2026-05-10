# OpenPlan Wave 6 Release-Readiness Summary

**Date:** 2026-05-10
**Branch base:** `origin/main` through `9f3c93d` (`Link command board to pilot preflight proof`)
**Status:** PASS for an internal merge-train readiness summary; supports a supervised buyer/demo/pilot conversation only.
**Scope:** concise operator summary of the May 10 Wave 6 proof/readiness merge train.

## Product Truth

OpenPlan is an Apache-2.0 planning workbench with optional Nat Ford managed hosting, onboarding, implementation, support, and planning services. This wave improves proof posture, operator visibility, and buyer-safe evidence traceability.

It does **not** make OpenPlan any of the following:

- fully self-serve municipal SaaS;
- legal-grade LAPM, procurement, grant-submission, or compliance automation;
- grant-award prediction;
- calibrated/validated behavioral forecasting;
- autonomous AI planning or autonomous public representation;
- survey-grade, engineering-grade, photogrammetry, orthomosaic, point-cloud, or centimeter-level aerial output.

## What This Merge Train Shipped

### 1. Operator preflight and proof synchronization

- Added the read-only pilot preflight bundle and operator proof note for local Supabase guard posture, migration inventory, production health, and Vercel deployment readiness.
- Linked Command Center / command-board surfaces to the pilot preflight proof so operators see the same readiness boundary in-app.
- Added admin pilot-readiness proof packet drift protection and synchronized the Admin Pilot Readiness export packet.
- Added an admin proof artifact index and pilot-readiness alignment smoke so proof packet surfaces are less likely to drift from buyer-safe copy.

Primary references:

- [Pilot preflight operator proof](2026-05-10-openplan-pilot-preflight-operator-proof.md)
- [Final pilot-readiness smoke checklist](2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md)
- [Admin Pilot Readiness proof packet](../sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.md)

### 2. Evidence traceability and source-context hardening

- Strengthened modeling evidence export posture and carried modeling caveats/source context into report and RTP proof paths.
- Added RTP artifact source metadata and funding-source context export coverage.
- Surfaced saved comparison source context, legacy scenario snapshot caveats, and report comparison provenance.
- Clarified aerial report provenance/source states without implying survey-grade or photogrammetry-grade output.
- Surfaced Data Hub lineage readiness so operators can distinguish proved source-context surfaces from future/unproved export surfaces.

Primary references:

- [Modeling caveat KPI SQL gate proof](2026-05-08-openplan-modeling-caveat-kpi-sql-gate-proof.md)
- [County-run manifest proof UI](2026-05-10-openplan-county-run-manifest-proof-ui.md)
- [Known issues register](2026-05-01-openplan-known-issues-register.md)

### 3. Workflow readiness cues

- Strengthened county-run manifest proof UI for evidence inventory, validation posture, operator next action, and caveat boundaries.
- Added RTP adoption-record proof, Grants evidence-readiness cues, and Engagement public-review copy guards.
- Improved project-spine crosslinks, empty states, and proof-artifact actions so a project remains the shared planning record across workflows.
- Sharpened Command Center workflow lanes and next-action grouping for operator triage.

Primary references:

- [Final pilot-readiness smoke checklist](2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md)
- [Release-to-sale plan](2026-05-01-openplan-release-to-sale-plan.md)
- [Full OS roadmap](2026-05-01-openplan-full-os-roadmap.md)

### 4. Buyer-safe managed-support posture

- Added the managed support proof map tying hosted operations, onboarding, support, backup/restore, billing, and pilot closeout claims to proof artifacts.
- Added proof-linked buyer demo script guardrails.
- Preserved the billing waiver boundary: historical live payment evidence plus current non-money-moving proof; no fresh same-cycle paid canary is claimed.
- Restored the access-request review-trail label so supervised onboarding remains visible as manual/operator-reviewed, not instant self-serve activation.

Primary references:

- [Managed support proof map](../sales/2026-05-10-openplan-managed-support-proof-map.md)
- [Buyer-safe caveat sheet](../sales/2026-05-01-openplan-buyer-safe-caveat-sheet.md)
- [Billing current-cycle waiver proof](2026-05-01-openplan-billing-current-cycle-waiver-proof.md)

## Validation Posture

Current readiness rests on three layers:

1. **Baseline RC gate:** the May 1 RC proof log records passing `pnpm test`, `pnpm lint`, `pnpm build`, production health, public demo preflight, and production audit checks at that checkpoint.
2. **Wave 6 targeted guards:** this merge train added or exercised targeted tests for pilot readiness, proof-packet drift, release-proof buyer-safe copy, demo proof links, command-board proof links, project-spine crosslinks, RTP funding/source context, county-run manifest UI, grants evidence readiness, engagement readiness, Data Hub lineage, scenario source context, aerial provenance, and report evidence summaries.
3. **Operator pre-conversation gate:** before any buyer/demo/pilot reliance, run `pnpm ops:check-pilot-preflight` from `openplan/` and treat any `ATTENTION` result as a caveat or stop condition.

Minimum rerun before external reuse remains:

```bash
cd openplan
pnpm ops:check-pilot-preflight
pnpm test -- --run \
  src/test/final-pilot-readiness-smoke-checklist.test.ts \
  src/test/managed-support-proof-map.test.ts \
  src/test/demo-workspace-script-proof-links.test.ts \
  src/test/release-proof-copy-guards.test.ts
pnpm lint
```

For app-behavior changes after this wave, run the standard release-to-sale gate in [the release-to-sale plan](2026-05-01-openplan-release-to-sale-plan.md) instead of relying on this summary.

## Caveats To Carry Into Any Merge / Demo / Buyer Conversation

- OpenPlan is ready for a **supervised planning-workbench conversation**, not broad self-serve launch.
- Admin provisioning and support are manual/supervised unless a later proof explicitly says otherwise.
- Modeling and county-run outputs are evidence packaging and planning-analysis support, not validated behavioral forecasting.
- Grants readiness means missing-evidence and next-action support, not award prediction or automated grant compliance.
- Public engagement output remains moderated and staff-reviewed, not autonomous public representation.
- Legal/LAPM/compliance, procurement, engineering, and survey-grade outputs require separate professional review and engagement-specific scope.
- Global SLA/RPO/RTO commitments are not product-wide promises; they must be filled in the managed-hosting service schedule per engagement.

## Merge Risk

Low for documentation-only summary reuse. The underlying merge train includes app and test changes already on `origin/main`; this document does not add runtime behavior. The main risk is over-reliance on this summary as a launch certificate, which the caveats above explicitly prohibit.
