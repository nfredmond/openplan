# Command Center action activity lane (2026-04-20)

## What changed

`/command-center` now includes the recent audited assistant action lane that first landed in Admin. The page reads the current workspace's latest `assistant_action_executions` rows and renders them in the operator-facing command surface, so packet generation, funding decisions, and project-record actions are visible where daily operators already triage work.

## Files

- `src/lib/operations/action-activity.ts` — shared workspace-scoped loader for recent action executions.
- `src/components/operations/recent-action-activity.tsx` — shared renderer for populated, empty, and read-warning states.
- `src/app/(app)/admin/operations/page.tsx` — now reuses the shared loader and renderer.
- `src/app/(app)/command-center/page.tsx` — renders the action lane below the command board.
- `src/test/command-center-page.test.tsx` — covers the Command Center action lane and the workspace-scoped query shape.

## Acceptance

1. Command Center remains the daily operator surface; Admin remains the troubleshooting watchboard.
2. Both pages use the same loader and renderer, avoiding drift in labels, empty state, and read-warning behavior.
3. The audit query stays workspace-scoped with `workspace_id = current workspace`, `completed_at DESC`, and `limit(8)`.
4. No new mutation path was added. This is observation-only visibility over the existing action audit table.

## Verification

- `pnpm exec vitest run src/test/admin-operations-page.test.tsx src/test/command-center-page.test.tsx`
- `pnpm exec tsc --noEmit`
- `pnpm qa:gate`
