# RTP export modeling claim-gating proof

**Shipped:** 2026-04-24 Pacific
**Scope:** Make generated RTP packet artifacts carry structured assignment-model claim posture whenever the workspace has county-run modeling evidence.

## What shipped

`POST /api/reports/[reportId]/generate` now loads recent workspace county runs for RTP-cycle packet generation, reads assignment evidence through the shared modeling evidence backbone, and passes that evidence into the RTP export HTML builder.

The RTP packet export now renders an `Assignment modeling claim posture` section when evidence exists. The section includes:

- claim status (`claim_grade_passed`, `screening_grade`, or `prototype_only`) as report-safe language,
- the claim decision reason and first caveats,
- source-manifest count and labels,
- validation summary counts,
- validation-check details.

The artifact metadata also records a compact `sourceContext.modelingEvidence` summary with the county run id, geography/run labels, claim status, report language, source-manifest count, validation-result count, and validation summary. This gives customer-facing packet exports and internal artifact records the same provenance posture.

## Safety posture

- Evidence lookup is additive; failure to read optional county-run/evidence records logs an audit warning and does not block packet generation.
- Missing evidence schema remains tolerated through the existing optional-query posture.
- Without a structured claim decision, the export labels the run as prototype-only and refuses outward planning-claim language.
- No report text is rewritten. The packet adds a visible evidence/caveat section beside chapter markdown so generated artifacts cannot rely on prose-only caveats.

## Files shipped

Modified:

- `openplan/src/app/api/reports/[reportId]/generate/route.ts`
- `openplan/src/lib/rtp/export.ts`
- `openplan/src/test/report-generate-route.test.ts`
- `openplan/src/test/rtp-export.test.ts`

## Gates

- `pnpm test src/test/rtp-export.test.ts src/test/report-generate-route.test.ts`: 2 files / 14 tests passing.
- `pnpm exec tsc --noEmit`: clean.
- `pnpm qa:gate`: clean.
  - Lint: clean.
  - `pnpm test`: 207 files / 1056 tests passing.
  - `pnpm audit --prod --audit-level=moderate`: 0 known vulnerabilities.
  - `pnpm build`: production build clean.

## Deferred

Project-status packet reports still use the older linked-run evidence-chain surface. The next modeling-evidence hardening slice should connect model-backed project reports to explicit county-run/model-run evidence where those reports make assignment-model claims.
