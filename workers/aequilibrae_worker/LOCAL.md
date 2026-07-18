# Running the AequilibraE worker locally

The worker is a background Python process that polls Supabase for queued
`model_run_stages`, runs an OSM + AequilibraE traffic assignment, and writes
KPIs, artifacts, and a volumes GeoJSON back to Supabase. Run it alongside
`npm run dev` so a live model run completes without any cloud deployment.

For cloud/hosted deployment (Fly.io, Railway, Docker) see `DEPLOY.md`.

## One-liner (from `openplan/`)

```bash
npm run worker:aequilibrae
```

That script `cd`s into `workers/aequilibrae_worker/` and runs `python3 main.py`.
`main.py` loads `openplan/.env.local` automatically (via `load_dotenv`), so the
Supabase credentials below are picked up from your existing dev env file.

## Required environment

The worker needs a Supabase URL + **service-role** key. It reads, in order:
`workers/aequilibrae_worker/.env`, then `openplan/.env.local`.

```
SUPABASE_URL=<your-supabase-url>            # or NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
# Optional, defaults shown:
SPATIALITE_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu/mod_spatialite.so
AEQ_WORK_DIR=<scratch dir; default is repo data/pilot-nevada-county>
CENSUS_API_KEY=<optional, raises ACS/LODES rate limits>
```

For local runs against the local Supabase stack, use the local API URL and the
local service-role key printed by `npm exec supabase status`.

If you want the Next.js app to fall back to reading run-local artifact files
from disk (dev only — hosted deployments must not), also set on the **app**
side: `OPENPLAN_WORKER_LOCAL_ROOT=<AEQ_WORK_DIR>`. Without it the app resolves
run volumes only through the private `run-artifacts` Storage bucket.

## Python dependencies

Do **not** install these into the repo's node/JS toolchain. Use a dedicated
Python virtualenv. Requirements (see `requirements.txt`):

```
aequilibrae>=1.6.0
numpy>=1.26
pandas>=2.0
shapely>=2.0
requests>=2.31
python-dotenv>=1.0.0
```

Suggested setup (run manually — not part of any npm script):

```bash
cd workers/aequilibrae_worker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

AequilibraE also needs the SpatiaLite extension (`mod_spatialite`) available on
the system library path; install it via your OS package manager
(`libsqlite3-mod-spatialite` on Debian/Ubuntu) and point
`SPATIALITE_LIBRARY_PATH` at it if it is not at the default location.

## What a successful run writes

- `model_run_stages`: each stage transitions queued → running → succeeded.
- `model_run_kpis` (category `general`/`assignment`): includes `daily_vmt`,
  `vmt_per_capita`, and `population_total` — screening-grade, derived from
  Σ(link volume × link length in miles), centroid connectors excluded.
- `model_run_artifacts`: a `volumes_geojson` row whose `file_url` is a private
  `storage://run-artifacts/model-runs/<run-id>/volumes.geojson` path (not a
  public URL); the app resolves it with a service-role download.
