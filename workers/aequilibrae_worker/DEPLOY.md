# OpenPlan AequilibraE Worker — Cloud Deployment

## What This Does
This is a Python worker that executes AequilibraE traffic assignment for OpenPlan model runs:
it downloads the OSM road network for the study area, runs BFW equilibrium assignment, and uploads
the results (GeoJSON volumes, evidence packets, KPIs) back to your Supabase project.

## Two ways to run it. Pick one before you deploy.

`AEQ_WORKER_MODE` selects how the process is *started*. Both modes execute a run through exactly the
same code — the same stages, the same atomic claim, the same results — so nothing about a model run
differs between them. What differs is what you pay for and what the app can tell a planner.

| Mode | How it gets work | What it costs | Deploy with |
| --- | --- | --- | --- |
| `poll` (default) | Reads queued stages out of your Supabase project every few seconds. The app never calls it, so there is no URL to configure. | An always-on process. Fly.io ~$3–5/month; Railway's free monthly credit covers light use. | `fly.toml` |
| `push` | Serves an HTTP trigger; the app POSTs each queued run to it. Nothing needs to stay running between runs. | Whatever your platform charges for the compute a run actually uses. | `fly.push.toml` |
| `both` | Both at once. | As `poll`. | either file, with `AEQ_WORKER_MODE=both` |

`both` needs no coordination from you, and two things — not one — are what make it safe. **Between
processes:** every stage is taken with an atomic `queued → running` claim, so whichever reaches a
stage first runs it and the other stops; there is no lock to configure and no way for a run to
execute twice. **Inside one process:** `both` runs the poll loop and the push drain on two threads,
and the claim does nothing to stop those two threads executing two *different* runs side by side — so
stage execution is serialized with a process-wide lock, and whichever thread arrives second waits.

**One run at a time, per process.** `AEQ_MAX_CONCURRENT_RUNS` is refused above 1, loudly, at startup.
AequilibraE keeps the open project in a process-wide global, so two runs in one process would assign
each other's networks and validate against each other's traffic counts — a wrong number on the
surface that decides what a run may claim. To run more at once, run more instances: separate
processes have separate globals, and they cannot take the same stage.

## Required Environment Variables

Both values come from **your own** Supabase project — the same one the OpenPlan app points at.
Find them in the Supabase dashboard under *Project Settings → API*.

```
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

Push mode additionally requires:

```
AEQ_WORKER_MODE=push
OPENPLAN_MODELING_WORKER_TOKEN=<a high-entropy shared secret; the app has the same value>
```

> **Substitute your own project ref before running anything below.** `<your-project-ref>` is the
> subdomain of your Supabase project URL (it also appears as the `NEXT_PUBLIC_SUPABASE_URL` in your
> app's environment). A worker pointed at someone else's project will authenticate against their
> database, not yours.
>
> The service-role key bypasses Row Level Security by design — the worker needs it to write results
> on behalf of every workspace. Treat it as a secret: set it through your host's secret store (as
> the commands below do), never commit it, and never expose it to a browser.

Optional, and none of them a tier — OpenPlan is free:

| Variable | Default | What it does |
| --- | --- | --- |
| `AEQ_WORK_DIR` | the system temp directory | Where per-run working directories are created. Container-local scratch; both Fly configs point it at `/tmp/aeq_runs`. |
| `AEQ_POLL_INTERVAL_SECONDS` | `5` | How often poll mode looks for queued stages. |
| `AEQ_HTTP_PORT` / `PORT` | `8080` | Port push mode listens on. Platforms that assign `PORT` win. |
| `AEQ_MAX_QUEUED_RUNS` | `8` | How many accepted-but-unstarted runs a push worker will hold. Beyond it the trigger answers 503 and the app tells the planner why, rather than accepting work it may never reach. |
| `AEQ_SHUTDOWN_GRACE_SECONDS` | `300` | How long a stop signal waits for accepted runs to finish. Keep it at or below your platform's kill timeout. |

## Option A: Fly.io — polling worker (always on)

```bash
# 1. Install Fly CLI
curl -L https://fly.io/install.sh | sh

# 2. Login
fly auth login

# 3. Deploy from the worker directory. `fly launch` asks for a region — pick the
#    one nearest you and your Supabase project; this repo ships no default,
#    because there is no such thing as a default place.
cd workers/aequilibrae_worker
fly launch --copy-config --yes

# 4. Set secrets
fly secrets set SUPABASE_URL="https://<your-project-ref>.supabase.co"
fly secrets set SUPABASE_SERVICE_ROLE_KEY="<your-key-from-.env.local>"

# 5. Verify
fly logs
```

Then tell the app a poller exists: `OPENPLAN_MODELING_WORKER=deployed`. A poller exposes nothing to
probe, so that declaration is the only way the app can be honest at the launch button.

## Option B: Fly.io — push pool (scales to zero)

```bash
cd workers/aequilibrae_worker

# 1. A separate Fly app, from the push config.
fly launch --config fly.push.toml --copy-config --yes

# 2. Secrets, including the shared secret the app will present.
fly secrets set --config fly.push.toml \
  SUPABASE_URL="https://<your-project-ref>.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="<your-key>" \
  OPENPLAN_MODELING_WORKER_TOKEN="$(openssl rand -hex 32)"

# 3. Confirm the trigger is serving. This says the PROCESS is up and which
#    stages it owns — never that a run would succeed.
curl https://<this-app>.fly.dev/healthz

# 4. On the APP (Vercel env, or your own host):
#      OPENPLAN_MODELING_WORKER_URL=https://<this-app>.fly.dev
#      OPENPLAN_MODELING_WORKER_TOKEN=<the same secret>
#    Leave OPENPLAN_MODELING_WORKER unset if nothing polls: `absent` would
#    refuse the runs your pool would happily have executed.
```

The app appends the contract path, so give the base URL. Both variables are required together: a URL
with no token is refused rather than used, because this endpoint starts minutes of compute on
request — and the worker refuses to serve without one for the same reason.

### What you must accept when you choose push mode

1. **The pool has to stay alive while a run drains.** The trigger answers `202` immediately and then
   executes for minutes, so a platform that reclaims instances the moment they look idle can stop one
   mid-run. The worker treats `SIGTERM` as *stop accepting, then finish*: it closes the listener,
   drains what it accepted (up to `AEQ_SHUTDOWN_GRACE_SECONDS`) and **names any run it could not
   finish** in its logs. That only works if your platform actually waits — `kill_timeout` on Fly,
   `terminationGracePeriodSeconds` on Kubernetes, `docker stop --timeout`. `fly.push.toml` sets 5
   minutes, which is Fly's maximum; a longer stage can still be interrupted.
2. **Nothing disappears when that happens, but a run is wasted.** An interrupted run's stages stay as
   the worker left them: unclaimed stages are still `queued` and any worker can take them, and a run
   that stops reporting progress is marked failed by OpenPlan's staleness sweep. It never silently
   succeeds, and it never sits pretending to be alive forever.
3. **Run the staleness sweep.** `/api/cron/reap-model-runs` (authorized by `CRON_SECRET`) is what
   turns an abandoned run into an honest failure without a person looking; the model page also
   reconciles stale runs when it loads. On a push-only deployment there is no poller to rescue
   anything, so this is the safety net — schedule it.
4. **Long runs may not be worth it.** If your stages routinely exceed the grace window, set
   `auto_stop_machines = "off"` in `fly.push.toml` (the machine then stays up, which is the polling
   cost profile) or simply run polling mode.

## Option C: Railway ($5 free credits/month)

```bash
# 1. Install Railway CLI
npm install -g @railway/cli

# 2. Login
railway login

# 3. Deploy
cd workers/aequilibrae_worker
railway init
railway up

# 4. Set env vars in Railway dashboard or CLI
railway variables set SUPABASE_URL="https://<your-project-ref>.supabase.co"
railway variables set SUPABASE_SERVICE_ROLE_KEY="<your-key>"

# For push mode, also:
railway variables set AEQ_WORKER_MODE="push"
railway variables set OPENPLAN_MODELING_WORKER_TOKEN="<the same secret the app has>"
# Railway assigns PORT and the worker obeys it; expose the service and use its
# public URL as OPENPLAN_MODELING_WORKER_URL.
```

## Option D: Any Docker Host

```bash
# Build
docker build -t openplan-aeq-worker .

# Polling (default)
docker run -d --restart=always \
  -e SUPABASE_URL="https://<your-project-ref>.supabase.co" \
  -e SUPABASE_SERVICE_ROLE_KEY="<your-key>" \
  openplan-aeq-worker

# Push trigger
docker run -d --restart=always -p 8080:8080 \
  -e SUPABASE_URL="https://<your-project-ref>.supabase.co" \
  -e SUPABASE_SERVICE_ROLE_KEY="<your-key>" \
  -e AEQ_WORKER_MODE=push \
  -e OPENPLAN_MODELING_WORKER_TOKEN="<the same secret the app has>" \
  openplan-aeq-worker

# Give a stopping container time to drain instead of killing it after 10s:
#   docker stop --timeout 300 <container>
```

## How It Works
1. A planner clicks "Launch Run" in the OpenPlan UI.
2. The Next.js API creates a `model_run` plus its `model_run_stages` in Supabase with
   `status=queued`, and — if a push endpoint is configured — POSTs the run id to this worker.
3. This worker picks the run up: immediately if it was pushed, otherwise on its next poll.
4. For each stage it claims (atomically, `queued → running`) it:
   - downloads the OSM road network for the study area,
   - adds zone centroids and connectors,
   - runs Bi-conjugate Frank-Wolfe traffic assignment,
   - generates a GeoJSON volume map,
   - uploads results to Supabase Storage,
   - records KPIs and artifacts in Supabase.
5. The UI renders the traffic volume map from the Supabase Storage URL.

A push is a **doorbell, not a handoff**: it carries a run id and confers no ownership. Every stage is
still taken with the conditional claim, which is why a poller and a push pool can serve one
deployment at the same time, and why a pushed worker that dies before claiming anything leaves a run
another worker can still take.

## Resource Requirements
- **CPU:** ~2 minutes of compute per run (single-core sufficient)
- **RAM:** ~200MB peak during assignment
- **Disk:** ~50MB temp space per run (cleaned after completion)
- **Network:** Downloads ~5MB OSM data per run, uploads ~1MB results
