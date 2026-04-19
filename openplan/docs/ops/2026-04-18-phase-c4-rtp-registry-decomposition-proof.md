# Phase C.4 — RTP registry decomposition proof (2026-04-18 evening)

## What landed

`src/app/(app)/rtp/page.tsx` dropped from **2413 → 1240 LOC** (−48.6%) by extracting four colocated section components into `_components/` siblings. Pattern mirrors Phase C.1 (`projects/[projectId]/page.tsx`) and Phase C.3 (`reports/[reportId]/page.tsx`) — now proven on three surfaces.

| File | LOC |
|---|---|
| `page.tsx` (after) | 1240 |
| `_components/rtp-registry-overview.tsx` | 104 |
| `_components/rtp-cycle-registry-table.tsx` | 597 |
| `_components/rtp-registry-advisory-panel.tsx` | 644 |
| `_components/rtp-queue-operations-board.tsx` | 115 |
| `_components/_types.ts` | 164 |
| `_components/_helpers.ts` | 36 |
| **Total after** | **2,900** |

Net LOC rose ~487 lines (prop boilerplate, shared type/helper extraction). Same accounting shape as C.1 and C.3.

## Section boundaries chosen

| # | Component | JSX it owns |
|---|---|---|
| 1 | `RtpRegistryOverview` | `<header className="module-header-grid">` — intro card + 6-card summary grid + "Make the RTP update a first-class operating object" operator card |
| 2 | `RtpCycleRegistryTable` | `<section>` — cycle status filter, recent-queue/queue-action/queue-trace-state filters, 8 metric cards, scrollable cycle rows with packet/funding/queue metadata |
| 3 | `RtpRegistryAdvisoryPanel` | Sidebar articles — recommended next action, unrecorded queue traces, outpaced queue traces, recent queue activity |
| 4 | `RtpQueueOperationsBoard` | Packet queue command board + bulk action modals + `<RtpCycleCreator />` + "What comes next" navigation article |

The page shell (`page.tsx`) retained: auth + `WorkspaceMembershipRequired` early-return, all Supabase data-loading (lines ~580–1130), all in-file helpers consumed only by data-loading (normalizers, matchers, priority helpers, packet-freshness/funding-review builders, queue-state builders), all row types used in data-loading, `actionHrefByKey` derivation, and the top-level `<section className="module-page">` shell + `<div className="module-grid-layout">` + `<aside>` layout grid with 4 `<Component />` invocations.

## Why page.tsx landed at 1240, not the lower end of the 1200–1400 estimate

Of the 1240 lines: ~35 are imports, ~430 are in-file helper functions (normalizers, matchers, priority resolvers, funding-review/freshness-review/queue-state builders — all called by data loading), ~575 are the Supabase data-loading chain with derivation (cycle rows + project links + funding profiles + awards + opportunities + invoices + packet reports + report sections + project-report artifacts + cross-cycle rollups), ~100 are the main `return ( <section> ... )` shell including 4 component invocations with full prop passthrough, plus inline ID-filter computations for the bulk action modals. The data-loading chain is non-decomposable within Phase C.4 scope per the approved plan's explicit boundary:

> "Extracting the RTP data-loader to `./_loaders/*` — that's Phase C.4.1, defer."

The JSX collapsed as planned — from ~1233 LOC to ~100 LOC of component invocations. The remaining bulk is all deferred data-loading per the plan.

## Deviations from the plan

None material. One note:

1. **`_helpers.ts` contains only 2 functions (`buildRtpRegistryHref`, `formatUsdWholeAmount`).** The approved plan listed these as the likely candidates; in practice no additional helpers were shared across two or more extracted sections, so no others moved. Page-local helpers (`normalizePacketAttentionFilter`, `matchesPacketAttentionFilter`, `buildPacketFundingReview`, `buildPacketPresetPosture`, `buildPacketFreshness`, `buildPacketOperatorStatus`, `buildPacketActivityTrace`, `buildPacketQueueTrace`, `buildPacketQueueTraceState`, `buildRecommendedAction`, etc.) stayed in page.tsx because they're consumed only by data-loading. Moving them would be churn for zero cohesion benefit — same rationale as C.1 and C.3.

## Verification

```
pnpm tsc --noEmit   → clean
pnpm test --run     → 760/761 (pricing-page.test.tsx flaky timeout, passes standalone)
pnpm build          → green; same route manifest
```

LOC check:
```
wc -l src/app/(app)/rtp/page.tsx
  → 1240
wc -l src/app/(app)/rtp/_components/*.tsx src/app/(app)/rtp/_components/*.ts
  → 1660 total
```

## What stayed out of scope per the plan

- **No data-loader extraction.** Deferred to Phase C.4.1 per the plan.
- **`@/lib/rtp/*` promotion skipped.** Same rationale as C.1/C.3: sibling colocation reads better on the first pass.
- **No test coverage additions.** Pure structural extraction; existing tests pass unchanged.
- **No behavior change.** No new sections, no new filters, no data-shape changes, no API changes.
- **No leaf-component touches.** `@/components/rtp/*` imports stayed untouched; the 7 leaf client components moved from page.tsx import list to the extracted components' import lists as needed.

## Successor ladder (updated after Phase C.4)

- **Phase C.2** — `explore/page.tsx` decomposition (3814 LOC, worst offender remaining). Higher risk because of map + chat state. Pattern now proven on three surfaces (C.1, C.3, C.4). Next up when a decomposition slice is on the table.
- **Phase C.1.1 / C.3.1 / C.4.1 (optional)** — extract data-loaders for each decomposed page. Defer until the LOC floors actually hurt. C.4.1 and C.3.1 are probably more valuable than C.1.1 when the time comes, given the data-loading bulk.
- **Phase O** — Quota asymmetry closure (77 routes). Design-gated on Phase P asks.
- **Phase Q** — 90% plan examples. Design-gated on Nathaniel's agency-example pick.
- **Phase S** — Design-gated unlocks (T16 reader, `rtp_posture` body, `aerial_posture` body).
- **Phase R.1** — Two small Phase-4 drift cleanups (explore gradient block, programs chip clusters). Needs Nathaniel's eye.

## What to re-surface to Nathaniel with this push

The Phase P design asks (quota scope + weight) should stay visible while he decides. Surfaced on the C.1 and C.3 pushes; surfacing again here so they don't drop off. Nothing changed about those asks; Phase C.4 was deliberately chosen because it didn't need them.

## Stop point

Per the approved plan: *"C.4 → (push + verify) → STOP."* Not opening C.2 in this session. Three mechanical decomposition transplants shipped the same day (C.1, C.3, C.4) — the pattern is now locked in. Next decomposition slice (C.2 explore) should get its own session because map + chat client state raises the risk above mechanical transplant.
