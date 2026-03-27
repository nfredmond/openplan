# OpenPlan ActivitySim Worker Runtime Prototype

This worker accepts a built OpenPlan ActivitySim input bundle, validates the handoff contract, stages a runtime working directory, and records an honest runtime result.

It supports two runtime modes:

- `preflight_only`: bundle validation and runtime staging succeed, but full ActivitySim execution is unavailable or not supportable yet
- `activitysim_cli`: a real ActivitySim CLI and executable config package are available, so the worker attempts a real run

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

## Docker

Build from the repo root:

```bash
docker build -f workers/activitysim_worker/Dockerfile -t openplan-activitysim-worker .
docker run --rm -p 8080:8080 openplan-activitysim-worker
```
