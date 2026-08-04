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

## Product constraints (the non-negotiables)

These are binding for every change, and the pull-request template's constraint
checklist points here. A change that conflicts with one of these needs the
conflict named in the PR description, not worked around.

1. **Nothing is hardcoded.** No place, jurisdiction, agency, organization, or
   person may be baked into code as a constant — no county names, FIPS codes,
   bounding boxes, agency names, or brand strings. Anything that varies between
   users is configuration, data, or a registry descriptor. The test: could a
   planner in a different place, with different data, use this without a code
   change? Jurisdiction-specific behavior (a state's crash feed, a state's
   grant programs, CEQA) lives behind an adapter or registry, never in a core
   type.
2. **It works for anyone in the United States, or says plainly that it
   doesn't.** No feature ships fitted to one county or one agency. Where a data
   source genuinely cannot cover an area, the UI states the limit and the
   reason — an empty result must never present as "nothing found here", and a
   failed read must never present as an absence.
3. **OpenPlan is free and open source.** No plans, tiers, usage quotas, paid
   gating, or payment steps, ever (`src/test/no-paid-tier-guard.test.ts`
   enforces this).
4. **Self-service is the bar.** Any agency must be able to sign up and use a
   feature fully on their own. A change that requires operator setup or a
   manual founder step is a defect to design out.
5. **Deepen existing modules; do not add new ones.** Extending an existing
   module is almost always right; proposing a new one is almost always wrong.
6. **Migrations are additive.** Never `DROP` a table or column a hosted
   deployment may hold data in; destructive statements fail the build unless
   allowlisted with a documented backfill
   (`src/test/migrations/no-destructive-migration.test.ts`).
7. **A new guard test must be proven non-vacuous.** Revert the code it guards,
   run it, confirm it fails for the right reason, restore — and say so in the
   PR. A test that stays green when its subject is broken is worse than no
   test.

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
