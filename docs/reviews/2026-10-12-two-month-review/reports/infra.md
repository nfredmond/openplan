## Bottom line

The site is up, serves current `main`, and promotion is gated by the seven required checks on both Vercel and Railway. That gate works. The gaps are operational:

- **No monitoring.** Nothing watches the live site, and the health endpoint does not check the database.
- **Schema lags code.** Code deploys automatically but migrations are applied by hand. This already broke a route on October 11.
- **No file backup.** Storage objects have no automated backup.
- **No per-account limits.** Public signups face no limit on what one account can use, and the Railway $40 hard limit would then stop every worker.
- **Mapbox has no cap.** It is the one meter outside every spend cap.
- **One operator.** Only you can deploy, roll back, restore or rotate a key, and none of those steps is written down for the hosted installation.

## 1. What is deployed

| Check | Result |
|---|---|
| `GET /` | 200, 60,299 bytes. TTFB is 0.18 to 0.26 s warm; one sample took 1.86 s (cold start). |
| `GET /api/health` | 200, `{"status":"ok","deployment":{"commit":"c735abec3a0e","version":"0.68.0"},"checks":{"app":"ok","database":"not_checked"}}` |
| Commit vs `origin/main` | Match |
| Vercel production | GitHub deployment 7002222207 for `c735abec3`, success at 21:42:43 UTC. That is 49 minutes after the push and seconds after `live RLS isolation` finished. |
| Railway | Deployment 7001629443 succeeded at 21:43:34. Only `application-workers` redeployed. |
| `railway status` | `application-workers` Online, `aequilibrae` Online, `ocr` Online with a public domain, `activitysim` (retired) **Failed**, `restore-drill` Postgres Offline |
| OCR public endpoint | `/healthz` answers 200 to anyone. Job endpoints need a bearer token checked with `compare_digest` (`workers/ocr_worker/main.py:438-440`). |

**Security headers** (from `openplan/next.config.ts`):
- Present: HSTS (2 years, preload), `X-Frame-Options: DENY`, nosniff, a referrer policy, a permissions policy, and a CSP with `frame-ancestors 'none'`, `object-src 'none'` and a report URI.
- Weak: `script-src` allows `'unsafe-inline' 'unsafe-eval'`, `connect-src` allows any `*.supabase.co` project, and `X-Powered-By: Next.js` is still sent.

**Caching:**
- `/_next/static` is cached for a year as immutable and served Brotli-compressed.
- Dynamic HTML is `no-store`; static pages are served from the cache.
- The home page loads 13 script chunks, 196 KB uncompressed.
- `/robots.txt` and `/sitemap.xml` return 404. `/privacy`, `/terms` and `/legal` return 200.

## 2. CI

**Required on `main`** (branch protection: `strict: true`, `enforce_admins: false`, no rulesets):
- `verify (qa gate)`: lint, knip, vitest, connector tests, `rls-gate`, `npm audit --audit-level=low`, full build
- shuffled vitest
- modeling, ops and worker Python suites
- `focused-workers`
- `live RLS isolation`, which runs against a local Supabase only

**Not required:**
- Upgrade Path (daily, and on migration changes)
- Restore Drill (quarterly, and on restore or migration PRs)
- QA Harness Nightly
- Modeling source contracts (weekly)
- Production Health: manual only, and skipped because `OPENPLAN_HEALTH_URL` is unset. It last ran 2026-09-08.

**Successful-run durations:**

| Workflow | Median | p90 | Max |
|---|---|---|---|
| CI | 29 min | 52 min | 121 min |
| RLS | 45 min | 51 min | 70 min |
| Restore Drill | 49 min | 58 min | 85 min |
| Upgrade Path | 3.5 min | 3.6 min | 12.5 min |

There were 1,000 runs in under three days. On PRs, CI had 43 failures and 72 cancellations against 134 passes. The cancellations come from the strict up-to-date rule.

**Two weeks on `main` (363 runs):**
- CI: 105 passed, 5 failed (Oct 2–8, all since fixed).
- RLS: 125 passed.
- Upgrade Path: 41 passed.
- Restore Drill: 1 scheduled run, passed.
- QA Harness Nightly: 13 passed, 1 failed, 1 stuck queued.

**Red now.** The latest scheduled QA Harness Nightly on `main` failed at 15:56 UTC on `local-rtp-release-review-smoke` (run 38153406796). PR #202 fixes it, but only branch dispatch runs have passed since. Everything else is green.

**Does the gate actually hold production?** Yes, for Git deploys. Vercel shows "Waiting for checks" and promotes within seconds of the last required check, and Railway follows. What it does not cover:
- Dashboard instant rollback and promotion bypass the gate, which is the right escape hatch but is undocumented.
- No check compares hosted migrations with the code being promoted.
- The low-level `npm audit` threshold can block every merge, hotfixes included.

Private vulnerability reporting and Dependabot security updates are both disabled.

## 3. Build and runtime

**Build.** The build runs `--webpack` with a 6 GB heap.
- The flag came in with commit `d7dbb9090` (Feb 23), which records no reason.
- `SELF_HOSTING.md` says the default 4 GB heap ran out during type checking.
- On October 11 one Vercel build hit the 45-minute limit and one was SIGKILLed on the 8 GB builder. `webpackMemoryOptimizations` was added afterwards.
- Warm builds take about 2.5 minutes. Cold-cache reliability is unproved.

**Runtime.**
- Functions run in `sfo1`, all on Node; none use edge. `src/proxy.ts` runs on every non-static request.
- `vercel.json` gives three report and export routes 60 s and 1,024 MB. Seventeen routes set 60 or 300 s in code. The 300 s project default lives only in the dashboard.
- Corridor analysis took 67.5 s and the browser lost the response.

**Crons.**
- `reap-model-runs` every 5 minutes.
- `reap-gtfs-ingests` every 15 minutes.
- `sweep-deadlines` daily at 13:00 UTC.

They return 401 without `CRON_SECRET`, and nothing alerts when that happens.

## 4. Environment variables (names only)

The app reads 81 deployment variables plus platform ones.

**`NEXT_PUBLIC_` (in the browser bundle):** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`, `NEXT_PUBLIC_MAPBOX_TOKEN`, `NEXT_PUBLIC_OPENPLAN_MAP_STYLE_URL`.

`.env.example` covers everything except `OPENPLAN_COMMIT_SHA`. `SELF_HOSTING.md` omits 49 names. The ones that matter here:
- **Cost and abuse caps:** `OPENPLAN_MONTHLY_RUN_CAP`, `OPENPLAN_MODELING_QUEUE_DEPTH`, `OPENPLAN_KB_DOCUMENT_MAX_BYTES`, plus the layer and feature caps.
- **Security:** `OPENPLAN_OUTBOUND_ALLOWED_HOSTS`, `OPENPLAN_AI_LOCAL_ENDPOINTS`, `OPENPLAN_EQUITY_INGEST_TOKEN`, `OPENPLAN_SPATIAL_WORKER_URL`, `OPENPLAN_SPATIAL_WORKER_TOKEN`.
- **Hosted operation:** `OPENPLAN_HOSTED_ARTIFACT_MIRROR`, `OPENPLAN_COMMIT_SHA`, and `OPENPLAN_GTFS_MANAGED_INGESTION` with its installation ID, parser build and work directory.
- **Elsewhere:** the six AI model overrides, the ten `OPENPLAN_AERIAL_*` names, the public basemap settings, the GTFS parser limits and `LODES_YEAR`.

Both cost caps default to unlimited (`src/lib/config/run-cap.ts:80-86`, `src/lib/models/run-dispatch.ts:67`). I could not check whether they are set in production.

## 5. Database

- **Count.** The repo has 405 migrations and the hosted record reports 405 applied, so they match today.
- **How they reach hosted.** By hand: `supabase migration up --linked --include-all` from a local checkout. No workflow applies or checks them.
- **Drift has already happened.** On October 11 the GTFS cleanup route was live before migrations 28 to 31 were applied. On October 10 a migration version collision needed a rename and a history repair.
- **Configuration that lives only in the dashboard:** the PostGIS pre-request hook (applied by hand from `restrict-postgis-data-api.sql`), the 1 GiB Storage limit, Auth URLs and password rules, SMTP, and the spend cap.
- **Future-dated filenames.** Migrations are named ahead of the calendar (`20261017000001` on Oct 11), so a migration made with a real timestamp sorts before applied ones.
- **Backup.**
  - Supabase Pro daily backups, kept 7 days, with no PITR. They do not include Storage object bytes.
  - Manual database and Storage captures sit on your machine only, with no schedule and no offsite copy.
- **Restore.**
  - One partial rehearsal on Oct 10, into a disposable Railway Postgres.
  - Never tested: replacement Auth and Storage, a real sign-in, restoring a Railway volume snapshot, or cutover.
  - `restore-drill.yml` tests only the local stack.
- **RLS live test.** About 100 files run against a fresh local Supabase on every PR, push and day, as a required check. It proves the migrations, not the hosted state (310 tables, 309 with RLS).

## 6. Railway workers

| Service | Image | Limits | Volume |
|---|---|---|---|
| `application-workers` | `workers/hosted-node/Dockerfile` (7 Node queues, Chromium, Poppler) | 1 vCPU, 2 GB, 1 replica | `/data` journals |
| `aequilibrae` (shared model host) | `workers/hosted-models/Dockerfile` (two Python venvs) | 2 vCPU, 8 GB | `/data/model-runs`, `/data/activitysim` |
| `ocr` | `workers/ocr_worker/Dockerfile` | not recorded in the repo | OCR custody; public domain |

**Deploy path.** Git `main` with "wait for CI", filtered by watch paths. `application-workers` rebuilt on every one of the last eight main commits, which interrupts in-flight exports and emails several times a day.

**Reproducibility.**
- Service settings exist only in the dashboard. The one `railway.json` (`workers/aequilibrae_worker/`, `python main.py`) belongs to the old layout.
- Base images use tags, not digests, and apt packages are unpinned.
- `aequilibrae>=1.6.0` and `ocrmypdf>=16.0` are open ranges. The October 10 Pandas 3 breakage came from this kind of unpinned rebuild.

**Failure handling.** Both supervisors exit non-zero if any child exits, and Railway restarts them. Logs go to stdout with no drain and no crash alert.

**What planners see.** The model run manager shows worker heartbeats and blocks a launch on a stale one until acknowledged (`model-run-manager.tsx:679-706`). The Node email, translation and synthesis queues write no heartbeat, so a stopped queue looks like a slow one.

## 7. Cost

| Service | Plan | Variable meters | Cap |
|---|---|---|---|
| Vercel | Pro (existing) | Function CPU, invocations, transfer, builds | Spend Management not visible to me |
| Supabase | Pro, Micro compute (credited) | MAU (100k), disk (8 GB), Storage (100 GB), egress (250 GB) | Spend cap on: overage restricts service instead of billing |
| Railway | Pro, $20 including $20 usage | CPU, RAM, volumes | Alert at $25, hard stop at $40 |
| Resend | Free | 100 emails per day, 3,000 per month | Sends fail past the quota |
| Anthropic | Demo key only | Tokens | $5 per month |
| Mapbox | Existing token | 50,000 free loads, then about $5 per 1,000 | **None known** |

**What grows with public signups:**
- **Storage.** No per-workspace quota. One account can upload 1 GiB map packages and 100 MB documents without limit. Public photos are stored before submission, with no orphan cleanup and only a per-instance rate limit (`photo.ts:116-140`).
- **Railway compute.** Model runs and OCR are unlimited unless the caps are set, and the caps count per workspace, so each new signup gets a fresh allowance. Hitting $40 stops all workers.
- **Resend.** About 100 signups or subscriptions a day exhausts the free quota.
- **Mapbox.** A public campaign with 60,000 loads costs about $50 by itself.

**Abuse protection:**
- Signup requires email confirmation, an 8-character password and a breached-password check, but has no CAPTCHA.
- Public engagement routes need a share token and have a honeypot, size limits, and a database-backed limit of 12 per 10 minutes per IP per campaign.
- AI routes have a per-workspace rate limit.
- No firewall rules are in the repo.

**Where a surprise bill could come from:** Mapbox first. Then Vercel overage if Spend Management is not set to pause. Railway is bounded at $40, but reaching it is an outage.

## 8. Observability

- **Error tracking:** none. Browser errors only go to `console.error` in `global-error.tsx`.
- **Logs:** platform defaults only, with no drain.
- **Health:** `/api/health` is shallow, plus OCR `/healthz` and model heartbeats.
- **Uptime:** none. The April 15-minute health schedule was removed and never re-armed.
- **Alerting:** only the Railway $25 usage email. Nothing alerts on downtime, 5xx rates, cron 401s, worker crash loops, the Resend quota, Supabase restriction or Mapbox usage.

## 9. Could someone else run it from the docs alone?

- **Deploy: partly.** Merging deploys, but Vercel, Supabase and Railway all sit under your personal accounts, with no second operator documented. The merge hold lives outside the repo.
- **Roll back: no.** There is no written procedure. The "prior May deployment" named in `HOSTED_LIVE` cannot run against 405 migrations.
- **Restore: no.** `HOSTED_RECOVERY.md` restores only into a disposable target and relies on private SQL and TOC files that are not in the repo.
- **Rotate a key: no.**
  - The service role key lives in Vercel and all three Railway services.
  - `OPENPLAN_INTEGRATION_KEY_SECRET` has no second-key support, so rotating it invalidates every stored workspace key (`key-crypto.ts:15`).

**Stale documents** that still say hosting is deferred or not commissioned: the `production-health.yml` header, the `KNOWN_ISSUES.md` header, and two passages in `SELF_HOSTING.md`.

**PR #217** is accurate against what I observed. It adds no rollback, restore, key-rotation or monitoring procedure. At review time `verify (qa gate)`, shuffled vitest and RLS were still running; the other required checks had passed.

## 10. Top 15 risks, ranked

1. **No monitoring or alerting.** Set `OPENPLAN_HEALTH_URL` and restore the 15-minute schedule. Add a free external uptime check on `/api/health` and the OCR `/healthz`. Add a token-protected deep health route covering one database read, one Storage check and heartbeat ages.
2. **Code deploys before schema.** This already happened on Oct 11 (`HOSTED_DEMO_AI_AND_GTFS_SCHEMA_2026-10-11.md`). Add a check that fails when the repo is ahead of `supabase migration list --linked`, and have health report expected versus applied migration versions.
3. **Storage objects have no automated backup**, and database backups are kept only 7 days. Schedule a bucket copy plus `pg_dump` to an offsite bucket such as Backblaze B2, within the $50.
4. **No per-account resource limits behind public signup** (`run-cap.ts`, `run-dispatch.ts`, map packages, documents). Set `OPENPLAN_MONTHLY_RUN_CAP` and `OPENPLAN_MODELING_QUEUE_DEPTH` now. Then add a deployment-wide concurrency limit and per-workspace storage quotas.
5. **The Railway $40 hard stop takes down email, exports and OCR along with models.** Move the model host to its own Railway project, or add a deployment-wide run cap.
6. **Mapbox has no cap, and its token is in the bundle.** URL-restrict the token, add a usage alert, and default public maps to the keyless MapLibre style that already exists.
7. **Confirmation email lands in Gmail Spam**, and Resend free allows 100 a day. Set up Google Postmaster Tools, send from a subdomain with aligned DMARC and tracking off, and plan for Resend Pro ($20) if signups grow.
8. **No error tracking.** Use Sentry's free tier or a log drain, and report client errors from `global-error.tsx` and the route `error.tsx` files.
9. **Rollback is undocumented, and the named target cannot run.** Write a one-page procedure (Vercel instant rollback to the previous `main` build, Railway redeploy) and keep migrations additive so the previous build always runs.
10. **One operator, no written access model.** Add a second owner or recovery contact on each platform, and an operations document listing accounts and where each secret lives (names only).
11. **No key-rotation procedure, and the integration secret cannot rotate.** Document the rotation order for each secret, and accept a previous key in `key-crypto.ts`.
12. **Hosted restore has never run end to end.** Rehearse into a second Supabase project, finish with a real sign-in and a file download, and time it.
13. **A hotfix takes about 50 minutes and is fragile.** RLS takes 45 minutes, strict mode forces reruns, and the low-level audit can block merges. Shard RLS, drop `strict`, and move the audit to a scheduled job.
14. **Workers cannot be rebuilt from the repo.** Add a `railway.json` per hosted service with narrow watch paths, pin image digests and `aequilibrae`/`ocrmypdf`, and add heartbeats to every Node queue.
15. **The build sits at the 8 GB builder's limit.** CI already type-checks the same commit before promotion, so skip the type check on Vercel only. Also measure a Turbopack build and record a cold-cache build time.

**Also noted, below the top 15:**
- The weak CSP described in section 1.
- Private vulnerability reporting and Dependabot security updates are off.
- The offline `restore-drill` Postgres on Railway still holds a restored copy of production, including password hashes. Delete it or set it to expire.
- The retired `activitysim` service shows Failed and still keeps a billed volume.
- No `robots.txt`.
- The latest scheduled QA Harness Nightly on `main` is red until tonight's run confirms PR #202.

## What I could not determine

- Vercel environment variables, Spend Management, firewall rules, log retention and deploy history (CLI not authorized for the `natford` scope).
- Supabase Auth rate limits, Storage and egress usage, and the backup list.
- Railway month-to-date usage and the OCR service's resource limits.
- Mapbox token restrictions and this month's map loads.
- Whether either cost cap is set in production.
- Current Railway per-vCPU and per-GB rates.
- Vercel Pro log retention.