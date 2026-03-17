# OpenPlan V1 Slice — Report Engagement Traceability Backlink

**Date:** 2026-03-17  
**Status:** shipped locally, then promoted and production-proven on `openplan-zeta.vercel.app`  
**Chosen lane:** planning/report orchestration follow-through

## What shipped

- Report detail now reads the configured engagement source from `report_sections.config_json` when an `engagement_summary` section is present.
- Report detail surfaces the linked engagement campaign directly in the provenance area, including status and handoff counts when artifact metadata exists.
- Report detail navigation now includes a direct `Open engagement campaign` link so operators can move from packet review back to the originating engagement lane without manual record hunting.
- Added focused helper coverage for engagement-section extraction and summary construction.

## Why it matters

The first handoff slice proved campaign → report generation. This follow-on slice makes the handoff operationally reversible by keeping the source campaign visible from the report detail surface itself, improving traceability and reducing operator guesswork during review.

## Validation

Local validation before promotion:
- `pnpm test`
- `pnpm lint`
- `pnpm build`

Production validation after alias refresh:
- live production smoke recorded at `docs/ops/2026-03-17-openplan-production-report-traceability-smoke.md`
- public alias updated to current deployment before re-smoke
- production proof confirms:
  - report detail renders the engagement source provenance card,
  - report detail renders `Open engagement campaign`, and
  - the backlink returns to the originating engagement detail surface on production.
