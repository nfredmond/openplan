# OpenPlan Wave 0 — Deploy / Schema Truth Memo

**Date:** 2026-04-05  
**Owner:** Bartholomew Hale  
**Scope:** Canonical deployment truth across Vercel + Supabase so Wave 0 execution is grounded in what is actually live, not what older docs imply.

---

## Executive summary

OpenPlan does have a real production-backed spine.

The canonical live truth today is:
- **Vercel project:** `natford/openplan`
- **Vercel project id:** `prj_NKckTxKCBtO25Tf6a92hPLkuqzYT`
- **Canonical Vercel root directory:** `openplan`
- **Canonical public production alias:** `https://openplan-zeta.vercel.app`
- **Linked Supabase project:** `aggphdqkanxsfzzoxlbk` (`openplan-core`)
- **Repo-controlled migration truth:** local and remote migration histories are aligned through `20260324000134_county_onramp_runs.sql`

There is no evidence of repo-vs-remote migration drift in the applied migration history.

The main truth gaps are now **documentation/config clarity**, not a missing production project:
1. older docs still leave alias/package-manager assumptions muddy,
2. `.env.example` is no longer a complete mirror of live env naming,
3. county onramp worker envs are **not** configured in production, so that lane currently runs in a preparation/manual-or-session-assisted posture rather than a fully wired background worker posture.

---

## 1) Canonical Vercel deployment truth

### Project identity
Verified via Vercel CLI against the `natford` scope:
- **Project:** `natford/openplan`
- **Project id:** `prj_NKckTxKCBtO25Tf6a92hPLkuqzYT`
- **Owner:** `Nat Ford`
- **Framework preset:** `Next.js`
- **Node version:** `24.x`
- **Root directory:** `openplan`

### Operational deploy truth
The Vercel project is configured with **rootDirectory = `openplan`**.

That means the safe operator posture remains:
- **deploy from the repo root** (`/home/narford/.openclaw/workspace/openplan`),
- let Vercel descend into the `openplan/` app directory,
- do **not** assume deploying from `openplan/openplan` is the canonical path.

This confirms the March root-directory remediation is still holding.

### Current production alias truth
Latest inspected production deployment:
- **deployment id:** `dpl_6yvQepKp6EErKSdJvyM6Td89jCx5`
- **deployment URL:** `https://openplan-iqxunu3m3-natford.vercel.app`
- **created:** 2026-04-05 11:49 PDT

Aliases currently attached to that deployment:
- `https://openplan-zeta.vercel.app`
- `https://openplan-natford.vercel.app`
- `https://openplan-git-main-natford.vercel.app`

### Public vs protected alias behavior
Direct header checks show:
- `openplan-zeta.vercel.app` → **HTTP 200** and serves the app publicly
- `openplan-natford.vercel.app` → **HTTP 401** behind Vercel SSO
- `openplan-git-main-natford.vercel.app` → **HTTP 401** behind Vercel SSO

**Canonical public alias truth:** use `openplan-zeta.vercel.app` for live-public smoke and launch-spine verification.

The other two aliases are real, but they are not public-canonical because they are access-gated.

### Custom-domain truth
`vercel domains ls --scope natford` shows only:
- `natfordplanning.com`
- `welcometograssvalley.com`

There is **no dedicated OpenPlan custom domain** attached today.

---

## 2) Launch-spine environment truth

### Production env presence verified
Using `vercel env ls` and a temporary `vercel env pull` to `/tmp`, the production lane is confirmed to contain:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `CENSUS_API_KEY`
- `SWITRS_CSV_PATH`
- Stripe billing secrets and price ids
- Mapbox token variables

### Supabase/Vercel alignment
Pulled production env confirms:
- `NEXT_PUBLIC_SUPABASE_URL` points to **`aggphdqkanxsfzzoxlbk.supabase.co`**

That matches the linked Supabase project ref in repo tooling.

### County onramp env truth
Production env **does not currently contain**:
- `OPENPLAN_COUNTY_ONRAMP_WORKER_URL`
- `OPENPLAN_COUNTY_ONRAMP_WORKER_TOKEN`
- `OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN`

This matters, but the impact is narrower than a hard outage because current code degrades intentionally:
- `src/lib/api/county-onramp-dispatch.ts` returns `{ deliveryMode: "prepared" }` when no worker URL is configured
- `src/app/api/county-runs/[countyRunId]/enqueue/route.ts` currently prepares/stores queue state and returns a `queued_stub` response rather than requiring live worker dispatch
- `src/app/api/county-runs/[countyRunId]/validate/route.ts` supports a **session-only** posture when callback bearer auth is absent

**Truth:** county-run automation is not fully wired to a production worker today, but the deployed code is already written to operate in a graceful-preparation mode instead of crashing.

### `.env.example` drift
Repo example env file is no longer a full truth mirror of production naming.

Present in `.env.example` but **not** in production:
- `OPENPLAN_COUNTY_ONRAMP_WORKER_URL`
- `OPENPLAN_COUNTY_ONRAMP_WORKER_TOKEN`
- `OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN`

Present in production but **not** in `.env.example`:
- `MAPBOX_ACCESS_TOKEN`
- `MAPBOX_TOKEN`
- `NEXT_PUBLIC_MAPBOX_TOKEN`
- `OPENAI_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

### Env alias/legacy clutter observations
Code inspection shows:
- Stripe secret handling uses `OPENPLAN_STRIPE_SECRET_KEY ?? STRIPE_SECRET_KEY`
- Mapbox usage mixes `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`, `NEXT_PUBLIC_MAPBOX_TOKEN`, and mapbox aliases in different files
- no direct code references were found for `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` or `STRIPE_PUBLISHABLE_KEY`
- `OPENAI_API_KEY` appears only in `supabase/config.toml` for local Studio tooling, not in app runtime code

**Interpretation:** live env inventory has legacy or convenience aliases that are not all represented in repo docs, and some are likely no longer runtime-critical.

---

## 3) Supabase schema truth

### Project identity
Verified via repo link state + Supabase CLI:
- **project ref:** `aggphdqkanxsfzzoxlbk`
- **project name:** `openplan-core`
- **region:** `West US (Oregon)`

### Migration truth
`supabase migration list` shows **local and remote are aligned** across the entire tracked migration series.

Latest applied migration on both sides:
- `20260324000134_county_onramp_runs.sql`

This is the strongest repo-controlled schema truth signal for Wave 0:
- the remote project is not missing any repo migration,
- the repo is not ahead of the remote migration ledger.

### Remote public schema inventory
A remote schema dump and live type generation confirm the remote `public` schema contains, at minimum:
- **57 tables**
- **27 functions**
- **159 policies**
- **57 tables with RLS enabled**

Representative live tables confirm the expected module spine is present remotely:
- workspace/auth core: `workspaces`, `workspace_members`, `analyses`, `runs`
- billing: `billing_events`, `billing_invoice_records`, `billing_webhook_receipts`
- projects: `projects`, `project_deliverables`, `project_risks`, `project_decisions`, `project_issues`, `project_meetings`, `project_milestones`, `project_submittals`
- data hub: `data_connectors`, `data_datasets`, `data_dataset_project_links`, `data_refresh_jobs`
- engagement: `engagement_campaigns`, `engagement_categories`, `engagement_items`
- planning modules: `plans`, `plan_links`, `programs`, `program_links`, `models`, `model_links`
- modeling run spine: `model_runs`, `model_run_stages`, `model_run_artifacts`, `model_run_kpis`
- reports/scenarios: `reports`, `report_runs`, `report_sections`, `report_artifacts`, `scenario_sets`, `scenario_entries`
- county/model packaging: `county_runs`, `county_run_artifacts`, `network_packages`, `network_package_versions`, `network_zones`, `network_corridors`, `network_connectors`
- source datasets: GTFS + Census/LODES tables are also present

### Important config interpretation
`openplan/supabase/config.toml` is still a **local-dev Supabase CLI config**, not proof of live production auth settings.

For example, its `site_url = "http://127.0.0.1:3000"` should be read as local tooling truth only, not as the production auth redirect truth.

---

## 4) Drift, ambiguities, and blockers

### A. No migration-history drift found
Good news: the core repo-controlled database truth is aligned.

### B. `supabase db diff --linked` is not reliable in the current CLI posture
Attempted drift diffing with:
- `supabase db diff --linked --schema public --use-migra`

Result:
- shadow DB bootstrap started,
- migrations replayed,
- command then failed with `password authentication failed for user "cli_login_postgres"` against the remote project.

Because migration list, dump, and type generation all succeeded, this looks like a **CLI auth/tooling issue**, not direct evidence of schema drift.

### C. Package-manager truth is still implicit, not pinned
Repo state shows both:
- `openplan/package-lock.json`
- `openplan/pnpm-lock.yaml`

Vercel project settings show generic install/build defaults, and package.json scripts are written in npm style.

**Operational truth for now:** treat **npm** as canonical.

**But:** package manager truth is still not explicitly pinned in config, which leaves avoidable room for future confusion.

### D. Alias history in old docs is partially stale
Older remediation docs mention `openplan-git-master-natford.vercel.app`.

Live alias truth today is:
- `openplan-git-main-natford.vercel.app`

That is a documentation-history mismatch, not a live deployment fault.

---

## 5) Validations performed

### Vercel
- `vercel whoami`
- `vercel teams ls`
- `vercel projects ls --scope natford`
- `vercel projects inspect openplan --scope natford`
- `vercel ls openplan --scope natford`
- `vercel inspect openplan-zeta.vercel.app --scope natford`
- `vercel env ls production|preview|development --scope natford`
- `vercel env pull /tmp/openplan-prod.env --environment production --scope natford`
- `curl -I` against public and protected aliases
- `curl -I https://openplan-zeta.vercel.app/pricing`
- `curl` against `https://openplan-zeta.vercel.app/api/workspaces/current` (returned expected `401 Unauthorized` without session)

### Supabase
- confirmed repo link ref in `openplan/supabase/.temp/project-ref`
- `supabase projects list`
- `supabase migration list`
- `supabase db dump --linked --schema public`
- `supabase gen types typescript --linked --schema public`
- attempted `supabase db diff --linked --schema public --use-migra` (tooling/auth failure; see blocker note)

### Repo/code inspection
- inspected `.vercel/project.json` at repo root and app subdir
- inspected `openplan/package.json`
- inspected `.env.example`
- inspected `openplan/supabase/config.toml`
- inspected runtime code paths for Stripe, Mapbox, Supabase, county-run dispatch, and county validation

---

## 6) Canonical truth, in one paragraph

If someone needs the single clean answer today: **OpenPlan’s real production app is the `natford/openplan` Vercel project, built from repo root with Vercel `rootDirectory = openplan`, publicly served at `https://openplan-zeta.vercel.app`, and backed by Supabase project `aggphdqkanxsfzzoxlbk` (`openplan-core`).** The remote database is aligned with repo migrations through `20260324000134_county_onramp_runs.sql`. The main remaining execution risk is not missing production infrastructure; it is configuration/documentation ambiguity around env naming, package-manager clarity, and the still-unwired production county-worker lane.

---

## Recommended next actions

1. **Treat `openplan-zeta.vercel.app` as the public-canonical URL** until or unless a dedicated OpenPlan custom domain is attached.
2. **Normalize env documentation** so `.env.example` honestly reflects current runtime and legacy alias posture.
3. **Pin package-manager truth explicitly** in repo config when the tree is calmer.
4. **Decide whether county onramp should remain operator-assisted** or get fully wired with production worker/callback secrets; current code supports either, but the live environment currently reflects the operator-assisted posture.
