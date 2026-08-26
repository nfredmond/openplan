# OpenPlan — Platform Design
*Date: 2026-02-19*

## Vision

Free, open-source transportation planning intelligence for every agency. A unified platform where demand modeling, civic engagement, scenario planning, construction tracking, and compliance monitoring work together — powered by AI, built on open-source geospatial infrastructure, accessible to small and rural agencies who can't afford $50K+/year tools.

## Phase 1 Scope: AI Transit Analysis Layer

Democratize what Replica and StreetLight Data charge five to six figures for: natural-language queries over real GTFS, Census LODES, and NPMRDS data, answered instantly with a live map. No contract required.

### Core Day-1 Capabilities

- Natural language → PostGIS query → map visualization pipeline
- Preloaded GTFS for top 100 US cities (from Mobility Database API)
- Census TIGER tract/block group boundaries + ACS 5-year attributes
- LODES 8.3 block-level origin-destination employment data (all 50 states)
- Public "Explore" mode (no login) + authenticated agency workspaces
- GTFS upload for agencies' own feeds
- Shareable analysis links

### Example queries the platform answers on day one

- "Which census tracts in Phoenix have no transit stop within a 10-minute walk?"
- "Show the top 20 block groups by jobs accessible within 30 minutes by transit"
- "How did the 2023 Route 15 cut affect low-income neighborhoods?"
- "What percentage of zero-vehicle households are within 400m of a bus stop?"

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, RSC, streaming) |
| Styling | Tailwind CSS + shadcn/ui |
| Map | MapLibre GL JS v5 |
| Data visualization | deck.gl v9.2 (H3 hex, trip animations, heatmaps) |
| Database | Supabase — Postgres + PostGIS + pgvector |
| AI | Claude API (claude-sonnet-4-6) via Vercel AI SDK |
| In-browser analytics | DuckDB-Wasm |
| Auth | Supabase Auth |
| File storage | Supabase Storage |
| Deployment | Vercel |
| Package manager | pnpm |
| License | MIT |

---

## Architecture

### Request flow

```
User types: "Which neighborhoods lost transit access?"
     │
     ▼
Next.js API Route (streaming)
     │
     ▼
Claude API — system prompt includes DB schema + PostGIS reference
     │  Claude calls run_spatial_query tool with validated SQL
     ▼
Supabase Postgres + PostGIS — RLS enforced
     │  Returns GeoJSON FeatureCollection
     ▼
Streamed back to client
     │
     ▼
MapLibre GL renders geometry + deck.gl H3 layer
Claude streams plain-English summary of findings
```

### Component map

```
app/
  (public)/
    page.tsx              — Landing: hero map, example queries, CTA
    explore/page.tsx      — Public map + AI chat + city selector
  (auth)/
    sign-up/page.tsx
    sign-in/page.tsx
    workspace/[id]/
      page.tsx            — Dashboard
      map/page.tsx        — Full map + AI assistant + layer controls
      data/page.tsx       — Upload & manage GTFS feeds
      analyses/page.tsx   — Saved analyses + shareable links
  api/
    chat/route.ts         — Vercel AI SDK streaming endpoint
    ingest/gtfs/route.ts  — GTFS zip parse + load
    ingest/lodes/route.ts — LODES batch import
```

---

## Database Schema (Phase 1)

### Public/preloaded tables

```sql
-- GTFS core
agencies (id, feed_id, name, url, timezone, geometry point)
routes (id, feed_id, agency_id, short_name, long_name, type, color)
stops (id, feed_id, name, geometry point, wheelchair_boarding)
trips (id, feed_id, route_id, service_id, headsign, direction)
stop_times (trip_id, stop_id, arrival, departure, sequence)
shapes (id, feed_id, geometry linestring)
calendar (service_id, feed_id, days[], start_date, end_date)
calendar_dates (service_id, feed_id, date, exception_type)
gtfs_feeds (id, city, state, agency_name, loaded_at, is_public)

-- Census + employment
census_tracts (geoid, state_fips, geometry polygon, pop, median_income,
               pct_nonwhite, pct_zero_vehicle, pct_poverty)
lodes_od (w_geocode, h_geocode, S000, SA01, SA02, SA03, year, state)
-- w=work block, h=home block, S000=total jobs, SA01/02/03=age cohorts

-- Workspace uploads
workspace_gtfs_feeds (id, workspace_id, feed_name, status, loaded_at)
-- inherits same GTFS tables scoped by workspace_id
```

### Auth + workspace tables

```sql
workspaces (id, name, slug, plan, created_at)
workspace_members (workspace_id, user_id, role)  -- RLS enforced
analyses (id, workspace_id, title, query_text, result_geojson,
          sql_executed, created_at, is_public, share_token)
```

---

## AI Query Pipeline Detail

**System prompt context given to Claude:**
- Full schema of all spatial tables with column descriptions
- PostGIS function reference (ST_DWithin, ST_Distance, ST_Intersects, ST_Buffer, ST_AsGeoJSON)
- Constraints: SELECT only, no schema changes, max 10,000 rows returned
- Output format: always return GeoJSON FeatureCollection + summary stats

**Tool Claude can call:**
```typescript
run_spatial_query({ sql: string, description: string })
// Server validates: SELECT-only, references only allowed tables,
// enforces workspace_id scope, executes with 5s timeout
```

**Safety:** Parameterized queries, allowlist of table names, regex to block DML/DDL, Supabase RLS as final backstop.

---

## Data Ingestion

### GTFS auto-ingestion (public feeds)
- Cron job (Vercel cron or Supabase pg_cron) weekly: fetch feed list from Mobility Database API
- Parse zip → insert into normalized tables → build PostGIS indexes
- Top 100 US agencies by ridership preloaded at launch

### LODES batch import
- Download state files from Census LEHD API
- Stream CSV → Postgres COPY for efficiency
- All 50 states = ~15GB, stored in Supabase

### Workspace GTFS upload
- User uploads zip → Supabase Storage
- Edge Function triggered → parse + load into workspace-scoped tables
- Status updates via Supabase Realtime

---

## Open Source Setup

- **License:** MIT
- **Repo structure:** Single Next.js monorepo, `supabase/` directory for migrations and edge functions
- **Local dev:** `supabase start` + `pnpm dev` — full stack runs locally
- **README:** One-click Vercel deploy button, environment variable guide
- **Contributing:** `CONTRIBUTING.md` with PR process, `docker-compose.yml` for devs who prefer Docker

---

## Future Phases (post Phase 1)

- **Phase 2:** Civic engagement pipeline — GIS-connected surveys, community input flows into map layers
- **Phase 3:** Scenario planner — paint land use changes, see real-time accessibility/equity/emissions impacts
- **Phase 4:** Federal compliance tracker — NEPA milestones, LAPM form automation, DBE reporting

---

## Success Metrics for Phase 1 Launch

- Any agency planner can get a meaningful transit equity analysis in under 60 seconds
- Works for all 100 preloaded cities with no login
- GTFS upload to first analysis under 5 minutes for workspace users
- Costs $0 to use forever (free tier)
