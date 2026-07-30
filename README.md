# OpenPlan

OpenPlan is Apache-2.0 open-source planning software for transportation and land-use teams — an operating system for a planning department where the map is the worksurface, every number carries its provenance, and AI assistance is auditable end to end.

## What it does

- **Cartographic workbench** — a live map behind every screen with projects, study corridors, RTP cycles, aerial missions, equity tracts, and community comments as clickable layers, plus an inspector-driven workflow shell. Every layer is fillable from inside the app: equity tracts load on demand from the US Census Bureau for a workspace's own county, and when a layer draws nothing it says whether that is an empty record or a limit of the data.
- **Projects & delivery** — project control rooms with milestones, submittals, deliverables, risks, decisions, meetings; an invoice register with retention math; award closeout gated on 100% reimbursement (Caltrans LAPM-style delivery discipline as workflow).
- **Grants** — a pipeline from funding need → opportunity → decision → award → reimbursement, a curated catalog of real CA/federal programs with one-click tracking, and AI-drafted narratives where every factual sentence must cite a verifiable workspace fact (per-sentence grounding validation, unverified sentences flagged).
- **Community engagement** — public map-based commenting via share links: points, drawn lines, and drawn areas, optional photo attachments (private until approved), "Support" votes, and a staff moderation queue in front of everything public.
- **Analysis Studio** — corridor analysis over live Census/OSM/FARS data with equity screening, composite scores, and grant-ready report generation; fallback estimates are always labeled "Estimated," never silently substituted.
- **Transportation modeling** — screening-grade network model runs (AequilibraE worker) with KPIs, evidence packets, claim-grade gating, and a CEQA §15064.3 VMT screen with downloadable statutory memos.
- **RTP & programming** — RTP cycle workrooms with chapter drafting, linked project portfolios, funding rollups, and board-packet exports; RTIP/STIP program registries.
- **Planner Agent** — a copilot grounded in workspace data (streaming AI chat with a deterministic fallback), executable actions behind hash-verified, single-use, time-limited approvals, and a visible audit ledger of every action.

Nat Ford Planning builds and maintains the project.

**OpenPlan is free.** There is no paid tier, no plan, no seat count, no usage quota, and no payment
step anywhere in the software — sign up and every feature is available. There is no Stripe or
billing integration in the codebase; the subscription subsystem that once existed was deleted, and
`src/test/no-paid-tier-guard.test.ts` fails the build if it comes back.

Two things that sound commercial are not: the **invoice register** is Caltrans LAPM
grant-reimbursement invoicing — an agency invoicing *its funder* — and the **AI rate limit** bounds
Anthropic spend against runaway loops. Both are planning/operations features, unrelated to charging
anyone for OpenPlan.

Run it on your own infrastructure whenever you like: see
[`openplan/docs/SELF_HOSTING.md`](openplan/docs/SELF_HOSTING.md). The software, the schema, and your
data are yours.

## Repository layout

- `openplan/` — main Next.js application.
- `docs/` — product, proof, operations, governance, and planning documentation.
- `qa-harness/` — local and production smoke-check scripts.
- `scripts/` — validation, modeling, and operator utilities.
- `schemas/` — reusable schemas.
- `workers/` — Python modeling workers (AequilibraE screening runs, county validation).

## Development quick start

You need Node and a running Docker daemon — the local Supabase stack is
containerised, and `supabase start` waits indefinitely without it.

```bash
cd openplan                     # the app lives here; there is no root package.json
npm install
npm exec -- supabase start      # local Postgres + Auth + Storage; prints your keys
cp .env.example .env.local      # then fill in the four required values (below)
npm exec -- supabase db reset   # apply all migrations to the empty local database
npm run dev                     # http://localhost:3000
```

**The `--` is required.** `npm exec supabase start` fails with *"Must specify one
of --local, --linked…"* because npm consumes the flag before the Supabase CLI
sees it.

`.env.example` lists every variable OpenPlan reads, and marks the four the app
does not work without: the three Supabase values — all three printed by
`supabase start` — and a **public** Mapbox token (`pk.`, free from mapbox.com).
Without the Mapbox token every map renders blank, which is most of the product.
Add `ANTHROPIC_API_KEY` for the planning assistant, comment synthesis, moderation
and machine translation. Everything else is optional and degrades honestly when
unset, saying what is missing rather than failing quietly.

**`db reset` destroys local data.** It is right on a fresh machine, where the
database is empty. On a machine you have been working on, use
`npm exec -- supabase migration up`, which applies only the new migrations.

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
