# OpenPlan V1 Provisioning Hardening — 2026-03-16

## Scope
Hardening pass on the two most foundational provisioning routes:
- `POST /api/workspaces/bootstrap`
- `POST /api/projects`

## Why this mattered
These routes sit directly on the v1 trust path:
- new authenticated users need deterministic workspace bootstrap
- project creation needs deterministic workspace + owner scaffolding
- partial failures should not leave orphaned workspace records behind

That is not decorative QA. It is launch-safety work.

## What changed
### 1. Restored regression coverage for service-role provisioning paths
Updated route tests so they correctly model the current service-role client behavior used by both provisioning flows.

### 2. Added cleanup on partial provisioning failure
Both routes now explicitly clean up provisioned artifacts when a downstream step fails:
- workspace bootstrap now deletes the partially created workspace if owner-membership creation fails
- project creation now deletes provisioned workspace artifacts if either:
  - owner-membership creation fails, or
  - project-record creation fails after workspace creation

### 3. Added regression tests for cleanup behavior
New tests assert that cleanup executes when provisioning fails after the initial workspace record is created.

## Validation
Ran successfully in `openplan/openplan`:
- `pnpm test`
- `pnpm lint`
- `pnpm build`

Current result:
- 50 test files passed
- 222 tests passed

## V1 relevance
This closes a real reliability/support gap in the onboarding spine and improves pilot-readiness honesty. A failed bootstrap or failed project-create flow is now less likely to leave the database in an ambiguous partially provisioned state.

## Suggested next move
Continue with the next trust-critical lane:
1. authenticated interior production smoke on real records, or
2. billing/commercial evidence refresh, or
3. another reliability pass on save/update failure states across Plans / Programs / Models.
