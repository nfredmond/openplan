# OpenPlan Deep Dive: Complete Inventory of Prior Work
_Date: 2026-02-24 | Author: Bartholomew (COO)_

## Sources Examined
1. **Local repos:** `SaaS/` and `Saas.Claude/` (file trees, git history, all .md docs, source code, migrations)
2. **GitHub (nfredmond):** All 30 repos inventoried; 12+ directly related to this platform
3. **Google Drive:** 4 key documents downloaded and read in full
4. **promt1.md:** The 10-section comprehensive research document (identical in both repos)
5. **Existing workspace docs:** rollout plan v1, feature parity matrix, sprint checklist, master backlog, ADR-001

---

## Prior Attempts (Chronological)

### 1. Planning_Tool (Mar 2025)
- No description, early experiment

### 2. DOT_Dashboard_2.0 (Feb 2025)
- First DOT dashboard attempt

### 3. project_prioritization (Feb 2025)
- Project prioritization tool for RTPAs in California

### 4. Demand_Model_o3-mini & Demand_Model_grok3 (Mar 2025)
- FastAPI + React demand model attempts using different AI models
- GPU-accelerated CuPy, AequilibraE, PostgreSQL/PostGIS, Redis/Celery
- Docker-based with JWT auth

### 5. Planning-Manager (Apr 2025)
- Project prioritization tool for transportation planners

### 6. DOT-Dashboard (Jul 2025) — "Planning Manager v7"
- **THE MOST COMPLETE PRIOR ATTEMPT**
- Full-stack Next.js app at planningmanager.ai
- Features: Project management, BCA, GreenChAMP (chained activity model), TrendNavigator (scenario planning), public engagement, AI analysis, Mapbox GL JS
- Tech: Next.js 15, React 19, Prisma, Supabase, Mapbox, OpenAI + Anthropic, Tailwind
- Had comprehensive system architecture doc
- Google Doc "APP OVERVIEW" is a 846KB Claude analysis of this codebase
- **Problem:** Over-engineered, too many features at once, build issues (ignoreBuildErrors: true, ignoreDuringBuilds: true)

### 7. transitscore-3d (Oct 2025)
- Sacramento development site analyzer
- Walk/bike isochrone analysis, VMT/GHG calculations, AI density recommendations
- Next.js 14, Supabase, Leaflet, deck.gl, Claude AI
- Had monetization: free + $20/mo Pro tier
- **Useful patterns:** network-based accessibility, scenario comparison, PDF reports

### 8. planning_manager_2.0 (Oct 2025)
- Another planning manager iteration

### 9. FreeChAMP (Nov 2025)
- **THE MOST AMBITIOUS PRIOR ATTEMPT**
- "Free Chained-Activity Modeling Platform" — open-source web-based ABM
- Next.js 15, React 19, tRPC, PostGIS + TimescaleDB, MapLibre + deck.gl, AWS Batch + Celery
- Monorepo (apps/web), Sentry, 25+ E2E tests
- Features: ActivitySim-based ABM, 6-step model run wizard, AI chat with RAG + function calling, GTFS/Census/OSM data integration, 8 map layer types, CSV/Excel/PDF export
- **Most complete modeling implementation** but likely never reached production stability

### 10. python-demand-model (Nov 2025)
- Pure Python demand model
- Census API, OpenStreetMap, TIGER/Line TAZ
- Trip generation + gravity model distribution
- Folium maps, multiple export formats
- **Good reference for core modeling algorithms**

### 11. demandmodel_11.13.25 (Nov 2025)
- "Transportation Demand Model attempt with Claude Code"
- Python-based, another approach at the same problem

### 12. planpulse (Nov 2025)
- Appears to be a fresh Next.js scaffold, minimal content

### 13. SaaS (Feb 2026)
- Strong prototype with good UX and report generation
- Markdown docs: ARCHITECTURE.md, MVP.md, ROADMAP.md, DATA_SOURCES.md

### 14. Saas.Claude/openplan (Feb 2026) — CANONICAL
- Current canonical repo per ADR-001
- Next.js 16, Supabase + PostGIS, MapLibre + deck.gl, Vercel AI SDK
- 6 Supabase migrations (GTFS, census, LODES, workspace schemas)
- **Now has:** auth forms, route protection, analysis API, runs persistence, corridor upload, run history, report generation, explore workspace

---

## Key Google Docs

### "Plan for Developing a Web-Based Chained-Activity Travel Demand Model" (Oct 2025)
- 68KB, 276 lines — the original vision document
- Describes: ActivitySim-based ABM, tour-based simulation, Supabase + PostGIS, Mapbox, AI assistant, multi-user roles
- Includes detailed front-end, back-end, database, external data, AI integration, security, deployment, marketing, and roadmap sections
- **Key insight:** This is the FULL vision — everything from synthetic populations to scenario comparison to PDF reports to global expansion
- Contains a detailed AI prompt for implementation at the end

### "CAMP Integration Technical Implementation Guide" (Mar 2025)
- 65KB — a complete technical guide for integrating the Chained Activity Modeling Process
- Covers: database schema (multi-tenant with RLS), API development, GIS mapping (Leaflet + PostGIS), model execution (real-time + batch), AI integration (Claude + OpenAI Agent SDK), scenario development, performance optimization, reporting
- Includes working SQL migrations, TypeScript API route examples, Python/Node worker scripts
- **Most implementation-ready document** — can be directly adapted

### "APP OVERVIEW" (May 2025)
- 846KB — massive Claude analysis of the DOT-Dashboard/Planning Manager v7 codebase
- Full dependency analysis, architecture review, system status

### "promt1.md" (research document, in both repos)
- 10-section comprehensive market/technology research
- Covers: ABM state-of-art, SaaS market, civic engagement, construction tracking, data sources, AI in transport, GIS stack, scenario planning, emerging tech, federal compliance
- **Excellent competitive intelligence** — identifies exact market gaps OpenPlan should fill

---

## What Worked (Salvageable Patterns)

1. **FreeChAMP's model run wizard** — 6-step guided process for configuring ABM runs
2. **DOT-Dashboard's GreenChAMP/TrendNavigator** — scenario planning with side-by-side comparison
3. **transitscore-3d's monetization model** — free + paid tier with Supabase
4. **python-demand-model's core algorithms** — trip generation + gravity model in clean Python
5. **CAMP Integration Guide's SQL schema** — multi-tenant with RLS, ready to adapt
6. **promt1.md's tech stack recommendation** — MapLibre + deck.gl + PostGIS + DuckDB + PMTiles + H3
7. **SaaS repo's report generation** — clean HTML report templates

## What Killed Previous Attempts

1. **Scope explosion** — every attempt tried to build everything at once (ABM + engagement + BCA + project management + AI + construction tracking)
2. **Framework churn** — bouncing between Leaflet/Mapbox/MapLibre, Prisma/raw Supabase, FastAPI/Next.js API routes
3. **No incremental delivery** — never got a single workflow reliable before adding the next feature
4. **Build/type issues ignored** — `ignoreBuildErrors: true` in DOT-Dashboard signals technical debt was accumulating faster than features
5. **Solo developer + AI pair programming** — generated large codebases but couldn't maintain or debug them
6. **No customer validation** — built features without confirming agencies would pay for them

---

## Revised Strategic Assessment

### The Vision Is Sound
The market research in promt1.md is genuinely excellent. The gap is real: small/rural agencies can't afford Replica ($50K+/yr), StreetLight, or Via Intelligence. An affordable, AI-assisted planning tool would have genuine demand — especially one that can help with grant applications (ATP, SS4A, RAISE) which these agencies desperately need.

### The MVP Must Be Radically Smaller
Every prior attempt failed by trying to build the full vision. The sellable MVP should be:

**One workflow, done perfectly: "Upload a corridor → get an accessibility + equity analysis → generate a grant-ready report"**

This is what small agencies actually pay consultants $15K-$50K to do for ATP/SS4A applications. If OpenPlan can do it in 15 minutes for $599/mo, agencies will buy it.

### What the MVP Does NOT Need (Yet)
- Full ABM / ActivitySim integration
- Construction tracking
- Public engagement suite
- Real-time transit data
- Scenario comparison engine
- Custom synthetic populations
- Network assignment

All of that is Phase 2+ after we have paying customers.
