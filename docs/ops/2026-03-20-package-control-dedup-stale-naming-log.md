# Package Control — Dedup / Stale / Naming Resolution Log

**Date:** 2026-03-20  
**Author:** Mateo Ruiz (Assistant Planner — package-control lane)  
**Scope:** Identification and tagging only. No files moved, renamed, or deleted.

---

## Duplicated / Overlapping Documents — Resolution Tags

### 1. Ship Evidence Indexes (2 versions)
| File | Date | Owner | Verdict |
|---|---|---|---|
| `2026-03-01-ship-evidence-index.md` | 2026-03-01 | Mateo | **SUPERSEDED** — Day 1 original |
| `2026-03-05-ship-evidence-index.md` | 2026-03-05 | Iris | **SUPERSEDED** — Phase-1 refresh |
| `2026-03-16-openplan-v1-proof-packet.md` | 2026-03-16 | Bart | **CANONICAL** — current evidence index |

**Recommendation:** Archive both older indexes into `docs/ops/archive/`.

### 2. Principal QA Approval Artifacts (3 versions)
| File | Date | Status |
|---|---|---|
| `2026-03-05-principal-qa-approval-phase1.md` | 2026-03-05 | **SUPERSEDED** — original 03-05 approval |
| `2026-03-05-principal-qa-approval-ship-phase1-core.md` | 2026-03-05 | **SUPERSEDED** — preserved copy of prior `PRINCIPAL_QA_APPROVAL.md` |
| `PRINCIPAL_QA_APPROVAL.md` | 2026-03-17 | **CANONICAL** — Elena's current-cycle decision artifact |

**Recommendation:** Archive both `2026-03-05-principal-qa-*` files. `PRINCIPAL_QA_APPROVAL.md` is the only live governance artifact.

### 3. Production Authenticated Smoke (2 dated versions)
| File | Date | Status |
|---|---|---|
| `2026-03-16-openplan-production-authenticated-smoke.md` | 2026-03-16 | **SUPERSEDED** — prior cycle |
| `2026-03-17-openplan-production-authenticated-smoke.md` | 2026-03-17 | **CANONICAL** — freshest production smoke |

**Recommendation:** Keep both (different dates = different proof cycles), but label 03-17 as canonical in the command board.

### 4. Iris Closure Reports (5 files from 03-05)
| File | Purpose |
|---|---|
| `2026-03-05-iris-closure-sprint-evidence-report.md` | Sprint evidence |
| `2026-03-05-iris-op003-template-binding-report.md` | OP-003 template binding |
| `2026-03-05-iris-p1-d01-d05-closeout-report.md` | P1 D01–D05 closeout |
| `2026-03-05-iris-phase1-implementation-report.md` | Phase 1 implementation |
| `2026-03-05-iris-targeted-proof-closure-report.md` | Targeted proof closure |

**Recommendation:** These are **granular** but **not duplicates** of each other. Consider consolidating into a single `2026-03-05-iris-phase1-closure-summary.md` (would require engineering lane, so flagging only).

---

## Stale Items — Age Tags

### Oldest proof cycle (`2026-03-01-test-output/`, 25 files)
- **Age:** 19 days old
- **Status:** Valid historical baseline but superseded by 03-15/16/17 proofs
- **Recommendation:** Move to `docs/ops/archive/2026-03-01-test-output/`

### Intermediate proof cycle (`2026-03-05-test-output/`)
- **Age:** 15 days old
- **Status:** Superseded by 03-16/17 proofs
- **Recommendation:** Move to `docs/ops/archive/2026-03-05-test-output/`

### Handoff protocol files (`2026-03-02-*-handoff-protocol.md`, 8 files)
- **Age:** 18 days old
- **Status:** Process artifacts — may or may not be actively enforced
- **Recommendation:** Move to `docs/ops/handoff-protocols/` or `archive/`

---

## Naming Issues — Suggested Renames

| Current Name | Issue | Suggested Name |
|---|---|---|
| `2026-03-05-p1-d01-d05-closeout-checklist-tonight.md` | "tonight" is ambiguous | `2026-03-05-p1-d01-d05-closeout-checklist.md` |
| `2026-03-02-live-command-packet-p0-blockers.md` | "live" confusing on static doc | `2026-03-02-command-packet-p0-blockers.md` |
| Wave guard notes (`wave21`–`wave40`) | Opaque numbering | Add a `wave-guard-notes/README.md` explaining the numbering system |

---

## Summary Stats

| Category | Count |
|---|---|
| Files tagged SUPERSEDED | 4 |
| Files tagged CANONICAL | 3 |
| Stale directories recommended for archive | 2 |
| Process artifact sets for consolidation | 1 (handoff protocols) |
| Naming fixes recommended | 3 |
| Items requiring engineering action (not touched) | 1 (Iris consolidation) |
