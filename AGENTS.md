# AGENTS.md

This file provides guidance to coding agents (OpenAI Codex CLI, Claude Code, and similar) when working with code in this repository. It mirrors `CLAUDE.md`; update both when changing agent guidance.

## Start here (cold-start agents)

**Before anything else, read:** [`docs/ops/2026-04-16-openplan-integrated-deep-dive-review.md`](docs/ops/2026-04-16-openplan-integrated-deep-dive-review.md)

That document is the current canonical synthesis across all OpenPlan lanes (Platform, RTP OS, Grants OS, Transportation Modeling OS, Aerial Operations OS, Runtime, UX). It contains the recalibrated scorecard, the unifying write-back diagnosis, per-lane findings with file:line evidence, and the 18-ticket 4-week execution program (T1–T18). Any new work should be framed against that document.

Secondary canonical references (read only if the deep-dive points you to them):
- `docs/ops/2026-04-16-openplan-integrated-execution-program.md` — prior execution program this deep-dive supersedes
- `docs/ops/2026-04-13-openplan-canonical-architecture-status-and-build-plan.md` — architecture status snapshot
- `docs/ops/2026-04-11-openplan-master-product-roadmap.md` — master product roadmap

## Project Overview

**OpenPlan** — a free, open-source transportation planning intelligence platform. Phase 1 is an AI transit analysis layer that democratizes what Replica and StreetLight Data charge $50K+/year for: natural-language queries over real GTFS, Census, and LODES data, answered with live maps.

**Stack:** Next.js 16 (App Router) · React 19 · Supabase (Postgres + PostGIS + Auth + Storage) · Mapbox GL JS v3 · deck.gl v9.2 · Claude API via Vercel AI SDK · TypeScript · Tailwind CSS v4 · shadcn/ui · pnpm · Vercel

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

**Current (implemented):**
```
Workspace context (plan / RTP cycle / scenario / run / …)
     │
     ▼
Next.js API route (app/api/assistant/route.ts) — synchronous JSON
     │  zod validation · 64 KB body cap · supabase.auth.getUser() gate · audit logger
     ▼
lib/assistant/context.ts — loads target via scoped Supabase RPCs (RLS enforced)
     │
     ▼
lib/assistant/respond.ts — builds workflow actions, preview stats, quick links
     │
     ▼
Client renders response panel; Mapbox GL + deck.gl render map layers from data APIs
```

Grant-narrative generation in `lib/ai/interpret.ts` is the only live Claude call today (Haiku 4.5, `generateText`, non-streaming).

**Planned (not yet wired):** a natural-language query surface that turns user questions into scoped read-only RPC calls and streams results back with GeoJSON for the map. The prior `execute_safe_query` SECURITY DEFINER plumbing was dropped in migration `20260418000058` because narrow per-resource RPCs + RLS proved a smaller attack surface.

**App Router structure:**
```
src/app/
  (public)/explore/        — Public map + AI chat, no login required
  (auth)/sign-up|sign-in/  — Supabase Auth pages
  (workspace)/dashboard/   — Auth-guarded workspace pages
  (workspace)/workspace/[id]/map|data|analyses/
  api/assistant/           — Workspace assistant JSON endpoint (current AI surface)
  api/{plans,programs,rtp-cycles,scenarios,projects,reports,…}/  — Feature-scoped RPCs
  auth/callback/           — Supabase OAuth/email callback
src/components/
  app-shell.tsx             — Left rail + worksurface layout
  assistant/                — Assistant response panel + workflow UI
  nav/                      — Top nav + workspace nav
  ui/                       — shadcn/ui primitives (Tailwind v4)
src/lib/
  supabase/client.ts|server.ts|middleware.ts  — Supabase SSR clients
  assistant/{context,respond,catalog,local-console-state}.ts  — Assistant pipeline
  ai/interpret.ts           — Haiku 4.5 grant-narrative generation
  ai/cost-threshold.ts      — Per-workspace AI spend guardrail
  http/body-limit.ts        — Request body size enforcement
  observability/audit.ts    — Structured API audit logger
supabase/
  migrations/               — All schema in numbered SQL files (70+)
scripts/
  seed-gtfs.ts              — Seeds top US agencies into gtfs_feeds
  seed-nctc-demo.ts         — NCTC pilot demo seeding
```

## Database Schema (PostGIS)

**GTFS tables:** `gtfs_feeds`, `agencies`, `routes`, `stops` (geometry POINT), `trips`, `stop_times`, `shapes` (geometry LINESTRING), `calendar`, `calendar_dates`

**Census/employment:** `census_tracts` (geometry MULTIPOLYGON + ACS attributes), `lodes_od` (block-level OD jobs), views: `census_tracts_computed` (adds pct_nonwhite/pct_zero_vehicle/pct_poverty), `lodes_by_tract` (tract-aggregated jobs)

**Auth/workspace:** `workspaces`, `workspace_members`, `analyses` (saved queries + GeoJSON results)

**Access pattern:** Feature-scoped RPCs + RLS. The former `execute_safe_query` SECURITY DEFINER function was dropped in `20260418000058_drop_execute_safe_query.sql` because it was dormant and represented an unused RLS-bypass surface.

**RLS:** All workspace tables enforce row-level security. Public GTFS feeds have `workspace_id IS NULL` and are readable by anyone. Recent hardening (migrations `20260420000061`–`20260420000064`) pinned `search_path` on 34 trigger/validator functions, switched public views to `security_invoker`, scoped GTFS child-feed visibility, and tightened public select policies.

## AI Layer

The only live Claude call today is `lib/ai/interpret.ts` — `generateText` against Haiku 4.5 to turn corridor metrics + summaries into grant-application narratives. It falls back to the raw summary text when `ANTHROPIC_API_KEY` is unset or the model errors. Cost is tracked per call and surfaced through `lib/ai/cost-threshold.ts`.

The workspace assistant (`/api/assistant`) is a **synchronous** endpoint: it validates input, loads target context via scoped Supabase RPCs, and returns a pre-built response (workflow actions, preview stats, quick links). It does not stream and does not currently call an LLM at request time — the "assistant" here is deterministic workflow UI, not model inference.

## Key Design Decisions

- **Scoped RPCs + RLS over SECURITY DEFINER pass-through**: The original AI query pipeline was designed around a `SELECT`-only SECURITY DEFINER function. That was dropped in favor of per-resource RPCs that rely on RLS for authorization. Do not re-introduce broad SECURITY DEFINER query functions.
- **Public feeds**: `workspace_id IS NULL` in `gtfs_feeds` — preloaded agencies readable without auth
- **Workspace auto-creation**: DB trigger `on_auth_user_created` on `auth.users` creates workspace + owner membership on signup
- **Mapbox GL JS** (not react-map-gl): Direct `mapbox-gl` usage for full control over map instances; deck.gl layers composed on top
- **CSP in report-only mode**: `next.config.ts` ships HSTS, X-Frame DENY, Permissions-Policy, and CSP-Report-Only with a `/api/csp-report` sink. Enforce-mode migration is tracked separately.
- **Body-size limits on write endpoints**: `lib/http/body-limit.ts` caps request bodies per-route (assistant = 64 KB)
- **Service-role-only billing receipts**: `billing_webhook_receipts` has RLS enabled with no policy by design; all access goes through the Stripe webhook handler using the service-role key

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
