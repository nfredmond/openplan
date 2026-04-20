# Pilot handoff action surface (2026-04-20)

## What shipped

Connected the report-detail pilot workflow handoff to the existing audited action runtime:

1. The packet-assembly row still links to the current report.
2. When a concrete `reportId` is available, the row now also offers a `Generate packet` action.
3. That action dispatches the existing `generate_report_artifact` `ActionRecord`, refreshes the page on completion, and relies on `/api/reports/[reportId]/generate` to write the existing `assistant_action_executions` audit row.

## Why this slice

The prior slice made the pilot spine visible across dashboard, project detail, and report detail. This slice makes the first handoff step operational without adding a second workflow engine or bypassing the assistant action registry.

The change is intentionally limited to the report packet step because it already has:

- a concrete record id,
- a safe `ActionRecord`,
- existing API-side audit persistence,
- existing generation quota/body-limit/security hardening.

## Changes

- `src/components/operations/pilot-workflow-action-button.tsx` adds a small client action control backed by `executeAction`.
- `src/components/operations/pilot-workflow-handoff.tsx` attaches the packet action only when `reportId` is present.
- `src/test/pilot-workflow-action-button.test.tsx` verifies success and failure behavior.
- `src/test/report-detail-page.test.tsx` verifies the report handoff exposes the packet action.

## Gates

Targeted checks:

```bash
pnpm exec vitest run src/test/pilot-workflow-action-button.test.tsx src/test/dashboard-page.test.tsx src/test/project-detail-page.test.tsx src/test/report-detail-page.test.tsx
# exit 0; 4 files / 10 tests
```

Type check:

```bash
pnpm exec tsc --noEmit
# exit 0
```

Full gate:

```bash
pnpm qa:gate
# exit 0; lint + 179 files / 839 tests + audit (0 vulnerabilities) + build
```

Residual known warning:

- `src/test/report-detail-page.test.tsx` still emits React's existing `Received NaN for the children attribute` warning during the rich report-detail fixture. It does not fail the test and was not introduced by this slice.

## Next development step

Persist an operator-facing action activity lane on `/admin/operations` or `/command-center` using `assistant_action_executions`, so the action that is now reachable from the workflow spine becomes visible in the operational watch surface after it runs.

## Not this slice

- No new database tables or migrations.
- No new action kind.
- No approval modal changes.
- No action buttons for project, engagement, analysis, or readiness steps.
