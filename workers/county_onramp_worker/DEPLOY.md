# The modeling worker

This is the service that turns a county run in OpenPlan into an actual travel
model result. It accepts a job over HTTP, runs
`scripts/modeling/bootstrap_county_validation_onramp.py` — which downloads the
road network, builds zones from Census data, assigns traffic and writes a
manifest — and posts that manifest back to OpenPlan.

**Without it, OpenPlan still works.** Launching a county run produces a complete
job description that nothing executes, and `/county-runs` says so before you
click rather than after. That is a supported configuration. This document is
about turning the other one on.

A run takes roughly six minutes on an ordinary laptop, most of it spent
downloading the road network.

## On your own machine (the usual case)

From the `openplan/` app folder:

```bash
npm run modeling:up
```

The first run builds the image: several minutes, about a gigabyte of
AequilibraE, GeoPandas and SpatiaLite. Later starts are instant.

Then put three values in `openplan/.env.local` and restart `npm run dev`:

```bash
OPENPLAN_COUNTY_ONRAMP_WORKER_URL=http://127.0.0.1:8686/jobs
OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN=<any long random string>
CENSUS_API_KEY=<free, from api.census.gov/data/key_signup.html>
```

**All three matter, and two of them fail silently if you skip them.** Without
the callback token the worker runs the whole model and OpenPlan refuses the
result with a 401 — the run never appears. Without the Census key every run
stops in its first second, which at least says so plainly.

`npm run doctor` checks all three and says which is missing. `npm run
modeling:logs` follows the worker's own output; `npm run modeling:down` stops
it.

### What the compose file does, and why

- **`network_mode: host`** — each job carries a callback URL of
  `http://localhost:3000/…`. Inside a normal container that address is the
  container itself, where nothing is listening, so the model would run
  correctly and the result would go nowhere. On Docker Desktop (macOS/Windows)
  turn on Settings → Resources → Network → "host networking". *Verified on
  Linux; the Docker Desktop setting is documented behaviour we have not run
  here.* If it gives you trouble, use the bridge-network alternative below —
  it needs one more setting and no Docker Desktop preference.
- **The bind mount of your checkout at `/app`** — OpenPlan reads several of a
  run's files straight off disk (the validation scaffold CSV, the validation
  summary), so the app and the worker have to be looking at the same folder. It
  is also how the worker sees your `.env.local`, and how results survive
  `docker compose down`.
- **`OPENPLAN_COUNTY_ONRAMP_WORKER_HOST: 127.0.0.1`** — host networking puts
  this socket on your machine's real network stack, and the job endpoint starts
  processes and writes files. Loopback keeps it off your wifi. If you move the
  app to another machine, change this *and* set a worker token.

### Changing `main.py` needs a restart; changing the model does not

The bind mount makes your checkout live inside the container, but only for code
that is STARTED FRESH each time. The model scripts are subprocesses, so an edit
to them takes effect on the next job. `main.py` is the long-running server: it
was imported when the container started and keeps the old copy in memory.

This bites quietly — the job runs, succeeds, and silently ignores a new option,
which reads as "the feature does not work" rather than "the server is stale". If
a payload field seems to have no effect:

```bash
npm run modeling:up
```

Runs land in `data/screening-runs/<run name>/` in your checkout, with
downloads cached in `data/_screening_cache/`. Both are gitignored. They are
large — a county is a few hundred megabytes.

### Bridge-network alternative (if host networking is a problem)

In `docker-compose.yml`, replace `network_mode: host` and the
`OPENPLAN_COUNTY_ONRAMP_WORKER_HOST` line with:

```yaml
    ports:
      - "127.0.0.1:8686:8686"
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

and add one line to `openplan/.env.local`:

```bash
OPENPLAN_COUNTY_ONRAMP_CALLBACK_ORIGIN=http://host.docker.internal:3000
```

That last line is the whole difference. Without it the worker would try to
deliver the finished run to itself.

## On a server

Same image, without host networking:

```bash
docker build -f workers/county_onramp_worker/Dockerfile -t openplan-modeling-worker .
docker run -d -p 8080:8080 \
  -e OPENPLAN_COUNTY_ONRAMP_WORKER_TOKEN=<shared-bearer-token> \
  -e CENSUS_API_KEY=<your key> \
  openplan-modeling-worker
```

Build from the **repo root** — the worker shells out to sibling scripts by path.

On the OpenPlan side:

```bash
OPENPLAN_COUNTY_ONRAMP_WORKER_URL=https://your-worker-host/jobs
OPENPLAN_COUNTY_ONRAMP_WORKER_TOKEN=<same shared bearer token>
OPENPLAN_COUNTY_ONRAMP_CALLBACK_BEARER_TOKEN=<a different random string>
```

The two tokens are deliberately different secrets in opposite directions: the
first proves OpenPlan to the worker, the second proves the worker to OpenPlan.

The worker must be able to reach OpenPlan at the address OpenPlan sees itself
at — the callback URL is built from the incoming request's origin. And OpenPlan
must be able to read the run's artifact files, so a worker on a separate machine
needs the same shared storage mounted at the same path.

## Settings

| Variable | Meaning |
|---|---|
| `OPENPLAN_COUNTY_ONRAMP_WORKER_TOKEN` | Required bearer token on `POST /jobs`. Unset means the endpoint is unauthenticated — acceptable only on loopback. |
| `OPENPLAN_COUNTY_ONRAMP_WORKER_HOST` | Bind address. Default `0.0.0.0`; the local compose setup sets `127.0.0.1`. |
| `PORT` | Listening port. Default `8080`; the local compose setup uses `8686`. |
| `OPENPLAN_REPO_ROOT` | Where the checkout is. Default `/app`. Artifact paths in a job are resolved against it and **refused if they escape it**. |
| `OPENPLAN_COUNTY_ONRAMP_PYTHON_BIN` | Interpreter for the model subprocess. Defaults to the one running the worker. |
| `OPENPLAN_COUNTY_ONRAMP_MAX_CONCURRENCY` | Simultaneous runs. Default 1; each one saturates a core for minutes. |
| `OPENPLAN_COUNTY_ONRAMP_CALLBACK_TIMEOUT_SECONDS` | Default 30. |
| `CENSUS_API_KEY` | Required by every run. Read from the environment, or from `openplan/.env.local` when the checkout is mounted. |

The callback bearer token is carried in each job payload, so it is never
configured on the worker.

## Endpoints

- `POST /jobs` (and `POST /`) — accepts a job, returns `202` immediately, runs
  it in the background and posts the manifest to the job's callback URL.
- `GET /healthz` — what `npm run doctor` probes.

## Running it without Docker

The dependencies are in two files, and **both are required**: this worker
imports only the first, but the model subprocess it launches imports the second.
Installing only the service dependencies produces a worker that starts, answers
`/healthz`, accepts jobs and fails every one of them a second later.

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r workers/county_onramp_worker/requirements.txt
pip install -r scripts/modeling/requirements.txt
python workers/county_onramp_worker/main.py
```

You will also need SpatiaLite — `libsqlite3-mod-spatialite` on Debian/Ubuntu —
and `SPATIALITE_LIBRARY_PATH` pointing at it if it is not in a standard place.
Python 3.11 is not arbitrary: it is the only interpreter this chain has been
observed to complete a run on.
