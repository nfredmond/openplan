## What this changes

## Why

## Verification

- [ ] `npm run qa:gate` passes from `openplan/` (lint + tests + audit + build)
- [ ] Python worker changes: the matching `workers/**/test_*.py` scripts pass (`python3 <file>`)
- [ ] New/changed behavior has a test

## Constraint check (see README.md and CONTRIBUTING.md)

- [ ] Nothing hardcoded: no place, agency, FIPS, bbox, or jurisdiction literal in core code —
      anything that varies between users is configuration, data, or a registry descriptor
- [ ] Works for anyone in the US; geographic/data limits are disclosed, never silent
- [ ] No plan/tier/quota/payment gating of any kind — OpenPlan is free
- [ ] Migrations are additive; nothing DROPs a table or column a hosted deployment may hold
