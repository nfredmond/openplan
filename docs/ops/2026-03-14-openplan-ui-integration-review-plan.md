# OpenPlan UI + Reports Integration / Review Plan

Date: 2026-03-14
Status: READY FOR REVIEW
Owner: Bartholomew

## Executive Summary

OpenPlan is now at a clean review/integration checkpoint.

Two major local work streams exist:
1. **Main repo work** — Reports V1 foundation + reconciliation
2. **UI worktree work** — broad OpenPlan visual/system polish from Camila

Good news: these two streams currently show **no overlapping changed paths**.

That means integration risk is low and the correct next sequence is:
1. review local changes,
2. integrate UI worktree into main cleanly,
3. run full validation in main,
4. commit in a disciplined order,
5. push,
6. watch Vercel,
7. run visual smoke checks.

## Current Local State

### Main repo (`~/openclaw/workspace/openplan`)
Contains:
- Reports V1 foundation
- reports schema/migration/API/routes/tests
- Reports UI surface in main app
- Reports reconciliation/hardening pass
- related local docs

### UI worktree (`~/openclaw/workspace/openplan-ui-camila`)
Contains:
- homepage/public polish
- app-shell seam polish
- module surface hierarchy pass
- list-density refinement
- Explore / Analysis Studio passes
- Run History / comparison / narrative polish
- global UI system refinements

### Git posture
- main repo and UI worktree both currently branch off the same base commit
- changed file sets are currently **disjoint**
- this is the best-case integration scenario

## Verified Merge Risk

### Overlap check result
**No overlapping changed paths detected** between:
- main repo local changes
- Camila UI worktree local changes

### Practical implication
We should avoid unnecessary cherry-pick gymnastics.

Best path:
- bring UI worktree changes into main via a controlled patch/checkout sync,
- then validate the unified local tree,
- then commit.

## Recommended Integration Sequence

### Phase 1 — review checkpoint
Before any push:
1. review the current main repo diff (Reports lane)
2. review the current UI worktree diff (Camila lane)
3. confirm no unwanted collateral changes remain

### Phase 2 — integrate UI worktree into main
Recommended approach:
- copy/check out the changed UI files from `openplan-ui-camila` into the main repo worktree
- do not squash blindly before verification
- preserve the existing main local Reports changes as-is

### Phase 3 — unified validation in main repo
Run in the main repo after integration:
- `npm run lint`
- `npm test`
- `npm run build`

If build is clean, proceed.

### Phase 4 — commit discipline
Recommended commit structure:

#### Commit A — Reports V1 foundation + reconciliation
Scope:
- schema
- API
- reports UI scaffolding
- tests
- reconciliation fixes

#### Commit B — UI system + shell/module polish
Scope:
- public/app shell polish
- module hierarchy refinements
- list-density refinements
- Explore / Analysis Studio polish

If diff volume is too large, split Commit B into:
- B1 = shell/system polish
- B2 = Analysis Studio polish

### Phase 5 — push + deploy
After commits:
1. push branch (or main, depending on Nathaniel’s chosen ship posture)
2. observe Vercel autodeploy
3. verify build success
4. run production visual smoke checks

## Recommended Review Order For Nathaniel

If reviewing locally before push, look in this order:

### 1. Reports
- `/reports`
- report detail page
- report generation flow

### 2. Explore / Analysis Studio
- current result
- current vs baseline pairing
- Run Comparison
- Run History
- map-side drawers / project context panel

### 3. App shell consistency
- sidebar
- top header
- content seam
- dashboard / projects / data hub / project detail

### 4. Public/auth surfaces
- homepage
- pricing
- sign-in / sign-up

## Acceptance Gate Before Push

Do not push until these are true:
- merged local tree is lint-clean
- merged local tree is test-clean
- merged local tree is build-clean
- no clearly accidental dev/scaffolding language remains
- no stray conflict markers / dead code / duplicate styles
- Nathaniel has had at least a quick review chance or explicitly waived it

## Vercel / Deploy Plan

Current status:
- nothing from this UI wave has been pushed yet
- therefore no Vercel deploy has been triggered for this wave

Post-push deploy checklist:
1. confirm Git push succeeded
2. watch Vercel build
3. verify auth pages load
4. verify app shell loads
5. verify `/reports` loads and report detail route works
6. verify Explore page loads and Run History / comparison UI render cleanly
7. verify no dark/light contrast regressions on real deployed surface

## Memory / Local Runtime Note

As of this checkpoint:
- Ollama memory search is healthy
- provider = `ollama`
- model = `nomic-embed-text`
- embeddings/vector store ready
- user service is active via systemd

After reboot, first check if needed:
- `systemctl --user status ollama.service`

## Strategic Recommendation

Do **not** continue indefinite UI polishing before returning to module work.

Recommended threshold:
- finish the current comparison-narrative lane,
- integrate/review this wave,
- then return to module development.

After this checkpoint, UI work should become a **companion pass per module**, not a separate endless track.

## Immediate Next Step

**Next operational move:** integrate `openplan-ui-camila` changes into the main repo and run full validation.
