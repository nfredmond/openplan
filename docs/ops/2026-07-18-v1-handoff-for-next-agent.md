# OpenPlan v1 — Handoff for the Next Agent

Written 2026-07-18, immediately after v1 shipped. Read this before touching anything. The stated next mission: **make the transportation demand modeling substantially better** — §7 is your brief.

## 1. Who you're working with

Nathaniel (GitHub `nfredmond`) is the solo founder of Nat Ford Planning and owns OpenPlan end-to-end. He's a transportation planner and a beginner developer — take the lead on engineering standards, explain consequential decisions plainly, and push back when his idea has a better alternative; he explicitly wants senior-partner behavior, not compliance. Budget is ~$0/month: everything runs locally (Vercel account is blocked pending an unpaid balance — he must email support to settle/downgrade to Hobby; Supabase can get a new free org under his existing account whenever he's ready). Keep the GitHub repo current as you work.

## 2. State of the project

**v1 shipped 2026-07-17.** Nine PRs merged to `main` (#24–#32), each behind a green CI gate:

| PR | Content |
|---|---|
| #24 | Green baseline: failing tests fixed, dead code + 12 unused deck.gl/luma packages removed, `ws`/`qs` dependency advisories patched |
| #25 | Security: cross-tenant projects-insert hole, tenant-wide gtfs-uploads bucket, anon enumeration of shared campaigns, global audit-row leak, stored XSS in public map popups, `/admin` operator allowlist gate, timing-safe secret compares, unspoofable audit hashes (migration `20260717000082`; live RLS proof tests) |
| #26 | Demo truth: Grants added to nav, working zoom controls, phantom layer toggles removed, milestone/submittal completion (PATCH `records/[recordId]`), "Estimated" badges on FARS/Overpass/LODES fallbacks, site-wide copy rewrite to confident-product framing |
| #27 | clawmodeler Planner Pack port → `src/lib/planner-pack/` (CEQA §15064.3 VMT, ATP/CTC screen, `[fact:id]` grounding validator; proven byte-equivalent to the Python) |
| #28 | AI layer: streaming copilot chat (`/api/assistant/chat`, graceful `ai_offline` 503 + deterministic fallback), 15-program grant catalog (`src/lib/grants/program-catalog.ts`), AI narrative drafts, `/assistant-activity` audit ledger |
| #29 | Engagement full vision: point/line/polygon comments (house click-to-draw, no draw lib), private photo pipeline (magic-byte validation, signed URLs, never public until approved), upvote-only Support votes (migration `20260717000084`) |
| #30 | Grounded narratives (`[fact:N]` citations validated per sentence, "N of M sentences cite verifiable workspace facts") + CEQA VMT screen panel on county-run detail (migration `20260717000085`) |
| #31 | Ship prep: CSP fix for local-stack auth in production builds, demo-user password + pre-shared campaign in seed, copilot markdown rendering, demo runbook + demo script + README |
| #32 | Theme consistency: the `module-*` design system tokenized (was light-hardcoded → unreadable in dark mode), 13 components fixed, basemap caption now truthful |

Verified end-to-end in a real browser with live API keys: sign-in → dashboard → grants catalog → live AI narrative ("7 of 10 sentences cite verifiable workspace facts") → grounded copilot chat → public portal (drew nothing, but voted; line/area items render) → CEQA panel (honest empty state) → activity ledger. Both themes screenshot-verified.

## 3. Architecture in one screen

- **App**: `openplan/` — Next.js 16 App Router, React 19, Tailwind v4, npm (never pnpm — except `qa:gate`'s pinned `corepack pnpm@10.33.0 audit`, which is deliberate). Build uses webpack (`next build --webpack`).
- **DB**: local Supabase (Docker), 91 migrations in `openplan/supabase/migrations/`. Every app table has workspace-membership RLS; deliberately policy-less service-role-only tables: billing_webhook_receipts, access_requests, assistant_action_approvals, engagement_item_votes, engagement-photos bucket. There is a live RLS test lane: `npm run test:rls-live`.
- **Maps**: Mapbox GL JS v3 direct (deck.gl was removed — zero imports). The app-wide "cartographic shell" backdrop fetches six `/api/map-features/*` layers.
- **AI**: Vercel AI SDK (`ai` + `@ai-sdk/anthropic`). Three call sites: `src/lib/ai/interpret.ts` (analysis narratives, Haiku hardcoded), `/api/assistant/chat` (copilot, `OPENPLAN_ASSISTANT_MODEL` env, default claude-opus-4-8, currently pinned to `claude-haiku-4-5`), `/api/funding-opportunities/[id]/narrative-draft` (`OPENPLAN_GRANTS_AI_MODEL`, same pin). Every feature has an explicit offline state when the key is empty — never silently degrade AI features.
- **Modeling workers**: `workers/` (Python) — see §7.
- **Secrets** live in `openplan/.env.local` (gitignored): `ANTHROPIC_API_KEY` (funded, small balance — keep everything on Haiku), `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` (valid pk.*), `OPENPLAN_ASSISTANT_MODEL` / `OPENPLAN_GRANTS_AI_MODEL` = `claude-haiku-4-5`, `OPENPLAN_DEMO_USER_PASSWORD`.

## 4. Working conventions (hard-won — follow them)

1. **Gate everything**: `cd openplan && npm run qa:gate` (lint + 1,800+ tests + pnpm audit + build) before any PR. CI runs the same gate.
2. **Merge flow**: feature branch → PR → local gate green + CI green → `gh pr merge N --merge --admin`. The `--admin` flag is required because the blocked Vercel account leaves a permanently failing "Vercel" check on every PR — that check is noise; the qa gate is the real signal.
3. **Migrations**: sequential numbering `202607DDNNNNNN_name.sql`, guarded style (`DO $$ ... IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`). Highest today: `20260717000085`. Always verify with `npm exec supabase db reset`. Parallel branches: coordinate numbers up front (we used 083/084/085 across three branches without collision).
4. **Claim boundaries are enforced by tests** (`sales-proof-claim-boundaries.test.ts`, `current-buyer-demo-proof-packet.test.ts`, `public-open-source-posture-guardrail.test.ts`, `aerial-catalog.test.ts`): modeling is *screening-grade*, never "calibrated/validated forecasting"; LAPM is delivery tracking, not E-76 generation; aerial is evidence tracking, not photogrammetry. Never weaken these tests — write copy that passes them. This honesty is the product's differentiator with Caltrans; treat it as a feature.
5. **Design constitution** (`docs/ops/2026-04-08-openplan-frontend-design-constitution.md`): civic workbench — lists/rows/tables, left rail + worksurface + inspector, no card grids, no pills, one primary CTA. Use the `module-*` CSS system and semantic theme tokens (`var(--card)`, `var(--border)`, `text-muted-foreground`); never hardcode light-only or dark-only colors on themed surfaces. Note: `--muted` is a *text* color in this codebase, not a surface.
6. **XSS discipline**: user text into Mapbox popups via DOM building (`createElement` + `textContent`), never `setHTML` interpolation. Markdown renders through `src/lib/markdown/render.ts` (HTML-stripping renderer).
7. **Subagent conventions that worked**: parallel agents on one branch with explicit file-ownership boundaries; isolated worktrees for whole-feature builds; agents never commit — the orchestrator reviews and commits in logical chunks.

## 5. Demo operations

`docs/ops/2026-07-17-v1-demo-runbook.md` (cold laptop → public URL; `cloudflared` is installed at `~/.local/bin/cloudflared`) and `docs/sales/2026-07-17-v1-demo-script.md` (15-minute click path). Demo login: `nctc-demo@openplan-demo.natford.example` + `OPENPLAN_DEMO_USER_PASSWORD` set at seed time. `npm run seed:nctc` is idempotent and pre-shares the engagement campaign (`/engage/nctc_demo_sr49_corridor`).

## 6. Known debts (small, non-blocking)

- Sign-in/sign-up pages still carry "supervised workspace identity" copy — off-key vs the confident framing elsewhere.
- `runs`/`model_runs`/`county_runs` are three parallel run concepts (documented schema debt; do not unify casually).
- Monoliths: `respond.ts` (2.1k lines), `context.ts` (2.4k), `app-copilot.tsx` (2k), several 1k+ page components.
- Deferred v1.1 candidates: aerial ODM pipeline port (working implementation exists in his `OpenGeo` repo — `lib/odm/client.ts` + orthomosaic workflow — and `aerial-intel-platform`), live grants.gov sync, BCA engine port (`DOT-Dashboard/src/lib/benefit-cost-service.ts`, 1.4k lines, Apache-2.0), TDM catalog (`transitscore-3d/lib/tdmCalculations.ts`), downvotes on engagement (deliberately omitted; he may ask).
- `transitscore-3d` has a hardcoded public ORS API key in `lib/isochrone.ts` — his own leak, worth rotating.

## 7. THE NEXT MISSION: transportation demand modeling

### 7.1 What exists today (three lanes + one stub)

1. **Deterministic corridor lane** (in-app, synchronous): `/api/analysis` — live ACS 2023 + TIGERweb + OSM Overpass + FARS/SWITRS → accessibility/safety/equity composite scores. Not a travel model; a data scorecard. Weakness: tract selection is coarse (whole counties via FCC bbox lookup, `src/lib/data-sources/census.ts:130-165`); LODES is never actually called (`lodes.ts` always returns an ACS-based estimate).
2. **AequilibraE lane** (async, real computation): `workers/aequilibrae_worker/main.py` — OSM network build, centroid connectors, NetworkSkimming, doubly-constrained gravity distribution, BFW/BPR assignment (α 0.15, β 4.0, rgap 0.01), KPIs/skims/volumes GeoJSON written back to Supabase (`model_runs`, `model_run_stages`, `model_run_artifacts`, `model_run_kpis`). Demand synthesis is the weak link: jobs = 0.47 × population with fixed sector shares (`data_pipeline.py:178-184`), hardcoded trip rates, car-only — no mode choice, no transit assignment.
3. **County screening lane**: `scripts/modeling/screening_runtime.py` (1,058 lines) — richer 3-purpose model (HBW/HBO/NHB), external gateway matrix, BFW assignment, plus count validation (`validate_screening_observed_counts.py`: MAPE, Spearman ρ, screening gate). Dispatched via `workers/county_onramp_worker/` (Flask shim that shells the script; needs a repo checkout — operationally the most fragile lane).
4. **ActivitySim lane**: `workers/activitysim_worker/runtime.py` — deliberately `preflight_only`; launch from UI returns 409 by design. Scaffolding, not a model.

The **evidence backbone** is genuinely good and is the thing to build on: `src/lib/models/evidence-backbone.ts`, `evidence-packet.ts`, `kpi-comparison.ts`, `caveat-gate.ts`, claim-grade gating in migrations `20260424000069` + `20260508000079` (behavioral KPIs readable only via consent-requiring RPC). The CEQA VMT screen (`src/lib/models/ceqa-vmt-screen.ts` + county-run panel) currently renders an empty state because **no run producer writes a VMT-family KPI** — see quick win #1.

### 7.2 Known defects in the modeling lanes (from the code survey — verify then fix)

- Worker job claim is non-atomic (plain PATCH after unguarded GET, `main.py:649`) — two replicas would double-process.
- Worker uploads artifacts to a **public** storage URL (`main.py:597-609`) — bypasses the workspace RLS that protects every table.
- No client-side run-status polling on model-run/county-run detail (users must refresh; a queued run with no worker looks frozen forever — no timeout/watchdog).
- `volumes/route.ts` falls back to reading the worker's local filesystem — only the Storage path works when app and worker are on different hosts.
- `engine_key` CHECK constraint allows `activitysim` but not `behavioral_demand` (`20260317000025:8`) — latent trap if the 409 block is ever lifted.
- O(n²) OD-matrix loops in Python — fine at ~200 zones, not county-wide zone systems.

### 7.3 Assets available for the upgrade (already surveyed, cloned copies may need re-cloning)

- **FreeChAMP** (`github.com/nfredmond/FreeChAMP`): `apps/web/src/lib/abm/` — ~1,800 lines of dependency-free TS sketch activity-based model (CDAP tour generation w/ NHTS-calibrated frequencies, MNL destination choice with size terms, per-purpose mode-choice coefficient tables in the SF-CHAMP/MTC tradition, time-of-day, full runner). **Known bug: `mode-choice.ts:295` multiplies utility by ~income×0.002 (~100-150×), collapsing the logit — fix before use.** Also: `routers/calibration.ts` (VMT %-error, mode-split RMSE, 0-100 fit score), 9 parameterized scenario policy templates incl. CARB SB 375 (`routers/templates.ts`), scenario-lever/TAZ-override/trip-flows schema shapes. The platform around these is fake — harvest the domain logic only.
- **clawmodeler** (already partially ported): `clawmodeler_engine/model.py` screening math (cumulative-opportunity accessibility, per-capita VMT/CO2e), `what_if.py` (scoring-weight override runs), `diff.py` (run-to-run added/removed/changed), `readiness.py` (per-engine calibration-requirements rubric for SUMO/MATSim/UrbanSim/DTALite/TBEST — maps ~1:1 onto the caveat-gate claim grades).
- **demandmodel_11.13.25**: Census/TIGER TAZ auto-build pipeline (treat as spec, reimplement against PostGIS).
- **Real data**: `data/screening-runs/` holds actual Nevada County AequilibraE artifacts (the seeded county run's evidence).

### 7.4 Recommended roadmap (my opinion as the outgoing agent)

Quick wins first:
1. **Write VMT KPIs from the AequilibraE worker** (VMT = Σ link volume × length is already computable from the assignment results; add `daily_vmt`, `vmt_per_capita` to `model_run_kpis`). This alone lights up the CEQA §15064.3 screen end-to-end — screening model → statutory determination memo is a killer demo arc that's one KPI away.
2. **Real LODES**: replace the jobs=0.47×pop synthesis with actual LODES WAC/OD data (the `lodes_od` table exists, dormant; or call the LEHD API from the worker). Biggest realism jump per hour of work.
3. **Fix the worker defects** (§7.2): atomic claim (UPDATE ... WHERE status='queued' RETURNING), private storage + signed URLs, client polling + stuck-run watchdog.
4. **Run the worker locally as part of the dev stack** (docker compose or a `npm run worker:aequilibrae` script) so a live model run works in demos without cloud deployment.

Then the bigger arc:
5. **Port FreeChAMP's sketch ABM as a new "sketch" run mode** in `run-modes.ts` (fix the mode-choice bug, validate against NHTS/ACS benchmarks, gate outputs as sketch-grade in the caveat system). This gives OpenPlan an in-process, no-infrastructure demand model with mode choice — the thing the current lanes lack.
6. **Calibration story**: port FreeChAMP's fit-scoring into `evidence-packet.ts`; pair with the county lane's observed-count validation so every run carries "how wrong is this" numbers. This is the Caltrans-credibility play — do it before chasing model sophistication.
7. **Mode choice + transit LOS** in the AequilibraE lane (GTFS schema exists, dormant) only after 5-6; it's the largest lift.
8. Keep ActivitySim as roadmap. Do not attempt to run it in v1.x — the caveat-gate culture requires calibration data nobody has yet.

Respect the claim boundaries throughout: everything above stays *screening-grade* until there's a real calibration/validation story, and the copy tests will hold you to it.

## 8. Session logistics for the fresh agent

- Local Supabase must be running (`npm exec supabase start`); after branch switches run `npm exec supabase db reset` (+ `NOTIFY pgrst, 'reload schema'` via psql-in-docker if PostgREST caches go stale).
- The production server runs via `npm run build && npm run start` (port 3000). Playwright MCP is available for browser verification — production builds need the CSP fix that's already on main; sign in with the demo user.
- Memory files for continuity live at `~/.claude/projects/-home-nathaniel-code-openplan/memory/`.
- There may be stray `.claude/worktrees/` entries — `git worktree list` and prune freely.
