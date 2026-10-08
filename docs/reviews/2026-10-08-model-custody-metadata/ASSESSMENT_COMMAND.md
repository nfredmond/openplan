# Retained legacy assessment command

October 8, 2026, following publication checkpoint `9385deba`. This is work within
roadmap M3/S1. It does not change the V1 contract, scientific gates or queue.

## Recovery problem

The normal legacy assessment RPC creates three artifact rows and one assessment
on each call. The parent branch's native test demonstrates that an assessment can
commit while the caller receives an altered or missing reply. Receipt validation
correctly leaves that call unconfirmed, but repeating the write has no retained
request identity and can create another assessment. A failed response does not
establish rollback.

## Candidate behavior

`prototype/assessment-command.sql` wraps the existing custody RPC in one database
transaction with a private request/response record. The request binds the complete
payload and caller-generated request UUID. An exact retry returns its original
assessment and artifact records. Reusing an ID with changed payload fails. The
server serializes matching requests and locks the parent run before a new write.
A final receipt failure rolls back the assessment and all three new artifacts.

New writes refuse failed/cancelled or managed parents. Historical retries return
their old receipt without reactivating a run. Existing managed attempt-bound
commands remain separate. The candidate retains the existing assessment RPC's
scientific outcome vocabulary; it does not assign a publication tier or declare
a stored outcome independently accepted. Service-role callers can execute the
command but cannot directly write its receipt table.

The payload requires explicit fields and types, including canonical UUIDs,
nonnegative integer byte sizes, SHA-256 strings, JSON metadata, method track,
partition, planning use, outcome and reasons. Storage references and recorded
hashes remain references, not proof that corresponding object bytes exist.

## Verified checkpoint

`prototype/verify_assessment_command.py` runs against the named owned CLI-upgrade
proof database and rolls back every case. Its synthetic fixture uses the actual
assessment RPC and database constraints. Baseline, harmless and restored variants
pass; seven faults in changed-request refusal, exact receipt return, size kinds,
terminal-run refusal, field completeness, receipt persistence and privileges are
detected. Tests also exercise late receipt failure, historical retry after run
termination and managed-parent refusal. Candidate objects are absent afterward.
Private results are retained in
`model-command-client-20261008-proof/assessment-command/assessment-command.json`.

No application migration installs this candidate.
HTTP lost-reply and fresh-process recovery, command-journal/client integration,
normal dispatcher adoption, actual Storage integrity, managed ingestion and
independent scientific acceptance remain unfinished. These are required next
boundaries, not implied by the transaction tests.

This work uses `work/model-assessment-command-20261008`. The parent publication
checkout remains frozen for its already-running QA gate on `9385deba`.

## Separate-session ordering proof

`prototype/verify_assessment_contention.py` now exercises four orderings using
independent PostgreSQL service-role sessions. Each contender demonstrably waits
on a database lock before the owner commits. Simultaneous exact retries retain
one receipt, one assessment and four artifacts, including the original output.
A changed payload with the same request ID waits and then fails. A reaper that
commits first prevents new assessment records. An assessment that commits first
retains its receipt after the reaper stops the run, and its exact retry returns
that historical receipt.

Baseline, harmless-comment and restored variants pass all four orderings.
Bypassing payload comparison, returning a wrong retry receipt and bypassing the
stopped-run guard each fail for the expected reason. All 15 cases complete.
Candidate function and table cleanup is confirmed after the owned sessions exit.
Synthetic fixture records remain in the named proof database. Private evidence
is `model-command-client-20261008-proof/assessment-contention/assessment-contention.json`.

This proves legacy assessment transaction ordering against the actual stale-run
reaper. It does not exercise HTTP loss, journal recovery, normal workers,
managed ingestion, Storage bytes or scientific acceptance.

## Retained client checkpoint

The command client now accepts `record_legacy_model_assessment`. It validates the
complete payload and its run, stage and method bindings before transport. The
existing destination-bound journal retains the exact request before POST. A
response resolves the request only when its request UUID, assessment values and
all three artifact records match. Recovery lists the saved run, stage and track,
then resends the original request. Normal workers still use the old RPC.

Four new client tests cover write ordering, cached receipts, lost-response mock
recovery, invalid input and mismatched assessment/artifact receipts. The combined
client, journal, recovery, publication, KPI, instrument and ownership run passes
42 tests. It emits a SQLite ResourceWarning from an existing test connection;
this run does not establish connection cleanup. The existing seven mutation
suites pass after adding the new import dependencies to their isolated copies.

Baseline, harmless and restored assessment-client controls pass. Four faults in
request binding, assessment validation, artifact validation and argument scope
fail for the expected assertion. The first scope fault reached mock transport
and raised an unconfirmed-delivery error; the input test now asserts that no
transport occurs even when a different exception is raised. The repeated control
then fails at that explicit assertion. Private controls are retained in
`model-command-client-20261008-proof/assessment-client-controls.json`.

HTTP loss after native commit and fresh-process recovery remain the next proof.
These mocked transport checks do not establish either, and this candidate is
still uninstalled. Full worker checks on this checkpoint remain pending.

## Native lost-response recovery

`prototype/verify_assessment_recovery_cli.py` now exercises the retained client
against actual PostgREST and the candidate command in the owned proof database.
Its loopback bridge forwards the first request, receives the native committed
response, then closes the TCP connection before sending the response to the
client. The command stays pending. A fresh worker recovery CLI reads and retries
the saved request. A second fresh invocation uses the journal's checked receipt.
Exactly two identical HTTP POSTs occur. The database retains one receipt, one
assessment and four artifact rows, including the original model output.
The resolved local receipt equals the database's retained response.

Baseline, harmless-comment and restored runs pass. Changing the server's exact
retry response to an empty object causes the fresh recovery CLI to refuse the
receipt. The proof catches that failure at the expected boundary. Source is
restored after the control. The temporary gateway, bridge, function and receipt
table are removed; synthetic fixture rows and private journals remain.

Baseline evidence is retained under
`model-command-client-20261008-proof/assessment-native-cli/recovery-cli.json`.
Controls are in `assessment-native-cli-controls.json` beside that directory.
The baseline run is `95da84ea-87b6-485b-a24c-1d14108f782d` and request is
`b9f0d969-365c-4286-ad47-562243b9126a`.

This verifies native legacy assessment receipt recovery after response loss.
It does not install the candidate, activate normal workers, verify Storage
bytes, cover managed ingestion or establish scientific acceptance. Those
boundaries remain open, as does the full worker suite on this branch.

## Full worker checkpoint and adoption boundary

At `e5a1b4c3`, the repository worker runner passes all 69 suites, with zero
failures and zero suites not run. Each worker uses its own existing environment
through ignored symlinks in this isolated checkout. Unit
`openplan-assessment-workers-e5a1b4c3.service`, invocation
`af2fff4410954ce0a2cb8c50570497b2`, finishes successfully at 06:19 Pacific on
October 8. It runs under a 1 GiB memory cap, zero swap and one CPU quota.
Peak memory is 178.4 MB; wall time is 34.501 seconds. This is worker software
regression evidence, not model or human acceptance.

Source review identifies an adoption prerequisite. Both existing assessment
callers catch write failures and annotate the assessment before subsequent
publication. The shared persistence helper catches all exceptions and rewrites
its local assessment JSON. An unresolved retained command must instead remain
recoverable with the exact original payload and must not fall through to later
publication or terminal writes. Persist a stable operation identity before
transport; do not generate another request for an unresolved logical write.
Recovery must reconcile the saved receipt before continuing the original work.

The publication candidate currently accepts only `prototype_only`. Installing
it as a universal replacement would refuse existing higher-tier payloads.
Do not silently downgrade or discard those payloads to fit the candidate.
Complete the evidence-bound publication policy and the normal caller recovery
path before treating atomic publication as adopted. The assessment command can
be installed additively without enrolling a run in managed attempts, but an
installed unused function would not close the worker connection requirement.

## Stop after uncertain assessment custody

The existing assignment custody block and shared rules-v4 persistence helper now
rethrow `WorkerStateWriteUnconfirmed` before their generic failure annotations.
They remove any stale in-memory custody receipt and preserve the original local
assessment bytes. The enclosing stage dispatcher already propagates this error
without issuing its generic terminal failure update. Successful custody and
ordinary preparation failure keep their existing paths.

The caller tests execute the real shared helper and the actual assignment try
block extracted from `stage_artifacts`. Both now prove uncertainty propagation,
unchanged canonical bytes and removal of stale in-memory receipts. The assignment
case does not execute the complete model stage or database transport.
Baseline, harmless and restored controls pass. Removing either rethrow or either
stale-receipt removal produces its targeted assertion failure, four adverse
controls in total. Results are retained in
`model-command-client-20261008-proof/assessment-stop-controls.json`.

This closes the swallowed-uncertainty behavior. It does not yet give normal
callers a retained command identity or automatic reconciliation. Full worker
regression for this changed caller checkpoint is pending.

The full worker regression at `7526c304` passes all 69 suites, with zero failures
and zero suites not run. Unit `openplan-assessment-stop-workers-20261008.service`,
invocation `022628d2696e4d4dbc481566b37c91f7`, finishes at 06:21 Pacific under
the same 1 GiB, zero-swap, one-CPU limits. Wall time is 33.843 seconds and peak
memory is 169.8 MB. This includes both corrected assessment callers.

## Stable assessment request preparation

`model_assessment_command.prepare` now binds a retained command to the configured
deployment and an existing canonical assessment UUID. Its UUIDv5 namespace is
specific to the legacy assessment operation. Payload contents do not enter that
request key. A changed payload for the same assessment therefore reaches the
journal's exact-request refusal instead of creating another command. The helper
validates and detaches the payload, then commits it to the journal before
returning. It does not send a request or resume a stage.

Five tests pass, including preparation in a fresh process, changed payloads,
resolved-request immutability, distinct assessment/deployment identities and
invalid input before journal creation. Baseline, harmless and restored controls
pass. Four faults that add payload to the key, omit retention, omit validation
or omit assessment identity fail for the expected assertions. Private results
are in `model-command-client-20261008-proof/assessment-preparation-controls.json`.

The native lost-response proof now uses this helper. It again retains one
assessment and three new artifacts after a dropped committed reply, fresh CLI
recovery and a cached second recovery. Its run is
`31e56f6e-20e8-47b3-885d-358a89c3b7e9`; its request is
`f0c42bff-47c1-51a6-9db1-46b32cdc2523`. Evidence is under
`model-command-client-20261008-proof/assessment-prepared-native-cli/`.

Normal callers must load the original persisted assessment identity after
interruption. Rebuilding an assessment with a fresh UUID is a new operation and
is not made safe recovery by this helper. That caller connection, application
migration and complete restart reconciliation remain unfinished.

## Additive migration candidate

The CLI now generates the migration checkpoint as
`20261016000015_legacy_assessment_command_receipts.sql`. The generated timestamp
was moved above the existing `20261016000014` high-water mark. The migration
contains the verified command plus an index on its run foreign key. It creates
only the private receipt table, index and service-only function. Existing
assessment and artifact rows are not rewritten. Normal callers remain inactive.

The native rollback verifier accepts an explicit source file. Using the actual
migration, baseline, harmless and restored checks pass and all seven faults
produce their expected failures. Rollback cleanup is confirmed. The migration
inventory passes with 387 files and no duplicate versions, invalid names or
empty files. The first inventory invocation used the repository root and
correctly reported a missing directory; the documented package-root invocation
then passes. Product direction check passes with its existing review reminders.

A temporary committed installation in the named proof database is compared with
its own advisor baseline. There are no new WARN or ERROR findings. The two new
INFO findings identify the intentionally policy-free private receipt table and
its unused index in this small fixture. Function and table cleanup is confirmed.
Existing whole-database findings remain; this is a scoped comparison, not a
clean database security assessment. Private evidence is under
`model-command-client-20261008-proof/assessment-migration-rollback/` and
`assessment-migration-advisors/`.

The tracked migration has not yet been applied through migration history or to
an application database. Populated-record upgrade preservation, installed HTTP
permissions, release ordering, complete CI and normal worker adoption remain
open. The original prototype remains a historical source; this checkpoint's
rollback evidence names the exact migration file.

## Migration-history upgrade and preservation

`prototype/verify_assessment_upgrade.py` clones the named, idle 48 MB synthetic
proof database and applies pending migrations with the Supabase CLI. Running
migration-up twice produces one `20261016000015` history row. Before/after JSON
matches across all existing fields in eight tables: 110 runs, 51 stages,
239 artifacts, 20 KPIs, 59 claims, 19 validation results, one v2 instrument and
44 legacy assessments. No recovery receipts are fabricated by the migration.
The installed command cases pass in a rollback transaction and leave the same
retained records. The source stays at migration `20261016000014`.

The baseline clone is
`openplan_assessment_upgrade_72966dc0f5df4456acd29ca581f9a394` in the owned restore
target container. Its metadata and exact snapshots are under
`model-command-client-20261008-proof/assessment-cli-upgrade/`. The migration hash
is `aad23c391bf9d0bddf2583468f44701bf4a3ad4bbc0d9c94312b0594be8b8390`.

Harmless-comment and restored upgrade variants also pass. Appending a synthetic
rewrite of an existing run causes the preservation assertion to fail for the
expected reason. Source is restored afterward. These separate synthetic clones
remain for diagnosis; no application database was changed. Control evidence is
`model-command-client-20261008-proof/assessment-upgrade-controls.json`.

This proves migration-history application and preservation for the captured
synthetic records. It does not prove installed HTTP permissions, operational
backup restoration, Storage contents, normal worker restart or scientific
acceptance. Those remain separate requirements.

## Installed HTTP permission checkpoint

`prototype/verify_assessment_http_permissions.py` tests the installed command in
the baseline upgrade clone through a temporary loopback PostgREST gateway.
The fixture first proves that the member can read the synthetic run and the
outsider cannot. Member and outsider command calls then return 403; anonymous
and unsigned calls return 401. No assessment is created by these refusals.
The service-role command succeeds, its complete receipt validates, and an exact
retry returns the same receipt. Direct receipt-table reads return 403 for the
member, outsider and service role, and 401 for anonymous and unsigned callers.

Temporarily granting function execution to authenticated users exposes the
already-retained synthetic receipt to the outsider. Revoking that grant restores
403. This adverse control establishes that the refusal is enforced by function
privileges, rather than a broken token or missing endpoint. Only one receipt is
retained. The owned gateway is removed afterward; fixture rows remain.
Results are in `model-command-client-20261008-proof/assessment-installed-http/`.

The gateway's database guard now accepts the exact assessment-upgrade clone
prefix with 32 lowercase hexadecimal characters. Four scope tests pass.
Harmless and restored controls pass; bypassing the database guard or rejecting
the valid new clone name fails its targeted case. Results are retained in
`model-command-client-20261008-proof/assessment-gateway-controls.json`.
These checks do not establish application activation or scientific acceptance.

## Parent integration

PR #162 merges to main as `73c4a34ae5658488192c6582826d6babf9cebbe1` after
all seven checks pass at `67be2aff9e2f8adf42cc4168d65505f4cb711103`.
PR #163's local QA remains live on its unchanged `9385deba` checkout, so that
checkout has not been updated or retargeted during acceptance.
