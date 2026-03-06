# OpenPlan Phase 1 Daily Evidence Checklist (Reusable)

Purpose: reusable daily checklist for Phase-1 gate governance (09:00 / 13:00 / 17:30).  
Usage: copy this file to `openplan/docs/ops/YYYY-MM-DD-phase1-evidence-checklist.md` and fill all fields before each gate call.

## 0) Daily metadata
- Date (PT): `[YYYY-MM-DD]`
- Branch: `[branch-name]`
- Prepared by: `[name]`
- Gate owner: `[name]`
- Principal QA owner: `[name]`

## 1) Scope + governance controls
- [ ] Scope remains within active Phase-1 packet (no unauthorized expansion).
  - Evidence: `[path]`
- [ ] Hard gate rules acknowledged (unresolved P0 => HOLD; missing evidence => unresolved).
  - Evidence: `[path]`
- [ ] Current blocker register has named owner + ETA for every open item.
  - Evidence: `[path]`

## 2) Required evidence inventory (attach concrete paths)
| Evidence item | Required at gate? | Status (PASS/MISSING/PARTIAL) | Evidence path(s) | Notes |
|---|---|---|---|---|
| Lint log (same day) | 13:00 + 17:30 | [ ] | [path] | |
| Test log (same day) | 13:00 + 17:30 | [ ] | [path] | |
| Build log (same day) | 13:00 + 17:30 | [ ] | [path] | |
| Critical runtime proof (UI/API) | 17:30 | [ ] | [path] | |
| Phase-1 acceptance criteria crosswalk update | 13:00 | [ ] | [path] | |
| Blocker truth table (owner/ETA/evidence/mitigation) | 09:00 + 13:00 + 17:30 | [ ] | [path] | |
| PASS/HOLD recommendation note | 17:30 | [ ] | [path] | |
| Principal QA dated artifact | 17:30 finalization | [ ] | [path] | |

## 3) 09:00 checkpoint fill
### completed
- [item + evidence path]

### in progress
- [item + evidence path]

### open blockers (owner / ETA / evidence / mitigation)
| Blocker | Owner | ETA | Evidence | Mitigation |
|---|---|---|---|---|
| [blocker] | [owner] | [eta] | [path] | [mitigation] |

### recommendation
- 09:00 posture: `PASS` / `HOLD`
- Reason (1–2 lines): [text]

## 4) 13:00 checkpoint fill
### completed
- [item + evidence path]

### in progress
- [item + evidence path]

### open blockers (owner / ETA / evidence / mitigation)
| Blocker | Owner | ETA | Evidence | Mitigation |
|---|---|---|---|---|
| [blocker] | [owner] | [eta] | [path] | [mitigation] |

### recommendation
- 13:00 posture: `PASS` / `HOLD`
- Reason (1–2 lines): [text]

## 5) 17:30 checkpoint fill
### completed
- [item + evidence path]

### in progress
- [item + evidence path]

### open blockers (owner / ETA / evidence / mitigation)
| Blocker | Owner | ETA | Evidence | Mitigation |
|---|---|---|---|---|
| [blocker] | [owner] | [eta] | [path] | [mitigation] |

### recommendation
- 17:30 posture: `PASS` / `HOLD`
- Decision basis: unresolved P0? `YES/NO`
- Principal QA artifact linked? `YES/NO`
- Final reason (1–3 lines): [text]

## 6) PASS/HOLD decision logic (non-bypass)
A gate is **PASS-eligible** only when all are true:
1. No unresolved P0 blockers.
2. Every claim has concrete evidence path(s).
3. Owner + ETA + mitigation recorded for each open blocker.
4. Principal QA dated artifact posted (for final ship gate).

If any condition fails -> **HOLD**.

## 7) Sign-off
- Planner packet owner: `[name]` at `[time]`
- Engineering evidence owner: `[name]` at `[time]`
- Principal QA owner: `[name]` at `[time]`
- Final decision recorded: `PASS` / `HOLD`