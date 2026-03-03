# OpenPlan Master Backlog

## Epic 0 — Repo Consolidation
- [ ] ADR-001 Canonical repository decision
- [ ] Inventory reusable components from `SaaS/saas-platform`
- [ ] Retire/Archive duplicate branches

## Epic 1 — Multi-tenant Foundation
- [ ] Validate all Supabase migrations in cloud project
- [ ] Workspace bootstrap trigger QA
- [ ] Role-based access policies tested
- [x] Wire sign-up/sign-in screens to Supabase auth (local app)
- [x] Protect workspace route group with server-side auth check
- [ ] Add sign-out + session UX polish in workspace nav

## Epic 2 — Ingestion Pipeline
- [ ] GTFS ingestion happy-path + failure handling
- [ ] ACS + LODES ingestion with reproducible snapshots
- [ ] Data lineage log table and quality checks

## Epic 3 — Analysis Engine
- [ ] Accessibility analysis v1
- [ ] HIN safety analysis v1
- [ ] Equity analysis v1
- [ ] Run persistence + versioned parameters

## Epic 4 — Reports & Exports
- [ ] 2-4 page client-ready PDF templates
- [ ] CSV/GeoJSON exports
- [ ] Run comparison report

## Epic 5 — Productization
- [ ] Subscription plans + billing
- [ ] Organization onboarding flow
- [ ] Support/admin dashboard

## Epic 6 — Pilot Launch
- [ ] Pilot agency setup templates
- [ ] Demo script + demo data packs
- [ ] Case study generation workflow

## Epic 7 — AI Copilot & Grant Lab Parity (OpenPlan)
- [ ] Bring Grant AI Lab workflow into OpenPlan (step-based intake → draft generation → revision chat → export)
- [ ] Preserve parity UX: required-field clarity, progressive disclosure, sample loader, keyboard send behavior
- [ ] Add productivity controls: copy latest draft, copy executive summary, autosave indicators
- [ ] Add usage controls parity: persistent rate limits + budget tracking with member/guest policy
- [ ] Add conversation-integrity safeguards (server-side trusted history / user-turn sanitization)

## Epic 8 — Geospatial Intelligence UX (Mapbox + CARTO)
- [ ] Standardize OpenPlan map UX on Mapbox for interactive planning views and lightweight static previews
- [ ] Add map-linked context in AI tools (location-aware recommendations + map snapshots where useful)
- [ ] Introduce CARTO Terminal integration lane for advanced spatial analysis workflows (phased rollout)

## Epic 9 — Census-backed Data Attribution
- [ ] Add Census API connector for up-to-date available ACS/Decennial pulls in AI workflows
- [ ] Require source citation blocks (dataset, vintage, geography, retrieval URL) whenever Census values are returned
- [ ] Implement graceful fallback when Census lookup fails (no fabricated values, clear uncertainty language)
