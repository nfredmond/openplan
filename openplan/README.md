# OpenPlan

OpenPlan is Apache-2.0 open-source transportation and land-use planning software for small agencies, tribes, counties, RTPAs, transportation commissions, and consultancies that need credible planning workflows without black-box enterprise software.

Nat Ford Planning's commercial model is services around the open-source core: managed hosting, onboarding, implementation, support, planning services, and custom extensions.

## Current product truth

OpenPlan is currently strongest as a **supervised planning workbench with optional Nat Ford managed hosting**, not a broad self-serve municipal SaaS.

What is real now:
- authenticated planning workspace flows,
- projects, plans, programs, models, reports, and scenarios,
- engagement campaigns and public/share intake,
- geospatial analysis surfaces and report traceability,
- county-run onboarding/scaffold workflows,
- bounded billing/admin and managed-hosting/support operations.

What is **not** currently an honest broad claim:
- validated forecasting,
- behavioral-demand readiness,
- full LAPM/legal-grade compliance automation,
- fully autonomous self-serve onboarding,
- a finished all-in-one planning suite across the entire original vision,
- or a proprietary subscription-first software whose core value is hidden from agencies.

For the canonical April 2026 product boundary, start here:
- `../docs/ops/2026-04-07-openplan-v1-status-memo-refresh.md`
- `../docs/ops/2026-04-05-openplan-supervised-external-pilot-packet.md`
- `../docs/ops/README.md`

## Repository structure

This repo has multiple layers. The main Next.js product app lives in `openplan/`.

- `openplan/` — main Next.js application
- `docs/` — product, ops, governance, proof, and planning docs
- `qa-harness/` — production/local smoke and UX review harnesses
- `scripts/` — modeling, validation, and support utilities
- `workers/` — supporting worker deployment paths where applicable

## App stack

- Next.js 16 (App Router)
- TypeScript
- Supabase (Postgres, Auth, Storage, PostGIS)
- Mapbox GL JS + deck.gl
- Tailwind CSS
- Vercel

## Main product surfaces

Current authenticated product surfaces include:
- Dashboard
- Projects
- Plans
- Programs
- Models
- Reports
- Scenarios
- Data Hub
- Engagement
- Billing
- County Runs
- Admin / pilot-readiness tools

## Development

Run commands from the `openplan/` app directory.

```bash
cd openplan
pnpm install
pnpm dev
```

Then open:
- `http://localhost:3000`

Useful commands:

```bash
pnpm dev
pnpm build
pnpm test
pnpm lint
```

## Documentation guide

If you need current truth instead of historical aspiration, prefer the ops docs over older design docs.

Recommended reading order:
1. `../docs/ops/README.md`
2. `../docs/ops/2026-04-07-openplan-v1-status-memo-refresh.md`
3. `../docs/ops/2026-04-05-openplan-supervised-external-pilot-packet.md`
4. `../docs/ops/2026-04-08-openplan-user-md-alignment-memo.md`

## Product positioning discipline

Use disciplined language.

Safe current posture:
- production-backed,
- supervised pilot ready,
- planning-domain continuity,
- evidence-accurate,
- guided onboarding.

Unsafe overclaims:
- proprietary, subscription-first software,
- fully launched self-serve SaaS,
- validated forecasting platform,
- complete LAPM automation,
- universally proven modeling engine.

## Bottom line

OpenPlan is a real planning product with real production-backed workflows and an open-source-first posture.

It is not finished, but it is well beyond prototype theater. Treat it as serious Apache-2.0 planning software with optional Nat Ford managed services, and keep all external claims inside the current evidence boundary.
