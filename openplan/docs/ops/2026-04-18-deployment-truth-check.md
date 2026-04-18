---
title: 2026-04-18 deployment truth check
date: 2026-04-18
phase: Phase D (forward-motion plan)
---

# 2026-04-18 Vercel deployment truth check

## Verdict

**Vercel production matches `origin/main`.** No drift.

Four local commits from today's Phase B+C work are unpushed —
`0b5f9c7`, `65a082b`, `53a8bff`, `6b9dd23` — but that is pending
push queue, not drift. The last-pushed commit (`fb4c5cb`) is what
Vercel is serving.

## Evidence

**Vercel production deployment** (inspected via `vercel api /v13/deployments/dpl_4Dqzd5zKnRRYsuWmbvGjcwMaTEDL`):

- Deployment id: `dpl_4Dqzd5zKnRRYsuWmbvGjcwMaTEDL`
- URL: `openplan-fpdwfc90t-natford.vercel.app`
- Created: Sat Apr 18 2026 01:59:36 PDT (~2h before this check)
- Status: `READY` / `PROMOTED`
- Git ref: `main`
- Git SHA: `fb4c5cbff2203ecf70f9c2334ddde17af516c2ce`
- Commit subject: "docs: 2026-04-18 retrospective update — 4 deferred items closed"

**Local repo state at check time:**

- `git rev-parse origin/main` → `fb4c5cbff2203ecf70f9c2334ddde17af516c2ce`
- `git rev-parse main` → `6b9dd236ed249b830a10725fe41c6c128a71fe78`
- `git log origin/main..HEAD` → 4 commits (all from today, Phase B+C)

`origin/main` SHA matches Vercel's `gitSource.sha` exactly. The
local `main` is 4 commits ahead because Phase C's work has not yet
been pushed.

## Alias map

Three aliases for the current production deployment, all returning
HTTP 200 with matching `x-matched-path: /`:

| Alias | Status |
|---|---|
| `openplan-zeta.vercel.app` | HTTP 200 — shared alias |
| `openplan-natford.vercel.app` | HTTP 200 — canonical natford alias |
| `openplan-git-main-natford.vercel.app` | HTTP 200 — branch-tracking alias |

**Correction to the 2026-04-18 forward-motion plan:** the plan
listed `openplan-git-master-natford.vercel.app` as one of the
aliases to verify. That alias does not exist; the default branch
was renamed `master → main` in this repo, so the branch-tracking
alias is `openplan-git-main-natford.vercel.app`. Plan memory was
stale.

## /dashboard behavior

Not probed here — the `/dashboard` route is auth-guarded and the
truth check is read-only. The 2026-03-16 auth/proxy closure work
landed long before the 2026-03-23 stack lock; no current regression
signal.

## Implications for today's unpushed work

The four unpushed Phase B+C commits are safe to push when the user
authorizes:

1. `0b5f9c7` docs — Phase 4 UI/UX review (no runtime change)
2. `65a082b` ci — adds `.github/workflows/ci.yml` (will fire on the
   next push)
3. `53a8bff` feat(ui) — Form primitive + first consumer
   (engagement-category-creator)
4. `6b9dd23` refactor(projects) — stage-gate extraction

None of these modify database schema, RLS, Supabase Edge Functions,
or Vercel env vars, so a push will trigger a clean production
rebuild against main without config drift.

## Pointers

- Forward-motion plan: `.claude/plans/eager-munching-spark.md`
  (local, not checked in)
- Prior deployment evidence:
  `docs/ops/2026-04-17-program-retrospective.md`
- Vercel CLI binding: `.vercel/project.json`
  (`prj_NKckTxKCBtO25Tf6a92hPLkuqzYT`, team `natford`)
