# OpenPlan Responsive Layout Audit Summary — 2026-04-05

## Executive Summary

A production Playwright audit was run against the main authenticated OpenPlan surfaces to detect **real bounding-box overlap** between visible card/section containers.

The first responsive mobile pass exposed a real county-detail bug: at `390px`, `county-runs/[countyRunId]` was horizontally overflowing because card/section surfaces were inheriting a too-wide min-content width. That was fixed by making shared cards/section surfaces explicitly shrinkable on narrow layouts.

Final result after the fix: **no meaningful container overlaps or horizontal overflow detected** across the audited pages at the following viewport widths:

- desktop: `1440×1600`
- tablet-ish: `1024×1500`
- narrow tablet: `768×1400`
- mobile: `390×1200`

## Pages audited

- Projects list
- Models list
- Model detail
- Plan detail
- Program detail
- County runs list
- County run detail
- Billing

## Interpretation

This does **not** prove the UI is perfect.
It does mean the current complaint is unlikely to be a broad literal “cards are overlapping each other” bug on the core authenticated surfaces after the current fix set.

More likely explanations now are:

1. a **specific page not included** in the audit,
2. a **different visual issue** (crowding, excessive density, awkward stacking, clipped content, sticky headers, etc.), or
3. a **state-specific case** not reproduced by the QA seed data.

## Raw reports

- `docs/ops/2026-04-05-openplan-production-layout-overlap-audit.md`
- `docs/ops/2026-04-05-w1024-openplan-production-layout-overlap-audit.md`
- `docs/ops/2026-04-05-w768-openplan-production-layout-overlap-audit.md`
- `docs/ops/2026-04-05-w390-openplan-production-layout-overlap-audit.md`

## Raw screenshots

See `docs/ops/2026-04-05-test-output/` for the viewport-tagged screenshots:

- `2026-04-05-layout-audit-*`
- `2026-04-05-w1024-layout-audit-*`
- `2026-04-05-w768-layout-audit-*`
- `2026-04-05-w390-layout-audit-*`

## Fix note

- Narrow-layout hardening shipped in `6e1bece` — `fix: prevent card overflow on narrow layouts`
- Final mobile confirmation was run against the direct Nat Ford deployment URL to avoid alias churn during verification.

## Next recommended lane

If Nathaniel still sees “overlapped cards,” the fastest way to isolate it is:

- identify the **exact page/route**, and
- capture either a screenshot or the approximate viewport/window width.

That will let the next pass target the specific visual defect instead of treating the whole product as generally overlapping.
