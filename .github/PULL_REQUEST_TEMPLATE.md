## What this changes

## Why

## Verification

- [ ] `npm run qa:gate` passes from `openplan/` (lint + tests + audit + build)
- [ ] Python worker changes: run the relevant suite in its configured worker environment; use `npm run test:workers` from `openplan/` for the declared worker matrix
- [ ] Consequential changed behavior has meaningful checks; changed guards have a surviving harmless mutation and a targeted failure

## Constraint check (see CONTRIBUTING.md — "Product constraints")

- [ ] Nothing hardcoded: no place, agency, FIPS, bbox, or jurisdiction literal in core code —
      anything that varies between users is configuration, data, or a registry descriptor
- [ ] Works for anyone in the US; geographic/data limits are disclosed, never silent
- [ ] No plan/tier/quota/payment gating of any kind — OpenPlan is free
- [ ] Migrations are additive; nothing DROPs a table or column a hosted deployment may hold
