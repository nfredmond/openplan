# Modeling evidence reader proof

**Shipped:** 2026-04-24 Pacific
**Scope:** Read-side follow-through for the modeling evidence backbone. County-run detail now consumes structured assignment evidence instead of leaving operators to infer claim posture from manifest prose.

## What shipped

The county-run detail API now loads assignment evidence from the new backbone tables:

- `modeling_claim_decisions`
- `modeling_validation_results`
- `modeling_source_manifests`

The response includes a `modelingEvidence` block with:

- the structured claim decision,
- report-safe claim language,
- source manifest rows,
- validation rows.

The county-run detail page now renders a dedicated `Modeling evidence` section with:

- claim-grade / screening-grade / prototype-only badge,
- report-safe language,
- decision reasons,
- validation pass/warn/fail counts,
- validation check details,
- public source manifest citations.

## Safety posture

The route is migration-tolerant. If the evidence tables do not exist in an environment yet, `/api/county-runs/[countyRunId]` logs `county_run_modeling_evidence_lookup_failed` with `missingSchema: true`, returns `200`, and sets `modelingEvidence: null`. That keeps the source rollout safe before the database migration is explicitly applied.

Evidence lookup failures do not break the core county-run truth surface. The existing county run, artifact list, worker handoff, runtime summary, and validation summary remain available.

## Files shipped

New:

- `openplan/src/components/county-runs/county-run-modeling-evidence.tsx`

Modified:

- `openplan/src/app/api/county-runs/[countyRunId]/route.ts`
- `openplan/src/lib/api/county-onramp.ts`
- `openplan/src/lib/api/county-onramp-presenters.ts`
- `openplan/src/lib/models/evidence-backbone.ts`
- `openplan/src/components/county-runs/county-run-detail-client.tsx`
- `openplan/src/test/county-run-detail-route.test.ts`
- `openplan/src/test/county-run-detail-client.test.tsx`

## Gates

- `pnpm test src/test/county-run-detail-route.test.ts src/test/county-run-detail-client.test.tsx src/test/modeling-evidence-backbone.test.ts`: 3 files / 15 tests passing.
- `pnpm exec tsc --noEmit`: clean.
- `pnpm qa:gate`: clean.
  - Lint: clean.
  - `pnpm test`: 207 files / 1052 tests passing.
  - `pnpm audit --prod --audit-level=moderate`: 0 known vulnerabilities.
  - `pnpm build`: production build clean.

## Production posture

No production migration was applied. This reader remains inert until `20260424000069_modeling_evidence_backbone.sql` exists in the target database and the county-run manifest callback writes evidence rows.

## Next

Wire generated report/export language to the same claim decision before emitting assignment model claims. The county-run page now shows the right posture; exported artifacts should consume the same source of truth.
