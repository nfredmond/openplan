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

For the accumulated v0.68 candidate, use the
[upgrade and recovery instructions](V068_UPGRADE.md). That guide does not
declare the candidate released; confirm its final GitHub release and commit.

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

With migration `20261016000022_model_reaper_recovery_boundary.sql`, automatic
timeout applies only to unstarted queued model work. The database refuses to
reap running, attempt-managed or previously started work based on age alone.
Earlier deployments do not have this protection. A retained running status is
still not proof of a live process. Preserve stage and worker timelines, local
journals and late results before making a recovery decision.

Migration `20261016000023_model_recovery_decisions.sql` lets an owner or
administrator review and abandon nonterminal execution through the model's
recovery panel. It preserves the reviewed records and revokes database write
authority. It neither proves process termination nor authorizes restart.
Do not manually rewrite outcomes, clear enrollment or replace request IDs to
resume a stage. Use the [bounded recovery procedure](V068_UPGRADE.md#review-an-interrupted-model)
and retain uncertain requests for explicit retry.

Check the three authenticated schedules and cadences in SELF_HOSTING. Capture
scheduler delivery, authentication failures and the resulting state changes.
The maintenance endpoints use GET but **write data**: a model reaper request can
fail runs and a deadline sweep can send messages. Model-page loading also has
reconciliation behavior. HTTP method and page navigation are not reliable
indicators that an action is read-only.

### Translation recovery worker

The v0.59.0 translation queue uses `npm run worker:translation-generation`
from `openplan/`; append `-- --once` for one claim or recovery cycle. Apply all
migrations through `20261014000020_engagement_public_translation_queue.sql`
before running the app or worker. Upgrading from v0.58.1 applies eleven new
migrations, 20261014000010 through 20261014000020, with migration up. Do not reset
an existing database. Restart the app and worker after upgrading.

Use the app's configured local Supabase service credential and
`OPENPLAN_INTEGRATION_KEY_SECRET`. Staff and public comment requests stay queued
until a worker handles them. Retained output and valid legacy cached text can be
read without new generation. Checking an interrupted request does not request a
new attempt; the public reader must explicitly request a successor after failure.
Manual staff wording remains available without model generation. Configuring a
provider is separate and does not make provider usage free.

`OPENPLAN_TRANSLATION_GENERATION_WORK_DIR` may name an absolute private directory.
The default is beneath `~/.local/state/openplan/translation-generation-worker/`,
partitioned by the configured database URL. Keep that directory on durable local
storage and reuse it after restart. Its OS lock prevents two processes sharing
the same journal; database claims protect attempts across worker directories.
Never copy a pending journal to a different database or delete it to retry work.

A restart with a running journal reports an interrupted attempt without another
model call. A completed journal redelivers its exact saved output, including when
source or access has since changed; that retained evidence does not publish the
translation or reactivate a cancelled job. Expired claims without a journal are
reconciled through database status. A failed key read, decryption or changed
selection prevents dispatch. The worker logs states without source words or keys.
Do not infer publication or translation quality from a completed worker cycle.

### Synthesis preparation worker

Apply migrations through
`20261015000012_engagement_synthesis_preparation_queue.sql`. From `openplan/`,
use Node 24, installed npm dependencies, Linux `/usr/bin/flock` and `/usr/bin/cat`,
and the app's private Supabase URL and service credential. The command reads
`.env.local` when present; environment variables already supplied to the process
take precedence.

```bash
npm run worker:synthesis-preparation -- --help
npm run worker:synthesis-preparation -- --once
npm run worker:synthesis-preparation
```

Only explicitly enqueued requests are eligible. Preparation reconstructs retained
segment, context and thematic inputs, stages their deterministic plans and records
completion receipts. Provider execution still requires its separate native
resource authorization. Preparation neither calls a model nor approves or
publishes a result. Staff generation controls have bounded synthetic workflow
evidence in the [queue acceptance record](../../../docs/reviews/2026-10-07-synthesis-execution-queue/DESIGN.md);
observed interpretation quality and human usefulness remain unproved.

`--once` retries up to 64 pending attempts and reads one candidate page of up to
64 requests. It is not a queue drain. No arguments keeps polling, with a
two-second pause after a pass without pending custody, and five seconds after an
error or a pass with pending custody. SIGINT and SIGTERM interrupt active work
and waits. Preserve the directory and restart the same command against the same
database. Do not delete journals, change the directory to bypass an unresolved
attempt, or copy pending state between databases.

Set `OPENPLAN_SYNTHESIS_PREPARATION_WORK_DIR` to an absolute private durable root.
The default is `~/.local/state/openplan/synthesis-preparation-worker`. The worker
partitions either root by the full SHA-256 of the canonical database URL and
checks the target retained in the journal. Directories require mode 0700 and
journal files mode 0600. Back up the root with the database. The coordinator
retains terminal child journals and bounds its active index at 16 MiB; exceeding
the bound refuses work without dropping custody. Monitor storage separately.

For `--once`, exit 0 means that pass finished without pending custody records,
exit 2 means unconfirmed custody remains, and exit 1 means failure or interruption.
Continuous operation reports pass failures and keeps polling. Its requested
shutdown exits 0 and prints a stopped message. These are process outcomes, not
claims that all requests are prepared or approved. A retained superseded outcome
can remain unconfirmed even when another worker has completed the native request.
Read the current request status separately from its historical journal.

A process supervisor can run the continuous command from the application package.
Keep the same environment, operating-system user and persistent root across
restarts. Send SIGTERM for a normal stop and retain the files after an abnormal
exit. This command does not install or enable a service. Process termination and
restart have been tested; boot-time startup, host power loss and deployment
capacity require separate verification.

### Synthesis execution and context recovery

The internal synthesis worker accepts an existing native resource authorization.
Run it from `openplan/` with the configured `.env.local`, service credential and
integration-key secret. Apply migrations through
`20261014000039_engagement_synthesis_context_execution.sql` before using context
execution. Staff generation and proposal import have candidate browser evidence;
see the [execution queue acceptance record](../../../docs/reviews/2026-10-07-synthesis-execution-queue/DESIGN.md)
for the identified builds and remaining release boundaries.

For an independent segment grant:

```bash
npm run worker:synthesis-generation -- --authorization UUID --all-tasks
npm run worker:synthesis-generation -- --authorization UUID --task-index 0
```

For a dependent context grant, append `--context`:

```bash
npm run worker:synthesis-generation -- --authorization UUID --all-tasks --context
npm run worker:synthesis-generation -- --authorization UUID --task-index 0 --context
```

Replace `UUID` with the retained authorization in the configured database.
The command processes that grant's allowance and explicit retry scope. It does
not create a grant, select a replacement interpretation or authorize additional
provider attempts. Context frames replay the preceding selected original outputs
before preparing another task. Missing, incomplete or changed predecessors stop
fresh work. A complete task that exceeds its byte allowance is refused intact.

Keep `OPENPLAN_SYNTHESIS_GENERATION_WORK_DIR` on private durable storage. Its
default is `~/.local/state/openplan/synthesis-generation-worker`, partitioned by
database target, authorization and task. The full schedule and single-task
commands use the same task journals. Retry the same command and directory after
an interrupted acknowledgement. Preserve an unknown dispatch as unobserved;
context scheduling stops there before any successor. Explicit retry authority and
a retained result choice govern replacement attempts.

Saved outputs can recover their original database custody after cancellation,
expiry or staff access loss. Every fresh claim and dispatch checks current
permission separately. Exit 0 means the saved schedule's outputs have acknowledged
custody. Exit 2 reports an unobserved dispatch or a partial grant. Exit 1 reports
an error, interruption or refusal. The summary names scheduled tasks that were
not processed after an unresolved predecessor. These outcomes do not establish a
valid interpretation, representative participation, staff approval or publication.

### Explicit synthesis execution queue

Apply additive migrations through `20261016000013_synthesis_execution_queue.sql`.
From `openplan/`, use the configured private `.env.local`, Supabase service
credential and integration encryption configuration:

```bash
npm run worker:synthesis-execution -- --help
npm run worker:synthesis-execution -- --once
npm run worker:synthesis-execution
```

Staff first saves execution permission, opens Review scheduling and explicitly
requests execution under that allowance. Saving permission alone does not enqueue
it. This worker discovers explicit queue entries, not every historical allowance.
It supports segment, context and thematic requests through their existing task
schedulers. It does not approve or publish their outputs.

Use the same absolute `OPENPLAN_SYNTHESIS_GENERATION_WORK_DIR` as the single-grant
CLI, on private durable storage. Preserve its database-target, authorization and
task directories across restarts. One `--once` invocation visits at most 32 queue
entries. An empty page wraps the cursor for a later pass; it does not prove that
the queue has no work. Continuous mode polls until SIGINT or SIGTERM. These
commands do not install a supervisor or start the worker at boot.

A queue receipt proves retention of the exact scheduling command. Current staff
access, request state, provider revision, credentials, expiry and task history
still govern fresh dispatch. Inspect saved analysis results for retained outputs
and unobserved attempts. Do not delete journals or create replacement requests to
bypass an uncertain call. If a scheduling reply is lost, retain and retry the same
command in the staff interface to recover its receipt.

For an intentionally local provider, configure its exact loopback endpoint in
the worker process `OPENPLAN_AI_LOCAL_ENDPOINTS` JSON array. The app process
setting is not inherited by a separately launched worker. A transport refusal
may occur after dispatch retention. Preserve each task's history and determine
its state before retrying; an endpoint-policy message does not prove no task ran.

A task-byte diagnostic reports the complete task size and saved limit. Preserve
the original request and journals. Review saved results before creating a separate
request with an explicit larger budget and separate execution permission. Do not
truncate source text or treat a larger budget as permission to repeat an uncertain
call. Worker output reports the task-byte refusal. The staff results page also
assesses required bytes from saved source material and verified earlier results,
and compares them with the saved limit. That assessment does not establish whether
a provider call occurred. The [combined candidate acceptance](../../../docs/reviews/2026-10-07-v068-release/COMBINED_ACCEPTANCE.md)
records desktop and 390px inspection of that distinction.

Exit 0 means the bounded pass returned without a schedule exception, not that all
outputs exist. Exit 2 means at least one schedule was unconfirmed. Exit 1 means the
pass failed or a one-pass invocation was interrupted. Keep the journal directory
and database target unchanged when recovering. Host-loss, boot supervision and
capacity acceptance remain separate from the recorded process-restart checks.

The [Linux user-service recipe](SYNTHESIS_SUPERVISION.md) generates reviewable
systemd units for the existing preparation and execution workers. Generation
does not install or start a service. Preserve the same private configuration and
journals; supervisor process checks do not establish host-loss recovery.

## Separate inspection from changes

| Action | Operational effect |
|---|---|
| Checkout status, redacted local configuration summary, health probe | Inspection; the health probe contacts the explicitly selected service. |
| `npm run dev` | Starts the app and runs migration synchronization through `predev`. |
| `npm start` | Starts a built app; does not apply migrations or provision the surrounding stack. |
| Worker launch/Compose commands | Start or recreate compute services that can claim queued work and write results. |
| Migration application, configuration edits, credential rotation | Change deployment behavior or durable schema; require identified targets and a release/incident plan. |
| `npm run test:rls-live`, `npm run qa:gate` | Test/build activity; live checks may create records. Use explicitly selected test environments, not an unexamined production environment. |
| `npm run ops:restore-drill` | Creates and removes disposable services/data; exercises the selected-row sample; add `-- --full-archive` for complete default-local database/Storage restoration. |
| `npm run ops:strip-engagement-photo-metadata` | Inspection: reports engagement photos still carrying EXIF, XMP or IPTC metadata (location, device, time). With `-- --apply` it re-encodes those photos in place and reads each back; the originals cannot be recovered, so back up Storage first. Needed once for photos uploaded before 2026-10-10. |
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

The disposable drill's `--full-archive` mode restores a complete default-local
PostgreSQL custom archive and Storage filesystem into a fresh, matching-image
target. It preserves database ownership, grants and settings, compares complete
data/schema/file inventories, independently reconstructs overlapping OWP cycles,
and checks password sign-in and live access isolation. The default mode retains
the smaller selected-row sample. See the [recovery evidence](../../../docs/reviews/2026-09-09-owp-full-recovery/VERIFICATION.md)
for the current accepted scope and browser results.

External worker files, protected configuration, custom cluster roles, hosted
layouts and production cutover remain outside the executable full-archive drill.
It does not make the whole installation recoverable by itself.

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
