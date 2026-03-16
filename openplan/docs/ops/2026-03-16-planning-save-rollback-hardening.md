# 2026-03-16 — Planning save rollback hardening

## What shipped
- Added shared link-replacement rollback utilities for record-detail PATCH routes.
- Reordered Plan, Program, and Model save flows so linked-record replacement happens before the trailing metadata write.
- Added rollback behavior so if the metadata write fails after links were replaced, the prior link set is restored automatically.
- Tightened operator-facing error copy to distinguish:
  - could not load current links,
  - could not refresh links,
  - could not save links but previous links were restored,
  - could not finish metadata update after link changes.

## Why it matters
This closes a trust gap in the core planner save path. Before this pass, a Plan / Program / Model update could partially apply: linked records might change, then the metadata write could fail, leaving the operator with an error and an ambiguous record state. The new flow makes that failure mode deterministic and supportable.

## Scope
- `src/lib/api/link-replacement.ts`
- `src/app/api/plans/[planId]/route.ts`
- `src/app/api/programs/[programId]/route.ts`
- `src/app/api/models/[modelId]/route.ts`
- route tests covering rollback behavior for all three detail endpoints

## Validation
- `pnpm test src/test/plan-detail-route.test.ts src/test/program-detail-route.test.ts src/test/model-detail-route.test.ts`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

All green locally.
