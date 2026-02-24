# OpenPlan vs SaaS Prototype Feature Parity Matrix

## Scope
This matrix compares the current `openplan` repository against the existing prototype in `/mnt/c/Users/nfred/code/SaaS/saas-platform` and assigns import priority for a sellable transportation-planning MVP.

Priority legend:
- `P0`: Required for MVP sale/pilot readiness in Sprint 0-1.
- `P1`: Important after core workflow works end-to-end.
- `P2`: Nice-to-have or optimization.

## Matrix
| Feature Area | SaaS Prototype Status | OpenPlan Current Status | Priority | Import / Implementation Notes |
|---|---|---|---|---|
| Core analysis workspace UI | Present (`src/app/page.tsx`) with query input, analysis controls, metrics/layers, and run comparison patterns | Not present yet (only baseline app shell before Sprint 0) | P0 | Rebuild as modular workspace flow in OpenPlan dashboard route and feature modules. Keep state and API contracts explicit from day one. |
| Corridor boundary upload (GeoJSON) | Present in prototype dashboard flow | Not present | P0 | Implement file upload + geometry validation + server handoff. Start with `Polygon`/`MultiPolygon` only. |
| Analysis API endpoint | Present: `POST /api/analysis` with input validation and deterministic metric output | Not present | P0 | Stand up `app/api/analysis/route.ts` in OpenPlan with strict schema and workspace scoping. Wire to Supabase-backed job/run records. |
| Run history (list/search/delete/clear) | Present: `GET/DELETE /api/runs` | Not present | P0 | Build MVP CRUD around run entities, but store in Supabase tables (not file JSON). Include pagination and basic filtering. |
| Report generation API (PDF) | Present: `POST /api/report` using `@react-pdf/renderer` | Not present | P1 | Import after core run flow is stable. Start with one template, then extend. |
| Report history + re-download | Present: `GET/DELETE /api/reports`, `GET /api/reports/[id]/download` | Not present | P1 | Preserve payload snapshot strategy to enable deterministic re-download. Include audit metadata for enterprise buyers. |
| Backup/restore of runs and reports | Present: `GET /api/backup`, `POST /api/restore` with merge/replace modes | Not present | P2 | Defer until multi-workspace data lifecycle requirements are clearer. Replace with DB export tooling later if needed. |
| Interactive map visualization (MapLibre + deck.gl) | Present: `MapView.tsx` with boundary, sample points, and hex overlays | Libraries installed, no integrated map view in app routes | P1 | Reuse stack and move toward real layer rendering from backend outputs. Keep map component isolated and client-only. |
| Template-driven report UX (corridor + SS4A) | Present in report page and PDF generator | Not present | P1 | Start with corridor template for first pilot; add SS4A variant once core data quality is proven. |
| Local derived JSON persistence (`data/derived`) | Present for runs/reports storage | OpenPlan uses Supabase foundation and SQL migrations | P0 (concept), not implementation | Do not import file-based persistence; map concept to relational tables and row-level security. |
| Restore validation and dedupe logic | Present in `/api/restore` | Not present | P2 | Useful reference for import tooling, but not first-customer critical. |
| Supabase auth/middleware baseline | Minimal in prototype | Present (`src/middleware.ts`, `src/lib/supabase/*`) | P0 (continue) | Expand into full auth gating for workspace routes and onboarding flow. |
| Transportation data schema baseline (GTFS/workspace/storage migrations) | Prototype does not include equivalent schema depth | Present in `supabase/migrations/*` | P0 (continue) | Treat as OpenPlan differentiator. Next step is binding schema to functional API endpoints and UI. |

## Recommended Import Sequence
1. `P0`: End-to-end corridor analysis workflow in OpenPlan (`auth -> workspace -> run created -> results shown -> run history visible`).
2. `P1`: Report generation/history + map enrichment and layer controls.
3. `P2`: Backup/restore and advanced admin data tooling.

## Immediate Gaps Blocking MVP
- No integrated analysis workspace route with real interactions yet.
- No OpenPlan API endpoints for analysis/run/report lifecycle.
- No authenticated workspace flow tied to persistent run/report records.

## Definition of “Parity Enough” for MVP Sale
- A transportation planner can sign in, run at least one corridor analysis, review key metrics, and save/re-open prior runs.
- The system can produce at least one professional export artifact (report) from a saved run.
- Workspace data persists reliably per tenant/workspace with auditable timestamps.
