# OpenPlan ODM Worker — Self-Hosted Aerial Imagery Processing

## What This Does

This is the worker that turns a mission's drone photos into deliverables — an
orthomosaic (GeoTIFF), a browser-viewable preview (PNG), surface models (DSM/DTM)
and a point cloud — using [NodeODM](https://github.com/OpenDroneMap/NodeODM), the
open-source OpenDroneMap processing server. You never interact with NodeODM
yourself: this worker wraps it and speaks OpenPlan's aerial processing contract,
so to OpenPlan it looks exactly like the hosted Aerial Intel Platform.

It also reads each orthomosaic's own GeoTIFF tags and reports the WGS84 bounds,
native CRS, and pixel size on the callback, which is what lets the mission page
place the preview on the map. When a file's georeferencing cannot be read, the
worker says so and OpenPlan refuses to place it — it never guesses.

## What you need before starting

- **Docker with Docker Compose** on a machine with as much RAM as you can spare
  (8 GB minimum for real missions; photogrammetry is memory-hungry).
- A running OpenPlan deployment on the same machine or reachable over the
  network. Same machine is the simple case and what the defaults assume.
- About 10 minutes.

## Step 1 — start the services

```bash
cd workers/odm_worker
docker compose up -d --build
```

**What success looks like:** the first run downloads the NodeODM image, which is
large (several GB) — the terminal can sit on "Pulling nodeodm" for several
minutes on ordinary broadband. That is downloading, not a hang. When it
finishes, `docker compose ps` shows **two services with STATUS "Up"**:
`nodeodm` and `odm-worker`.

The worker will print one line and then **exit** if step 2 has not been done
yet — `docker compose logs odm-worker` will say exactly which variable is
missing. That refusal is deliberate: an unauthenticated processing endpoint
would let anyone start minutes of compute. Do step 2, then
`docker compose up -d` again.

## Step 2 — create the two shared secrets

The worker and OpenPlan authenticate to each other with two bearer tokens: one
for requests going TO the worker, one for callbacks coming BACK. Generate both
and put them in a `.env` file next to `docker-compose.yml`:

```bash
cd workers/odm_worker
cat > .env <<EOF
OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN=$(openssl rand -hex 32)
OPENPLAN_AERIAL_PROCESSING_CALLBACK_BEARER_TOKEN=$(openssl rand -hex 32)
EOF
docker compose up -d
```

**What success looks like:** `docker compose logs odm-worker` ends with a line
like

```
[odm-worker] serving on :8484 (NodeODM at http://localhost:3001; ...)
```

## Step 3 — tell OpenPlan about the worker

In the OpenPlan app's environment (`.env.local` for a local deployment; your
host's environment settings otherwise), set — with the SAME two token values
from step 2:

```
OPENPLAN_AERIAL_PROCESSING_WORKER_URL=http://localhost:8484
OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN=<the worker token from step 2>
OPENPLAN_AERIAL_PROCESSING_CALLBACK_BEARER_TOKEN=<the callback token from step 2>
OPENPLAN_AERIAL_PROCESSING_WORKER_CONTRACT=v1.1
```

`v1.1` is what makes OpenPlan send the photos stored on a mission (uploaded in
the mission's imagery panel) instead of asking the planner to zip them and host
the ZIP somewhere. Restart the app after changing environment variables.

**If your OpenPlan is NOT on this machine**, two URLs must change from their
localhost defaults: `OPENPLAN_AERIAL_PROCESSING_WORKER_URL` (how the app
reaches this worker) and `ODM_WORKER_PUBLIC_URL` in `docker-compose.yml` (how
the app reaches this worker's output links) — and the app must set
`OPENPLAN_AERIAL_PROCESSING_CALLBACK_URL` to a URL this machine can reach.
See also the networking note at the top of `docker-compose.yml`.

## Step 4 — verify

```bash
curl http://localhost:8484/healthz
```

**What success looks like:** JSON with `"status": "ok"` and
`"nodeodm": {"reachable": true, ...}`. If `reachable` is `false`, NodeODM is
still starting (give it a minute after first pull) or its port mapping was
changed — the `detail` field says what the worker saw. This endpoint reports
that the PROCESS is up; it never promises a job will succeed.

## Step 5 — process a mission

In OpenPlan: open an aerial mission → upload photos in the imagery panel →
"Request processing". The form will say the stored photos will be dispatched.

**What success looks like:** the job appears in the mission's processing list
as *accepted*, advances through *running* with progress percentages as NodeODM
works, and lands on *succeeded* with the outputs listed. OpenPlan then pulls
the outputs into its own storage (custody), so the worker's links expiring
later does not lose anything.

**How long it takes:** minutes for a handful of photos on the fast-preview
preset; **hours** for hundreds of photos on high-quality. The job reports
progress as it goes — silence for tens of minutes during dense reconstruction
is normal for large missions.

## Environment variables (worker side)

| Variable | Default | What it does |
| --- | --- | --- |
| `OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN` | — required | Bearer token OpenPlan presents when dispatching. The worker refuses to start without it. |
| `OPENPLAN_AERIAL_PROCESSING_CALLBACK_BEARER_TOKEN` | — required | Bearer token this worker presents on callbacks. Must equal the app's value of the same name. |
| `NODEODM_URL` | `http://nodeodm:3000` | Where NodeODM is. The compose file overrides it to `http://localhost:3001` for the host-networked worker. Point it at your own NodeODM to skip the bundled one. |
| `NODEODM_TOKEN` | unset | Pass-through if your NodeODM runs with `--token`. |
| `ODM_WORKER_PORT` / `PORT` | `8484` | Port the worker listens on. |
| `ODM_WORKER_PUBLIC_URL` | `http://localhost:8484` | Base of the output links the worker issues. Must be reachable by the OpenPlan deployment. |
| `ODM_WORKER_WORK_DIR` | system temp | Per-job scratch and published outputs. |
| `ODM_WORKER_ARTIFACT_TTL_SECONDS` | `86400` | How long output links stay valid. OpenPlan copies the bytes into its own storage on success, so links only need to outlive that pass. |
| `ODM_WORKER_MAX_QUEUED` | `4` | Jobs held unstarted before the worker answers 503 rather than accepting work it may never reach. |
| `ODM_WORKER_POLL_INTERVAL_SECONDS` | `10` | How often NodeODM is polled for progress. |

## How It Works

1. A planner clicks "Request processing" on a mission. OpenPlan POSTs a
   ProcessingRequest here (`/api/v1/processing-requests`, bearer-authenticated)
   carrying either the mission's stored photos as signed links (contract v1.1)
   or a pasted ZIP link (contract v1 — both shapes are accepted).
2. The worker answers an `accepted` callback body immediately and queues the
   job. One job processes at a time — NodeODM does one reconstruction well and
   several badly.
3. Intake downloads the photos. Manifest photos that declare a SHA-256 or byte
   size are verified; a mismatch fails the job **naming the file**, because
   silently corrupted source photos would flow into an orthomosaic nobody
   could distrust.
4. The photos go to NodeODM with the preset's options (plus `orthophoto-png`,
   always — the PNG is what a browser can display without a tile server).
   Progress callbacks flow back to OpenPlan as NodeODM reports it.
5. On completion the worker downloads the outputs, reads the orthomosaic's
   GeoTIFF tags, reprojects its corners to WGS84, and POSTs a `succeeded`
   callback whose artifacts carry time-limited download links plus
   `boundsWgs84`/`crs`/`pixelSizeM`. OpenPlan verifies, stores, and serves the
   files from its own storage from then on.
6. Anything that fails, fails with a sentence that names the stage and cause
   in the job's own callback trail — never a silent stall.

**What a restart forgets.** The worker keeps its accepted-job queue in memory,
not on disk. If the worker restarts while a job is queued or running, that job
is gone from the worker's point of view and no failure callback will ever
arrive for it. This is not silent on the OpenPlan side: after
`OPENPLAN_AERIAL_PROCESSING_SILENCE_MINUTES` without a callback, the job's
panel says the worker has gone quiet and the planner can dispatch a fresh
request. If you restart the worker deliberately, expect any in-flight job to
need that re-dispatch — nothing is corrupted, only forgotten.

## Running the worker's test suites

Plain scripts, no pytest — the same posture as the AequilibraE worker. All but
one run on the standard library alone:

```bash
cd workers/odm_worker
for f in test_*.py; do python3 "$f" || break; done
```

`test_georef.py`'s reprojection checks need `pyproj` and say so when it is
absent (the tag-parser checks still run). Inside the built container all
dependencies are present, and one check skips by name instead: the contract
enum cross-check needs the repo's schema file, which is not shipped in the
image.

```bash
docker compose exec odm-worker sh -c 'for f in test_*.py; do python "$f" || break; done'
```

**What success looks like, either way:** every suite prints its checks and ends
with an "all … checks passed" line; any `SKIPPED` line names what was skipped
and why. A suite that stops early prints the failing assertion — that is a real
failure, not noise.
