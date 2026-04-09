# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**OpenPlan** — a free, open-source transportation planning intelligence platform. Phase 1 is an AI transit analysis layer that democratizes what Replica and StreetLight Data charge $50K+/year for: natural-language queries over real GTFS, Census, and LODES data, answered with live maps.

**Stack:** Next.js 15 (App Router) · Supabase (Postgres + PostGIS + Auth + Storage) · MapLibre GL JS v5 · deck.gl v9.2 · Claude API via Vercel AI SDK · TypeScript · Tailwind CSS · shadcn/ui · pnpm · Vercel

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
Streamed back to client → MapLibre GL renders geometry + deck.gl layers
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
  map/BaseMap.tsx           — MapLibre GL wrapper (forwardRef)
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
- **MapLibre** (not react-map-gl): Direct maplibre-gl usage with a custom `BaseMap` forwardRef component for full control

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
