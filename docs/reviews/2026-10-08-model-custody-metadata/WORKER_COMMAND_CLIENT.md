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
