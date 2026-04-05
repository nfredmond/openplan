# OpenPlan Launch Truth ADR — April 2026

**Date:** 2026-04-05
**Owner:** Bartholomew Hale (COO)
**Audience:** Nathaniel, Elena, ops/planning leads
**Status:** Canonical current launch-truth decision record

## Decision
OpenPlan is **GO for supervised external pilot use** and **NO-GO for broad public self-serve launch**.

That is the honest boundary as of 2026-04-05.

## Executive summary
OpenPlan is no longer a vague prototype. It now has a real production-backed spine and a coherent current deployment story:

- authenticated planning continuity across Project → Plan → Model → Program surfaces on production,
- managed model-run launch and attached run history on production,
- scenario comparison on production,
- county run creation, manifest ingest, and scaffold editing on production,
- responsive layout hardening on the core authenticated pages,
- canonical Vercel consolidation to the Nat Ford project and alias policy,
- and an April proof trail that is materially stronger than the March internal gate.

What is **not** true:

- OpenPlan is **not** a fully validated forecasting platform,
- **not** a finished LAPM / legal-grade compliance system,
- **not** a fully self-serve municipal SaaS launch,
- and **not** commercially proven in a way that justifies broad marketing language about frictionless checkout or universal readiness.

So the launch posture is narrow on purpose: **pilot-ready, supervised, evidence-accurate**.

## Governing facts
### Proven in current production evidence
- Authenticated create/list/detail continuity across core planning surfaces.
- Managed run launch with linked analysis attachment.
- Scenario comparison rendering on production.
- County run onboarding/editing workflow on production.
- Layout stability on narrow viewports for the audited authenticated surfaces.
- Canonical production alias policy: `https://openplan-natford.vercel.app`.
- Legacy compatibility alias: `https://openplan-zeta.vercel.app`.

### Proven only to a bounded degree
- Billing and commercial behavior are strong enough for pilot/pre-close posture, but the current proof story still relies on human review and an explicit commercial boundary.
- Modeling work remains screening-grade / bounded, not outward-forecast-ready.
- LAPM / invoicing support exists as a project-controls lane, but is not yet a full client-facing compliance machine.

### Not proven enough for broad launch claims
- validated behavioral demand forecasting,
- fully automated compliance/legal signoff,
- universal self-serve onboarding with no human supervision,
- fully closed billing proof beyond the evidence boundary already documented,
- or “ready for any agency in any context” messaging.

## Recommended v1 boundary
### In
- Authenticated planning OS core:
  - projects
  - plans
  - programs
  - models
  - reports
  - scenarios / comparison board
- Engagement core where already proven:
  - campaign management
  - public/share submission flow
  - moderation and handoff into reports
  - traceability back to source context
- Managed-run and county-run onboarding surfaces that are already production-proven.
- Billing/admin baseline only to the extent it is already operationally usable.

### Out
- Broad public self-serve launch claims.
- Behavioral or calibrated forecasting claims.
- Full LAPM/legal/compliance automation claims.
- Claims of complete commercial proof in the current cycle.
- Claims that OpenPlan is a drop-in replacement for mature enterprise procurement, legal, or compliance tooling.

### Pilot-only / bounded
- County modeling and screening work.
- Any AequilibraE / ActivitySim / MATSim posture beyond bounded screening or prototype evidence.
- Any support surface that has not been repeatably proven in production.

## Operating recommendation
Use this exact posture in current planning and outward communication:

> OpenPlan is a production-backed planning operating system for supervised pilot use. It is strongest today in authenticated planning workflow continuity, report traceability, managed runs, scenario comparison, and guided county onboarding. Modeling and compliance claims remain bounded, and commercial language stays evidence-accurate.

## Why this is the right decision
1. The product spine is real enough to be useful now.
2. The evidence is strong enough to support design-partner use.
3. The commercial/support/legal packet is not yet broad-launch complete.
4. The cost of overclaiming is higher than the cost of staying precise.
5. The company’s long-term trust is worth more than a loud but sloppy launch.

## Consequences of this decision
### What we should do now
- Launch only through supervised pilots.
- Keep human-led onboarding and support in the loop.
- Keep marketing and sales language aligned to the proven surface area.
- Treat older rollout narratives as historical unless translated through this memo.

### What we should not do now
- Do not call the product “fully launched” in the broad public sense.
- Do not imply validated forecasting or compliance maturity that we do not yet have.
- Do not quote stale pricing or stale product-shape language as canonical.
- Do not let the original corridor-analysis thesis override the current Planning OS truth.

## Safe language / unsafe language guidance
### Safe language
Use phrases like:
- production-backed
- pilot-ready for supervised use
- evidence-accurate
- guided onboarding
- human-reviewed at critical gates
- bounded screening-grade
- auditable workflow continuity
- transparent methods and assumptions

### Unsafe language
Avoid phrases like:
- fully launched
- fully validated
- fully automated compliance
- decision-ready forecasting platform
- works for any agency without qualification
- frictionless self-serve commercial launch
- all proof questions are closed
- commercial billing was freshly re-proven this cycle

### Safer substitutions
If a sentence starts to sound too big, prefer one of these substitutions:
- “production-backed” instead of “fully proven”
- “pilot-ready for supervised use” instead of “ready for any agency”
- “bounded screening-grade” instead of “forecast-ready”
- “human-reviewed” instead of “automated”
- “current proof supports” instead of “this is settled forever”

## Bottom line
OpenPlan’s honest April 2026 launch truth is simple:

**GO for supervised pilot use. NO-GO for broad public self-serve launch.**

That boundary matches the evidence, protects trust, and gives the team a clean operating sentence to use everywhere else.
