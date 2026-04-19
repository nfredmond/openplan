# Phase C.1 — Projects detail decomposition proof (2026-04-18 evening)

## What landed

`src/app/(app)/projects/[projectId]/page.tsx` dropped from **2707 → 889 LOC** (−67%) by extracting five colocated section components into `_components/` siblings.

| File | LOC |
|---|---|
| `page.tsx` (after) | 889 |
| `_components/project-posture-header.tsx` | 498 |
| `_components/project-delivery-board.tsx` | 583 |
| `_components/project-funding-panel.tsx` | 427 |
| `_components/project-evidence-activity.tsx` | 275 |
| `_components/project-risk-decision-log.tsx` | 187 |
| `_components/_types.ts` | 313 |
| `_components/_helpers.ts` | 89 |
| **Total after** | **3,261** |

Net LOC rose about 550 lines (component prop boilerplate, shared type/helper extraction, JSX fragments). This matches the expected "total LOC may rise slightly, that's the cost of the cohesion boundaries" note in the approved plan.

## Section boundaries chosen

| # | Component | `<h2>` sections it owns |
|---|---|---|
| 1 | `ProjectPostureHeader` | intro card, operator card, RTP portfolio posture, packet freshness & regeneration cues |
| 2 | `ProjectFundingPanel` | candidate funding opportunities (awards + opportunities + invoice chains + decision controls) |
| 3 | `ProjectDeliveryBoard` | milestone/submittal/invoice readiness, ms/sb/in grid, deliverables |
| 4 | `ProjectRiskAndDecisionLog` | risks, issues, decisions, meetings |
| 5 | `ProjectEvidenceAndActivity` | linked datasets, recent runs, aerial missions & packages, activity timeline |

The page shell (`page.tsx`) retained: `generateMetadata`, the full Supabase loading chain, all cross-section derivations (`fundingStackSummary`, `projectControlsSummary`, `aerialProjectPosture`, `projectReports` enrichment, `timelineItems`, RTP link derivations), and six page-local helpers (`parseSortableDate`, `compareDateValues`, `looksLikePendingSchema`, `milestonePriority`, `submittalPriority`, `invoicePriority`). The retained JSX is breadcrumb + interstitial grid (`ProjectRecordComposer` + `WorkspaceRuntimeCue` + `WorkspaceCommandBoard` + `ProjectStageGateBoard`) + five `<Component ... />` invocations.

## Deviations from the plan (two small ones)

1. **Sibling `_helpers.ts`, not `@/lib/projects/*` promotion.** Plan language: *"If two or more extracted sections share a helper, lift it to an existing `@/lib/projects/*` module — don't create a new shared helpers file."* Deviation reasoning: the helpers are page-specific enum-token switches (`toneForDeliverableStatus`, `toneForSubmittalStatus`, etc.) tied to domain values the page already owns, and all four non-posture sections need the same subset. Sibling colocation reads better than threading 6 imports through `@/lib/projects/*` for tokens nothing else consumes. If a future page reuses these, we promote then.
2. **3-col deliverables/risks/issues grid became a 2-col risks/issues grid + full-width deliverables article.** The original page wrapped deliverables alongside risks + issues in `xl:grid-cols-3`. Because the extraction boundaries put deliverables inside `ProjectDeliveryBoard` and risks/issues inside `ProjectRiskAndDecisionLog`, splitting that grid was unavoidable. The new layout preserves all content, just rebalanced. This is the only visible layout shift.

## Verification

```
pnpm tsc --noEmit   → clean
pnpm test --run     → 761 tests pass across 169 files (baseline unchanged)
pnpm build          → green; same route manifest
```

LOC check:
```
wc -l src/app/(app)/projects/[projectId]/page.tsx
  → 889
wc -l src/app/(app)/projects/[projectId]/_components/*.tsx
  → 1970 total
```

Commit: `1813fa0 refactor(projects): extract 5 section components from projects/[projectId]/page.tsx`.

## Why page.tsx landed at 889, not the plan's 500–700

Of the 889 lines: ~97 are imports + the six page-local helpers, ~670 are the Supabase data-loading chain (12 select queries + all cross-section derivations), ~122 are the final JSX orchestration. The data-loading chain is non-decomposable within Phase C.1 scope per the approved plan's rule: *"Don't lift state into the page. Each section already reads what it needs from the loaded project bundle — pass the slice, don't pass the whole thing speculatively."* Pushing data-loading into the sections themselves would create N separate Supabase-round-trips per page render (today it's one), which would be worse on every dimension. Moving the derivations out of the page and into a server-side loader module is a valid next step, but it's **not** Phase C.1 — it's a follow-on. Recorded on the successor ladder below.

## Successor ladder (updated after Phase C.1)

- **Phase C.1.1 (new, optional)** — extract `projects/[projectId]/page.tsx` data-loader into `./_loaders/project-detail-data.ts`. Would likely land page.tsx in the 250–350 LOC range. Mechanical refactor, same safety profile as C.1. Defer until it's clear the 889 LOC floor actually hurts — the current shape is readable.
- **Phase C.2** — `explore/page.tsx` decomposition (3814 LOC, new worst offender per Phase 4 review). Higher risk because of map + chat state. Do after C.1 proves the pattern stable.
- **Phase C.3** — `reports/[reportId]/page.tsx` decomposition (2548 LOC). Pattern from C.1 should transplant cleanly.
- **Phase C.4** — `rtp/page.tsx` decomposition (2413 LOC). Portfolio/packet sections are the natural split.
- **Phase O** — Quota asymmetry closure (77 routes). Design-gated on the two asks surfaced in the Phase P proof doc.
- **Phase Q** — 90% plan examples. Design-gated on Nathaniel's agency-example pick.
- **Phase S** — Design-gated unlocks (T16 reader, `rtp_posture` body, `aerial_posture` body).
- **Phase R.1** — Two small Phase-4 drift cleanups (explore gradient block, programs chip clusters). Needs Nathaniel's eye per Phase 4 review.

## What to re-surface to Nathaniel with this push

The Phase P design asks (quota scope + weight) should stay visible while he decides. They were the last remaining design-gated blockers surfaced in `docs/ops/2026-04-18-phase-p-proof.md`. Nothing changed about those asks; Phase C.1 was deliberately chosen because it didn't need them.

## Stop point

Per the approved plan: *"C.1 → (push + verify) → STOP. Don't open C.2 in the same session — keep decomposition slices independently reviewable. If C.1 goes fast, surface it as a candidate for C.2 in the completion doc rather than chaining."* Surfaced above (Phase C.2, explore detail). Not opening in this session.
