# Report composer modeling evidence picker proof

**Shipped:** 2026-04-24 Pacific
**Scope:** Give operators an explicit UI control for binding new project report packets to county-run assignment evidence.

## What shipped

The reports page now loads recent workspace county runs and their assignment claim decisions, then passes compact modeling evidence options into the report composer.

The report composer now includes a `Modeling evidence` selector:

- defaults to the latest county run in the selected project workspace with a structured assignment claim decision,
- shows the claim posture next to each selectable run,
- renders the selected run's geography, stage, status reason, and validation summary,
- keeps an explicit `Do not attach modeling evidence` option for reports that should not make assignment-model claims,
- submits `modelingCountyRunId` to `POST /api/reports` only when the operator leaves a run selected.

Project changes remain workspace-scoped: if the selected project changes and the previous county run does not belong to that workspace, the composer reselects the best available claim-backed run or clears the evidence link.

## Safety posture

- No schema change in this slice; it consumes the `reports.modeling_county_run_id` path shipped in the prior slice.
- The UI never invents claim posture. It only displays `modeling_claim_decisions` rows for the assignment track.
- Leaving the selector empty preserves historical report creation behavior.
- The API route remains the authority for validating that the selected county run belongs to the target workspace.

## Files shipped

Modified:

- `openplan/src/app/(app)/reports/page.tsx`
- `openplan/src/components/reports/report-creator.tsx`
- `openplan/src/test/report-creator.test.tsx`
- `openplan/src/test/reports-page.test.tsx`

## Gates

- `pnpm test src/test/report-creator.test.tsx src/test/reports-page.test.tsx src/test/reports-route.test.ts src/test/report-generate-route.test.ts`: 4 files / 28 tests passing.
- `pnpm exec tsc --noEmit`: clean.
- `pnpm qa:gate`: clean.
  - Lint: clean.
  - `pnpm test`: 208 files / 1066 tests passing.
  - `pnpm audit --prod --audit-level=moderate`: 0 known vulnerabilities.
  - `pnpm build`: production build clean.

## Deferred

The RTP detail quick-create control and registry shortcut buttons still create packets without an evidence picker. They can either inherit a default county-run binding or grow their own compact selector once customers are creating RTP packets from those surfaces often enough to justify the extra control.
