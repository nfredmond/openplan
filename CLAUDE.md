# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Start here (cold-start agents)

**Before anything else, read:** [`docs/ops/2026-04-16-openplan-integrated-deep-dive-review.md`](docs/ops/2026-04-16-openplan-integrated-deep-dive-review.md)

That document is the current canonical synthesis across all OpenPlan lanes (Platform, RTP OS, Grants OS, Transportation Modeling OS, Aerial Operations OS, Runtime, UX). It contains the recalibrated scorecard, the unifying write-back diagnosis, per-lane findings with file:line evidence, and the 18-ticket 4-week execution program (T1–T18). Any new work should be framed against that document.

Secondary canonical references (read only if the deep-dive points you to them):
- `docs/ops/2026-04-16-openplan-integrated-execution-program.md` — prior execution program this deep-dive supersedes
- `docs/ops/2026-04-13-openplan-canonical-architecture-status-and-build-plan.md` — architecture status snapshot
- `docs/ops/2026-04-11-openplan-master-product-roadmap.md` — master product roadmap

## Current continuity (as of 2026-04-19)

**Paused state lifted.** Nathaniel delegated the five Phase P design decisions on 2026-04-19 with "You answer for me. Take this app to the next level." Decisions are locked in `docs/ops/2026-04-19-phase-p-decisions-locked.md`.

**This session shipped Phase S.2 + S.3 + O + S.1 + S.3 follow-up + O.1 + O.2 + Q.1 + Q.2 + Q.3 (draft) in sequence:**

- **Phase S.2 + S.3** — `project-posture-unified.tsx` surfaces the cached `rtp_posture` and `aerial_posture` bodies on `projects/[projectId]/page.tsx`.
- **Phase O** — weighted quota (`QUOTA_WEIGHTS.MODEL_RUN_LAUNCH=5`) + gate on `reports/[reportId]/generate`. Proof: `docs/ops/2026-04-19-phase-o-quota-closure-proof.md`.
- **Phase S.1** — T16 behavioral-onramp KPI reader on `county-runs/[countyRunId]/page.tsx` with screening-grade refusal banner + `?includeScreening=1` consent toggle. Proof: `docs/ops/2026-04-19-phase-s1-t16-reader-proof.md`.
- **Phase S.3 follow-up** — mission detail page reads `projects.aerial_posture` from the cached column (new "Project aerial posture (cached)" inspector group; existing mission-scoped aggregate kept under a clarified label). Proof: `docs/ops/2026-04-19-phase-s3-followup-mission-rewire-proof.md`.
- **Phase O.1** — subscription + quota gate added to `/api/scenarios/[scenarioSetId]/spine/comparison-snapshots` (default weight, `runs` bucket). Three other Phase O.1 candidates (aerial-process 501 stub, deterministic assistant, network-package ingest with pre-existing auth gap) documented as deferred with reasons. Proof: `docs/ops/2026-04-19-phase-o1-quota-tranche-proof.md`.
- **Phase O.2** — network-package ingest hardened in two commits: (1) auth patch (401/404/403 for anonymous/unknown-package/non-member), (2) subscription + quota gate (402/500/429). New test file covers all 5 gate branches + happy path (6 tests). Proof: `docs/ops/2026-04-19-phase-o2-network-package-ingest-proof.md`.
- **Phase Q.1** — NCTC demo seed. `workspaces.is_demo` marker migration + idempotent `scripts/seed-nctc-demo.ts` service-role script that upserts workspace/membership/project/rtp_cycle/project_rtp_cycle_link/county_run with manifest + validation summary preserved verbatim. Pure `buildSeedRecords` helper covered by 7 unit tests. Scope doc: `docs/ops/2026-04-19-phase-q-scope.md`. Proof: `docs/ops/2026-04-19-phase-q1-nctc-demo-seed-proof.md`.
- **Phase Q.2** — NCTC demo Existing Conditions chapter. Extends the seed script with an 8th `rtp_cycle_chapters` row (`chapter_key = existing_conditions_travel_patterns`) whose `content_markdown` is composed from the manifest + validation summary — every number traces back to the frozen run, not hand-typed. New pure `buildExistingConditionsChapterMarkdown` helper covered by 8 additional unit tests. No UI shipped — the chapter renders via existing `rtp/[rtpCycleId]/{page,document}` surfaces. Proof: `docs/ops/2026-04-19-phase-q2-existing-conditions-chapter-proof.md`.
- **Phase Q.3** — Outbound one-pager draft. Non-code commercial lane per the scope doc. Drafted at `docs/sales/2026-04-19-nctc-demo-one-pager.md` with concrete numbers from Q.1+Q.2 and a caveat posture that mirrors the chapter. Handoff doc flags pricing, tone, demo-access posture, contact line, and PDF build as human decisions still outstanding. Handoff: `docs/ops/2026-04-19-phase-q3-outbound-one-pager-handoff.md`.
- **Phase Q polish** — chapter `content_markdown` rendering fix. All three read sites (`rtp/[rtpCycleId]/page.tsx`, `rtp/[rtpCycleId]/document/page.tsx`, `src/lib/rtp/export.ts`) now parse markdown via a new `src/lib/markdown/render.ts` helper (`marked@^14` + defensive XSS strip for `<script>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `on*=`, `javascript:`). `.txt` export path left as raw markdown by design. New `.chapter-markdown` CSS block in `globals.css` uses `color-mix()` + `var(--muted)` for theme adaptivity. 8 unit tests in `src/test/markdown-render.test.ts`. Proof: `docs/ops/2026-04-19-phase-q-polish-chapter-markdown-rendering-proof.md`.
- **Phase Q polish — chapter editor preview.** Edit/Preview toggle added to `components/rtp/rtp-chapter-controls.tsx` so drafters can see rendered markdown without saving. Reuses the shared `renderChapterMarkdownToHtml` helper + `.chapter-markdown` CSS. Placeholder text updated to commit to markdown instead of "plain text or markdown-style structure is fine for now."
- **Phase Q polish — standalone-export styling + renderer hardening.** `buildRtpExportHtml` now embeds `.chapter-markdown` rules inline in the export `<style>` block so downloaded HTML exports render styled without the globals.css cascade. Wide tables now wrap in `<div class="chapter-markdown-table-wrap">` (overflow-x: auto) — both in-app (globals.css) and in the standalone export. `stripUnsafeHtml` gained a third branch for unquoted event-handler attributes. +5 hardening tests in `src/test/markdown-render.test.ts` (13 total) + 1 export test in `src/test/rtp-export.test.ts`. Proof: `docs/ops/2026-04-19-phase-q-polish-standalone-export-proof.md`.
- **Phase Q.4 — PDF export wired end-to-end.** `POST /api/reports/[reportId]/generate` now honors `format: "pdf"` for both the RTP-cycle and project branches. Pattern: reuse the existing HTML (`buildRtpExportHtml` / `buildReportHtml`), render via `renderHtmlToPdf(html)` (new `src/lib/reports/pdf.ts` — `puppeteer-core@^23` + `@sparticuz/chromium@^129` in prod, system Chrome in dev), upload to new private `report-artifacts` bucket at `<workspace>/<report>/<uuid>.pdf` with workspace-scoped RLS, persist `report_artifacts` with `artifact_kind: "pdf"` + `storage_path`, update `latest_artifact_kind`. Migration `20260420000060_report_artifacts_bucket.sql` applied live. `vercel.json` sets `maxDuration: 60, memory: 1024` for the generate route. +3 tests on the existing `report-generate-route.test.ts` (806 total). Proof: `docs/ops/2026-04-20-phase-q4-pdf-export-proof.md`.
- **Security-advisor backlog scoped (2026-04-20).** Live advisor inventory against prod (`aggphdqkanxsfzzoxlbk`): 3 ERRORs (2 SECURITY DEFINER views + 1 RLS-disabled PostGIS system table) + 37 WARNs (34 mutable-search-path functions + 2 extensions in public + 1 leaked-password Auth toggle) + 11 INFOs (10 public-data tables w/ RLS-no-policy + 1 billing_webhook_receipts). Split into 5 Wave-1 ship-before-external-customer slices (function search_path pin migration, public GTFS/Census select policies, 2 dashboard toggles, billing_webhook_receipts COMMENT), 1 Wave-2 design call (drop SECURITY DEFINER from views, depends on Wave-1 policies landing first), 1 Wave-3 acknowledged-risk (PostGIS in public). Nothing shipped as code — this is the scoping doc that unblocks the next series of migrations. Doc: `docs/ops/2026-04-20-security-advisor-backlog.md`.
- **Security-advisor Wave-1 + W2.1 shipped (2026-04-20).** Three migrations applied live against prod (`20260420000061_pin_function_search_paths.sql`, `20260420000062_public_data_select_policies.sql`, `20260420000063_public_views_security_invoker.sql`). Advisor count collapsed 51 → 5 (net −46): all 34 mutable-search-path WARNs closed, the 10 public-data RLS-no-policy INFOs closed via permissive SELECT policies on GTFS/Census/LODES, both SECURITY DEFINER ERRORs closed via `ALTER VIEW ... SET (security_invoker = true)`, and billing_webhook_receipts' intentional no-policy posture documented via `COMMENT ON TABLE`. Remaining 5 items are all either dashboard-only (spatial_ref_sys RLS, leaked-password protection) or Wave-3 acknowledged-risk (postgis + pg_trgm in public, billing_webhook_receipts INFO). Tests stay at 806/172. Proof: `docs/ops/2026-04-20-security-advisor-wave1-proof.md`.
- **Markdown renderer hardened without DOM runtime deps (2026-04-20).** Replaced the regex-based `stripUnsafeHtml` in `src/lib/markdown/render.ts` with a DOM-free safe `marked` renderer: raw HTML is unsupported and stripped, dangerous raw blocks are stripped before/after render, and markdown link/image URLs are allowlisted after HTML-entity decoding. Signature of `renderChapterMarkdownToHtml` unchanged — all consumers (editor preview + both read sites + `buildRtpExportHtml`) keep working. The previous stripper missed entity-encoded `javascript:` URIs, `data:text/html`, `<style>` tags, and inline `style=` attrs; the final implementation blocks those without bundling `jsdom` into Next server routes. Proof: `docs/ops/2026-04-20-markdown-dompurify-hardening-proof.md`.
- **Dead-code lint-warning cleanup (2026-04-20).** `pnpm lint` went from 52 warnings to 0 across 13 files. High-value: removed 17 unused Supabase queries from `Promise.all([...])` blocks across 5 decomposed page components (`data-hub`, `plans/[planId]`, `plans`, `programs/[programId]`, `programs` — real DB round-trips per page render, remnant from Phase C decomposition). Medium: removed ~145 LOC of dead memoization from `explore/page.tsx` (`filteredCrashPointCount`, `activeOverlayLegend`, `mapExperienceReady`, `analysisSummary`, `activeOverlayGeometryLabel`) + 13 unused imports on `grants/page.tsx` + smaller cleanups across 7 other files. Tests stay at 809/172 (pure cleanup, no behavior change). Proof: `docs/ops/2026-04-20-dead-code-cleanup-proof.md`.
- **Baseline security headers (2026-04-20).** `NextConfig.headers()` in `openplan/next.config.ts` now emits five headers on every route: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(self), interest-cohort=()`, and `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`. Closes clickjacking, MIME-sniffing, cross-origin referrer leakage, third-party sensor/FLoC access, and HTTPS protocol-downgrade. CSP deferred to a follow-up (needs report-only rollout against Mapbox + Supabase + Anthropic streaming + `data:`/`blob:` image pipeline + worker-src). Tests stay at 809/172. Proof: `docs/ops/2026-04-20-security-headers-proof.md`.
- **CSP in `Report-Only` mode + violation sink (2026-04-20).** Added `Content-Security-Policy-Report-Only` header to `NextConfig.headers()` with a best-guess policy covering known origins (Supabase REST + `wss://` realtime, Mapbox tiles/events/api, `data:` + `blob:` for map images + workers, `frame-ancestors 'none'`, `object-src 'none'`). `script-src` + `style-src` kept loose with `'unsafe-inline' 'unsafe-eval'` because Next.js 15 App Router RSC bootstrap has no nonce middleware yet — report-only mode means this is cosmetic. New `POST /api/csp-report` route (`src/app/api/csp-report/route.ts`) accepts both legacy CSP1 and modern Reporting API payload shapes, normalizes each violation, and emits `audit.warn("csp_violation", …)` through the existing `createApiAuditLogger` → Vercel runtime logs. Always returns 204 (broken sink must not become a bigger outage than the missed report), never auth-gated (reports fire before page hydrates). +4 tests in new `src/test/csp-report-route.test.ts`. Tests 809 → 813, 172 → 173 files. Next slice: observe 1-2 days of violations, tighten policy, flip to enforcing. Proof: `docs/ops/2026-04-20-csp-report-only-proof.md`.
- **Anthropic call telemetry on `/api/analysis` (2026-04-20).** `generateGrantInterpretation` in `src/lib/ai/interpret.ts` now surfaces AI-SDK v6's `LanguageModelUsage` (`inputTokens`, `outputTokens`, `totalTokens`), model id, an `estimatedCostUsd` computed against a module-level Haiku rate card (`$1.00/MTok` input, `$5.00/MTok` output, rounded to 6 decimals), and a `fallbackReason` discriminating `missing_api_key` / `generation_error` / `empty_output`. The route's `audit.info("analysis_completed", …)` call gained `aiModel`/`aiInputTokens`/`aiOutputTokens`/`aiTotalTokens`/`aiEstimatedCostUsd`, and a new `audit.warn("analysis_ai_fallback", …)` fires on fallback paths — so Anthropic spend is now greppable at per-call granularity in Vercel runtime logs. No DB table, no dashboard, no cost-based quota yet (observation-first discipline, same as CSP report-only). The PreToolUse hook recommended AI-Gateway migration for OIDC auth + failover; noted as a future slice but out of scope for telemetry. +5 tests in `src/test/interpret.test.ts` (mocks `ai` + `@ai-sdk/anthropic` at import level). Tests 813 → 818, 173 → 174 files. Proof: `docs/ops/2026-04-20-anthropic-telemetry-proof.md`.
- **Dependency CVE patching (2026-04-20).** `pnpm audit --prod` went from 12 advisories (1 critical, 3 high, 6 moderate, 2 low) to **0**. Two moves: (1) `next` + `eslint-config-next` bumped 16.1.6 → 16.2.4, closing 6 advisories including the high-severity Server Components DoS (CVE-2026-23869), HTTP-request smuggling in rewrites, `next/image` cache growth, postpone-resume buffering, null-origin Server Actions CSRF bypass, and the HMR websocket CSRF bypass. (2) `pnpm.overrides` added for two transitive-only advisories that chain through `@deck.gl/geo-layers@9.2.8 → @loaders.gl/*@4.3.4` — `fast-xml-parser@<4.5.5` pinned to `>=4.5.5` (critical entity bypass + 2 high DoS + 1 moderate + 1 low) and `protocol-buffers-schema@<3.6.1` pinned to `>=3.6.1` (prototype pollution, CVE-2026-5758). Overrides use selector form so they become no-ops if upstream ever ranges past them. Stale `.next/types/` from 16.1.6 deleted before tsc — errors about `PrefetchForTypeCheckInternal` were auto-generated artifacts, not real type errors. Tests stay 813/173. Deck.gl major upgrade explicitly not attempted (breaking-change risk). Proof: `docs/ops/2026-04-20-dependency-cve-patch-proof.md`.
- **`qa:gate` audit lock-in + `x-request-id` echo (2026-04-20).** Two small-but-durable moves bundled. (1) `qa:gate` script in `package.json` now runs `pnpm audit --prod --audit-level=moderate` between tests and build — locks today's 0-advisory state so any moderate-or-higher regression fails the local gate before build-artifact production. (2) `src/proxy.ts` (Next.js 16 middleware) now resolves `x-request-id` on every request: inbound header echoed verbatim when present (trimmed, non-empty), otherwise `crypto.randomUUID()` generated. The ID is set on the request headers *before* `updateSession()` runs, so `createApiAuditLogger`'s existing `firstHeader(request, ["x-request-id", …])` read at `src/lib/observability/audit.ts:103` resolves to the same value the client will see on the response. The ID is then set on the response header in both the allow path and the sign-in redirect path — so a bug report citing `x-request-id: …` now grep-matches the `requestId` field on every `audit.*` line for that request. +3 tests in `src/test/middleware.test.ts` (echoes inbound; generates UUID when absent; carries through sign-in redirects). Tests 818 → 821, 174 files unchanged. CI wiring of `qa:gate` deferred until GitHub Actions vs Vercel checks is decided (no `.github/workflows` exists yet). Proof: `docs/ops/2026-04-20-qa-gate-audit-and-request-id-echo-proof.md`.
- **P1 review repair — build-safe markdown + feed-scoped GTFS policies (2026-04-20).** Addressed both reviewer blockers. `src/lib/markdown/render.ts` no longer imports a DOM-backed sanitizer, `package.json`/`pnpm-lock.yaml` drop `isomorphic-dompurify`, and `pnpm build` now passes through `/api/reports/[reportId]/generate` page-data collection. `supabase/migrations/20260420000062_public_data_select_policies.sql` now scopes GTFS child reads through `gtfs_feeds`, and new forward migration `20260420000064_scope_gtfs_child_feed_visibility.sql` repairs environments that already applied the broad `USING (true)` policies. Added `src/test/gtfs-child-policies.test.ts` plus one safe/unsafe markdown-link assertion; tests now 824/175 and `pnpm qa:gate` passes. Proof: `docs/ops/2026-04-20-p1-review-repair-proof.md`.
- **Defensive hardening follow-up (2026-04-20).** Applied `20260420000064_scope_gtfs_child_feed_visibility.sql` to prod (`aggphdqkanxsfzzoxlbk`) and repaired migration history; live `pg_policies` now shows all GTFS child tables inheriting `gtfs_feeds` public/workspace visibility. Root `.github/workflows/ci.yml` now runs `pnpm qa:gate`. Added `readJsonWithLimit` plus 16 KB `/api/csp-report` and 64 KB `/api/analysis` body caps, and `/api/analysis` now emits observation-only `analysis_cost_threshold_exceeded` warnings for single calls over `$0.50`. Supabase leaked-password protection is enabled via `password_hibp_enabled: true`; advisors are down to 3 (`spatial_ref_sys` owner-only RLS plus accepted `postgis`/`pg_trgm` extension warnings). Added `body-limit.test.ts` and `ai-cost-threshold.test.ts`; tests now 830/177 and `pnpm qa:gate` passes. Proof: `docs/ops/2026-04-20-defensive-hardening-followup-proof.md`.
- **Phase C.2 slice 2 - Explore hover inspector (2026-04-20).** Confirmed the initially proposed Grants -> RTP posture write-back was already live (`projects.rtp_posture`, `rebuildProjectRtpPosture`, and award-route rebuild tests exist), then shipped the next concrete code-only gap: extracted the Explore map-intelligence hover inspector into `src/app/(app)/explore/_components/explore-hover-inspector.tsx`, moved `TractMetric` into `_types.ts`, and added `src/test/explore-hover-inspector.test.tsx` for hidden, tract, and crash states. `src/app/(app)/explore/page.tsx` drops 3,129 -> 2,921 LOC. Tests now 846/181 and `pnpm qa:gate` passes. Proof: `docs/ops/2026-04-20-phase-c2-slice-2-hover-inspector-proof.md`.
- **Phase C.2 slice 3 - Explore results board (2026-04-20).** Extracted the Explore result board, comparison board, export controls, source briefing, and disclosure surfaces into `src/app/(app)/explore/_components/explore-results-board.tsx`. Parent `explore/page.tsx` still owns analysis execution, current/comparison run state, report generation, map state, map-view persistence, and Run History callbacks, but drops 2,921 -> 1,858 LOC. Added `src/test/explore-results-board.test.tsx` for empty, current-result, and comparison states. Tests now 849/182 and `pnpm qa:gate` passes. Proof: `docs/ops/2026-04-20-phase-c2-slice-3-results-board-proof.md`.
- **Phase C.2 slice 4 - Explore results board subcomponents (2026-04-20).** Split `ExploreResultsBoard` into `explore-current-result-card.tsx`, `explore-run-comparison-card.tsx`, `explore-geospatial-briefing.tsx`, `explore-disclosure-card.tsx`, and shared `explore-results-types.ts`. `ExploreResultsBoard` now orchestrates memoized view models and export handlers only, dropping 1,099 -> 445 LOC. Tests remain 849/182 and `pnpm qa:gate` passes. Proof: `docs/ops/2026-04-20-phase-c2-slice-4-results-board-subcomponents-proof.md`.
- **Phase C.2 slice 5 - Explore run history handoff (2026-04-20).** Extracted the state-bearing Run History boundary into `use-explore-run-history.ts` and `explore-run-history-panel.tsx`. The hook now owns pinned baseline state, saved-run loading, compare validation, `runId`/`baselineRunId` deep-link hydration, and URL sync; the page keeps live analysis, map, report, and persistence ownership. `explore/page.tsx` drops 1,858 -> 1,709 LOC. Added `src/test/explore-run-history.test.tsx`; tests now 854/183 and `pnpm qa:gate` passes. Proof: `docs/ops/2026-04-20-phase-c2-slice-5-run-history-handoff-proof.md`.
- **Phase C.2 slice 6 - Explore study brief controls (2026-04-20).** Extracted the Study brief form/control surface into `explore-study-brief-controls.tsx`: query textarea, character count, prompt-length warning, report template selector, run button, HTML/PDF export buttons, and validation error display. The page still owns analysis requests, report generation, map state, map lifecycle, and project/Data Hub context. `explore/page.tsx` drops 1,709 -> 1,629 LOC. Added `src/test/explore-study-brief-controls.test.tsx`; tests now 858/184 and `pnpm qa:gate` passes. Proof: `docs/ops/2026-04-20-phase-c2-slice-6-study-brief-controls-proof.md`.
- **Phase 2 - Cartographic selection wiring + AOI enrichment (2026-04-21).** Mounted the D2 cartographic shell end-to-end. New `src/components/cartographic/` tree (11 components + 769-LOC `cartographic.css`): context with tolerant `useCartographicSelection`/`useCartographicLayers` hooks, `<CartographicSelectionLink>` row wrapper (hover/focus/click previews the inspector dock), `<CartographicSurfaceWide />` body-attr opt-in for wide detail surfaces, Mapbox GL JS v3.20 backdrop with theme-reactive style swap. Swept selection-link across 9 list pages + wide-surface across 11 detail pages. `DEFAULT_CENTER = [-121.033982, 39.239137]` (Grass Valley / NCTC anchor) now the single source of truth in the backdrop + `engagement/location-{display,picker}-map.tsx` + `models/traffic-volume-map.tsx`. `scripts/seed-nctc-demo.ts` (+175 LOC) gains three hand-authored AOI polygons (downtown / SR-49 Alta Sierra / Empire Mine, 10-11 vertices each, verified against `isAoiPolygonGeoJson`) plus mission + evidence-package upsert loops. New `src/test/nctc-demo-aoi-polygons.test.ts` (6 tests). Tests 858/184 -> 864/185; `pnpm qa:gate` clean. Proof: `docs/ops/2026-04-21-phase-2-cartographic-selection-aoi-proof.md`.
- **Phase 3 Slice A - Live mission AOIs on cartographic backdrop (2026-04-21).** First data-driven layer on the shell backdrop. New `GET /api/map-features/aerial-missions` route (~100 LOC): auth-gated (401 anon), workspace-scoped via `loadCurrentWorkspaceMembership`, `.limit(500)` stopgap, `isAoiPolygonGeoJson` filter, structured audit logs (`aerial_mission_aois_loaded` / `aerial_mission_aoi_query_failed` / `aerial_mission_aoi_unhandled_error`). `cartographic-map-backdrop.tsx` (153 -> 264 LOC) gains fetch-on-mount with cancel guard + non-401 `console.warn`, paint effect for `#e45635 @ 0.18` fill + `0.85 / 1.75px` outline layers (re-registered on `style.load` after theme swap wipes the source/layer registry), visibility effect honoring `layers.aerial`. Post-review hardening bundled: `Object.freeze(DEFAULT_LAYERS)` in `cartographic-context.tsx`, `.limit(500)` + TODO-pagination on the route, TODO-live-counts on `cartographic-layers-panel.tsx` chip placeholders. 4 route tests (anon / no-membership / valid+malformed mix / DB error). Also adds `.mcp.json` for Supabase MCP HTTP transport. Tests 864/185 -> 868/186; `pnpm qa:gate` clean; `pnpm seed:nctc -- --env-file .env.production.local` landed 3 missions + 3 packages on prod. Proof: `docs/ops/2026-04-21-phase-3-slice-a-live-aoi-proof.md`.

**All 5 writer/reader census cases are now closed.** The 18-ticket integration program has no remaining reader-dead gaps.

**Phase C (mega-page decomposition)** shipped in full on 2026-04-18 evening. Pattern: `src/app/(app)/<route>/page.tsx` → sibling `_components/_types.ts` + `_helpers.ts` + N extracted section components.

| Slice | Target | Before → After | Completion doc |
|---|---|---|---|
| C.1 | `projects/[projectId]/page.tsx` | 2707 → 889 LOC | `docs/ops/2026-04-18-phase-c1-projects-detail-decomposition-proof.md` |
| C.3 | `reports/[reportId]/page.tsx` | 2548 → 1675 LOC | `docs/ops/2026-04-18-phase-c3-reports-detail-decomposition-proof.md` |
| C.4 | `rtp/page.tsx` | 2413 → 1240 LOC | `docs/ops/2026-04-18-phase-c4-rtp-registry-decomposition-proof.md` |
| C.2 slice 1 | `explore/page.tsx` | 3814 → 3256 LOC | `docs/ops/2026-04-18-phase-c2-explore-decomposition-proof.md` |
| C.2 slice 2 | `explore/page.tsx` | 3129 → 2921 LOC | `docs/ops/2026-04-20-phase-c2-slice-2-hover-inspector-proof.md` |
| C.2 slice 3 | `explore/page.tsx` | 2921 → 1858 LOC | `docs/ops/2026-04-20-phase-c2-slice-3-results-board-proof.md` |
| C.2 slice 4 | `explore-results-board.tsx` | 1099 → 445 LOC | `docs/ops/2026-04-20-phase-c2-slice-4-results-board-subcomponents-proof.md` |
| C.2 slice 5 | `explore/page.tsx` | 1858 → 1709 LOC | `docs/ops/2026-04-20-phase-c2-slice-5-run-history-handoff-proof.md` |
| C.2 slice 6 | `explore/page.tsx` | 1709 → 1629 LOC | `docs/ops/2026-04-20-phase-c2-slice-6-study-brief-controls-proof.md` |

All on main, all Vercel Ready, tests green (latest local gate: 858 tests / 184 files).

**Locked Phase P decisions (2026-04-19):**

1. T16 reader → **county-run detail page**. Shipped.
2. `rtp_posture` body → **compact inline + warm-gradient on `remainingFundingGap > 0`**. Shipped.
3. `aerial_posture` body → **unified section paired with #2**. Shipped; mission-page cached-column reader also shipped (Phase S.3 follow-up).
4. Quota → **per-workspace scope + binary weight** (model-run launches = 5 units, default = 1). Mechanical foundation shipped + report-generate wired.
5. 90% plan example → **Nevada County RTPA (NCTC)**. Q.1 (demo seed) + Q.2 (Existing Conditions chapter composed from the frozen run) shipped as code; Q.3 outbound one-pager drafted at `docs/sales/2026-04-19-nctc-demo-one-pager.md` and handed off for human review (pricing / tone / PDF build outstanding).

Full rationale: `docs/ops/2026-04-19-phase-p-decisions-locked.md`. Full options analysis: `docs/ops/2026-04-19-phase-p-design-decision-pack.md`.

**Queued next sessions:** Phase Q has no engineering slices left. Open human-owned follow-ups: (a) run `pnpm seed:nctc` against live Supabase with service-role creds so the demo workspace actually exists, (b) walk the Q.3 one-pager draft-review checklist + pick a PDF build path, (c) sanity-check that the chapter renders well on `/rtp/[rtpCycleId]/{page,document}` once seeded. Billing-bucket semantics (strict consumption vs soft cap) is a design decision deferred to Stripe-metering work.

**Supabase drift closed (2026-04-19 late session).** 12 pending migrations (`20260415000048_aerial_operations_os` → `20260419000059_workspaces_is_demo`) applied to production project `aggphdqkanxsfzzoxlbk` via MCP `apply_migration` in chronological order (MCP records them with UTC-now version timestamps — cosmetic only; all migrations are idempotent via `IF NOT EXISTS` / `DROP POLICY IF EXISTS` patterns, so a future local `supabase db push` skips them cleanly). Security-advisor diff: zero new issues, net −1 warning (dropped `execute_safe_query` silenced its own advisor). `pnpm seed:nctc` then run successfully against the live project — demo workspace `nctc-demo` (`is_demo=true`), project `d0000001-…-000000000003`, county_run with full validation_summary_json, and Q.2 Existing Conditions chapter (3,837 chars) are all live. Open human-owned follow-ups collapse to (b) Q.3 one-pager review + PDF path and (c) chapter-render sanity-check on `/rtp/[rtpCycleId]/{page,document}` — (c) is now unblocked.

**If you are a new agent asked to resume:** start with the decisions-locked doc, then the Phase O + Phase S.1 proof docs, then the `project-posture-unified.tsx` and `county-run-behavioral-kpis.tsx` components for pattern reference on the next reader work.

## Project Overview

**OpenPlan** — a free, open-source transportation planning intelligence platform. Phase 1 is an AI transit analysis layer that democratizes what Replica and StreetLight Data charge $50K+/year for: natural-language queries over real GTFS, Census, and LODES data, answered with live maps.

**Stack:** Next.js 16 (App Router) · Supabase (Postgres + PostGIS + Auth + Storage) · Mapbox GL JS v3.20 · deck.gl v9.2 · Claude API via Vercel AI SDK · TypeScript · Tailwind CSS v4 · shadcn/ui · pnpm · Vercel

**Source code lives in:** `openplan/` subdirectory (run all commands from there)

## Commands

```bash
pnpm dev                          # Start Next.js dev server (localhost:3000)
pnpm build                        # Production build
pnpm test                         # Run vitest unit tests
pnpm test:watch                   # Vitest in watch mode
pnpm supabase start               # Start local Supabase stack
pnpm supabase stop                # Stop local Supabase
pnpm supabase db reset            # Re-apply all migrations from scratch
pnpm supabase gen types typescript --local > src/types/supabase.ts  # Regenerate DB types
pnpm seed:gtfs                    # Seed top US transit agencies
pnpm supabase functions serve parse-gtfs --env-file ../.env.local   # Serve Edge Function locally
```

## Architecture

```
User asks: "Which neighborhoods have no transit within 10 min walk?"
     │
     ▼
Next.js API route (app/api/chat/route.ts) — Vercel AI SDK streaming
     │
     ▼
Claude API (claude-sonnet-4-6) — given full DB schema + PostGIS reference
     │  calls run_spatial_query tool with validated SELECT SQL
     ▼
Supabase Postgres + PostGIS — execute_safe_query() RPC (SELECT-only, RLS enforced)
     │  returns GeoJSON FeatureCollection
     ▼
Streamed back to client → Mapbox GL renders geometry + deck.gl layers
```

**App Router structure:**
```
src/app/
  (public)/explore/        — Public map + AI chat, no login required
  (auth)/sign-up|sign-in/  — Supabase Auth pages
  (workspace)/dashboard/   — Auth-guarded workspace pages
  (workspace)/workspace/[id]/map|data|analyses/
  api/chat/                — Vercel AI SDK streaming endpoint
  auth/callback/           — Supabase OAuth/email callback
src/components/
  map/BaseMap.tsx           — Mapbox GL wrapper (forwardRef)
  map/GeoJSONLayer.tsx      — Renders query results on map
  chat/ChatPanel.tsx        — Streaming AI chat UI
  chat/ExampleQueries.tsx   — Starter prompts
  nav/WorkspaceNav.tsx
src/lib/
  supabase/client.ts|server.ts|middleware.ts  — Supabase SSR clients
  ai/system-prompt.ts       — Full schema + PostGIS reference for Claude
  ai/query-tool.ts          — Vercel AI SDK tool: validates + executes SQL
supabase/
  migrations/               — All schema in numbered SQL files
  functions/parse-gtfs/     — Deno Edge Function: parses GTFS zip uploads
scripts/
  seed-gtfs.ts              — Seeds top 15 US agencies into gtfs_feeds
```

## Database Schema (PostGIS)

**GTFS tables:** `gtfs_feeds`, `agencies`, `routes`, `stops` (geometry POINT), `trips`, `stop_times`, `shapes` (geometry LINESTRING), `calendar`, `calendar_dates`

**Census/employment:** `census_tracts` (geometry MULTIPOLYGON + ACS attributes), `lodes_od` (block-level OD jobs), views: `census_tracts_computed` (adds pct_nonwhite/pct_zero_vehicle/pct_poverty), `lodes_by_tract` (tract-aggregated jobs)

**Auth/workspace:** `workspaces`, `workspace_members`, `analyses` (saved queries + GeoJSON results)

**Key function:** `execute_safe_query(query_text TEXT)` — SECURITY DEFINER, SELECT-only, called by the AI tool via Supabase RPC

**RLS:** All workspace tables enforce row-level security. Public GTFS feeds have `workspace_id IS NULL` and are readable by anyone.

## AI Query Pipeline

The AI layer uses Vercel AI SDK's `streamText` with a single tool `run_spatial_query`. Claude receives the full schema + PostGIS function reference in the system prompt, generates a SELECT query with `ST_AsGeoJSON(geometry)` for map display, the tool validates (SELECT-only, blocks DDL/DML), executes via `execute_safe_query` RPC, returns GeoJSON + row count. Claude then streams a plain-English summary. `maxSteps: 5` allows follow-up queries if the first fails.

## Key Design Decisions

- **SELECT-only AI queries**: Double-validated (client regex + SECURITY DEFINER function) — Claude cannot modify data
- **Public feeds**: `workspace_id IS NULL` in `gtfs_feeds` — preloaded agencies readable without auth
- **GeoJSON extraction**: `buildGeoJSON()` in `query-tool.ts` looks for string columns starting with `{"type"` — Claude must include `ST_AsGeoJSON(geom)` in SELECT
- **Workspace auto-creation**: DB trigger `on_auth_user_created` on `auth.users` creates workspace + owner membership on signup
- **Mapbox GL JS v3** (not react-map-gl): Direct `mapbox-gl` usage with a custom `BaseMap` forwardRef component for full control. The cartographic shell backdrop (`src/components/cartographic/cartographic-map-backdrop.tsx`) loads `mapbox://styles/mapbox/{light,dark}-v11` with `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`. Default map center is Grass Valley, CA — `[-121.033982, 39.239137]` — the NCTC demo anchor.

## Frontend Redesign Guardrails (Current OpenPlan direction)

When working on OpenPlan UI, do **not** drift back to generic AI-SaaS output.

### Canonical posture
- OpenPlan should feel like a **civic workbench / planning operating system**, not a startup dashboard made of cards and pills.
- Default layout metaphor: **left rail + continuous worksurface + right inspector/context rail** when the workflow benefits from detail-on-selection.
- Emphasize hierarchy through typography, spacing, row rhythm, alignment, and separators before adding more containers.

### Avoid by default
- stacked card grids as the main page structure,
- chip/pill clusters for metadata or filters,
- floating badge noise,
- detached callout boxes that fragment the page,
- many equal-weight CTAs fighting for attention.

### Prefer by default
- lists, rows, tables, and sectioned worksurfaces for scan/compare/find tasks,
- sentence-style or inline-text filters instead of chip bars,
- a single clear primary action per area,
- inspector-side metadata editing and secondary actions,
- calm density over decorative novelty.

### Prompting / implementation rule
Before major UI generation or refactor work, consult and follow:
- `docs/ops/2026-04-08-openplan-frontend-design-constitution.md`

That memo is the current design constitution for avoiding generic output while preserving feature parity.

## Research Context (from promt1.md)

This platform targets the critical market gaps identified in the spec:
- Small/rural agencies priced out of Replica ($50K+), StreetLight, Conveyal
- No single tool integrates demand modeling + engagement + compliance
- AI accessibility layer democratizes complex spatial analysis

**Phase roadmap:**
1. ✅ **Phase 1 (current):** AI transit analysis — GTFS + Census + LODES queries via natural language
2. **Phase 2:** Civic engagement pipeline — GIS-connected surveys, community input → map layers
3. **Phase 3:** Scenario planner — land use changes → real-time accessibility/equity/emissions impacts
4. **Phase 4:** Federal compliance tracker — NEPA milestones, LAPM forms, DBE reporting

**Key data sources used:**
- GTFS (2,500+ agencies, auto-ingested from Mobility Database API)
- Census TIGER tract boundaries + ACS 5-year attributes
- LODES 8.3 block-level origin-destination employment (all 50 states, 2022)
- NPMRDS (future: 400K+ road segments, 5-min speeds) — not in Phase 1

**Planned future integrations:** ActivitySim/MATSim ABM outputs, GTFS-Flex (demand-responsive transit), GBFS (shared mobility), MDS (curb management), Curb Data Specification, Vision Zero HIN analysis, NEPA/CEQA milestone tracking

## Implementation Plan

Full step-by-step plan with exact file paths and code: `docs/plans/2026-02-19-phase1-implementation.md`
Design document: `docs/plans/2026-02-19-platform-design.md`
