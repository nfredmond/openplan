# OpenPlan documentation map

OpenPlan is free, open-source, self-serve planning software. The Next.js app lives in `openplan/`;
this directory holds everything that is not application code. Start here:

## If you want to know what is being built

- **`product/V1_PRODUCT_CONTRACT.md`** — the binding definition of v1: the ultimate free planning
  operating system for all US planning practice, all states, with California as the gold standard.
- **`product/AGENT_OPERATING_RULES.md`** — the tracked shared operating manual used by the slim
  local `AGENTS.md` and `CLAUDE.md` harness shims.
- **`ROADMAP.md`** — the only active development queue derived from that contract.
- `product/US_PLANNING_CAPABILITY_MATRIX.md` — the conservative coverage ledger; only `proven`
  cells pass v1.
- `product/PRODUCT_DIRECTION_REVIEW_PROTOCOL.md` — the recurring fresh-context review and the
  commands that make an expired strategic review fail the release gate.
- `reviews/product-direction/2026-08-25-v1-direction.md` — Nathaniel's decision after comparing
  the independent Claude and Codex reviews.
- `modeling/VALIDATION_OBSERVATION_UNCERTAINTY_RESEARCH_2026-08-25.md` — why a count is not exact
  truth, why that cannot excuse model defects, and the proposed nationwide acceptance design.
- `reviews/OPENPLAN_V1_CODEX_REVIEW_2026-08-25.md` — the independent Codex product and codebase
  review, with a companion interactive HTML report; its original smaller v1 recommendation is
  preserved as comparison evidence and explicitly superseded by the product contract.
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
- `archive/plans/` — superseded plans retained as dated historical evidence.

## What is deliberately NOT here

The 2026 commercial-era documentation (sales packets, buyer proofs, supervised-pilot memos,
billing/pricing records) was deleted on 2026-07-27 by explicit decision: OpenPlan is free and open
source, and the working tree describes only that product. Git history preserves every deleted
document. Dated technical records that survive were accurate when written — read them with their
dates in mind, and never rewrite one to say something it did not say.
