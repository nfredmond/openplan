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
