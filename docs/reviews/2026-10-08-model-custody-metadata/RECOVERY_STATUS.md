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

## Installed reader and regression checks

Migration 19 installs through the Supabase CLI on a fresh populated clone of the
owned migration-18 fixture. A second migration-up call leaves one history entry.
Exact rows across 21 model tables remain unchanged, including all 111 enrollment
records. The installed function passes the native enrollment, observed start,
workspace and actual role-permission cases. The source remains at migration 18.

The harmless-comment and restored migration controls pass. Granting execution
to authenticated users installs successfully but fails the native permission
assertion, demonstrating that a successful CLI exit alone cannot clear this
check. The widened-permission clone remains isolated for diagnosis. No
application database was upgraded. Private records are `recovery-reader-upgrade-v1`
and `recovery-reader-upgrade-controls` under the proof root.

All 66 tests in six related existing model-control suites pass. These cover run
status, failure copy, calibration controls, CEQA mounting, relaunch offers and
worker declaration. Combined candidate QA and T3 acceptance remain outstanding.

## Parent retention QA

The full `npm run qa:gate` completed on the unchanged parent
`5fec2787204ddfac6e00458f38e9bb58d4f7ff1f`. It ran 20,105 passing tests with 1,587
skips across 1,513 passing and 95 skipped files. Lint, provider-connector tests,
dependency audit and production build completed. The build compiled, passed
TypeScript and generated all 137 static pages. The configured deadcode command
completed but reported 538 unused exports; it is not evidence of no dead code.
Live RLS was explicitly skipped and is not covered by this result.

The unit `openplan-retention-qa-5fec2787.service`, invocation
`acf1a2b1204f428a8237a89a68d8360b`, completed on October 8 at 10:28 Pacific with
a 5.8 GiB memory peak. These checks precede the recovery-status changes and do
not establish combined-head acceptance. The completed transient unit was removed
by systemd. Its journal and exact-head runner remain available in the private
proof records.
