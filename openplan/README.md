# OpenPlan

OpenPlan is Apache-2.0 open-source transportation and land-use planning software for agencies,
tribes, counties, cities, RTPAs/MPOs, transportation commissions, and consultancies that need
credible planning workflows without black-box enterprise software.

OpenPlan is free. There is no paid tier, no plan, no usage quota, and no payment step — sign up
and every feature is available. Anyone can run it locally or self-host it; see
`docs/SELF_HOSTING.md`.

## Current product truth

OpenPlan is **self-serve and free**: sign up and a workspace is provisioned immediately, teammates
join by invitation, and no operator is involved. Its depth is uneven by module, and the honest
claim boundaries below matter more than the feature list.

What is real now:

- authenticated multi-tenant workspaces with row-level security,
- projects, plans, programs, models, reports, and scenarios,
- engagement campaigns with a public comment map, surveys, and share/embed intake,
- screening-grade travel demand modeling with disclosed evidence tiers,
- grant opportunity tracking with grounded AI narrative drafting,
- RTP cycle tracking with priority scoring and a public share view,
- Caltrans LAPM grant-reimbursement invoicing,
- geospatial analysis surfaces and report traceability,
- county-run validation workflows.

What is **not** an honest claim:

- validated forecasting (modeling outputs are screening-grade and say so),
- full LAPM/legal-grade compliance automation,
- a finished all-in-one planning suite — several modules are deliberately deeper than others.

## Repository structure

The main Next.js product app lives in `openplan/` (this directory). From the repo root:

- `openplan/` — main Next.js application
- `docs/` — documentation (see `docs/README.md` at the repo root for the map)
- `qa-harness/` — production/local smoke and UX review harnesses
- `scripts/` — modeling, validation, and support utilities
- `workers/` — Python modeling workers (AequilibraE screening, county onramp, ActivitySim)

## App stack

- Next.js 16 (App Router)
- TypeScript
- Supabase (Postgres, Auth, Storage, PostGIS)
- Mapbox GL JS + deck.gl
- Tailwind CSS
- Vercel-compatible deployment (self-hosting supported; see `docs/SELF_HOSTING.md`)

## Main product surfaces

- Dashboard and Command Center
- Projects (the hub — everything links back here)
- Plans, Programs, RTP Cycles
- Grants and funding awards
- Reports (board packets, PDF pipeline)
- Invoicing (Caltrans LAPM reimbursement)
- Engagement (public comment mapping, surveys)
- Models, Scenarios, County Validation, Analysis Studio
- Safety, Data Hub, Knowledge Base, Aerial Ops

## Development

Run commands from the `openplan/` app directory.

```bash
cd openplan
npm install
npm run dev
```

Then open `http://localhost:3000`. Full local setup (Supabase, env vars, seeding) is in
`docs/SELF_HOSTING.md`.

Useful commands:

```bash
npm run dev
npm run build
npm test
npm run lint
npm run qa:gate   # lint + tests + dependency audit + build — the pre-ship gate
```

Package commands use npm because `package-lock.json` is canonical for installs and CI. The release
gate still runs `COREPACK_ENABLE_STRICT=0 corepack pnpm@10.33.0 audit --prod --audit-level=moderate`
through `npm run qa:gate`, so keep `pnpm-lock.yaml` current when dependencies change.

## Claim discipline

Public copy stays inside the evidence boundary:

- say `screening-grade` when evidence is screening-grade;
- say `human-reviewed` when professional judgment is required;
- never claim validated forecasting, complete compliance automation, or uniform module depth.

## Bottom line

OpenPlan is a real planning product with real production-backed workflows, free and open source,
built to be used self-serve by anyone. It is not finished — and where it is not, it says so
instead of pretending.
