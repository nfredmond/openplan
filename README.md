# OpenPlan

OpenPlan is Apache-2.0 open-source planning software for transportation and land-use teams — an operating system for a planning department where the map is the worksurface, every number carries its provenance, and AI assistance is auditable end to end.

## What it does

- **Cartographic workbench** — a live map behind every screen with projects, corridors, RTP cycles, equity tracts, and community comments as clickable layers, plus an inspector-driven workflow shell.
- **Projects & delivery** — project control rooms with milestones, submittals, deliverables, risks, decisions, meetings; an invoice register with retention math; award closeout gated on 100% reimbursement (Caltrans LAPM-style delivery discipline as workflow).
- **Grants** — a pipeline from funding need → opportunity → decision → award → reimbursement, a curated catalog of real CA/federal programs with one-click tracking, and AI-drafted narratives where every factual sentence must cite a verifiable workspace fact (per-sentence grounding validation, unverified sentences flagged).
- **Community engagement** — public map-based commenting via share links: points, drawn lines, and drawn areas, optional photo attachments (private until approved), "Support" votes, and a staff moderation queue in front of everything public.
- **Analysis Studio** — corridor analysis over live Census/OSM/FARS data with equity screening, composite scores, and grant-ready report generation; fallback estimates are always labeled "Estimated," never silently substituted.
- **Transportation modeling** — screening-grade network model runs (AequilibraE worker) with KPIs, evidence packets, claim-grade gating, and a CEQA §15064.3 VMT screen with downloadable statutory memos.
- **RTP & programming** — RTP cycle workrooms with chapter drafting, linked project portfolios, funding rollups, and board-packet exports; RTIP/STIP program registries.
- **Planner Agent** — a copilot grounded in workspace data (streaming AI chat with a deterministic fallback), executable actions behind hash-verified, single-use, time-limited approvals, and a visible audit ledger of every action.

Nat Ford Planning builds and maintains the project. The commercial model is services around the open-source core:

- managed hosting and workspace administration;
- implementation, onboarding, and staff training;
- support retainers and operational QA;
- planning services for RTP, ATP, grants, engagement, and project-list workflows;
- custom extensions, integrations, reports, and AI-assisted workflow buildouts.

Stripe/billing code remains in the repository because Nat Ford-operated hosted workspaces need payment, entitlement, usage, and support infrastructure. That infrastructure is for managed hosting and services; it is not intended to turn the Apache-2.0 core into a closed source license.

## Repository layout

- `openplan/` — main Next.js application.
- `docs/` — product, proof, operations, governance, and planning documentation.
- `qa-harness/` — local and production smoke-check scripts.
- `scripts/` — validation, modeling, and operator utilities.
- `schemas/` — reusable schemas.
- `workers/` — Python modeling workers (AequilibraE screening runs, county validation).

## Development quick start

```bash
cd openplan
npm install
npm exec supabase start      # local Postgres + Auth + Storage (Docker)
npm exec supabase db reset   # apply all migrations
npm run seed:nctc            # optional: seed the Nevada County demo workspace
npm run dev                  # http://localhost:3000
```

Useful gates:

```bash
npm run lint
npm test
npm run build
npm run qa:gate   # lint + tests + dependency audit + production build
```

To demo publicly from a laptop, see `docs/ops/2026-07-17-v1-demo-runbook.md`.

Command note: package scripts are invoked with `npm run …` in current operator docs because `package-lock.json` is canonical and npm is the most reliable baseline on this host. The app pins `packageManager` to npm, while `npm run qa:gate` explicitly pins `pnpm@10.33.0` and disables Corepack strict package-manager enforcement for the production audit lane. Legacy proof logs may still cite bare `pnpm` commands.

## License boundary

Unless otherwise marked, source code is licensed under the Apache License, Version 2.0. See `LICENSE` and `LICENSE-NOTICE.md`.

The license does not grant rights to Nat Ford Planning trademarks, logos, private credentials, client confidential information, third-party datasets, third-party media, or client-specific deliverables unless those materials are explicitly included under the same license.

## Capability boundaries

OpenPlan states its limits as plainly as its strengths — several are enforced by tests. Modeling outputs are screening-grade with caveats attached, not calibrated or validated forecasting. LAPM support is delivery tracking and an invoice register, not exact Caltrans exhibit/E-76 form generation. Aerial operations cover mission and evidence tracking; imagery-to-orthomosaic processing is on the roadmap. It should not be described as a finished autonomous municipal SaaS or a substitute for qualified planning review.
