# County Onramp HTTP Worker

This worker exposes an HTTP endpoint that accepts county onramp jobs, runs `scripts/modeling/bootstrap_county_validation_onramp.py`, and posts the result back to the OpenPlan app.

## Required Environment Variables

```bash
# Worker endpoint auth for app -> worker POSTs.
OPENPLAN_COUNTY_ONRAMP_WORKER_TOKEN=<shared-bearer-token>

# Optional overrides.
OPENPLAN_REPO_ROOT=/app
OPENPLAN_COUNTY_ONRAMP_PYTHON_BIN=/usr/local/bin/python
OPENPLAN_COUNTY_ONRAMP_MAX_CONCURRENCY=1
OPENPLAN_COUNTY_ONRAMP_CALLBACK_TIMEOUT_SECONDS=30
PORT=8080
```

The callback bearer token is sent in the job payload by the app, so it does not need to be configured separately on the worker.

## Run Locally

From the repo root:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r workers/county_onramp_worker/requirements.txt
python workers/county_onramp_worker/main.py
```

The worker accepts `POST /jobs` and `POST /`.

## Docker

Build from the repo root so the image includes `scripts/`, `data/`, and the app code:

```bash
docker build -f workers/county_onramp_worker/Dockerfile -t openplan-county-onramp-worker .
docker run --rm -p 8080:8080 \
  -e OPENPLAN_COUNTY_ONRAMP_WORKER_TOKEN=replace-me \
  openplan-county-onramp-worker
```

## App Configuration

Set these in the OpenPlan app host:

```bash
OPENPLAN_COUNTY_ONRAMP_WORKER_URL=https://your-worker-host/jobs
OPENPLAN_COUNTY_ONRAMP_WORKER_TOKEN=<same-shared-bearer-token>
OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN=<separate-callback-bearer-token>
```

The worker uses `callback.manifestIngestUrl` from each job payload and includes `callback.bearerToken` on the callback request when present.
