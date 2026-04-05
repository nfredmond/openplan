# OpenPlan Review Package — Inventory & Handoff Checklist

**Date:** 2026-03-20  
**Author:** Mateo Ruiz (Assistant Planner — package-control lane)  
**For:** Elena (Principal Planner) + Bartholomew (COO)  
**Scope:** Operations/organization pass only. No code edits. No strategy calls.

---

## 1. File / Path Inventory — Key Proof Artifacts & Notes

### Canonical command documents
| File | Purpose |
|---|---|
| `docs/ops/2026-03-15-openplan-v1-command-board.md` | Single-source status board (GREEN/YELLOW/RED lanes) |
| `docs/ops/2026-03-16-openplan-v1-proof-packet.md` | Evidence index for internal pre-close review |
| `docs/ops/2026-03-16-openplan-v1-internal-ship-gate.md` | Internal ship gate checklist |
| `docs/ops/2026-03-17-openplan-v1-status-memo.md` | Executive truth-state memo after principal adjudication |
| `docs/ops/2026-03-15-openplan-v1-execution-queue.md` | Execution backlog / queue |
| `docs/ops/PRINCIPAL_QA_APPROVAL.md` | Elena's principal QA approval artifact |
| `docs/ops/2026-03-17-openplan-principal-gate-decision.md` | Scoped approval — internal pre-close / pilot-readiness |
| `docs/ops/2026-03-17-openplan-commercial-proof-waiver.md` | CEO waiver on fresh paid canary |
| `docs/ops/2026-03-17-openplan-client-safe-positioning-note.md` | External language guardrails |

### Pilot geography
| File | Purpose |
|---|---|
| `docs/ops/2026-03-19-pilot-geography-decision-nevada-county.md` | Pilot geography decision (Nevada County, CA) |

### Model run / modeling stack
| File | Purpose |
|---|---|
| `docs/ops/2026-03-17-openplan-modeling-stack-technical-spec.md` | AequilibraE + ActivitySim + MATSIM technical spec |
| `docs/ops/2026-03-17-openplan-modeling-stack-build-backlog-and-execution-plan.md` | Modeling stack backlog + execution plan |
| `docs/ops/2026-03-18-modeling-stack-phase1-artifacts-prd.md` | Phase 1 PRD for modeling artifacts |
| `docs/ops/2026-03-15-openplan-model-engine-options-note.md` | Model engine evaluation |
| `docs/ops/2026-03-18-p1a1-canonical-network-package-schema.md` | Network package schema |
| `docs/ops/2026-03-18-p1a2-zone-corridor-connector-contract.md` | Zone/corridor/connector contract |
| `docs/ops/2026-03-18-p1a3-ingestion-qa-pipeline.md` | Ingestion QA pipeline |
| `docs/ops/2026-03-18-p1b2-aequilibrae-worker-prototype.md` | AequilibraE worker prototype spec |
| `docs/ops/2026-03-18-p1b3-skim-artifact-generation.md` | Skim artifact generation |
| `docs/ops/2026-03-18-p1b4-assignment-accessibility-extractors.md` | Assignment/accessibility KPI extractors |
| `docs/ops/2026-03-18-p1c1-run-mode-surface-ui.md` | Run mode UI surface |
| `docs/ops/2026-03-18-p1c2-evidence-packet-output.md` | Evidence packet output format (shipped) |
| `docs/ops/2026-03-19-p2-activitysim-synthetic-population-spec.md` | Phase 2 ActivitySim spec |
| `docs/ops/2026-03-16-openplan-modeling-roadmap.md` | Modeling roadmap overview |

### Auth / evidence / API hardening
| File | Purpose |
|---|---|
| `docs/ops/2026-03-16-openplan-auth-proxy-closure-bundle.md` | Auth/proxy closure |
| `docs/ops/2026-03-15-openplan-v1-auth-access-evidence.md` | Auth + access evidence |
| `docs/ops/2026-03-16-billing-identity-review-hardening.md` | Billing identity review hardening |
| `docs/ops/2026-03-16-v1-provisioning-hardening.md` | Provisioning cleanup hardening |
| `docs/ops/2026-03-16-openplan-live-billing-hold-canary.md` | Live billing hold canary results |
| `docs/ops/2026-03-16-openplan-cancel-refund-operational-closeout.md` | Cancel/refund operational closeout |
| `docs/ops/2026-03-15-openplan-v1-billing-reliability-evidence.md` | Billing reliability evidence |
| `docs/ops/2026-03-16-openplan-supervised-paid-canary-preflight-closeout.md` | Paid canary preflight closeout |
| `docs/ops/2026-03-16-openplan-supervised-paid-commercial-canary-package.md` | Supervised paid canary package |
| `docs/ops/2026-03-16-openplan-live-billing-chooser-verification.md` | Billing chooser verification |
| `docs/ops/2026-03-16-openplan-billing-workspace-selection-elena-handoff.md` | Billing workspace selection handoff |
| Wave guard notes (06/07): `2026-03-06-wave21-*` through `2026-03-07-wave40-*` (13 files) | HTTP fetch / cache / timeout / sensitive-query hardening |

### Production smoke proof (screenshots + logs)
| Directory | Contents |
|---|---|
| `docs/ops/2026-03-15-test-output/` | Auth smoke screenshots (3 PNG), billing build/lint/test logs (3) |
| `docs/ops/2026-03-16-test-output/` | Auth smoke (8 PNG), edit smoke (3 PNG + log), billing hold canary (3 PNG + logs), billing chooser proofs (JSON + logs), billing tests (9 logs) |
| `docs/ops/2026-03-17-test-output/` | Auth smoke (8 PNG), engagement smoke (8 PNG), managed-run (3 PNG), report-traceability (3 PNG), QA cleanup summary (JSON) |
| `docs/ops/2026-03-18-test-output/` | Scenario comparison (2 PNG + debug files) |
| `docs/ops/2026-03-01-test-output/` | Older P0 billing/auth/gate tests (25 files), B-05/B-06 runtime proofs (PNG) |

### KPI / comparison
| File | Purpose |
|---|---|
| `docs/ops/2026-03-18-openplan-production-scenario-comparison-smoke.md` | Scenario comparison smoke |
| `docs/ops/2026-03-13-comparison-export-artifacts-pass.md` | Comparison export artifacts |
| `docs/ops/2026-03-18-p1b4-assignment-accessibility-extractors.md` | KPI extractor spec |
| `docs/ops/2026-03-18-p1c2-evidence-packet-output.md` | Evidence packet with KPI summary structure |

### Governance / review artifacts
| File | Purpose |
|---|---|
| `docs/ops/2026-03-05-authoritative-governance-state.md` | Authoritative governance state |
| `docs/ops/2026-03-05-phase1-gate-packet.md` | Phase 1 gate packet |
| `docs/ops/2026-03-05-phase1-evidence-checklist.md` | Phase 1 evidence checklist |
| `docs/ops/2026-03-05-coo-verification-phase1.md` | COO verification phase 1 |
| `docs/ops/2026-03-05-op001-op003-acceptance-crosswalk.md` | Acceptance criteria crosswalk |
| `docs/ops/2026-03-16-openplan-v1-coo-verification.md` | COO verification (current) |
| `docs/ops/2026-03-16-openplan-v1-elena-review-packet.md` | Elena review packet |
| `docs/ops/2026-03-16-openplan-live-evidence-lane-reconciliation.md` | Evidence lane reconciliation |
| `docs/ops/2026-03-20-branch-audit-after-mainline-recovery.md` | Branch audit / mainline recovery |
| `docs/ops/2026-03-02-research-handoff-enforcement-checklist.md` | Handoff enforcement checklist |
| `docs/ops/2026-03-02-research-handoff-message-template.md` | Handoff message template |
| `docs/ops/2026-03-02-research-handoff-protocol-index.md` | Handoff protocol index |

### Module plans (future scope)
| File | Purpose |
|---|---|
| `docs/ops/2026-03-14-reports-v1-module-plan.md` | Reports module plan |
| `docs/ops/2026-03-14-engagement-v1-module-plan.md` | Engagement module plan |
| `docs/ops/2026-03-14-scenarios-v1-module-plan.md` | Scenarios module plan |
| `docs/ops/2026-03-15-plans-v1-module-plan.md` | Plans module plan |
| `docs/ops/2026-03-17-engagement-report-handoff-slice.md` | Engagement → report handoff (shipped) |
| `docs/ops/2026-03-17-report-traceability-backlink-slice.md` | Report traceability backlink (shipped) |

---

## 2. Grouped Checklist by Category

### A. Pilot Geography
- [x] Pilot geography decision documented: `2026-03-19-pilot-geography-decision-nevada-county.md`
- [x] Selection rationale with data-source availability confirmed
- [x] Conflict-of-interest check (no Green DOT overlap) confirmed
- [x] Fallback smaller geography defined (Grass Valley–Nevada City core)
- [ ] **MISSING:** No actual Nevada County network package artifact yet (defined in spec, not built)

### B. Model Run Proof
- [x] Modeling stack technical spec: `2026-03-17-openplan-modeling-stack-technical-spec.md`
- [x] Phase 1 PRD with task breakdown: `2026-03-18-modeling-stack-phase1-artifacts-prd.md`
- [x] Network package schema spec: `2026-03-18-p1a1-*`
- [x] Zone/corridor/connector contract: `2026-03-18-p1a2-*`
- [x] Ingestion QA pipeline spec: `2026-03-18-p1a3-*`
- [x] AequilibraE worker prototype spec: `2026-03-18-p1b2-*`
- [x] Skim artifact generation spec: `2026-03-18-p1b3-*`
- [x] KPI extractor spec: `2026-03-18-p1b4-*`
- [x] Run mode UI spec: `2026-03-18-p1c1-*`
- [x] Evidence packet output format (shipped): `2026-03-18-p1c2-*`
- [x] Managed run production smoke: `2026-03-17-openplan-production-managed-run-smoke.md`
- [ ] **MISSING:** No actual AequilibraE run output artifact (skim, assignment, accessibility) exists yet
- [ ] **MISSING:** No benchmark/validation run log from a real network

### C. Auth / Evidence / API Hardening
- [x] Auth proxy closure: `2026-03-16-openplan-auth-proxy-closure-bundle.md`
- [x] Auth + access evidence: `2026-03-15-openplan-v1-auth-access-evidence.md`
- [x] Billing identity review hardening: `2026-03-16-billing-identity-review-hardening.md`
- [x] Provisioning cleanup hardening: `2026-03-16-v1-provisioning-hardening.md`
- [x] Live billing hold canary (partial pass): `2026-03-16-openplan-live-billing-hold-canary.md`
- [x] Cancel/refund closeout: `2026-03-16-openplan-cancel-refund-operational-closeout.md`
- [x] HTTP fetch/cache/timeout hardening (wave 21–40 notes, 13 files)
- [x] Production authenticated smoke (3/15, 3/16, 3/17 — screenshots present)
- [x] Production edit/update smoke: `2026-03-16-openplan-production-edit-update-smoke.md`
- [ ] **NOTED (waived):** No fresh same-cycle real-money paid canary — CEO waiver documented

### D. KPI Comparison
- [x] Scenario comparison production smoke: `2026-03-18-openplan-production-scenario-comparison-smoke.md`
- [x] Comparison export artifacts pass: `2026-03-13-comparison-export-artifacts-pass.md`
- [x] Evidence packet output spec with KPI structure: `2026-03-18-p1c2-*`
- [ ] **MISSING:** No actual populated KPI comparison output from a real model run
- [ ] **MISSING:** No baseline-vs-scenario numerical comparison artifact

### E. Governance / Review Artifacts
- [x] Principal QA approval: `PRINCIPAL_QA_APPROVAL.md`
- [x] Principal gate decision (scoped): `2026-03-17-openplan-principal-gate-decision.md`
- [x] Commercial proof waiver: `2026-03-17-openplan-commercial-proof-waiver.md`
- [x] COO verification: `2026-03-16-openplan-v1-coo-verification.md`
- [x] Elena review packet: `2026-03-16-openplan-v1-elena-review-packet.md`
- [x] Evidence lane reconciliation: `2026-03-16-openplan-live-evidence-lane-reconciliation.md`
- [x] Branch audit / mainline recovery: `2026-03-20-branch-audit-after-mainline-recovery.md`
- [x] Client-safe positioning note: `2026-03-17-openplan-client-safe-positioning-note.md`
- [x] QA cleanup note: `2026-03-17-openplan-production-qa-cleanup.md`

---

## 3. Missing, Duplicated, Stale, or Ambiguously Named Items

### Missing artifacts (flagged for engineering, not created here)
1. **No actual Nevada County network package** — spec exists, artifact does not.
2. **No actual AequilibraE model run output** — worker prototype spec exists, no run log or output files.
3. **No populated KPI comparison artifact** — spec structure exists, no real numbers.
4. **No fresh paid canary** — explicitly waived by CEO, documented.
5. **No grant-application sample output** — the platform lacks a grant-focused export template or sample.
6. **No formal report/memo PDF export sample** — report module plan exists but no sample deliverable output.

### Potentially duplicated / overlapping documents
1. `2026-03-01-ship-evidence-index.md` vs `2026-03-05-ship-evidence-index.md` — two evidence indexes from different dates; the 03-05 version appears to supersede the 03-01 version.
2. `2026-03-05-principal-qa-approval-phase1.md` vs `2026-03-05-principal-qa-approval-ship-phase1-core.md` vs `PRINCIPAL_QA_APPROVAL.md` — three QA approval artifacts; canonical one should be clearly labeled.
3. `2026-03-16-openplan-production-authenticated-smoke.md` vs `2026-03-17-openplan-production-authenticated-smoke.md` — two dated versions of the same smoke; the 03-17 version is the freshest.
4. Multiple Iris closure/sprint reports from 03-05 (5 files) — may consolidate into one closure summary.

### Stale items
1. `2026-03-01-*` test output directory (25 files) — oldest proof cycle; still valid as historical baseline but may cause confusion if treated as current.
2. `2026-03-05-*` test output — intermediate cycle; superseded by 03-15/03-16/03-17 proofs.
3. `2026-03-02-*` handoff protocol files (8 files) — process artifacts that may no longer be actively enforced.

### Ambiguously named
1. `2026-03-05-p1-d01-d05-closeout-checklist-tonight.md` — "tonight" is ambiguous once date passes.
2. `2026-03-02-live-command-packet-p0-blockers.md` — "live" is confusing when document is static.
3. Wave guard notes (`wave21` through `wave40`) — opaque numbering without context unless you know the wave system.

---

## 4. Recommended Cleaner Folder Structure

```
docs/ops/
├── README.md                          ← NEW: top-level index pointing to current canonical docs
├── command-board/
│   ├── v1-command-board.md            ← from 2026-03-15-openplan-v1-command-board.md
│   ├── v1-proof-packet.md             ← from 2026-03-16-openplan-v1-proof-packet.md
│   ├── v1-status-memo.md             ← from 2026-03-17-openplan-v1-status-memo.md
│   └── v1-internal-ship-gate.md      ← from 2026-03-16-openplan-v1-internal-ship-gate.md
│
├── governance/
│   ├── principal-qa-approval.md       ← canonical (current PRINCIPAL_QA_APPROVAL.md)
│   ├── principal-gate-decision.md
│   ├── commercial-proof-waiver.md
│   ├── coo-verification.md
│   ├── elena-review-packet.md
│   ├── client-safe-positioning.md
│   └── branch-audit.md
│
├── pilot-geography/
│   └── nevada-county-decision.md
│
├── modeling-stack/
│   ├── technical-spec.md
│   ├── build-backlog.md
│   ├── phase1-prd.md
│   ├── p1a1-network-schema.md
│   ├── p1a2-zone-corridor.md
│   ├── p1a3-ingestion-qa.md
│   ├── p1b2-aequilibrae-worker.md
│   ├── p1b3-skim-artifact.md
│   ├── p1b4-kpi-extractors.md
│   ├── p1c1-run-mode-ui.md
│   ├── p1c2-evidence-packet.md
│   └── p2-activitysim-spec.md
│
├── auth-billing-hardening/
│   ├── auth-proxy-closure.md
│   ├── auth-access-evidence.md
│   ├── billing-identity-review.md
│   ├── provisioning-hardening.md
│   ├── live-billing-hold-canary.md
│   ├── cancel-refund-closeout.md
│   ├── billing-reliability-evidence.md
│   └── wave-guard-notes/              ← consolidate wave21–wave40 files here
│
├── production-smoke/
│   ├── 2026-03-17/                    ← current canonical smoke (screenshots + logs)
│   ├── 2026-03-16/                    ← prior cycle
│   └── archive/                       ← older cycles (03-01, 03-05, 03-15)
│
├── module-plans/
│   ├── reports-v1.md
│   ├── engagement-v1.md
│   ├── scenarios-v1.md
│   ├── plans-v1.md
│   └── shipped-slices/
│       ├── engagement-report-handoff.md
│       └── report-traceability-backlink.md
│
├── handoff-protocols/                  ← process docs (retain or archive)
│
└── archive/                           ← existing archive + older superseded docs
```

**Note:** This is a recommendation only. Restructuring requires COO/CEO approval. No files were moved or renamed in this pass.

---

## 5. Companion Documents

- **Dedup / stale / naming resolution log:** `docs/ops/2026-03-20-package-control-dedup-stale-naming-log.md`  
  Tags 4 superseded files, 3 canonical files, 2 stale directories for archive, and 3 naming fixes.

---

## ACK

- **READY** — package-control / organization lane confirmed.
- **No-overlap** with active engineering execution — confirmed. No code, migration, or implementation files touched.
- **Inventory plan:** file/path inventory + grouped checklist + gap/dupe/stale/naming flags + structure recommendation.
- **This document is the first checkpoint.**
