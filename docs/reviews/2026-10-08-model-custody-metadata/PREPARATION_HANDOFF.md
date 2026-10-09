# Connect preparation to execution without promoting scientific claims

Status: implementation design based on checkout `ea8a5a536`, October 9, 2026.
This refines the existing S1 work in the roadmap and CORE-MODEL-01. It does not
create another queue, reduce the V1 contract or declare independent acceptance.

## The current boundary is incomplete

`validation_instrument_v2.py` can build observation packages, assignment-blind
match audits and exact input bundles. `model_structural_input_audit.py` can audit
network, boundary, zones, OD demand, conversion and assignment-profile inputs.
These are reusable components. The historical comparable study runner supplies
them from `OLD_ROOT`, a seven-county registry and predecessor output paths. Its
California-specific source acquisition is a declared study boundary, not a
generic worker preparation interface.

`build_input_bundle` verifies source bytes and package/registry/geography
relationships, but its identity is a study/geography pair. It does not bind an
admitted workspace, run, method or attempt. The worker rules-v5 wrapper accepts
expected identities but still has no normal dispatch caller. The source catalog
and publisher retain complete declared files after execution; their `preparation`
entry labels cannot establish when observation selection actually occurred.

The normal `process_stage` path still calls `stage_assignment` from Network
Assignment and ActivitySim Network Assignment. The latter consumes an executed
ActivitySim demand package. `build_structural_input_audit` requires an OD matrix.
Therefore a complete ActivitySim structural audit cannot be required before that
method has produced demand. This does not authorize observing validation residuals
before selecting or grading the evidence.

## Preserve two different preparation checkpoints

1. Freeze the observation and matching protocol before modeled results are
   revealed for that experiment. Retain registry/protocol identity, resolved
   study geometry, observation bytes and their source records, evidence grades,
   network identity, matching decisions, declared use, uncertainty rules and
   development/selection/untouched-acceptance role. The existence of a JSON flag
   or a caller-provided timestamp does not prove ordering. A consumed holdout
   remains consumed.
2. Freeze each method's actual assignment inputs before its network assignment.
   Bind the first checkpoint plus method, network settings, assignment profile,
   zone identities, OD demand, structural audit and relevant population,
   coefficient, conversion and source-vintage records. ActivitySim-derived demand
   is execution output of its behavioral stage and input to network assignment.
   Preserve both relationships. Do not relabel it as independently observed data.
3. After assignment, form the comparison basis from the retained input identities
   and actual output/run-summary/conservation records. Verify all dependencies
   before evaluating output. Retain and publish assessment and diagnosis through
   the admitted artifact/instrument commands. These records remain separate for
   both methods and cannot promote the scientific claim tier on their own.

## Implementation order within the existing worker

First extract an explicit input-bundle preparation boundary from the historical
study runner. It takes supplied, verified v2 observation/match files and a
registered protocol. It does not acquire a substitute source, search old run
folders or infer an authority from a country default. It validates actual source
files and uses the shared builder. The output directory is fresh and owned;
conflicting or partial records are preserved for reconciliation.

Add a separate immutable execution-binding record around the existing bundle.
Keep the bundle schema intact. Bind workspace, run, demand method, producing
attempt, exact bundle hash, structural audit and source identities. Across stages,
consumer attempt identity differs from producer identity; reuse the existing
registered-artifact handoff instead of rewriting the producer's record. Reuse of
an exact record is allowed only after verifying the original bytes and context.

Then connect this record to the actual admitted engine launch boundary. A launch
must verify its own retained command and input identities, not accept a boolean
from the caller. Lost preparation registration must stop before engine launch.
Lost launch acknowledgement must reconcile the original admission and command,
not create a second execution. The publication-recovery CLI completes publication
only and remains unable to resume an engine.

Integrate one complete run through both method lanes before enabling general
managed dispatch. Preserve the existing explicit unassessed behavior for runs
without adequate scientific preparation. Missing prerequisites cannot become an
empty passing assessment or be treated as zero observations.

## Required proof before enabling dispatch

- Real preparation files from a fresh fixture, followed by an actual admitted
  stage. A harmless source-order change survives; changed run, method, geography,
  source hash, settings, network, parent ownership or preparation artifact fails
  before an engine is invoked.
- An engine spy and durable launch evidence distinguish no invocation from a
  launched process with an unconfirmed reply. Source reads through aliases must
  not reveal output early. Tests that inspect flags alone are insufficient.
- Interrupted preparation registration, failed source retention, existing partial
  directories, revoked ownership and changed source bytes preserve prior records
  and prevent a new launch. Recovery uses the original request identity.
- Both methods use the same declared geography, population/network comparison
  boundary and observation protocol. Their method-specific demand and settings
  remain explicit. Unsupported, unavailable, failed and unassessed are distinct.
- Native database/Storage records and complete source downloads agree with the
  recorded preparation and execution bytes. Then verify the identified-build
  Models, report, assistant and export journeys, desktop and 390px, in T3.
- Separate untouched geographic acceptance and practitioner observation are
  still required for V1. Synthetic transport fixtures establish neither.

## Current evidence limit

This document records code relationships and implementation constraints. No new
model ran, no holdout was opened, no dispatcher was enabled and no preparation
record was fabricated. The outstanding CI repair for the instrument access census
must also pass its full RLS and restore runs before integration is called verified.

## Explicit bundle retention checkpoint

`model_validation_preparation.retain` now uses the shared v2 input-bundle builder
with explicitly supplied files. It refuses sources outside the owned attempt
before calling the builder. Within a fresh method-specific directory it copies
every declared readiness file through the pinned same-run copy helper, checking
each declared source even when two roles have identical content. It stores those
copies by hash, retains the unchanged generated bundle and writes the manifest
last. The manifest binds the attempt owner and explicit method. It preserves the
original source references alongside their retained object names.

`AttemptWriter.prepare_validation_bundle` registers the manifest through the
existing attempt artifact command with a fixed method-specific request identity.
A copy or registration failure stops the writer. A lost registration reply leaves
the original command journal available for exact-request reconciliation. Existing
complete or partial preparation directories are not recomputed or overwritten.
There is no new partial-preparation resume or engine-restart path.

The related suite has 29 passing tests, including six preparation-file cases and
three admitted-writer cases. Ten harmless, broken and restored controls passed
expected outcomes; results are in `prototype/validation-preparation-controls.json`.
The tests use real temporary files and local command journals with synthetic
records and injected database responses. The fixture has an empty observation
package, so it proves no observation adequacy or scientific usefulness.

This is the first explicit retention boundary, not the completed execution
handoff. The manifest says `source_completeness`, `structural_preparation`,
`preparation_independence` and `scientific_acceptance` are `unassessed`, with
`execution_authorized: false`. Nested measurement coverage, source authority,
actual freeze timing, structural audit binding, native artifact registration and
normal stage/engine integration still require evidence. No historical study files
or existing output bytes were rewritten.

## Native preparation registration and lost-reply recovery

The native registration verifier now exercises `prepare_validation_bundle` as
well as the complete source-catalog writer. Each preparation case uses a fresh
admitted attempt and isolated database clone. It verifies the retained bundle,
manifest and six declared readiness roles against their hashes and byte sizes,
then checks the actual artifact's type, method, attempt and manifest reference.
No source is acquired and no model is invoked.

For each method, the verifier commits the artifact command and suppresses its
reply. The writer stops, and its original request remains pending. A separate
Python process runs exact-request recovery through the existing CLI. It retrieves
the same committed receipt and clears the pending command. Snapshots of six native
tables remain unchanged during recovery; the original writer remains stopped.
A wrong request ID fails, and a deliberate stopped-writer bypass is detected.

All seven preparation registration cases and all seven existing source-registration
cases passed their expected outcomes against separate clones. Their results are retained in
`prototype/native-preparation-registration-controls.json` and
`prototype/native-source-registration-controls.json`. The gateway is removed on
successful completion of each owned context. Database clones remain as evidence.

This establishes native artifact registration and receipt recovery for these
synthetic preparation files. The fixture's empty observation package does not
establish useful observations, adequate source coverage, scientific independence,
structural preparation or execution ordering. No Storage publication, normal
stage handoff or engine launch is proved by this checkpoint.

## Explicit consumer handoff checkpoint

The predecessor selector now supports method-specific preparation artifacts.
Network Assignment selects AequilibraE preparation from AequilibraE Setup.
ActivitySim Network Assignment selects ActivitySim preparation from ActivitySim
Bundle & Preflight. Both require a unique completed earlier managed producer,
its current attempt, and a matching artifact method. Existing package/state
handoffs keep their existing predecessor mappings.

`retain_managed_validation_preparation` reads the current consumer and registered
producer through the bound installation. It requires the exact producer-owned
manifest location and supported metadata. The new consumer verifies the original
manifest and bundle hashes, run/method/attempt scope, every declared readiness
role, unique role identities and content-addressed object names. It copies the
verified objects into a fresh consumer directory, preserving the original bundle
and producer manifest byte-for-byte. A separate consumption manifest and native
artifact command retain the producer identity without relabeling it as the
consumer's own preparation. The result remains `execution_authorized: false`.

The related set has 43 passing tests, including eight file/selection cases and
three tests of the real bound worker adapter. Eight mutation-control cases passed
their expected outcomes. Results and source hashes are in
`prototype/preparation-handoff-controls.json`. Source acquisition is synthetic and
database responses are injected in these adapter tests. The existing native
producer-registration evidence does not prove this new consumer transaction.

Producer reads are point-in-time checks. Final consumption registration uses the
consumer's attempt fence, but no lease over concurrent producer revocation is
claimed. Native end-to-end handoff, structural-audit integration, validated source
coverage and actual engine launch ordering remain open. Normal dispatch does not
call this new handoff yet; adding a function alone does not complete the workflow.

## Native producer-to-consumer handoff, October 9

The explicit consumer now has native database evidence. The new
`prototype/verify_native_preparation_handoff.py` creates a fresh isolated clone,
claims a preparation producer, retains and registers its synthetic inputs, and
completes it through the managed stage command. A separately admitted assignment
consumer then calls the actual handoff adapter over the isolated PostgREST gateway.
Both AequilibraE and ActivitySim mappings pass. Each consumer registers one
consumption artifact with its own attempt and the original producer identity.
All six retained roles match their recorded hashes and sizes. Producer files
remain unchanged; the producer stays succeeded and the consumer stays running.
Consumption does not authorize execution or complete the assignment stage.

Five control cases passed their expected outcomes: baseline, a harmless input
folder rename, deliberately omitted consumption registration, an unrelated
producer name, and restored baseline. The omitted registration fails the native
artifact inventory assertion. The unrelated producer fails the named predecessor
selector. Results and the proof hash are in
`prototype/native-preparation-handoff-controls.json`. Private logs and database
identities remain under `native-preparation-handoff-controls-20261009b` in the
local OpenPlan state directory. Gateway containers are removed; database clones
are retained. An earlier control setup tried renaming an already managed stage;
the database correctly refused that direct update. The final control declares
the unrelated name before claiming the producer.

This supersedes only the earlier native handoff evidence gap. Inputs are authored
fixtures with empty observations, not scientific acceptance evidence. The test
uses explicit managed invocations, not normal dispatch. Consumer artifact reply
loss and fresh-process recovery, concurrent producer revocation, structural-audit
integration, source coverage, and actual engine ordering remain unproved here.

## Consumer artifact reply-loss recovery, October 9

The native handoff proof now also loses the response after the database commits
the consumer artifact. The actual adapter stops the writer and leaves exactly
one pending artifact request. A fresh Python process runs the existing recovery
CLI with that saved request ID and installation. It recovers the original receipt
without invoking the handoff or admitting another computation.

For both methods, the proof compares all seven relevant native table snapshots,
the local execution-admission rows, and every retained run file before and after
recovery. All remain unchanged. The pending request becomes resolved with the
exact original transaction receipt. The old writer remains stopped and refuses
stage completion after recovery. The proof reconstructs file references only to
compare the retained consumption manifest against native rows; it does not pass
an execution continuation back to the worker.

The control runner includes a harmless input-folder rename, an unknown recovery
request, and a deliberately bypassed stopped-writer guard. The unknown request
cannot recover the pending artifact; the guard bypass is caught when it permits
completion. These tests cover response loss after commit, not operating-system
process termination, database service restart or concurrent producer revocation.
Normal dispatch, structural binding, engine ordering, source adequacy and
independent scientific acceptance remain open.

All ten handoff/recovery controls passed their expected outcomes. The current
`prototype/native-preparation-handoff-controls.json` records both verifier hashes.
Private evidence is retained under
`native-preparation-handoff-controls-20261009c` in the local OpenPlan state folder.
The earlier five-case report remains in Git history.

## Structural zone identity correction, October 9

Before connecting the structural audit to execution, inspection found a
reproducible identity defect. The matrix reader accepted duplicate zone IDs,
converted `1.9` and `1.1` to the same integer, and collapsed adjacent integer IDs
`9007199254740992` and `9007199254740993` through binary floating point. The zone
table used the same conversion and a dictionary that silently discarded duplicate
rows. Such a matrix cannot support an exact zone-based demand audit.

The reader now parses integer identities exactly, accepts integral decimal and
exponent spellings, and refuses fractional/non-finite IDs. Matrix axes must have
unique IDs; zone tables must be nonempty and unique. Empty matrix rows produce
an explicit structural refusal. The actual audit entry calls this checked zone
reader before reading demand. Seven new tests, fourteen existing preparation-file
tests and the existing structural audit/diagnosis script pass. Eight harmless,
broken and restored controls pass their expected outcomes in isolated module
copies. See `prototype/structural-zone-controls.json`. Historical study records
remain unchanged; these tests do not establish geographic or model acceptance.

Tracing `stage_assignment` also confirms that input-package demand is not the
final assigned matrix. Mode choice, scenario adjustments, gateway injection and
unreachable-pair filtering occur before resident/external traffic classes are
constructed. The execution connection must preserve the package audit and
separately bind the actual class matrices, centroid order and applied network
settings immediately before assignment. Calling the existing package audit a
freeze of final engine demand would overstate its scope. That connection remains
open; this correction fixes a prerequisite rather than claiming it complete.

## Initial assignment input checkpoint, October 9

`stage_assignment` now calls `model_assignment_input_snapshot.retain_and_execute`
in place of its initial `assig.execute()`. The helper reads the configured
resident and external traffic classes directly. It checks each class's actual
computational view, integer centroid identities, agreement with graph centroid
order, PCE, iteration limit, convergence target and core count. Demand must be
square, finite and nonnegative. This occurs after mode choice, scenario adjustment,
gateway loading and unreachable-pair filtering.

The helper saves centroid arrays and demand arrays as NPY files, reads them back
against the active solver views, and records hashes, sizes, the assignment profile,
network state and applied network settings. It writes the manifest last and syncs
both the snapshot directory and its parent before calling the engine. Existing
complete or partial directories are refused. A retention failure prevents the
initial execute call; an engine failure preserves the completed input snapshot.
The returned assignment result includes the snapshot identity under
`initial_assignment_inputs`. Reusing an output directory containing a snapshot
now requires reconciliation rather than an implicit second execution.

Forty-five related tests pass, including nine new snapshot cases. Seven isolated
mutation controls detect early execution, reused directories, skipped array
readback and changed graph/settings checks. AequilibraE 1.6.2 also completes the
existing two-centroid, one-link synthetic bound-assignment proof with the new
checkpoint. Both class snapshots match the native OMX exports exactly, and their
network state/settings match the assignment result. Four native readback controls
pass their expected outcomes, including a deliberately changed in-memory expected
matrix. Reports are `prototype/assignment-snapshot-controls.json`,
`prototype/native-assignment-input-snapshot.json` and
`prototype/native-assignment-snapshot-controls.json`. Native run evidence is in
`native-initial-assignment-snapshot-20261009b` under the local OpenPlan state folder.

This checkpoint covers only the initial traffic assignment. Calibration reruns
are explicitly outside its scope. The native proof uses injected parent database
responses and synthetic demand; it does not establish scientific accuracy,
observation independence or a complete normal-dispatch journey. Database artifact
registration and the link to the consumed observation/structural preparation are
still missing. The network record identifies solver-visible state; this change
does not add a complete downloadable graph snapshot or a concurrent-mutation lease.
