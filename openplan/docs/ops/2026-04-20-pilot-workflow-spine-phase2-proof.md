# Pilot workflow spine phase 2 (2026-04-20)

## What shipped

Extended the pilot workflow spine from a dashboard-only orientation aid into a reusable handoff component that appears on the surfaces where a planner actually loses context:

1. Dashboard keeps the five-step pilot path.
2. Project detail now anchors the path on the current project.
3. Report detail now anchors the path on the current report packet, campaign, and project.

## Why this slice

The recent hardening work made the app safer to run. The product still needed a clearer supervised-pilot path so an operator can move one planning story through context, analysis, engagement, packet assembly, and readiness proof without reinterpreting the platform map on every page.

This does not invent a new workflow engine. It makes the existing spine visible at the points where the end-to-end story changes hands.

## Changes

- `PilotWorkflowHandoff` centralizes the five-step pilot path in `src/components/operations/pilot-workflow-handoff.tsx`.
- `DashboardPilotWorkflowSpine` now delegates to the shared handoff component instead of owning a duplicate local step list.
- `projects/[projectId]` renders the handoff after the unified project posture block, with the project context row linked directly to the current project.
- `reports/[reportId]` renders the handoff after the workspace command board, with packet assembly linked to the current report and engagement linked to the report campaign when available.
- Page tests cover the new project/report handoff links and keep dashboard coverage for the shared spine.

## Gates

Targeted checks:

```bash
pnpm exec vitest run src/test/dashboard-page.test.tsx src/test/project-detail-page.test.tsx src/test/report-detail-page.test.tsx
# exit 0; 3 files / 8 tests
```

Type check:

```bash
pnpm exec tsc --noEmit
# exit 0
```

Full gate:

```bash
pnpm qa:gate
# exit 0; lint + 178 files / 837 tests + audit (0 vulnerabilities) + build
```

Residual known warning:

- `src/test/report-detail-page.test.tsx` still emits React's existing `Received NaN for the children attribute` warning during the rich report-detail fixture. It does not fail the test and was not introduced by this slice.

## Next development plan

1. Runtime action backbone: create the canonical `ActionRecord` registry, move the existing seven assistant actions through it, and add server-side `assistant_action_executions` audit rows. This turns today's handoff links into durable, approvable operations.
2. Full command-board lane coverage: add modeling, scenario, engagement, and aerial posture to the workspace command board so the pilot spine has real runtime pressure behind every step.
3. Aerial first-class lane: ship `/aerial`, mission detail, nav placement, and evidence-package write-back to project posture. Field evidence should stop living only inside project detail.
4. Grants OS decomposition and write-back: extract `grants/page.tsx` into domain components, then wire awards and milestones back into project/RTP posture.
5. RTP/modeling freshness closure: unify packet labels and mark RTP packet basis stale when linked model/scenario evidence changes.
6. External-pilot proof pass: run the NCTC demo path through browser smoke, tighten CSP after report-only observation, and add an operator-facing AI cost/watchboard view.

## Not this slice

- No new database tables or migrations.
- No assistant action execution changes.
- No Aerial route or Grants OS decomposition.
- No CSP enforcement or Supabase extension relocation.
