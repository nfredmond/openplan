# OpenPlan AequilibraE Worker — Cloud Deployment

## What This Does
This is a background Python worker that continuously polls Supabase for queued model runs, executes AequilibraE traffic assignment (downloading OSM road networks, running BFW equilibrium assignment), and uploads the results (GeoJSON volumes, evidence packets, KPIs) back to Supabase.

## Required Environment Variables
```
SUPABASE_URL=https://aggphdqkanxsfzzoxlbk.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

## Option A: Fly.io (Recommended — $3-5/month)

```bash
# 1. Install Fly CLI
curl -L https://fly.io/install.sh | sh

# 2. Login
fly auth login

# 3. Deploy from the worker directory
cd workers/aequilibrae_worker
fly launch --copy-config --yes

# 4. Set secrets
fly secrets set SUPABASE_URL="https://aggphdqkanxsfzzoxlbk.supabase.co"
fly secrets set SUPABASE_SERVICE_ROLE_KEY="<your-key-from-.env.local>"

# 5. Verify
fly logs
```

## Option B: Railway ($5 free credits/month)

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
railway variables set SUPABASE_URL="https://aggphdqkanxsfzzoxlbk.supabase.co"
railway variables set SUPABASE_SERVICE_ROLE_KEY="<your-key>"
```

## Option C: Any Docker Host

```bash
# Build
docker build -t openplan-aeq-worker .

# Run
docker run -d --restart=always \
  -e SUPABASE_URL="https://aggphdqkanxsfzzoxlbk.supabase.co" \
  -e SUPABASE_SERVICE_ROLE_KEY="<your-key>" \
  openplan-aeq-worker
```

## How It Works
1. User clicks "Launch Run" in OpenPlan UI (Vercel)
2. Next.js API creates a `model_run` + 3 `model_run_stages` in Supabase with `status=queued`
3. This worker polls Supabase every 5 seconds for queued stages
4. When found, it:
   - Downloads the OSM road network for the study area
   - Adds zone centroids and connectors
   - Runs Bi-conjugate Frank-Wolfe traffic assignment
   - Generates a GeoJSON volume map
   - Uploads results to Supabase Storage
   - Records KPIs and artifacts in Supabase
5. The UI renders the traffic volume map from the Supabase Storage URL

## Resource Requirements
- **CPU:** ~2 minutes of compute per run (single-core sufficient)
- **RAM:** ~200MB peak during assignment
- **Disk:** ~50MB temp space per run (cleaned after completion)
- **Network:** Downloads ~5MB OSM data per run, uploads ~1MB results
