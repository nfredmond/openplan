# Phase C.3 — Reports detail decomposition proof (2026-04-18 evening)

## What landed

`src/app/(app)/reports/[reportId]/page.tsx` dropped from **2548 → 1675 LOC** (−34%) by extracting four colocated section components into `_components/` siblings. Pattern mirrors the Phase C.1 decomposition of `projects/[projectId]/page.tsx`.

| File | LOC |
|---|---|
| `page.tsx` (after) | 1675 |
| `_components/report-packet-review.tsx` | 169 |
| `_components/report-composition-audit.tsx` | 157 |
| `_components/report-provenance-audit.tsx` | 660 |
| `_components/report-navigation-preview.tsx` | 110 |
| `_components/_types.ts` | 101 |
| `_components/_helpers.ts` | 19 |
| **Total after** | **2,891** |

Net LOC rose about 343 lines (component prop boilerplate, shared type/helper extraction, JSX fragments). Matches the expected "total LOC may rise slightly, that's the cost of the cohesion boundaries" note in the approved plan.

## Section boundaries chosen

| # | Component | `<h2>` sections it owns |
|---|---|---|
| 1 | `ReportPacketReview` | Packet release review (basis-stale banner + freshness/grant-modeling/comparison 3-card grid + recommended next action) |
| 2 | `ReportCompositionAudit` | Packet sections + Linked runs + Generated artifacts (left-column composition metadata) |
| 3 | `ReportProvenanceAudit` | Audit trail (run audit, evidence chain, drift since generation, governance/stage-gates, project records provenance, scenario basis) |
| 4 | `ReportNavigationPreview` | Related surfaces + Latest HTML artifact iframe preview |

The page shell (`page.tsx`) retained: `generateMetadata`, the auth check, 20 coercion/parsing helpers (lines 93–368), all Supabase data-loading (for both RTP and non-RTP paths), all cross-section derivations (`driftItems`, `evidenceChainSummary`, `fundingSummaryDigest`, `currentReportPacketFreshness`, `currentReportGrantModelingReadiness`, stage-gate summary, project-records drift), the RTP early-return path (`<RtpReportDetail />`, unchanged), the hero header with project identity + status badges, and `<ReportDetailControls />` + `<WorkspaceCommandBoard />` integrations.

## Why page.tsx landed at 1675, not the plan's 800–1000

Of the 1675 lines: ~50 are imports, ~275 are in-file coercion/parser helpers (20 `as*` functions used by data-loading), ~1090 are the Supabase data-loading chain for both RTP and non-RTP paths (14 distinct queries + cross-section derivations + RTP-specific portfolio funding snapshot assembly), ~70 are the hero header + 4 component invocations + RTP early-return. The data-loading chain is non-decomposable within Phase C.3 scope per the approved plan's rule: *"Don't lift state into the page. Each section already reads what it needs from the loaded report bundle — pass the slice, don't pass the whole thing speculatively."*

The plan's 800–1000 LOC target underestimated how much of the 2548 was data-loading + coercion helpers (about 1365 LOC) vs JSX body (about 1020 LOC). The JSX portion did collapse as planned — from ~1020 LOC to ~70 LOC of component invocations. The remaining bulk is all deferred data-loading per the plan's explicit scope boundary:

> "Page-level data-loading extraction (would be Phase C.3.1, defer)."

## Deviations from the plan (one small one)

1. **Sibling `_helpers.ts` only contains 2 functions, not more.** Plan language expected multiple shared helpers. In practice only `driftTone` (used in one section but natural to keep alongside _types) and `formatCurrency` (used across extracted sections and the hero) moved to `_helpers.ts`. The remaining page-local helpers (`asHtmlContent`, `asRunAudit`, `asRecord`, `asNullableString`, `asNullableNumber`, `asSourceContext`, `asScenarioSetLinks`, `asProjectRecordSnapshotEntry`, `asStageGateSnapshotGateSummary`, `asStageGateSnapshotControlHealth`, `asStageGateSnapshot`, `asPortfolioFundingSnapshot`, `asEngagementCampaignSnapshot`, `parseTimestamp`, `maxTimestamp`, `formatCompactDateTime`, `buildCurrentProjectRecordEntry`, `summarizeProjectRecordDrift`) stayed in page.tsx because they're consumed only by data-loading and drift derivation — not by any extracted section. Moving them would be churn for zero cohesion benefit.

## Verification

```
pnpm tsc --noEmit   → clean
pnpm test --run     → 761 tests pass across 169 files (baseline unchanged)
pnpm build          → green; same route manifest
```

LOC check:
```
wc -l src/app/(app)/reports/[reportId]/page.tsx
  → 1675
wc -l src/app/(app)/reports/[reportId]/_components/*.tsx src/app/(app)/reports/[reportId]/_components/*.ts
  → 1216 total
```

Commit: `3b3f694 refactor(reports): extract 4 section components from reports/[reportId]/page.tsx`.

## What stayed out of scope per the plan

- **RTP path unchanged.** `<RtpReportDetail />` early-return (page.tsx ~line 820) is already a single-component delegation. Plan explicitly excluded it.
- **`@/lib/reports/*` promotion skipped.** Same rationale as C.1: sibling colocation reads better on the first pass. Promote only if a future file needs the same types.
- **No test coverage additions.** The extraction is pure structure; existing tests pass unchanged. Adding "render without crashing" tests would be maintenance weight without value.
- **No behavior change.** No new columns, no new sections, no data-shape changes, no API changes.

## Successor ladder (updated after Phase C.3)

- **Phase C.2** — `explore/page.tsx` decomposition (3814 LOC, worst offender). Higher risk because of map + chat state. Pattern now proven on two surfaces (C.1, C.3).
- **Phase C.4** — `rtp/page.tsx` decomposition (2413 LOC). Portfolio/packet sections are the natural split.
- **Phase C.1.1 (optional)** — extract `projects/[projectId]/page.tsx` data-loader to `./_loaders/project-detail-data.ts`. Defer until the 889 LOC floor actually hurts.
- **Phase C.3.1 (new, optional, post-C.3)** — same move for reports: extract `reports/[reportId]/page.tsx` data-loader if the 1675 LOC floor hurts. Given the data-loading bulk here is larger than C.1's, this may be more valuable than C.1.1 when the time comes. Still defer.
- **Phase O** — Quota asymmetry closure (77 routes). Design-gated on Phase P asks.
- **Phase Q** — 90% plan examples. Design-gated on Nathaniel's agency-example pick.
- **Phase S** — Design-gated unlocks (T16 reader, `rtp_posture` body, `aerial_posture` body).
- **Phase R.1** — Two small Phase-4 drift cleanups (explore gradient block, programs chip clusters). Needs Nathaniel's eye.

## What to re-surface to Nathaniel with this push

The Phase P design asks (quota scope + weight) should stay visible while he decides. Surfaced on the C.1 push; surfacing again here so they don't drop off. Nothing changed about those asks; Phase C.3 was deliberately chosen because it didn't need them.

## Stop point

Per the approved plan: *"C.3 → (push + verify) → STOP. Don't open C.2 or C.4 in the same session — keep decomposition slices independently reviewable. If C.3 goes fast, surface it as a candidate for C.2 or C.4 in the completion doc rather than chaining."* Surfaced above (Phase C.2 and C.4 both remain on the ladder). Not opening in this session.
