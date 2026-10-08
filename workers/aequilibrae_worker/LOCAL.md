# Running the AequilibraE worker locally

The worker is a Python process that executes queued `model_run_stages` — an OSM
+ AequilibraE traffic assignment — and writes KPIs, artifacts, and a volumes
GeoJSON back to Supabase. Run it alongside `npm run dev` so a live model run
completes without any cloud deployment.

Locally it polls, which is the default and needs no configuration. (The other
mode, an HTTP trigger the app pushes runs to, exists for deployments that would
rather wake a container than keep one on; `AEQ_WORKER_MODE=push` and `DEPLOY.md`
cover it. There is nothing to gain from it on a dev machine.)

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
OPENPLAN_DEPLOYMENT_ID=<stable identity for this database installation>
# Optional, defaults shown:
SPATIALITE_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu/mod_spatialite.so
AEQ_WORK_DIR=<scratch dir; default is <system temp>/openplan-model-runs>
AEQ_WORKER_MODE=<poll (default) | push | both — see DEPLOY.md>
CENSUS_API_KEY=<REQUIRED for dynamic study areas — the Census ACS API rejects keyless requests; free at https://api.census.gov/data/key_signup.html>
```

> The default scratch root used to be `data/pilot-nevada-county/` inside the
> repo — one county's name on every run's working directory, anywhere in the
> world. It is now the system temp directory. If you have an in-flight local run
> under the old path, set `AEQ_WORK_DIR` to it so the remaining stages find their
> `state.json`; if you want run scratch kept somewhere durable, set it to that
> instead.

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

## Full run IDs in scratch paths

New worker execution uses `AEQ_WORK_DIR/runs/<full-run-uuid>`. Configure the
application's `OPENPLAN_WORKER_LOCAL_ROOT` to the same root. Shortened 12-character
directories remain on disk but are not adopted automatically.

Before upgrading an installation with unfinished runs, finish those runs using
the existing worker checkout. The new worker refuses a later stage before
claiming it when only shortened legacy scratch exists. Do not rename a prefix
directory based on its name alone; it does not prove the complete run identity.
Legacy `local://` references under shortened paths are refused by the updated
application. Existing private Storage references keep their original identity.
Automated reconciliation of legacy local files remains unfinished.

## Retained assessment writes

Before running this worker revision, apply migration
`20261016000015_legacy_assessment_command_receipts.sql` to the intended database.
Set `OPENPLAN_DEPLOYMENT_ID` to a stable installation identity. Keep it unchanged
when restarting that installation; use a different identity for a replacement
database. Missing identity stops assessment delivery. There is no fallback to
the old non-idempotent assessment RPC.

Use a durable `AEQ_WORK_DIR`. Each assessment directory retains its exact command
under `command-journal/model-commands.sqlite3`. Back up this journal together with
the assessment files. An unconfirmed write stops the stage before publication.
Use `model_command_recovery.py --help` to list or recover the original request,
with the same deployment identity, URL and journal directory. Recovery confirms
custody only. Automatic continuation of the original stage remains unfinished;
do not regenerate an assessment with a new UUID as a substitute for recovery.


Primary link-volume registration also requires migration
`20261016000016_legacy_artifact_command_receipts.sql`. Apply it to the intended
database before starting this worker version. Keep
`<work_dir>/stage-journals/<stage_id>/model-commands.sqlite3` with the prepared
source files. An unconfirmed primary write stops the stage and retains its exact
request for `model_command_recovery.py`. Recovering that receipt does not resume
the stage or authorize replay of the complete stage.


## Retained KPI writes

Both normal assignment KPI writers require migration
`20261016000017_legacy_kpi_command_receipts.sql` before this worker starts.
They retain each complete request in the same stage journal used by artifacts.
Keep `OPENPLAN_DEPLOYMENT_ID`, the database URL and that journal unchanged for
recovery. A lost reply stops the stage; use `model_command_recovery.py` to
recover its original receipt. Changed values under the same KPI identity are
refused. Explicit null values remain null. Receipt recovery does not authorize
whole-stage replay or establish model accuracy.


## Inspect saved calculations

Use the same deployment identity, URL and stage journal as the original worker:

```bash
python model_command_recovery.py --journal /path/to/stage-journal \
  --base-url "$SUPABASE_URL" --deployment-id "$OPENPLAN_DEPLOYMENT_ID" \
  --list-computations
```

This read-only listing reports `result_retained` or `started_without_result` for
each saved calculation. It prints identifiers and states, not inputs or result
payloads. A missing journal or damaged record is refused. An older journal with
no calculation records returns an empty list. This does not contact the server,
claim the stage or resume work. Preserve an interrupted start and its source
files for reconciliation. Do not delete it to make the calculation run again.
Use `--list-pending` separately to inspect delivery requests.
