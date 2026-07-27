# Contributing to OpenPlan

OpenPlan welcomes contributions that improve transparent, practical planning software for public agencies, tribes, RTPAs/MPOs, counties, and consulting teams.

## Positioning rule

Keep the project open-source first. Do not introduce copy or product behavior that frames OpenPlan as a proprietary, subscription-first software. OpenPlan itself is free and open source, with no paid tier and no payment step.

## Before opening a change

1. Work from the relevant app directory: `openplan/`.
2. Keep public claims evidence-bound and planner-facing.
3. Do not reintroduce plans, tiers, usage quotas, paid gating, or Stripe. OpenPlan is free; `src/test/no-paid-tier-guard.test.ts` enforces this.
4. Avoid committing secrets, client confidential material, private datasets, or third-party media without explicit rights.
5. Run the smallest meaningful validation gate for your change.

Common gates:

```bash
cd openplan
npm run lint
npm test
npm run build
```

For focused changes, run the matching Vitest files first, then expand if feasible.

## Public copy standard

Good OpenPlan copy is plain, grounded, and accountable:

- say `free and open source` — OpenPlan has no paid tier, no managed-service lane, and no
  commercial offering to describe;
- say `screening-grade` when evidence is screening-grade;
- say `human-reviewed` when professional judgment is required;
- avoid black-box claims, unsupported forecasting promises, or vague AI productivity language.

## Issues and pull requests

- File bugs and feature requests as GitHub issues on this repository. Include reproduction steps
  and your environment (local dev vs. self-hosted) where relevant.
- Branch from `main`, keep changes focused, and open a pull request against `main`.
- Before requesting review, run the full gate from `openplan/`: `npm run qa:gate` (lint + tests +
  dependency audit + build). Python worker changes also run the matching
  `workers/**/test_*.py` scripts directly (there is no pytest in this repo).
- Migrations are additive: never `DROP` a table or column that a hosted deployment may hold data
  in.

## Security and disclosure

Report vulnerabilities through `SECURITY.md`. Do not open public issues with exploitable details, credentials, or private tenant data.
