# Connect comparable evidence to actual model runs

October 8, 2026. Source audit and implementation design against `db92ca1b`.
This does not implement ingestion, run a model or establish scientific acceptance.
The active work remains roadmap S1.

## Finding

Published rules-v5 study files and normal worker assessment custody use different
paths. The production connection is incomplete. Adding a caller for the existing
v2 custody RPC without resolving its identity contract would not complete S1.

| Boundary | Inspected source | Finding |
|---|---|---|
| Normal AequilibraE assignment | `workers/aequilibrae_worker/main.py`, `build_rules_v4_validation_records` and assignment persistence | Builds rules-v4 records and calls `record_modeling_validation_assessment`. |
| ActivitySim assignment within the same orchestrated run | `main.py`, call to `persist_rules_v4_validation_records` | Uses the same `run_id`, a separate output artifact and `behavioral_demand` track. |
| Rules-v5 worker wrapper | `main.py`, `assess_rules_v5_validation_instrument` | Defines a wrapper around the shared evaluator. The tracked Python source search finds no caller of this wrapper. Its existence is not a completed worker path. |
| Published comparable study | `scripts/modeling/run_comparable_observation_study.py`, `assess_all` | Calls the shared rules-v5 evaluator, writes local assessment/diagnosis files and a study result. It does not register the v2 custody RPC. |
| Legacy assessment identity | `20260828000001_model_validation_assessment_custody.sql` | Retains a track and model-output artifact per assessment. Its rules version is constrained to 4. It cannot truthfully receive v5 records unchanged. |
| V2 custody identity | `20260828000004_comparable_observation_v2_custody.sql` | Retains five artifact identities and hashes but no method or output artifact. `UNIQUE (model_run_id)` permits one custody row per run. |
| V2 consumers | `reports/run-citations.ts`, `assistant/chat-tools.ts`, `project-evidence-bundles/generated-records.ts` | Read v2 custody records. Consumer queries do not establish a production writer. |

A tracked-source search for the exact v2 RPC name finds its migration and tests,
not a production caller. Searches also cover direct table references and the
normal worker's artifact registration paths. Dynamic invocation outside the
inspected repository or a separately installed service was not assessed.

The one-row-per-run constraint conflicts with directly persisting separate v2
records for both outputs of the existing dual-method run. This is a source-level
integration conflict, not a claim that a deployed two-method write failed. The
existing wrapper and evaluator docstrings describe a stronger normal-worker
connection than this call-site audit establishes. Keep that distinction visible.

## Identity and storage decision

Preserve existing v4 and v2 rows and their meaning. Do not relabel v4 as v5,
invent a method for a historical v2 record, average the methods, create a second
synthetic model run solely to avoid a constraint, or drop the v2 run constraint
without supplying the missing identity controls.

The production record must bind the actual workspace, model run, stage/attempt,
demand method, output artifact and logical output hash. It must also bind exact
input-bundle, match-audit, comparison-basis, assessment and diagnosis artifacts.
The two demand methods can share a parent run and assignment engine while
remaining separate assessments. Method cannot be inferred from the parent
run's engine label.

Use a versioned successor to the existing custody command for these records.
Retain its service-role boundary and immutable artifacts. An additive successor
table is preferable to reinterpreting ambiguous historical rows. Before writing
that migration, compare its fields with the complete current artifact, stage,
attempt and claim schemas. Reuse their identity and access checks rather than
create another run lifecycle. No new product module is needed.

An exact request retry returns the same custody identity. A different payload
with the same request identity fails. A new assessed input revision retains a
new record linked to its actual output and instrument; it does not overwrite
the earlier assessment. A workspace/run/method label alone is not an adequate
idempotency key.

## Worker connection

The inspected generic stage path claims with a conditional queued-status PATCH
and later updates by stage ID. It does not supply the per-attempt identity
required above. The [state-receipt correction](WORKER_STATE_VERIFICATION.md)
stops after unconfirmed updates, but does not provide fencing or restart
reconciliation. Extend the existing M3 lifecycle rather than invent a parallel
custody-only attempt system or silently omit that requirement.

Use the existing stage execution and artifact upload paths. Require an explicit
prepared instrument for the selected run. The worker must verify its source,
geography, network, assignment, population and observation boundaries before
opening model-output bytes. A caller-provided `model_output_bytes_read: false`
flag alone does not prove ordering or protect a holdout. Preserve actual
preparation custody and attempt ownership.

Keep the current uncontracted assessment path honest when that prepared evidence
does not exist. Missing preparation remains unassessed or inconclusive; it must
not produce invented observations or an empty passing record. The frozen v5
diagnostic instrument's quantity assumptions do not establish a general
nationwide acceptance evaluator.

Upload immutable exact bytes before the custody transaction. Bind file sizes,
logical hashes, schemas and all inter-artifact references to those bytes. On a
lost transaction acknowledgement, resolve the exact request before declaring
failure or creating another assessment. Unreferenced uploaded objects remain
distinct from successfully recorded custody. Never rewrite an object after
its hash is committed or claim success solely because upload succeeded.

Consumers must use the successor's actual identities and hashes in Models,
Reports, assistant grounding and project evidence bundles. Return explicit
missing or failed evidence states. Preserve historical v4/v2 views; do not
silently select a method, a latest row or a summary from an unrelated artifact.

## Evidence required before calling the connection complete

Use synthetic software-integrity fixtures first. Do not reopen a holdout to test
transport or storage. Exercise both method outputs within one actual run,
cross-workspace/run/output rejection, missing and null fields, swapped artifacts,
changed bytes, unknown response recovery, concurrent exact retry and attempted
claim promotion. Include a harmless control and a relevant broken behavior for
each changed guard.

Verify the native RPC and immutable Storage bytes, then traverse the real worker
entry point. Confirm that output bytes remain unread on every failed preparation
gate. Separately verify a visible identified-build journey from the run to its
report, assistant citation and complete exported records at desktop and 390px.
Hashes, summaries and method labels must agree across those consumers. Test
recovery against a disposable stack and retain an unchanged earlier assessment.

Independent AequilibraE and ActivitySim acceptance, representative human use,
all-state/DC coverage and the remaining contract gates are separate obligations.
No successful ingestion case closes them.


## October 9 connection audit at a0ffd8cb0

The roadmap S1 obligation remains production preparation and ingestion. Recent
input-bundle, readiness-record and CSV identity checks repair concrete defects
in shared helpers. They do not supply the missing worker connection.

`main.py:assess_rules_v5_validation_instrument` still has no tracked production
caller. It opens a caller-supplied structural audit, validates its contents, then
calls the shared evaluator. Its arguments contain no expected workspace, run,
method or preparation identity. The structural audit is not passed to that
evaluator or required as a named bundle readiness artifact. Its source records
include both logical and stored hashes, including gzip handling; those cannot
be replaced by a generic path/hash comparison without preserving their meaning.

The next production connection must join these existing pieces in dependency
order, within S1 rather than as a separate product queue:

1. Retain preparation against the actual admitted run and method before opening
   output. Bind the structural audit, observation package, pre-volume match audit
   and input bundle to the selected geography, network, assignment, population
   and source records. Verify stored and logical bytes under their declared
   representations. Caller timing flags alone remain insufficient evidence.
2. Use that retained preparation at the real AequilibraE stage entry. Refuse a
   mismatched run or method before output access. Preserve the existing honest
   unassessed path where preparation is absent. Do not enable automatic managed
   enrollment merely because the ActivitySim admitted-entry fixture passes.
3. Materialize and upload immutable assessment and diagnosis artifacts, then use
   `model_attempt_writer.record_instrument` for exact delivery and recovery.
   That method explicitly does not prepare or grade evidence. Its existence
   cannot substitute for steps 1 and 2.
4. Verify native Storage and database records, then the identified-build Models,
   report, assistant and exported-evidence journeys required above. T3 snapshot
   failure still prevents complete browser evidence.

Use synthetic transport fixtures for implementation and fault controls. Keep
real source quality, preparation independence, general quantity comparability,
untouched geographic acceptance and practitioner observation separate. The
current diagnostic evaluator does not authorize a nationwide accuracy claim.

This audit changes the next implementation target, not the V1 scope or acceptance
standard. It does not mark any of the four connection steps complete.


### Structural source verification implemented after the audit

The existing worker wrapper now requires expected structural-audit hash, method,
geography and source records. `verify_structural_input_files` compares those
expectations, validates audit contents, and verifies every recorded source. It
checks stored bytes separately from logical bytes, preserving the producer's
`.gz` representation and logical filename. The audit and source files cannot
alias the supplied model-output file. The wrapper calls the evaluator only
after these checks pass.

Fourteen synthetic tests traverse the actual wrapper with the assessment
function replaced by a sentinel. Valid compressed and plain sources pass. Wrong
audit hash, method, geography, source records, stored bytes, logical hash or size,
logical path, output alias, malformed record, unavailable file and already-read
output flags are refused. Eight targeted verifier faults and a wrapper-bypass
fault fail; harmless and restored verifier controls pass. Evidence is retained
in `prototype/structural-preparation-controls.json`.

The required expectations have no automatic admitted-run producer yet. They
must not be derived from the audit being checked. Comparison-basis/run bindings,
complete required source coverage, immutable preparation custody and independent
timing remain unfinished. Files can still change after verification; this is
not a filesystem race fence. The tests do not execute an engine, native Storage
or a scientific acceptance assessment. The four production connection steps
above remain open.


### Bind the evaluator to retained run and comparison identities

The worker wrapper now also requires expected run ID, input-bundle hash and
comparison-basis hash. It passes a `PreparedValidationContext` to the shared
evaluator. The evaluator checks the exact bytes it parsed, then requires the
basis run and method to match the context, before any model-output read. It does
not reopen the files to obtain a later hash. The worker uses the same expected
method for structural verification and comparison identity.

Five new file-based tests pass, including changed bundle/basis hashes, another
run or method, and invalid expectations. Each refusal records zero output reads.
Four targeted evaluator faults and a wrong-run forwarding fault fail; harmless
and restored controls pass. Evidence is in `prototype/prepared-context-controls.json`.
The fourteen structural-wrapper tests, existing instrument suite and two
input-custody tests also pass. The wrapper test replaces assessment execution
with a sentinel; the new file tests execute the real shared evaluator.

The historical study API still permits calls without this context. The worker
wrapper requires it. No historical study was reassessed. An admitted-run
preparation producer must still supply trustworthy expectations and establish
that structural sources, observation matching, population, network and the
comparison basis describe the same prepared case. Hash equality and a run label
do not establish those scientific relationships or independent timing. Normal
managed dispatch, native Storage and the remaining acceptance work stay open.


### Focused CI import dependency correction

GitHub run `37904285529` at `ed8572fe8` failed when the new structural-wrapper
test imported `main.py`: the focused workflow did not install pandas. The local
AequilibraE environment already had it, so the earlier local pass did not cover
the workflow's dependency boundary.

A new isolated Python 3.11 environment with the original focused dependencies
reproduced `ModuleNotFoundError: No module named 'pandas'`. The workflow now adds
pandas and `numpy<2.1`, matching the main worker CI job's lightweight dependency
setup. The existing engine-import test boundary remains in place; no numerical
engine is installed or claimed tested by this correction.

After that dependency change, all commands in the focused workflow pass locally,
including its science mutation runner. The commands ran serially in a user scope
with MemoryMax 2 GiB, MemorySwapMax 0 and TasksMax 128. The full log is retained
privately as `/tmp/openplan-focused-ci-full.log`. Tests and refusal criteria were
not weakened. GitHub verification of the new commit remains a separate check.


### Native custody after actual wrapper and evaluator execution

The existing native instrument proof now has a `worker-assessed-fixture` mode.
It calls the actual worker wrapper with retained synthetic audit/source facts
and explicit run, method, bundle and comparison-basis expectations. The wrapper
uses the real structural verifier and shared evaluator. The resulting nonempty
assessment files then pass through the admitted writer and native database RPCs.
The two method values remain separately prescribed fixture values, 100 and 120.

Five fresh-clone cases pass their expected outcomes: normal, harmless naming,
dropped custody write, changed output after assessment, and restored. Each
success retains two method records and twelve attempt-bound artifacts, verifies
exact receipt reuse and removes its temporary gateway. The dropped write fails
on missing native records; changed output fails the evaluated-byte binding
before publication. See `prototype/native-worker-assessed-instrument-controls.json`.
The existing twelve synthetic binding controls also pass. A further normal
native case verifies the corrected report wording after removing its outdated
empty-file description.

The campaign ran serially with a 2 GiB memory limit, zero swap and 128-task cap.
Private evidence directories are `native-worker-assessed-instrument-20261009a`
and `native-worker-assessed-report-20261009a` under the OpenPlan state directory.

This is a software integration fixture. Its author knows the model values and
supplies synthetic structural facts; a false output-read flag is not independent
timing evidence. Supporting structural/source files remain local and are not
fully published through native Storage. No engine, normal dispatcher, real
network/population, source adequacy or scientific acceptance is established.
The production preparation and complete artifact-publication requirements stay
open.


### Native private Storage upload evidence

The actual `upload_immutable_validation_json` helper now has an isolated native
Storage proof. Each case clones the owned installed proof database, starts the
installed Storage API v1.67.20 image with a fresh object directory, and creates
a private `run-artifacts` bucket in that clone. A prefix-only local HTTP proxy
translates the worker's `/storage/v1` URL to the standalone Storage service. It
forwards real requests and responses; it does not simulate object storage.

Normal, harmless JSON whitespace and restored cases upload and download exact
bytes. A second valid upload to the same object is refused with HTTP 400, code
`KeyAlreadyExists`, error `Duplicate`; the original bytes remain unchanged.
An unauthenticated request to the authenticated object route is refused. The
targeted control changes `x-upsert` to true at transport and fails because the
second upload replaces the object. See `prototype/native-validation-storage-controls.json`.

Two setup assertions were corrected from measured responses: a missing bucket
uses a response `statusCode` of 404 even when the HTTP status differs, and the
collision code is `KeyAlreadyExists`, with `Duplicate` in the error field. The
initial diagnostic evidence remains retained, followed by all four controls.
The private directories start with `native-validation-storage-20261009` and
`native-validation-storage-controls-20261009a` in the OpenPlan state directory.
All seven database clones are accounted for. Temporary Storage containers and
credential files are removed; the isolated databases and object directories
remain. The service cap is 512 MiB with no swap, and the controller cap is 1 GiB
with no swap. No existing object store or preview database was used for writes.

This proves the upload helper against native private Storage, not a joined
Storage-to-custody transaction. It does not verify the full user-role RLS matrix,
lost-acknowledgement recovery, complete source publication, operator recovery
or scientific acceptance. Those remain open.

T3 capture was retried separately: screenshot capture still fails, recording
start times out and recording stop fails. PR #170 retains all eight passing
GitHub checks, but its visible model-creation and recovery changes still lack
completed visual acceptance. This Storage evidence does not remove that hold.


### Recover immutable uploads through exact native readback

Validation and structural uploads previously trusted a successful POST and
rejected an already-present object. A lost successful reply therefore stranded
the same immutable object on retry. The content-addressed map uploader already
used authenticated exact readback. The three upload families now share
`upload_verified_immutable_bytes`, retaining their existing object paths.

Every upload remains non-upserted. The helper reads the exact authenticated
object after either a response or a transport exception, and returns a Storage
reference only when status is 200 and bytes equal the submitted payload. Changed,
missing or unreadable bytes raise `WorkerStateWriteUnconfirmed`. Redirects are
disabled for both upload and readback. No local-path fallback is introduced.

Five fresh native Storage cases pass their expected outcomes: normal, harmless
whitespace, lost acknowledgement after actual native commit, upsert fault and
restored. Successful cases also retry the original bytes and recover the same
reference. Changed uploads retain the original bytes; unauthenticated access is
refused. The upsert fault still fails the immutability assertion. See
`prototype/native-validation-storage-recovery-controls.json` and the private
`native-validation-storage-recovery-20261009a` directory. Temporary services and
credential files are removed; isolated databases and object directories remain.

Five unit tests cover all three upload families. Two targeted shared-readback
faults fail on changed bytes and unavailable reads; harmless/restored controls
pass. The legacy count-ingest failure test now supplies a failed GET as well as
POST, preventing accidental external access. A targeted false-confirmation fault
fails that test. See `prototype/immutable-upload-controls.json`. All eight
count-ingest checks, four validation-publication tests and the existing GeoJSON
lost-upload/readback regression pass.

This establishes same-process upload recovery after a lost acknowledgement. It
does not complete process-restart recovery, joined native Storage/database
custody, full user-role RLS, source publication or scientific acceptance.


### Fresh-process upload retry after committed output

The native Storage campaign now includes an actual process exit. A child imports
the worker and uploads the fixture, then calls `os._exit(73)` immediately after
native commit and before the helper can perform readback. The parent verifies
the committed bytes. A newly launched child reads a retained, credential-free
fixture manifest and calls the actual upload helper with the same identifiers
and bytes. It recovers the original Storage reference through authenticated
readback. Credentials pass privately through stdin, not the manifest or command
arguments.

Seven fresh-clone cases pass their expected outcomes: normal, harmless, lost
acknowledgement, fresh-process retry, wrong restart identity, upsert fault and
restored. The wrong-identity control deliberately substitutes an assessment ID
and fails the original-reference assertion. This detects a defective recovery
attempt; it does not claim the upload API forbids all new assessment identities.
The upsert control still fails on replacement. Evidence is retained in
`prototype/native-validation-storage-restart-controls.json` and the private
`native-validation-storage-restart-20261009a` directory. All seven database clones
have candidate records. Temporary services and credential files are removed.

This closes the fresh-process upload-helper retry check for this synthetic
fixture. It does not resume an admitted stage, restore a whole worker service,
join native object publication with the custody RPC, publish all scientific
sources or establish scientific acceptance. The retained manifest belongs to
the proof; a production recovery workflow still needs its own retained identity
and authorization path.


### Join native Storage objects to attempt-bound instrument custody

A new optional upload callback connects the existing evaluated-instrument proof
to the actual immutable uploader. Native Storage and the isolated PostgREST
gateway use the same fresh database clone. The proof creates a synthetic run
and stage, obtains a fresh admitted writer, evaluates separate method fixtures
through the actual worker wrapper, uploads all six instrument roles for each
method, and registers the returned Storage references through native artifact
and instrument commands.

After registration, the proof queries the twelve artifact rows and downloads
each recorded Storage reference. Object bytes, SHA-256 values and sizes must
match. Both instrument rows retain their actual attempt, stage, workspace and
method, and exact retries reuse their receipts. No model engine runs.

Six fresh-clone controls pass their expected outcomes: normal, harmless, dropped
custody write, changed output, wrong Storage reference and restored. The wrong
reference is deliberately registered and then fails the downloaded-byte check.
The database RPC does not itself fetch or reject that unavailable object; this
is a verification boundary, not a new database enforcement claim. See
`prototype/native-storage-custody-controls.json`.

The first joined diagnostic and the six-case campaign are retained privately
in `native-storage-custody-20261009a` and
`native-storage-custody-controls-20261009a`. Candidate records account for the
isolated databases. Temporary Storage/PostgREST services and credential files
are removed. Existing stores and the preview database remain outside the writes.

This joins evaluated fixture publication, native object bytes and native custody
in one case. It does not establish independent preparation, real network or
population inputs, publication of supporting source files, normal dispatcher
integration, the full RLS matrix or scientific acceptance. Lost custody-reply
recovery has separate native database evidence but has not yet been exercised
with this joined native Storage path.


### Recover lost instrument replies with native Storage retained

The joined proof now loses the HTTP reply after the native instrument RPC
commits. It tests each method separately. AequilibraE reply loss leaves six
registered/uploaded files and one instrument record; ActivitySim reply loss
occurs after the AequilibraE record has completed, leaving twelve files and two
records. In both cases the writer stops, preserves one exact pending request
and refuses later stage completion.

A fresh process invokes the actual recovery CLI with the saved request identity.
Its local adapter removes only the standalone PostgREST URL prefix. Recovery
retains the exact committed response without changing nine observed tables,
including instrument receipts and Storage object metadata. Native object
readback still matches every registered URI, hash and size. Receipt recovery
does not reopen the writer or resume computation.

Ten cases pass their expected outcomes: normal, harmless, bypassed stop guard,
wrong recovery request and restored, for each method. Bypassing the stop guard
fails the later-completion refusal check. A wrong request is refused by the CLI.
See `prototype/native-instrument-recovery-controls.json` and the private
`native-instrument-recovery-controls-20261009b` directory. All ten candidates
are recorded; temporary services and credential files are removed. The proof
PostgREST helper now caps swap at its 128 MiB memory limit and caps tasks at 128.

The first campaign exposed a harness error: the child called the CLI's `main`
without preserving its return code. The CLI correctly emitted `request_refused`,
but the wrapper exited zero. The corrected wrapper uses `SystemExit(main(...))`
and checks the refusal output. The diagnostic and initial campaign remain
retained in `native-instrument-recovery-20261009a` and
`native-instrument-recovery-controls-20261009a`; the final campaign uses fresh
clones rather than rewriting them.

This verifies joined native publication and exact receipt recovery for authored
software fixtures. Independent preparation, real network/population evidence,
publication of all supporting sources, normal dispatcher integration, the full
RLS matrix, practitioner observation and scientific acceptance remain open.

## October 9 consumer handoff audit

[The consumer handoff decision](CONSUMER_HANDOFF.md) traces the authenticated
project freeze, report citations and assistant reader. All three omit the new
attempt-specific custody. Its table currently denies application reads. Reports
also keep one historical comparable record per parent run, which cannot retain
both methods and multiple attempts. Read authorization, complete exports and
method-specific citations require implementation before claiming this handoff.

## Preparation producer custody review, October 9

The native publication/recovery work does not supply independent preparation.
The current development producer remains
`scripts/modeling/prepare_development_validation_instruments.py`. It reads a
registered network seed and resolved boundary, acquires observation sources,
builds an observation package and matches before opening model output. It is a
development-study producer, not the generic admitted-run preparation interface.
Its v1 observation/match records also cannot simply be relabeled as the v2 records
required by the complete source catalog.

Review found a reproducible preservation defect: `prepare_all` reused its output
root, and `_copy_exact` overwrote a changed network copy. A second invocation could
therefore replace prior preparation evidence. The producer now requires an unused
output root before acquisition. Existing complete or partial roots cause an
explicit refusal. The network-copy helper reuses identical bytes, refuses changed
bytes and uses exclusive creation for new destinations. No historical study files
were changed. Operators must select a new output root for a new attempt; this
change does not add partial-preparation resume.

Four filesystem tests and 13 existing instrument tests pass. Five mutation-control
cases establish that a harmless buffer-size change passes, while network overwrite,
output-root reuse and following a dangling target fail. The first output-root
mutation produced a mock-serialization error; the fixture now returns a serializable
record so the missing early refusal triggers the intended assertion. Results are
in `prototype/preparation-no-overwrite-controls.json`.

These tests mock acquisition. They do not establish source quality, independent
acceptance timing, comprehensive filesystem race resistance or power-loss recovery.
The next preparation connection still needs a run- and method-bound record made
before output access, exact structural/source identities, explicit readiness and
an immutable handoff to execution. The existing development freeze remains useful
source code and evidence, not authorization to enable managed dispatch or promote
a scientific claim.

The [preparation handoff design](PREPARATION_HANDOFF.md) separates the observation
protocol freeze from each method's assignment-input freeze. This distinction is
required because ActivitySim demand is an output of the behavioral stage before
it becomes an input to network assignment. The document identifies the current
producer/dispatcher seams and the native, ordering and recovery evidence required
before enabling dispatch. It changes no claim tier or study result.
