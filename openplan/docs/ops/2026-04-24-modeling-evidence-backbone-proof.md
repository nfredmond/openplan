# Modeling evidence backbone proof

**Shipped:** 2026-04-24 Pacific
**Scope:** First implementation slice from the public-data modeling OS plan. Adds the shared evidence contract that assignment, behavioral-demand, and multimodal-accessibility work can rely on before OpenPlan makes outward planning claims.

## What shipped

OpenPlan now has a durable evidence backbone for modeling outputs:

1. **Source manifests** — `modeling_source_manifests` records public input sources, vintages, citations, geography, license notes, checksums, and structured metadata for a model run or county run.
2. **Validation results** — `modeling_validation_results` stores machine-readable validation checks by track and metric, including observed values, thresholds, pass/warn/fail status, and whether the check blocks claim-grade language.
3. **Claim decisions** — `modeling_claim_decisions` stores the canonical per-run decision: `claim_grade_passed`, `screening_grade`, or `prototype_only`.

The first writer is the county-run manifest callback. After the existing manifest, artifact, and behavioral KPI persistence succeeds, `/api/county-runs/[countyRunId]/manifest` builds assignment evidence from the manifest and writes:

- Census TIGER boundary source manifest.
- Census ACS zone-attribute source manifest.
- OpenStreetMap roadway-network source manifest.
- Observed count validation source manifest when the manifest includes a count CSV.
- Assignment validation rows for final gap, count-station matches, median APE, critical-facility APE, and optional facility ranking Spearman rho.
- The assignment claim decision.

Evidence persistence is intentionally non-blocking for the callback. If the migration is not yet present in an environment, the route logs `county_run_modeling_evidence_backbone_failed` with `missingSchema: true` and still returns the manifest response.

## Claim-grade posture

The helper in `src/lib/models/evidence-backbone.ts` is conservative:

- `claim_grade_passed` only when every required metric exists and every blocking validation check passes.
- `screening_grade` when validation exists but any blocking warning/failure or screening-gate caveat remains.
- `prototype_only` when required evidence is missing or an upstream prototype reason is present.

For the current NCTC-style manifest, the critical-facility APE of `237.62%` exceeds the `50%` threshold. The bundle therefore downgrades to `screening_grade` even though assignment final gap and matched-station count pass. Report and UI surfaces can now read a structured decision instead of parsing prose.

## Schema posture

Migration `20260424000069_modeling_evidence_backbone.sql` is append-only and idempotent.

- RLS is enabled on all three tables.
- Workspace members can read/write only rows in their workspace.
- `modeling_evidence_target_matches_workspace(...)` is a `SECURITY INVOKER` helper with pinned `search_path`; RLS policies use it to ensure any referenced `model_run_id` or `county_run_id` belongs to the row workspace.
- Source manifests require at least one target run id.
- County-run source manifests and claim decisions are unique by source key / track, with nullable target ids preserving the future model-run path.
- Assignment refresh deletes only assignment validation and claim rows before writing replacements; it no longer wipes future behavioral-demand or accessibility evidence for the same county run.

## Files shipped

New:

- `openplan/supabase/migrations/20260424000069_modeling_evidence_backbone.sql`
- `openplan/src/lib/models/evidence-backbone.ts`
- `openplan/src/test/modeling-evidence-backbone.test.ts`

Modified:

- `openplan/src/app/api/county-runs/[countyRunId]/manifest/route.ts`
- `openplan/src/test/county-run-manifest-route.test.ts`

## Gates

- `pnpm test src/test/modeling-evidence-backbone.test.ts src/test/county-run-manifest-route.test.ts`: 2 files / 10 tests passing.
- `pnpm exec tsc --noEmit`: clean.
- `pnpm qa:gate`: clean.
  - Lint: clean.
  - `pnpm test`: 207 files / 1050 tests passing.
  - `pnpm audit --prod --audit-level=moderate`: 0 known vulnerabilities.
  - `pnpm build`: production build clean.

## Production posture

No production migration has been applied in this slice. The migration is ready for the next approved database push, but this commit only lands the schema, writer, helper, and tests in source control.

## Next

The next modeling-OS slice should be a reader surface for these decisions: load the county-run assignment claim decision and source/validation rows on the county-run detail page, then make the report/export path consume `modelingClaimReportLanguage(...)` before it emits outward modeling language. After that, the same backbone can accept behavioral-demand and multimodal-accessibility validation rows without adding new claim-grade semantics.
