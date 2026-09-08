# OpenPlan operations runbook

Use this runbook for an identified deployment. The installation and configuration
reference is [SELF_HOSTING](../SELF_HOSTING.md); recovery inventory and procedures
belong in [BACKUP_AND_RESTORE](BACKUP_AND_RESTORE.md). Record deployment acceptance
with [FIRST_DEPLOYMENT](../FIRST_DEPLOYMENT.md). Commands below run from the
repository's nested `openplan/` app directory unless stated otherwise.

This is maintained guidance, not evidence that a particular deployment works.
The local Supabase CLI stack is an evaluation environment; a complete hardened
agency deployment and full recovery procedure remain to be proved. No response
time or recovery objective is promised by OpenPlan. The operator must establish
those from their actual installation and rehearsals.

## Identify the incident before changing the system

Record when the failure began, the affected user task, public/private surface,
selected deployment, release/build, and one redacted request or job identifier.
Keep restricted evidence in the operator's private incident record; share only
sanitized reproduction material. Do not paste credentials, cookies, signed file
URLs, resident submissions or raw environment output into public issues.

Start by reading checkout identity and configuration without starting services:

```bash
git rev-parse HEAD
git status --short
npm run ops:check-local-supabase-status
```

The configuration check reads the local environment file and migration filenames,
redacts values, and checks whether selected URLs look local. It does not connect
to Supabase, validate credentials or compare applied migrations. A non-local
finding may be expected for a deliberately remote deployment; it must not be
reinterpreted as permission to run local-only write tools against that service.

When a network probe of the selected deployment is appropriate, set the intended
origin explicitly. This example is the local evaluation origin:

```bash
OPS_ORIGIN="http://127.0.0.1:3000"
bash scripts/ops/which-openplan.sh "$OPS_ORIGIN"
OPENPLAN_HEALTH_URL="$OPS_ORIGIN/api/health" npm run ops:check-prod-health
```

These commands contact that origin. The identity helper compares the reported
commit with the checkout and, when available, inspects the local listener's
working directory. The reported commit comes from deployment environment values;
it is not a verified hash of the served bundle. The helper also accepts a local
matching working directory when no commit is reported. Independently record
whether the process is a development server or a built app, its build record and
any uncommitted changes. A matching port, directory or stamp alone cannot prove
that all served assets came from the intended source.

The health check validates GET/HEAD responses, cache headers and the shallow app
payload. It deliberately requires `checks.database` to remain `not_checked` and
accepts an `unknown` commit. It does not check authentication, database readiness,
Storage, maps, workers, schedulers, output correctness or usable workflows.
The [health workflow](../../../.github/workflows/production-health.yml) runs only
when the repository's health-URL variable is configured; a skipped workflow
provides no monitoring. Its current remote runs are separate evidence to inspect.

## Local demo update and recovery

OpenPlan Control opens on the Demo tab with **Open demo** and **Update demo**.
Development holds the test-site controls. Diagnostics holds checks, the last
update log and **Recover previous demo**. Updates build separately. It checks the configured service directory before changing that service.
Use the same coordinator from the nested app directory when diagnosing the tool:

```bash
python3 scripts/ops/safe-refresh-walkthrough.py
python3 scripts/ops/safe-refresh-walkthrough.py --recover
```

Defaults target `~/apps/openplan`, `openplan-web.service` and port 3000. Separate
installations must pass their own instance path, `--service` and `--url`. The
instance must be an independent clone. This tool does not install or configure
services. A mismatched or unavailable predecessor identity blocks an update.

Candidates, changed-source snapshots, retained runtime directories, displaced failed builds and the recovery journal stay
in a private sibling directory, normally `~/apps/.openplan-updates`. These may
contain secrets. Keep them local. Each new attempt records its start time,
failure reason and a streamed `build.log`; Diagnostics can reopen the last log.
Git-tracked symbolic links are preserved when preparing the candidate. The tool retains them until an operator reviews
their disposition; allow disk space for dependencies and builds on each update.
An interrupted update blocks another update until recovery is resolved. A failed
preparation leaves the original directory in place. A failed promotion attempts
to restore the changed source and runtime; retry recovery if restart itself failed.
The instance root and local artifact paths stay in place. Managed settings
symlinks and source/settings changed outside the recorded transaction require
review before this coordinator can proceed. It preserves those edits.

The shell builder checks the local migration inventory, not the application's
actual runtime database identity. No database migration or rollback runs here.
Current main may be an unreleased candidate. A matching reported commit does not
establish browser acceptance or a dependable agency deployment. The September 6
[exercise record](../../../docs/reviews/2026-09-06-housekeeping/VERIFICATION.md)
separates real file/process checks from simulated builds and service management.

## Decide severity and containment

| Severity | Examples | Immediate owner action |
|---|---|---|
| Critical | Suspected cross-workspace disclosure, auth bypass, destructive data loss, deployment-wide outage | Preserve evidence, identify the affected boundary and coordinate containment with the deployment/security owner. Restrict the affected access or writes where necessary and communicate the impact through an authorized channel. |
| Major | A required planning workflow, export, source or worker is unavailable | Preserve the failing job/request and affected work; identify an actually tested alternative or report the workflow unavailable. |
| Limited | A bounded defect with no observed loss or exposure and a usable path | Record scope and reproduction, then schedule a focused correction. |

A suspected disclosure is a security incident even if health remains green.
Use the repository's [security reporting policy](../../../SECURITY.md) for
private vulnerability escalation. There is no vendor support contract behind
OpenPlan. Do not disable RLS, broaden Storage access or allow an unexplained
outbound origin to make a failing request succeed.

## Diagnose the failing boundary

Use the logs for the service and topology recorded at commissioning. Do not assume
a Vercel deployment or a particular systemd unit exists. Read the relevant app,
reverse-proxy, database or worker logs for the incident interval, with identifiers
redacted in shared notes. Inspect actual response status and error details before
changing configuration.

| Symptom | Next evidence to collect | What it does not establish |
|---|---|---|
| No health response or app 5xx | Listener/service state, last build/deploy result, app/proxy logs, available disk and memory | A process restart does not establish a fixed cause or valid saved work. |
| Health passes, sign-in or workspace access fails | Actual Auth redirect destination, selected Supabase origin, session/membership error, applied migration state and relevant service logs | Presence of keys or migration files does not establish authentication or schema readiness. |
| Blank map, missing layer or source | Browser console/network failure, token restrictions, chosen geography, provider/source response and layer status | A configured Mapbox/Census key does not prove the source covers this place or the layer rendered. |
| Missing report/PDF or attachment | Report/job state, output metadata, object availability, rendering/storage errors; inspect any produced artifact | A PDF file existing does not prove its content. Check the disclosed fallback tier and `CHROME_EXECUTABLE_PATH` on a local host. |
| Invitation or reminder missing | Distinguish copyable invitation links, application email provider, Supabase Auth email and scheduler delivery | One working email path does not establish the others. |
| CSP or external-fetch refusal | Requested origin, blocked directive/address and intended feature | A refusal alone is not a reason to weaken the policy. Confirm the source and add only a justified narrow allowance. |

`npm run doctor` performs broader configuration and selected liveness checks. It
may contact services and inspect local migration state; some unavailable checks
remain warnings. Preserve those findings rather than interpreting the final
message as complete readiness. Never share the raw output of a tool that prints
Supabase credentials; use redacted summaries in incident evidence.

If migration state is unknown, resolve the intended target and read its migration
inventory before planning an application change. The independently self-hosted
Supabase production recipe is still unproved. Do not apply a linked-project or
local-CLI command merely because a different topology used it successfully.

## Worker and scheduler incidents

First name the service: county-onramp, general AequilibraE, ActivitySim, OCR or
aerial processing. `modeling:up` starts the county service; `modeling:local`
starts paired general pollers. One does not provision the other. The
[configuration reference](../SELF_HOSTING.md) links each deployment guide.

Follow one job from its user-facing launch through dispatch/claim, worker log,
progress, callback, database state and persistent artifact. Compare job and
attempt identifiers, stage timestamps and worker heartbeat times. Distinguish:

- **Configured:** a URL, token or deployment declaration is present.
- **Reachable:** the service answered a health request.
- **Executing:** the intended worker accepted/claimed this job and is doing work.
- **Delivered:** its authenticated result and required bytes were persisted and
  can be reopened from the planner's workflow.
- **Validated:** the separate scientific or content checks support the claimed
  result. Execution alone does not establish this state.

ActivitySim can start in preflight-only mode when its execution environment is
missing. Preserve that limitation. For county/OCR callbacks, check matching tokens
in each direction and the worker's reachable callback origin. After environment
changes, the affected processes need the correct restart/recreation sequence;
changing the app alone does not replace a container's startup environment.

Current model recovery needs care: the reaper uses run/stage timestamps, while
workers can send a separate heartbeat. A fresh worker heartbeat is not proof that
the reaper will leave a long stage alone. Preserve both timelines and any late
result; do not manually rewrite a failed/inconclusive outcome to completed or
blindly resubmit work whose worker may still be running. Diagnose and rehearse
recovery on a disposable case before changing the production job's custody.

Check the three authenticated schedules and cadences in SELF_HOSTING. Capture
scheduler delivery, authentication failures and the resulting state changes.
The maintenance endpoints use GET but **write data**: a model reaper request can
fail runs and a deadline sweep can send messages. Model-page loading also has
reconciliation behavior. HTTP method and page navigation are not reliable
indicators that an action is read-only.

## Separate inspection from changes

| Action | Operational effect |
|---|---|
| Checkout status, redacted local configuration summary, health probe | Inspection; the health probe contacts the explicitly selected service. |
| `npm run dev` | Starts the app and runs migration synchronization through `predev`. |
| `npm start` | Starts a built app; does not apply migrations or provision the surrounding stack. |
| Worker launch/Compose commands | Start or recreate compute services that can claim queued work and write results. |
| Migration application, configuration edits, credential rotation | Change deployment behavior or durable schema; require identified targets and a release/incident plan. |
| `npm run test:rls-live`, `npm run qa:gate` | Test/build activity; live checks may create records. Use explicitly selected test environments, not an unexamined production environment. |
| `npm run ops:restore-drill` | Creates and removes disposable services/data; exercises only the representative recovery path documented below. |
| Walkthrough refresh helper | Fetches/builds/restarts an already configured service. Unverified migration state blocks build/restart; a served-commit mismatch fails after restart and may require recovery. It is not a generic diagnosis or installer command. |

Reproduce a defect with non-sensitive data in an isolated environment before
patching where feasible. Use focused regression and live boundary tests when
appropriate; verify that new guards detect a meaningful failure. Check browser
workflows against the identified build, including console and artifact results.
A green generic gate is not incident closure. An app rollback also does not
reverse migrations: verify compatibility with the actual current schema first.

## Backup and recovery during an incident

Follow [BACKUP_AND_RESTORE](BACKUP_AND_RESTORE.md); do not invent a restore command
against the only copy of the data. Durable state includes local worker artifacts
and protected configuration as well as database and Storage. Capture the damaged
state where feasible, retain logs and select an inventoried recovery point.

The existing local archive commands dump PostgreSQL and then tar Storage. Without
coordinated write quiescence or a tested snapshot method, those sequential files
can describe different moments. The original routine also omits separately stored
worker files from its executable capture steps. Archive hashes and readable
indexes cannot establish complete coverage or working recovery.

The current disposable drill restores selected SQL rows into a migration-created
schema and transfers one object through the Storage API. It does not restore the
full custom-format dump, the whole Storage filesystem, all Auth/roles/configuration
or local model artifacts. Its successful sample result must not be presented as
proof of that full archive procedure. Exact complete restore and cutover commands
remain a deliverable to test for the selected topology.

A restore that replaces durable state needs the deployment owner's explicit
approval. Restore into an isolated target first, verify tenant boundaries,
authentication, hashes and reopened planner work, and record actual elapsed time
and data loss. Prevent the rehearsal copy from sending real messages or callbacks.
Retain the old state until recovery is accepted. Restoring a snapshot does not
revoke leaked secrets or undo information already disclosed; handle those
containment needs separately.

## Close the incident with evidence

Record the affected task and time interval, identified versions/topology, cause
or unresolved hypothesis, containment and changes, data effects, reproduction,
verification and remaining limitations. Include evidence for resumed saved work
and any worker/export result that mattered. Use a private incident record for
sensitive details and a sanitized repository follow-up for reusable corrections.
Keep failed, skipped and inconclusive checks visible. Assign the concrete
prevention work and update the operating procedure when the mechanism is proved.
