# OpenPlan documentation map

OpenPlan is free, open-source, self-serve planning software. The Next.js app lives in `openplan/`;
this directory holds everything that is not application code. Start here:

## If you want to know what is being built

- **`ROADMAP.md`** — the only active development queue, and the definition of v1.0. Rewritten
  2026-08-25 from a full-repository review.
- `ops/KNOWN_ISSUES.md` — the active quality register: what OpenPlan does not claim, and why.
- `../CHANGELOG.md` — what shipped, in operator language, leading with required migrations.

## If you want to run OpenPlan

- **`../openplan/docs/SELF_HOSTING.md`** — the deployment guide: local development and
  self-hosting on Vercel + Supabase (or any compatible host).
- `../openplan/docs/ops/RUNBOOK.md` — operating a deployment: health checks, backups, restore.
- `../workers/aequilibrae_worker/DEPLOY.md` — running the modeling worker.

## If you want to understand or extend the code

- `../CLAUDE.md` — binding product constraints and engineering conventions (read first).
- `../CONTRIBUTING.md` — how to file issues and open pull requests.
- `ADRs/` — architecture decision records (modeling stack, crash-data acquisition, the MCP server
  surface and its refusals).
- `ops/README.md` — index of the technical records in `ops/`: modeling specs and validation
  evidence, county-onramp contracts, LAPM/stage-gate provenance, and current-era shipped
  handoffs.
- `ops/KNOWN_ISSUES.md` — the active quality register.

## What is deliberately NOT here

The 2026 commercial-era documentation (sales packets, buyer proofs, supervised-pilot memos,
billing/pricing records) was deleted on 2026-07-27 by explicit decision: OpenPlan is free and open
source, and the working tree describes only that product. Git history preserves every deleted
document. Dated technical records that survive were accurate when written — read them with their
dates in mind, and never rewrite one to say something it did not say.
