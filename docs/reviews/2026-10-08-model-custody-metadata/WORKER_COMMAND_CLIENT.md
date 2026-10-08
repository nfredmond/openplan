# Retained commands for model workers

October 8, 2026. This checkpoint adds a worker-side command client for roadmap
M3/S1. It does not activate attempt management in either stage dispatcher.

## What changed

`workers/aequilibrae_worker/model_command_client.py` delivers stage claims,
stage status writes, artifact writes, KPI writes and instrument-custody records
through the candidate command RPCs.
It retains the exact request before dispatch, binds it to a deployment and URL,
and resolves it only after checking the returned identity and outcome. A lost
reply stays pending. A resolved retry returns the retained receipt without
another POST. Credentials remain outside the journal.

KPI requests require an explicit value, including null when unknown. Receipt
checks distinguish null from zero and reject booleans, nonfinite values and
integers that the stored double-precision value cannot represent exactly.
Numeric `1` and `1.0` represent the same quantity. Supporting breakdown metadata
remains exact, including explicit null versus an omitted default object.

Instrument requests bind workspace, run, stage, attempt, method and six distinct
artifact identities with hashes. The current command admits the existing
inconclusive instrument only. It does not promote a scientific claim or merge
AequilibraE and ActivitySim results. A reply must match every supplied binding.

The client checks claim ownership identities, lost-claim outcomes, completion
timestamps, parent outcomes and exact artifact metadata and byte identities.
A failed stage must return a failed parent. A successful intermediate stage may
leave the parent running. A returned claim records its original outcome; it is
not proof that the attempt still owns work when recovery starts.

`model_command_journal.py` carries the tested SQLite journal from the dated
prototype into the worker source directory. The original prototype remains
unchanged as historical evidence. Worker adoption should use the worker module;
it must not import application code from review documents. The existing
AequilibraE Dockerfile copies these sibling Python files. The ActivitySim poll worker now includes the sibling AequilibraE directory for
a shared stdlib receipt comparator. That source path is present in both declared
ActivitySim Docker build contexts. Command-client adoption remains separate;
neither dispatcher calls it yet.

## Verification

Run from the repository root:

```sh
python3 -B workers/aequilibrae_worker/test_model_command_client.py
python3 -B workers/aequilibrae_worker/test_model_command_journal.py
python3 -B workers/aequilibrae_worker/test_model_command_kpi.py
python3 -B workers/aequilibrae_worker/test_model_command_instrument.py
python3 -B workers/aequilibrae_worker/test_model_command_ownership.py
python3 -B workers/aequilibrae_worker/test_model_command_mutations.py
```

Nine general delivery tests, five KPI tests, three instrument tests, five
ownership tests and six journal tests pass. Journal tests include separate
process exit after preparation and resolution, concurrent first-open requests,
private permissions, immutable responses and deployment filtering. Five mutation
runner tests retain harmless controls and detect twenty-six targeted broken behaviors.
They modify temporary copies, never the checkout under validation.

The parent-outcome fault initially survived because the fixture's timestamp also
contradicted its parent state. The fixture now supplies a consistent active-parent
timestamp, so removing the outcome check fails for the intended reason.

The reproducible native check is `prototype/verify_worker_client.py`. It requires
`OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER` selecting the disposable restore-target,
`OPENPLAN_MODEL_COMMAND_PROOF_METADATA` selecting its synthetic CLI-upgrade
metadata, and `OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT` selecting a private output
directory. It refuses databases outside the owned proof database naming scheme.
Do not target a demo or application database.

The check passed against the installed candidate migration in the retained
synthetic CLI-upgrade database. Each of two runs exercised a claim, artifact
write, three KPI writes, two separate six-artifact instrument packets, their
custody records and a terminal write through authenticated PostgREST. One run succeeded and
one failed. For all forty commands the transport discarded the first reply after
HTTP confirmed commit. The client retained the request and retried it exactly.
Each command sent two POSTs; subsequent delivery reused the local receipt. An
independent SQL count found one attempt and completion receipt per run, 13
artifact records, three KPI records retaining null, zero and 1.25 separately, and
two instrument custody records preserving AequilibraE and ActivitySim identities.
An ownership read confirms each active stage before output writes, refuses the
wrong workspace as unconfirmed, and identifies the retained claim as inactive
after either terminal outcome.
The temporary PostgREST gateway was removed. Synthetic database rows remain in
the owned proof database.

Instrument references in this native check are deliberately unuploaded synthetic
fixtures. Their hashes bind the fixture bytes, not verified Storage objects.
The earlier packet Storage check is separate evidence and does not establish
Storage verification for this caller.

The native check uses a transport adapter to remove the isolated PostgREST
server's missing `/rest/v1` prefix and to discard the reply. It does not simulate
a TCP disconnect or a worker process crash. The prior prototype's separate TCP
recovery evidence does not establish those properties for this new caller.
Local evidence is retained at
`~/.local/state/openplan/model-command-client-20261008-proof/ownership/native.json`.

## Current ownership during recovery

`inspect_ownership` checks the original claim command and returned receipt before
requesting a current stage snapshot. The PostgREST query includes its parent run
in the same response and filters by stage, run and workspace. Both records must
be attempt-managed and running, and the stage must retain the claimed attempt.
A valid inactive snapshot returns false. Missing fields, absent records, wrong
identities, failed transport and denied reads raise `OwnershipUnconfirmed`.
Neither result authorizes a new claim, terminal failure or relaunch.

This read is a point-in-time observation, not a lease. Attempt fencing still
applies to every subsequent write. Tests assert the complete query projection
because a mocked response alone could hide an omitted parent or ownership field.
The native check uses the actual joined PostgREST read before and after terminal
writes. Restart orchestration and file ownership reconciliation remain open.

## Normal assignment artifact identity

The normal ActivitySim network-assignment dispatcher now obtains its output ID
from the confirmed artifact registration receipt. It no longer supplies a locally
generated ID. Both rules-v4 assessment construction and persistence receive that
returned ID. This removes the caller-generated-ID conflict with the candidate
attempt artifact RPC; it does not switch dispatchers to that RPC.

The handoff suite passes 27 checks, including a real dispatcher call through the
existing receipt-checking helper with an injected HTTP response. Harmless source
changes pass. Injecting a different output ID before assessment or only before
custody persistence fails the corresponding assertion. The uncalibrated fixture
now supplies its required run and evidence responses and asserts completion; it
previously could pass after the stage failed to read its run. The adjacent
push-trigger suite now passes 37 checks.

These checks use synthetic assignment output and mocked scientific evaluators and
persistence. They do not execute ActivitySim or establish native assessment
custody. The initial push-suite run emitted two rejected background heartbeat
calls to its default local test URL with its test credential. Both returned 401;
no successful heartbeat write was shown. The startup-mode fixture now replaces
the heartbeat class with a local recorder and restores the prior global instance.
The rerun completes all 37 checks without those calls. Harmless source changes
pass; a changed default mode and an omitted heartbeat start fail their respective
assertions. This covers startup wiring, not live heartbeat delivery.

## JSON value kinds in normal receipt checks

Both normal workers now use `model_receipt_values.same_json_value` for retained
artifact and KPI fields. Python's ordinary equality treats false as zero and true
as one, including inside nested dictionaries and lists. Those substitutions now
leave the write unconfirmed. Null remains distinct from zero. Equal finite JSON
numbers, including 1 and 1.0, remain equivalent. This checks logical receipt
values; artifact byte hashes still carry exact file identity.

The AequilibraE image's existing Python glob includes the shared module. Both
ActivitySim Dockerfiles copy the repository, and the poll worker adds the sibling
AequilibraE directory without placing it ahead of its own modules. No comparator
copy is maintained in ActivitySim. These source and import checks are not rebuilt
container-image evidence.

Two comparator tests pass with a harmless control, three targeted faults and a
restored run. The normal AequilibraE push suite now passes 38 checks, including
receipt substitutions through its actual insert helper. All 35 ActivitySim worker
tests pass, including seven state/receipt tests and the shared module import.
These checks inject transport replies; they do not establish native database
acceptance for this comparator or execute a scientific model.

## Operator recovery of an uncertain command

`workers/aequilibrae_worker/model_command_recovery.py` lists unresolved commands
from an existing journal or recovers one exact saved request. The journal opens
read-only for selection. Missing journals, wrong destinations and changed request
identities are refused before delivery. Recovery sends the original request ID
and payload. A retained, checked receipt returns without another HTTP request.

Run from the worker directory, substituting the owned deployment and journal:

```bash
python3 model_command_recovery.py --journal /path/to/journal \
  --base-url http://127.0.0.1:54321 --deployment-id DEPLOYMENT_ID --list-pending
python3 model_command_recovery.py --journal /path/to/journal \
  --base-url http://127.0.0.1:54321 --deployment-id DEPLOYMENT_ID \
  --request-id SAVED_REQUEST_UUID
```

Network recovery reads `SUPABASE_SERVICE_ROLE_KEY` from the environment. Listing
and cached receipt recovery need no credential. Output contains command identity
and outcome, not scientific payloads or credentials. Exit status 2 means delivery
remains unconfirmed; 3 means the request was refused. Neither outcome authorizes
another claim, a terminal write, or model execution.

Five recovery tests pass. The six mutation-runner tests cover harmless controls
and 29 targeted client, journal, ownership and recovery faults. The three recovery
faults substitute a new request ID, bypass saved identity checks, or allow a
missing journal to be created. These checks use injected transport responses.

`prototype/verify_worker_recovery_cli.py` additionally exercises the installed
candidate migration through actual PostgREST and a loopback TCP proxy. It drops
the first reply after the database commits a synthetic claim. A fresh CLI process
lists and recovers the original request; another fresh process reads the cached
receipt without posting again. SQL independently confirms one attempt and one
claim receipt after two HTTP posts. The retained run is
`d8d0a759-eb54-47b6-8175-00f75ad195fd`, with request
`fc9ac22d-c43e-4e31-b824-44dfdf0eb994`. This proves command receipt recovery after
a lost reply, not model restart, file reuse, Storage bytes or scientific validity.

## Scratch-file identity blocks automatic restart

Source inspection after the recovery CLI checkpoint found a separate ownership
boundary. `main.py::_claim_and_run_stage` stores state and model files under
`RUN_WORK_ROOT/runs/run_id[:12]`. The application helper
`src/lib/models/artifact-source.ts::resolveRunWorkDir` constructs the same
shortened directory for local artifact scope. These are execution and read
boundaries, not display abbreviations.

For example, distinct canonical IDs
`12345678-1234-4123-8123-123456789abc` and
`12345678-1234-4567-8567-987654321abc` both map to `runs/12345678-123`.
The worker's process-wide lock serializes execution within one process but does
not distinguish those directories. Its `state.json` is not checked against a
retained full run identity before subsequent stages read it. This finding is
source evidence, not a claim that existing runs have collided or user files
have been disclosed.

Changing only the worker directory would break the application's local reads
and historical local references. Falling back to an unmarked shortened directory
would preserve the ambiguity. The next connection must bind full deployment,
run and attempt identities to scratch state, coordinate application local
resolution, and provide explicit reconciliation for retained legacy artifacts.
Do not infer old directory ownership from its prefix or silently relocate files.
Keep immutable Storage references and historical artifact identities intact.

Acceptance must include two runs with the same shortened prefix, concurrent
processes, lost command acknowledgements, revoked ownership and retained
predecessor-stage files. Exercise actual filesystem reads and both normal worker
entry points. The command recovery CLI must not resume model execution until
this file-ownership boundary and all attempt-aware writes are connected.

## Full run scratch identities

The worker and application now use complete canonical run UUIDs for local
scratch directories. The normal worker validates identity before claiming a
stage. Application local reads, downloads, KPI readers, agreement readers and
exports share the updated directory resolver. The change does not rename or
delete existing files and does not fall back to shortened directories.

An unfinished stage whose full directory is missing while legacy scratch exists
is refused before the claim. This leaves the database state and old files
unchanged. Existing shortened local artifact references are now refused by the
application. Immutable Storage references are unchanged. Finish in-flight legacy
runs with their existing worker before upgrading; do not rename a prefix directory
or rewrite a registered artifact reference without independently establishing
its complete run ownership. Automated legacy reconciliation remains unfinished.
This is a compatibility boundary, not a completed self-service recovery feature.

Three scratch tests exercise the actual normal dispatcher with synthetic setup,
real temporary files, two full run IDs sharing a prefix, malformed IDs and an
in-flight legacy directory. Four app suites pass 52 tests, including actual
filesystem byte reads and HTTP download-route refusal before file access. Two
adjacent KPI suites pass six tests. The 27 assignment-handoff checks and 38 push
checks also pass. Focused ESLint passes. Harmless changes preserve the result;
five adverse controls restore worker/app truncation, bypass their UUID checks
or bypass the pre-claim legacy refusal. Each fails its targeted assertion.

These checks do not execute a scientific model or exercise a rebuilt worker
container. Full IDs remove prefix collisions; they do not prove filesystem
symlink safety, deployment separation, attempt-specific file ownership, concurrent
process reconciliation or automatic model restart. Those boundaries remain open.
The first app-test invocation lacked installed dependencies and failed before
running tests. The passing run uses this checkout's pinned Vitest 4.1.11 after
`npm ci --ignore-scripts`; it is not a production build result.

## ActivitySim execution directory retention

The separate ActivitySim poll worker also used a shortened run directory and
removed that directory before each preflight. It now validates the full run UUID
before claiming work and creates a fresh `execution-*` directory beneath that
full UUID. Repeat executions retain previous files. Its source manifest carries
the full run identity. Existing prefix directories remain untouched.

All 38 ActivitySim worker tests pass, including the real preflight pipeline with
synthetic screening inputs and injected HTTP. The normal entry-point test executes
twice and confirms that the first execution and legacy files survive. Workspace
tests distinguish two full IDs with the same prefix. Harmless changes pass; five
faults detect prefix directories, execution-directory reuse, omitted pre-claim
validation, truncated source identity and swallowed state-write uncertainty.
Existing receipt fixtures initially failed because they used non-UUID run IDs;
they now use canonical synthetic IDs and retain their uncertainty assertions.

These directory names are local execution identities, not database attempt IDs.
Restart reconciliation must still bind them to retained claims, current ownership
and verified predecessor artifacts. No automatic cleanup removes prior executions.
This retention change does not establish cross-process recovery, actual model
execution, prepared-instrument ordering or scientific acceptance.

## Verified ActivitySim predecessor copies

The ActivitySim handoff query now requests artifact and run identities, byte size
and content hash as well as type and location. Before materializing preflight
inputs, the worker requires exactly one artifact per required type, the selected
run ID, a canonical artifact ID and an absolute local reference inside that
run's full-ID directory beneath `AEQ_WORK_DIR`. Resolved symlink escapes are
refused. Missing or ambiguous predecessor records stop the handoff.

Each input is streamed into a new execution-owned file while checking its byte
count and SHA-256. Preflight receives the verified copy, not the mutable source
path. Missing hashes/sizes and changed bytes are refused. A failed copy may leave
an unverified partial file in the private execution directory; it is not passed
to materialization or registered as an accepted artifact. Execution retention is
not a declaration that every retained file is valid.

All 43 ActivitySim worker tests pass. Tests use actual temporary files, synthetic
screening inputs and injected HTTP. They assert the full database projection,
source/copy independence, wrong-run and escaping paths, an outside symlink,
ambiguous inventory, absent metadata and changed bytes. A corrupt handoff cannot
reach preflight materialization. Harmless controls and six targeted faults cover
run binding, local scope, hash comparison, strict byte-size type, retained-copy
use and the query projection. The first size mutation failed incidentally on a
type error; its replacement specifically admits false as zero and fails the
empty-file refusal assertion. Restored tests pass.

This verifies retained input bytes, not scientific suitability, required-stage
completion or database attempt ownership. Local filesystem administrators can
still mutate directories, and concurrent path replacement was not tested.
Cross-host Storage input delivery, prepared-observation custody and automatic
restart remain open. No scientific model or consumed holdout was run.

## Native predecessor inventory checkpoint

`prototype/verify_activity_handoff.py` registers three synthetic unmanaged
artifacts in the installed CLI-upgrade proof database and calls the actual
worker inventory reader through isolated PostgREST. The transport adapter removes
only Kong's `/rest/v1` mount; query projection, run filter, returned rows and
retained-file verification use the worker implementation.

Run `a96c7f50-2ae9-420d-9abc-593f1c55a791` retains three verified copies. Changing
source bytes without changing their size is refused against the original native
hash. Restoring those bytes recovers a valid copy. An unknown run returns an
empty native inventory. The proof leaves synthetic rows and private files for
inspection and removes its owned PostgREST container on exit.

This closes the native inventory/projection uncertainty for the synthetic local
handoff. It does not run a model, use Storage input delivery, activate attempt
management, prove stage-completion custody or establish scientific acceptance.
The private result is `native-activity-handoff/native-activity-handoff.json`
under the worker-client proof directory.

## Remaining connection work

Normal dispatchers still use their current receipt-checked legacy writes. Before
adoption, connect all stage claims, logs, artifacts, KPIs, assessment records and
terminal outcomes. Reconcile retained requests and current ownership before
reusing run files or executing a recovered stage. Resolve the existing rules-v4
assessment writer's artifact creation and preserve the confirmed output identity
through the remaining attempt-aware paths. Preserve method
separation and unassessed outcomes when prepared evidence is absent.

The client has per-request connection and read timeouts, but no total wall-clock
response deadline or response-body size cap. Unit transports do not prove HTTP,
RLS, Storage contents or dispatcher behavior. The native proof does not verify
Storage bytes, scientific results, prepared-instrument ordering, cross-consumer
presentation, practitioner acceptance or V1 completion. Those remain required.
