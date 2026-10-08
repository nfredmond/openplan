# Recovery status candidate, October 8, 2026

The model page previously tried to reap stale historical runs on read. Migration
18 refuses those writes to preserve recovery evidence, while the reaper skips
RPC errors. The page therefore continues displaying the saved active status.
Its status-only relaunch predicate also offers a control the recovery guard will
refuse. This finding comes from source inspection, not a browser journey.

The candidate adds a service-role-only read of workspace-scoped enrollment and
observed stage starts. It does not grant execution ownership or change records.
The server parser checks exact workspace/run identities, provenance, timestamps
and count consistency. Missing, malformed and failed reads become unavailable.
In-process engines retain their existing behavior.

The authorized model page supplies recovery state to its run controls. Historical
runs display a reconciliation warning beside their saved status. Unavailable
records display a distinct read warning. Both states suppress relaunch, reaping
on page read, live progress estimates and automatic polling for those runs.
Saved stages and outputs remain inspectable; their status labels identify them
as saved records. This does not change scientific claim tiers.

## Checks completed

The focused reader and presentation suite passes 18 tests. It covers exact RPC
arguments, both scope identities, database and transport failures, malformed
records, historical status and the existing ActivitySim preflight distinction.
Baseline, harmless comment change and restored baseline pass. Removing the
workspace comparison, ignoring an RPC error and bypassing historical status
presentation each fail assertions. Private control results are retained at
`model-command-client-20261008-proof/recovery-status-controls.json`.

Targeted ESLint passes for all changed TypeScript files. The focused Vitest run
uses one worker, a 512 MB Node heap and a separate cache directory. It reads the
existing dependency installation without changing its package files. The first
invocation used the wrong relative path for the dependency link and did not run
tests; the corrected invocation produced the results above.

## Unfinished evidence and behavior

Migration 19 has not been installed or subjected to native permission, scope,
upgrade or restore tests. The reader tests mock its database response. Component,
page-loader integration and full app checks remain pending. No desktop or 390px
T3 acceptance has been collected for this candidate. Do not merge or release on
the strength of these unit checks.

The notice identifies reconciliation work; it does not perform it. Operator
inspection of database records, worker journals and output files, reviewed
reconciliation decisions, dispatcher recovery, current ownership checks and
whole-installation restoration remain unfinished. Cron reaping still attempts
historical writes and relies on the database refusal. The new-run state records
enrollment, not a current execution lease or a scientific acceptance decision.

## Native reader and rendered controls follow-up

The rollback-only native reader proof now passes against the owned migration-18
upgrade fixture. It compares complete historical/new enrollment records and the
actual stage-start timestamp/count. Wrong workspace, missing run and null scope
return no record. Actual calls under anonymous and authenticated roles are
refused; the service role reads the scoped state. Every variant rolls back.
Removing workspace filtering, relabeling historical enrollment, widening role
permission and losing the start count each fail the intended assertion.
Baseline, harmless comment and restored baseline pass. This supersedes the
untested-native-permission boundary above, but does not install migration 19 or
prove its migration history, whole upgrade or restore.

Nine component tests pass using the real manager and evidence panel in jsdom.
They check notices, saved stage labels, absent relaunch/progress, stopped polling
for historical records and continued progress/polling for a new running record.
Positive cases require an available queue control for both worker engines.

The first control run exposed a vacuous relaunch assertion. The fixture used
`behavioral_demand`, whose parent omitted the evidence panel for unfinished
runs, so removing the relaunch guard still passed. A positive case reproduced
that missing control. The parent now uses the shared worker-engine predicate.
The corrected tests catch omitted panel mounting and bypasses of relaunch,
progress and polling guards. Harmless and restored runs pass. Initial label
queries also assumed a single copy, but both the summary and run badge display
the state; the corrected assertions require both copies.

Private evidence is `recovery-status-native/recovery-reader.json` and
`recovery-component-controls.json` under the existing proof root. Targeted lint
passes. These tests do not establish page-level authorization, real navigation,
CSS/mobile usability, downloadable artifacts or browser acceptance. The full
candidate and T3 desktop/390px checks remain open.

## Page-loader integration follow-up

Seven tests now execute the actual server page with its actual recovery reader.
They confirm that sign-in failure, an absent user-scoped model and a failed model
read stop before service-role recovery inspection. The authorized path passes
exact workspace/run IDs, carries the historical or unavailable result into the
manager props, and excludes those records from reaping. An assessed new record
retains the ordinary reaper path. The database projection and model filter are
asserted explicitly because the mock otherwise supplies fields regardless of
what the query selects.

Baseline, harmless comment and restored baseline pass. Dropping the recovery
prop, passing historical records to the reaper, skipping the sign-in boundary,
and omitting the engine field from the run projection each fail assertions.
Private control results are `recovery-page-controls.json`. Targeted lint passes.

The tests mock user-scoped database responses and inspect the page's React tree.
They do not establish live RLS, installation migration ordering, actual page
navigation or rendered CSS. They supersede the untested page-loader join noted
above while preserving those remaining boundaries.
