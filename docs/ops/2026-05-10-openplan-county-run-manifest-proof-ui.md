# OpenPlan County-Run Manifest Proof UI Slice

**Date:** 2026-05-10
**Lane:** county-run / rural operator workflow
**Status:** Local worker slice; not pushed

## What changed

The county-run detail surface now includes a **Manifest proof checklist** that keeps the rural operator review bounded and auditable:

- inputs captured from the manifest, including county FIPS, prefix, mode, run directory, and runtime options;
- generated artifact inventory from both the manifest payload and registered artifact rows;
- validation status, including recorded stage, screening gate label, and available APE metrics;
- operator next action based on the current county-run stage;
- caveat boundaries that explicitly prevent autonomous planning, client-ready forecasting, and behavioral-forecast overclaims.

## Proof boundary

This is a UI/helper proof improvement only. It does not add database migrations, production writes, external calls, dependency changes, billing behavior, or new modeling authority.

The checklist is intentionally framed as evidence inventory and operator guidance. A recorded manifest proves file inventory and validation posture only; it does **not** prove validated behavioral forecasting or autonomous planning recommendations.

## Validation target

Focused validation for this slice:

```bash
cd openplan
npm test -- src/test/county-onramp.test.ts src/test/county-run-detail-client.test.tsx
npm run lint
npm run build
```
