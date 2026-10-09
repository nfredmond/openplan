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
