# OpenPlan Vercel Consolidation — 2026-04-05

## Executive Summary

OpenPlan had two separate Vercel projects receiving deployments from the same repo:

1. **Canonical project (keep):** `natford/openplan`
2. **Broken duplicate (remove):** `nat-ford-planning/openplan`

The duplicate project was created later, pointed at the wrong root directory, and produced a non-functional shell deployment even though the canonical project continued to serve the real Next.js app.

## Canonical project

- Scope: `natford`
- Project: `openplan`
- Project id: `prj_NKckTxKCBtO25Tf6a92hPLkuqzYT`
- Root directory: `openplan`
- Framework preset: `Next.js`
- Current production alias: `https://openplan-zeta.vercel.app`
- Current deployment URL at verification time: `https://openplan-oozbaqw9b-natford.vercel.app`
- Verified behavior: real route builds present (`admin`, `billing`, `county-runs/[countyRunId]`, etc.)

## Broken duplicate

- Scope: `nat-ford-planning`
- Project: `openplan`
- Project id: `prj_V8NINcMPpPHu7QuSbwaqzJjTgYRV`
- Root directory: `.`
- Framework preset: `Other`
- Production alias before cleanup: `https://openplan-xi.vercel.app`
- Broken deployment URL at verification time: `https://openplan-ohx9iey3x-nat-ford-planning.vercel.app`
- Observed behavior: build surface showed only `.` with no real Next.js route inventory

## Why the duplicate was unsafe

- Every push could deploy to two different projects with conflicting aliases.
- The duplicate project made debugging misleading because it looked "ready" while serving a broken/non-app deployment.
- Alias confusion (`openplan-zeta`, `openplan-xi`, scope-specific production aliases) obscured which deployment was actually serving OpenPlan.

## Preservation / loss-prevention checks

- GitHub remained the source of truth for all code and features.
- The canonical `natford/openplan` project contained the functioning Next.js deployment.
- Local repo link file `.vercel/project.json` was re-pinned to the canonical project:
  - `projectId`: `prj_NKckTxKCBtO25Tf6a92hPLkuqzYT`
  - `orgId`: `team_NhbhSJLav3R9laaC7I4vEPrO`
- Production smoke evidence was already captured against the canonical lane, including authenticated continuity and county scaffold flow proof.
- Production environment coverage was spot-checked across both projects and no unique feature-critical configuration surfaced on the duplicate lane during this cleanup pass.

## Decision

- **Keep:** `natford/openplan`
- **Remove:** `nat-ford-planning/openplan`
- **Reason:** removal stops future double-deploy drift without losing product features, because the working application, current aliases, and current proof set are all on the canonical Nat Ford project.

## Follow-through completed in this pass

- Local Vercel link repointed to canonical `natford/openplan`
- `openplan-zeta.vercel.app` pointed back to canonical Nat Ford deployment
- Canonical production proof preserved in:
  - `docs/ops/2026-04-05-openplan-production-authenticated-smoke.md`
  - `docs/ops/2026-04-05-openplan-production-county-scaffold-smoke.md`
  - `docs/ops/2026-04-05-openplan-production-qa-cleanup.md`

## Recommended post-cleanup posture

- Use only `natford/openplan` going forward.
- Treat `openplan-zeta.vercel.app` and `openplan-natford.vercel.app` as canonical production aliases.
- If a future team/scope migration is needed, move deliberately with one project only — not parallel duplicate Vercel projects.
