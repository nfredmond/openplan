# OpenPlan Multi-Agent Crash Guardrails

Date: 2026-03-03
Owner: COO lane (Bartholomew)

## Why this exists
Concurrent agent edits + host interruption can create untracked artifact drift and broken repo state.

## Guardrails (mandatory)
1. **One writer branch per lane**
   - Each agent/lane must write only to its own branch.
   - No shared direct writes on `master`.

2. **Crash-safe checkpoint cadence**
   - Every 30–60 minutes: `git status -sb` + checkpoint commit if dirty tracked files exist.

3. **Untracked artifact containment**
   - Generated files must live only under explicitly ignored paths:
     - `openplan/.artifacts/`
     - `openplan/supabase/.temp/`

4. **Evidence docs are tracked intentionally**
   - If a doc is referenced in tracked files, it must be committed in the same PR.

5. **Post-crash recovery protocol**
   - Move untracked files into dated recovery bundle under:
     - `projects/openplan-warroom/crash-recovery/YYYY-MM-DD-*`
   - Produce triage split: promote / archive / discard.
   - Re-promote referenced missing artifacts via a dedicated recovery PR.

## Recovery QA checklist
- [ ] `git status -sb` clean on target branch
- [ ] no unresolved missing-file references in tracked docs
- [ ] recovery manifest + triage report written
- [ ] promoted artifacts restored via PR

## Enforcement
Any ship claim made with unresolved crash drift is invalid until this checklist is green.
