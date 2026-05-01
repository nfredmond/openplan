# OpenPlan Full OS Roadmap

**Date:** 2026-05-01  
**Status:** Active product roadmap  
**Primary buyer:** rural RTPA / county  
**Delivery assumption:** small team, 3-5 builders  
**Roadmap horizon:** 18 months

## Product Truth

OpenPlan should become the open-source, evidence-backed planning operating system for regional transportation and community planning. The finished product is not a dashboard, project tracker, GIS viewer, or AI writing tool. It is a shared planning workbench where projects, plans, funding, maps, models, engagement, deliverables, invoices, and audit evidence stay connected.

Near-term commercial posture remains narrower:

- Apache-2.0 open-source planning software.
- Nat Ford managed hosting, onboarding, implementation, support, and planning services.
- Supervised planning workbench before broad self-serve SaaS.
- Evidence-backed planning intelligence before autonomous AI or legal/compliance automation claims.

## Phase 0 - Proof Repair And Release Baseline

**Target:** weeks 0-2

Goal: make current proof machinery match the current product before adding broad surface area.

Ship:

- Public demo preflight aligned to current `/request-access` service-intake positioning.
- Admin Pilot Readiness parsing that treats existing line-item `PASS:` evidence as passing proof when no explicit status header exists.
- Fresh `docs/ops/README.md` index entries for the current roadmap and recent proof packets.
- Clean local Mapbox posture: browser token values must be public `pk.*` values, never `sk.*`.
- UI/UX settle proof pack from the 2026-04-29 checkpoint.
- Fresh release-candidate proof log: lint, test, build, audit, prod health, public preflight.

Exit gate:

- The proof tools, admin readiness surface, public service-intake page, and docs index agree on the current product truth.

## Phase 1 - Shared Planning Spine

**Target:** months 1-3

Goal: harden the shared foundation so every module writes to one durable planning record instead of creating second truth stores.

Ship:

- Workspace/org/team roles, including agency staff plus consultants.
- Project database as the canonical spine for location, geometry, status, phase, cost, funding, comments, documents, model links, grants, deliverables, invoices, and audit history.
- Shared evidence packets, evidence links, dataset records, map layers, workflow tasks, approvals, exports, reports, and audit events.
- Dashboard command center showing active plans, projects, grants, unresolved comments, stale evidence, model review, invoice/reimbursement work, and next actions.

Exit gate:

- A rural county can enter a project once and reuse it across RTP, funding, map, report, engagement, and evidence-packet surfaces.

## Phase 2 - Rural County Planning OS v1

**Target:** months 3-6

Goal: make the first complete customer workflow credible for a rural RTPA/county.

Ship:

- RTP, ATP, LRTP, and corridor-plan workflow patterns: horizon, project list, goals, measures, datasets, current conditions, scenarios, engagement, funding, chapters, QA, export, adoption record.
- Programs and funding cycle tracking for RTIP/STIP/ATP/HSIP/local capital programs, eligibility, scoring, match, deadlines, obligation, expenditure, and reimbursement posture.
- Grants OS with transparent readiness factors, evidence used, missing data, risks, confidence, and next action.
- Board-ready and grant-ready exports: project sheets, maps, funding tables, engagement summaries, draft chapters, evidence packets.

Exit gate:

- A county ATP/RTP demo can run from project intake to board-ready packet and grant-ready project package without leaving the OpenPlan spine.

## Phase 3 - Engagement, GIS, Data Hub, And Public Portal

**Target:** months 6-9

Goal: make public participation, map work, and data lineage first-class planning evidence.

Ship:

- Public portal for project maps, plan pages, comment forms, surveys, document libraries, draft review pages, and status updates.
- Staff moderation, tagging, duplicate review, response assignment, comment matrices, engagement summaries, and report appendices.
- GIS imports/exports for GeoJSON, CSV coordinates, KML/KMZ, shapefile path, ArcGIS REST services, GTFS, Census/ACS, LODES/LEHD, OSM, and state/open-data sources.
- Data Hub lineage: source, URL/API, license, geography, vintage, update frequency, owner, quality, field definitions, geometry type, transforms, QA status, citation text, and dependent reports/maps.

Exit gate:

- Every public-facing report claim can trace to datasets, comments, project records, maps, assumptions, reviewer notes, and export history.

## Phase 4 - Modeling And Scenario OS

**Target:** months 8-13

Goal: support honest planning analysis, not black-box forecasting claims.

Ship:

- Level 1 sketch planning: trip-generation approximations, VMT screening, accessibility, safety, emissions, equity, benefit estimates, and before/after corridor measures.
- Production-supported AequilibraE/network-assignment lane: network import/build, zones, OD demand, assignment runs, link volumes, bottlenecks, scenario comparison, and evidence packets.
- Scenario comparison for cost, funding gap, VMT, accessibility, travel time, equity, safety, emissions, population/jobs served, public support, grant competitiveness, and implementation risk.
- ActivitySim beta with explicit caveats, job status, artifacts, assumptions, evidence packets, and refusal gates when callers attempt unsupported decision use.

Exit gate:

- A county can compare No Build, constrained, safety, active transportation, and transit scenarios with maps, tables, narrative, citations, and caveats.

## Phase 5 - Aerial, Asset, And Field Evidence

**Target:** months 10-15

Goal: make drone, field, and asset records evidence in the planning system, not a disconnected side app.

Ship:

- Aerial mission planning, AOI, DJI KMZ import/export, terrain/checklist posture, imagery links, processed output packages, and project/report attachment.
- Asset and field collection for sidewalks, curb ramps, crosswalks, bike lanes, signs, pavement, culverts, bridges, transit stops, trails, ADA barriers, hazards, drainage, lighting, photos, condition, severity, notes, action, cost, priority, and related project.
- Report and grant exhibit generation from aerial/asset records.

Exit gate:

- Aerial and field evidence can support project records, grant applications, public comment responses, and plan exhibits through the same evidence packet model.

## Phase 6 - Collaboration, AI, Integrations, And GA Hardening

**Target:** months 12-18

Goal: finish the OS with operational collaboration, supervised AI, integrations, and production hardening.

Ship:

- Assignments, tasks, internal notes, public/private comments, review states, approvals, version history, change logs, submittal packages, and consultant/agency reviewer roles.
- Supervised AI planning assistant for cited drafts, summaries, missing-evidence checks, staff reports, board summaries, comment themes, model-result explanations, QA checklists, and plain-language public summaries.
- Integrations that serve the spine: ArcGIS/QGIS exports, Mapbox, Google Drive, SharePoint path, calendar, Slack/Teams, email, Census, Caltrans/state portals, Socrata/open data, GTFS, OSM, drone/photogrammetry tools, billing, and private hosting/SSO path.
- GA operations: backup/restore runbook, incident runbook, monitoring for CSP reports, billing/webhook failures, body-limit events, action audit failures, support SLA, and escalation path.

Exit gate:

- Production pilots can run normal planning workflows without bespoke operator intervention, and every major output has traceable evidence, review history, export history, and caveat boundaries.

## Non-Negotiable Gates

- No broad `SECURITY DEFINER` query pass-throughs; keep scoped RPCs/API routes plus RLS.
- No new planning write without stale-marking or readiness recalculation for dependent reports, packets, scenarios, grants, and public outputs.
- No AI output without citations, editable text, human review posture, export history, and audit logging.
- No modeling claim beyond the current proof boundary; ActivitySim remains beta until calibrated and externally validated.
- No legal-grade LAPM/compliance automation claims before source-backed workflows and professional review gates exist.
- No generic SaaS card-grid UI drift; keep the civic workbench posture from the frontend constitution.

## Standard Release Proof

Run before any external release or paid-pilot proof packet:

```bash
cd openplan
pnpm lint
pnpm test
pnpm build
pnpm audit --prod --audit-level=moderate
pnpm ops:check-prod-health
pnpm ops:check-public-demo-preflight
```

Additional proof required when local dependencies are available:

```bash
cd openplan
pnpm ops:check-public-demo-preflight -- --mapbox-env-file .env.local
pnpm ops:check-admin-operations-smoke -- --reviewer-email <operator-reviewer-email>
pnpm seed:workspace-isolation
```
