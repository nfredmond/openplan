# Sprint 1 Progress — KPI Instrumentation (2026-02-25)

## Scope
Advanced P1 pilot metrics instrumentation with workspace-level KPI visibility in app.

## Changes shipped

1. **Run telemetry schema extension**
   - Added migration:
     - `supabase/migrations/20260226000005_runs_report_telemetry.sql`
   - New fields on `runs`:
     - `report_generated_count`
     - `first_report_generated_at`
     - `last_report_generated_at`

2. **Report generation now updates telemetry**
   - Updated `src/app/api/report/route.ts` to increment report generation counters after successful run fetch and before response return.
   - Telemetry update failures are logged as warnings and do not block report delivery.

3. **Workspace KPI computation utility**
   - Added `src/lib/metrics/workspace-kpis.ts` to standardize KPI math:
     - run completion rate
     - report generation rate
     - time to first result

4. **Dashboard KPI cards**
   - Updated `src/app/(workspace)/dashboard/page.tsx` with KPI cards and additional workspace metadata context.

## KPI definitions (current)
- **Run completion rate** = runs with both `metrics` and `summary_text` / total runs.
- **Report generation rate** = runs with `report_generated_count > 0` / total runs.
- **Time to first result** = first run timestamp minus workspace creation timestamp.

## Notes
- This is a practical telemetry baseline for pilot operations and weekly reviews.
- Future refinement can split HTML vs PDF export rates and add user-level event funnels.
