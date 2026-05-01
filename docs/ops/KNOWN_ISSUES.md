# OpenPlan Known Issues Register

**Last updated:** 2026-05-01
**Status:** Active ship-quality register
**Scope:** integrated OpenPlan release-to-sale and full-OS buildout

## Purpose

This register turns known product, proof, and operating caveats into explicit tracked items. It is not a backlog replacement. It is the ship-quality gate named by the 2026-04-16 integrated deep-dive: flagship flows should have zero open blockers, and non-blocking risks should have an owner, severity, disposition, and proof reference.

## Current Gate

**Open blockers:** 0

The current release-to-sale posture remains PASS for a supervised planning workbench and managed-service motion, provided sales language stays inside the proof boundaries in `2026-05-01-openplan-release-to-sale-plan.md`.

## Severity

| Severity | Meaning |
|---|---|
| Blocker | Must stop external release, paid-pilot expansion, or production mutation until resolved. |
| High | Not a full stop, but must be resolved before relying on the affected workflow in a buyer pilot. |
| Medium | Buyer/operator caveat; acceptable only if disclosed and actively tracked. |
| Low | Hygiene, future-proofing, or non-user-facing issue that should not be lost. |

## Open Watch Items

| ID | Severity | Owner | Area | Issue | Disposition | Proof / Source |
|---|---|---|---|---|---|---|
| KI-2026-05-01-001 | Medium | CEO/Ops | Billing/commercial proof | No fresh same-cycle paid checkout canary is claimed. Direct OpenPlan tier checkout now routes to fit review instead of Stripe checkout. | Accepted boundary for supervised sales. If a procurement reviewer requires current money-moving proof, run a separately approved paid canary and update the billing proof packet. | `2026-05-01-openplan-billing-current-cycle-waiver-proof.md`; commit `ee29492` |
| KI-2026-05-01-002 | Medium | Product/Ops | Modeling claims | Screening-grade county-run and behavioral-onramp evidence must not be described as calibrated or validated forecasting. | Keep buyer language in screening-grade / human-review posture. Require explicit consent paths for screening-grade evidence consumption. | `2026-04-16-caveat-gate-audit.md`; `2026-04-19-phase-s1-t16-reader-proof.md` |
| KI-2026-05-01-003 | Medium | Ops | Recovery operations | First staging Supabase restore drill passed, but future restore confidence depends on quarterly repetition and per-engagement RPO/RTO fields. | Not a release blocker. Schedule next drill before stronger recovery language or SLA commitments. | `2026-05-01-openplan-restore-drill-staging-supabase.md`; `openplan/docs/ops/2026-05-01-openplan-backup-restore-procedure.md` |
| KI-2026-05-01-004 | Low | Platform | CI/tooling | GitHub Actions currently annotates that Node.js 20-based actions are being forced onto Node.js 24. | Track as tooling hygiene. CI is passing; update action versions when upstream actions stop targeting deprecated Node runtime. | GitHub CI run `25237285943`; GitHub CI run `25237739979` |
| KI-2026-05-01-005 | Low | UX/Reports | Test hygiene | Full test run passes, but `src/test/report-detail-page.test.tsx` emits a React warning about `NaN` rendered as children. | Non-blocking because tests pass and no current proof gate fails. Investigate during the next report-detail UX pass. | Local `npm test` on 2026-05-01 before commit `ee29492` |

## Closed / Recently Controlled

| ID | Closed | Area | Resolution | Proof / Source |
|---|---|---|---|---|
| KI-2026-05-01-C01 | 2026-05-01 | Production admin access | Production authenticated smoke confirmed the configured reviewer can load `/admin/operations`, see service-lane intake unlocked, and avoid triage/provision actions or prospect row capture. | `2026-05-01-openplan-production-admin-operations-authenticated-smoke.md` |
| KI-2026-05-01-C02 | 2026-05-01 | Buyer proof packet | Admin Pilot Readiness proof packet now includes production admin-ops auth proof and regenerated static PDF without stale page footer text. | `docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.*`; commit `456657b` |
| KI-2026-05-01-C03 | 2026-05-01 | UI/code hygiene | App pages are now capped at 1,200 lines by ESLint after Grants and Dashboard decomposition. | `2026-05-01-openplan-app-page-max-lines-guard.md`; commit `6a5c7b8` |
| KI-2026-05-01-C04 | 2026-05-01 | Phase 1 spine | Local spine smoke proves one seeded NCTC project ID is reused across RTP, grants, engagement, analysis/county-run, reports, map, Data Hub, and aerial evidence rows without duplicate project creation. | `2026-05-01-openplan-local-spine-smoke.md` |

## Update Rules

- Add a row when a test, smoke, production proof, review, or buyer-facing packet reveals a real caveat.
- Promote to **Blocker** when the issue invalidates a release gate, creates unsafe billing/customer/data behavior, weakens workspace isolation, or causes proof language to overclaim.
- Close a row only when the linked proof or commit demonstrates the issue is controlled.
- Do not hide product boundaries by deleting watch items; move them to closed only when the boundary is replaced by working, verified behavior.
