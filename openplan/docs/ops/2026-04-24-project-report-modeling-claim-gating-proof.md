# Project report modeling claim-gating proof

**Shipped:** 2026-04-24 Pacific
**Scope:** Extend structured modeling evidence and claim posture from RTP packet exports to project-status report artifacts.

## What shipped

Project report generation now loads recent workspace county-run assignment evidence through the shared modeling evidence backbone. The generated project report HTML includes a `Modeling evidence and claim posture` section when evidence exists.

That section records:

- claim posture and report-safe language,
- the claim decision reason and leading caveats,
- source-manifest count and labels,
- validation summary counts,
- validation-check details.

The route also persists the same posture into `report_artifacts.metadata_json.sourceContext` as `modelingEvidence`, `modelingEvidenceCount`, and `modelingEvidenceClaimStatuses`.

`EvidenceChainSummary` now carries optional modeling-evidence fields so report detail surfaces can summarize whether a generated artifact has explicit model-claim support. Historical artifacts remain compatible because the new fields are optional.

## Shared helper

`src/lib/reports/modeling-evidence.ts` now owns the report-facing modeling evidence reference type, claim-status label formatting, validation-status label formatting, and compact artifact metadata summarizer. RTP exports and project reports use the same helper so claim language stays aligned.

## Safety posture

- Evidence lookup is additive; county-run/evidence lookup failures log audit warnings and do not block report generation.
- Missing claim decisions render as prototype-only in report HTML.
- Historical `EvidenceChainSummary` metadata remains readable because the modeling fields are optional.
- No report prose is rewritten. The generated artifact adds a structured evidence section next to existing project records, linked runs, scenario basis, and stage-gate provenance.

## Files shipped

Modified:

- `openplan/src/app/api/reports/[reportId]/generate/route.ts`
- `openplan/src/lib/reports/catalog.ts`
- `openplan/src/lib/reports/evidence-chain.ts`
- `openplan/src/lib/reports/html.ts`
- `openplan/src/lib/rtp/export.ts`
- `openplan/src/test/report-catalog.test.ts`
- `openplan/src/test/report-generate-route.test.ts`

Added:

- `openplan/src/lib/reports/modeling-evidence.ts`

## Gates

- `pnpm test src/test/report-generate-route.test.ts src/test/rtp-export.test.ts src/test/report-catalog.test.ts`: 3 files / 31 tests passing.
- `pnpm exec tsc --noEmit`: clean.
- `pnpm qa:gate`: clean.
  - Lint: clean.
  - `pnpm test`: 207 files / 1058 tests passing.
  - `pnpm audit --prod --audit-level=moderate`: 0 known vulnerabilities.
  - `pnpm build`: production build clean.

## Deferred

The project report still attaches evidence by recent workspace county runs. A future precision slice can add explicit project/report-to-county-run linkage when OpenPlan supports multiple simultaneous county runs per workspace in production use.
