# OpenPlan ActivitySim Worker Runtime Prototype

This worker accepts a built OpenPlan ActivitySim input bundle, validates the handoff contract, stages a runtime working directory, and records an honest runtime result.

It supports three runtime modes:

- `preflight_only`: bundle validation and runtime staging succeed, but full ActivitySim execution is unavailable or not supportable yet
- `activitysim_cli`: a real ActivitySim CLI and executable config package are available, so the worker attempts a real run
- `activitysim_container_cli`: a real containerized command is launched through a configured engine such as Docker, with explicit bundle/config/runtime mounts

The worker does not fabricate a successful behavioral run when the CLI or config package is missing.

## Required Environment Variables

```bash
# Optional shared bearer token for HTTP requests to POST /run or /jobs.
OPENPLAN_ACTIVITYSIM_WORKER_TOKEN=<shared-bearer-token>

# Optional host overrides.
OPENPLAN_ACTIVITYSIM_WORKER_HOST=0.0.0.0
OPENPLAN_ACTIVITYSIM_WORKER_PORT=8080
PORT=8080
```

## Local CLI Usage

From the repo root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r workers/activitysim_worker/requirements.txt

python3 workers/activitysim_worker/main.py \
  --bundle-path data/activitysim-bundles/nevada-county-prototype
```

If you have a real ActivitySim install and an executable config package, you can point the runtime at them explicitly:

```bash
python3 workers/activitysim_worker/main.py \
  --bundle-path data/activitysim-bundles/nevada-county-prototype \
  --config-dir /path/to/activitysim/configs \
  --activitysim-cli activitysim
```

For nonstandard launch commands, use a template:

```bash
python3 workers/activitysim_worker/main.py \
  --bundle-path data/activitysim-bundles/nevada-county-prototype \
  --activitysim-cli-template "activitysim run -c {config_dir} -d {data_dir} -o {output_dir} -w {working_dir}"
```

To reproduce the proven Python 3.11 smoke path in a managed container, point the worker at a container image and let it drive Docker explicitly:

```bash
python3 workers/activitysim_worker/main.py \
  --bundle-path data/activitysim-bundles/nevada-county-prototype \
  --activitysim-container-image python:3.11-slim \
  --container-network-mode bridge \
  --activitysim-container-cli-template "bash -lc 'python -m pip install --no-cache-dir activitysim==1.5.1 && activitysim run -c {config_dir} -d {data_dir} -o {output_dir} -w {working_dir}'"
```

Container behavior:

- bundle and config directories are mounted read-only into the container
- the runtime directory is mounted read-write at `/openplan/runtime`
- the worker defaults to `--network none` and, on Unix-like hosts, `--user <uid>:<gid>` for safer local output ownership
- use `--container-network-mode bridge` (or payload `containerNetworkMode`) when the container must install or fetch dependencies at runtime
- a plain image such as `python:3.11-slim` still needs an inner command that installs or already contains ActivitySim; a future dedicated image can omit that bootstrap

## HTTP Wrapper

Start the HTTP worker:

```bash
python3 workers/activitysim_worker/main.py --serve
```

Accepted endpoints:

- `GET /healthz`
- `POST /run`
- `POST /jobs`
- `POST /`

Example payload:

```json
{
  "bundlePath": "data/activitysim-bundles/nevada-county-prototype",
  "runLabel": "nevada-county-preflight",
  "force": true
}
```

Optional payload fields:

- `manifestPath`
- `runtimeOutputDir`
- `configDir`
- `activitysimCli`
- `activitysimCliTemplate`
- `activitysimContainerImage`
- `containerEngineCli`
- `activitysimContainerCliTemplate`
- `containerNetworkMode`

## Runtime Output Structure

By default the worker writes under:

```text
<bundle>/runtime/<timestamp>-<label>/
```

Files emitted there:

- `runtime_manifest.json`
- `runtime_summary.json`
- `logs/runtime.log`
- `stages/010-validate-inputs/stage.json`
- `stages/020-prepare-activitysim-inputs/stage.json`
- `stages/030-run-activitysim/stage.json`
- `stages/040-collect-outputs/stage.json`

When the CLI actually runs, worker-collected outputs are registered from:

- `output/`

`runtime_manifest.json` also records the execution backend, selected mode, container image, container mount plan, and command details so host CLI and container CLI runs remain distinguishable in downstream evidence.

## Docker

Build from the repo root:

```bash
docker build -f workers/activitysim_worker/Dockerfile -t openplan-activitysim-worker .
docker run --rm -p 8080:8080 openplan-activitysim-worker
```

---

# Supabase poll/claim worker — `behavioral_demand` lane

`supabase_poll.py` is the production entrypoint for the OpenPlan `behavioral_demand`
run class (the HTTP wrapper above stays for local/manual use). It mirrors the
AequilibraE worker's REST poll/claim contract exactly (no Postgres RPCs; the
atomic stage claim is a conditional PATCH `?status=eq.queued`).

A `behavioral_demand` run is a 4-stage async pipeline:

```
AequilibraE Setup → Network Assignment → Artifact Extraction   (aequilibrae_worker)
  → ActivitySim Bundle & Preflight                             (this worker)
```

The AequilibraE worker runs the screening (network + `travel_time_skims.omx`) and
registers `zone_attributes.csv` + the skim as `local://` artifacts. This worker
reads them, builds a real (uncalibrated, scaffold-population) ActivitySim input
bundle, runs the runtime, and writes an honest evidence packet + KPIs. **Because
the handoff is `local://`, the two workers must share a filesystem (co-located on
one host, or a shared volume).**

Required env: `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) + `SUPABASE_SERVICE_ROLE_KEY`.

Run it (light preflight infra — `requests` + stdlib only):

```bash
npm run worker:activitysim          # from openplan/
# or: python workers/activitysim_worker/supabase_poll.py
```

## Two postures: PREFLIGHT ($0) vs EXECUTION (dedicated host)

- **Preflight (default, light infra).** No ActivitySim installed → the runtime
  stays `preflight_only`. The run still produces a real, inspectable bundle +
  honest evidence + structural (scaffold) KPIs. **No** VMT/trip/mode-share number
  is ever written. This is the honest default and runs on modest infra.
- **Execution (a real, still-UNCALIBRATED run).** Set the execution env so the
  runtime launches a real ActivitySim CLI:

  ```bash
  # On a Python-3.11 host with requirements-exec.txt installed:
  export ACTIVITYSIM_CLI=activitysim
  # or drive a container instead:
  #   export ACTIVITYSIM_CONTAINER_IMAGE=openplan-activitysim-exec
  #   export ACTIVITYSIM_CONTAINER_CLI_TEMPLATE="activitysim run -c {config_dir} -d {data_dir} -o {output_dir} -w {working_dir}"
  ```

  Build the execution image (Python 3.11 — host 3.12 is not dependable):

  ```bash
  docker build -f workers/activitysim_worker/Dockerfile.exec -t openplan-activitysim-exec .
  ```

  When a run actually executes, behavioral KPIs are written **only if** the run
  produced supportable outputs, and are always labeled `uncalibrated`. A
  starter/zero-model config runs successfully but emits no trips/tours → no
  behavioral KPI (honest).

## ⛔ Infra reality — real behavioral runs are NOT $0

ActivitySim is RAM-heavy and long-running. The AequilibraE screening worker runs
on a **512 MB** Fly VM; ActivitySim **cannot** co-run there. Even a 26-zone
starter smoke used ~360 MB RSS; a calibrated multi-model metro run needs **several
GB of RAM**, several vCPUs, minutes-to-hours of runtime, and an always-on poller
(`auto_stop = false`). A real production behavioral lane therefore requires:

1. **A dedicated modeling host** (≈8–16 GB RAM VM/box) running the Python-3.11
   `Dockerfile.exec` image with `ACTIVITYSIM_CLI` set, co-located with (or sharing
   a volume with) the AequilibraE worker. This is **paid infra, not $0.**
2. **County-specific calibration** — the emitted config is the OpenPlan starter
   kit (`v0`); a behaviorally meaningful, forecast-grade run needs calibrated
   settings/coefficients + household/person schema alignment. Until then every run
   is labeled **uncalibrated / prototype / preflight — never a forecast.**

Verified locally on 2026-07-22: `activitysim==1.5.1` runs an OpenPlan-built bundle
end-to-end on Python 3.11 (`activitysim_cli`, settings-checker passes, 0 models →
no fabricated demand). See `docs/ops/2026-07-22-activitysim-behavioral-lane-smoke.md`.
