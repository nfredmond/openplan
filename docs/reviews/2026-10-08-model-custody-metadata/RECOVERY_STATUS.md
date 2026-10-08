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

## Native dispatcher follow-up

The normal worker dispatcher now has a native HTTP proof with synthetic domain
computations. It calls the actual queue reader, prerequisite classifier,
`process_first_actionable_stage`, serialized stage runner, conditional claim,
run/stage writes, atomic `state.json` publication and retained KPI delivery.
Only package preparation and the three domain computation functions are
substituted. The proof does not execute AequilibraE or ActivitySim.

The owned database clone includes installed migrations 18 and 19. Setup,
assignment and extraction finish in order, with three observed starts, one KPI,
saved setup/assignment handoff state and a succeeded parent. A later stage waits
for its queued prerequisite. A reply dropped after the claim commits raises
uncertainty before computation; the original stage cannot be claimed again, and
later stages remain waiting. An ordinary synthetic domain failure marks its
stage and parent failed and skips dependent stages. A failed local atomic
replacement preserves the running stage and parent instead of recording a
false terminal failure.

Baseline, a harmless claim-payload copy and restored baseline pass. Deliberately
swallowing the lost-claim error fails the claim-uncertainty assertion. Swallowing
the local publication error fails the local-uncertainty assertion. The final
proof performs 220 HTTP requests and removes its private PostgREST gateway.
The committed [result](prototype/retention-dispatcher-result.json) records source
hashes and synthetic run identities; the executable proof is
[verify_retention_dispatcher.py](prototype/verify_retention_dispatcher.py).
Private clone metadata and logs remain in `retention-dispatcher-v2` under the
existing proof root. An earlier run tested only the claim-error adverse control;
the final run adds the independent local-write adverse control.

This supersedes the lack of normal dispatcher integration evidence for these
synthetic cases. It does not prove real engine execution, interrupted process
continuation, managed-attempt ownership, operator reconciliation, Storage,
whole-installation restore, browser usability, human acceptance or scientific
accuracy. Those boundaries remain open. The integration checkout and its active
QA process were not changed by this proof.

## GitHub candidate failure and configuration correction

The GitHub QA job for `85a12549` fails one documentation test after 20,138
passing and 1,587 skipped tests. `BACKUP_AND_RESTORE.md` names the worker's
`OPENPLAN_DEPLOYMENT_ID`, but the shared environment example did not document it.
The environment example now explains that identity, its worker scope and its
same-installation restore boundary. No test exception or assertion was removed.
The eight mechanical documentation and operator-setting tests pass locally on
the corrected tree. The first invocation used the repository root rather than
the nested app root; it did not run tests. The corrected invocation passed.

The separate shuffled Vitest job also exits 1. Its retrieved log does not show
a final failing assertion or summary, so the documentation defect is not yet
established as its cause. The actual live RLS and full-archive restore jobs
remain in progress at this checkpoint. Local QA continues on the frozen
`989128da` checkout and does not cover the later operator documentation or CLI
inventory changes. No new full-suite or release success is claimed.

## Direct CI log and local dependency-fixture failure

The direct GitHub job log resolves the earlier shuffled-log uncertainty. Seed
465711 fails the same environment-template documentation assertion, with 20,138
passing tests, one failure and 1,587 skips. The first combined log retrieval was
incomplete. The configuration correction addresses that named failure; a new
GitHub run is still required.

Local QA on `989128da` ends at 11:06:11 Pacific after 20,139 passing tests and
1,587 skips. It then fails the braces vendor mutation checks. The dependency
installation uses per-package symlinks. The fixture's default `cpSync` copied
that symlink rather than package bytes, and its mutations changed the shared
installed LICENSE, parser, compile, expand and stringify files. This is a test
isolation failure introduced by combining the fixture with this dependency
layout, not a successful dependency audit. No tracked application files changed.

The five affected files were restored from the repository's hash-verified local
archive. All ten installed manifest files and the actual depth checks pass
again. The fixture now dereferences package links into its own temporary copy
and asserts that ownership before any mutation. A synthetic linked-package
regression checks that changing the copy leaves source bytes unchanged. All 19
vendor checks pass, followed by another successful installed-byte/behavior check.

Baseline, harmless comment and restored synthetic-copy controls pass. Removing
dereferencing fails the fixture ownership check. Removing both dereferencing and
the ownership assertion fails the source-preservation assertion. These adverse
variants run only the synthetic-copy test, not the installed-package mutations.
The committed result is `prototype/braces-copy-controls.json`. Remaining local
dependency audit and production build have not yet passed on the corrected tree.
The prior full application suite is retained as evidence for its stated commit,
not relabeled as a complete successful QA gate for this later candidate.

## Corrected dependency audit and production build

The bounded `openplan-recovery-audit-build-aa5e8318.service` job completes with
exit 0 on `aa5e8318`. It runs the dependency audit and production build after
the earlier QA job's failure. All 19 vendor checks pass, the ten installed
manifest files match, npm audit reports zero vulnerabilities, and the webpack
build completes TypeScript checking and page generation. The command uses the
same synthetic build configuration and explicitly disables local live RLS.

This is the completed remainder of local validation, not a new monolithic
`qa:gate` pass. The earlier 20,139-test result remains tied to `989128da`; the
later worker inventory and documentation/configuration changes have their
separate targeted tests. GitHub live RLS and full-archive restoration on
`85a12549` are still running at this checkpoint. The corrected integration head
has not yet received new GitHub checks or desktop/390px T3 acceptance.

## Model creator planning-link refusal found through T3

On candidate `a10b6907`, the actual T3 model creator says both planning links
are optional. Leaving both blank reaches the final step and returns `Invalid
input`. The route requires a project or scenario set. The correction states
that requirement at the planning-work step and keeps an unlinked model there
with an actionable message. Either link remains sufficient; the server rule is
unchanged. Five focused component tests and targeted ESLint pass. A harmless
comment and restored source pass; removing the check fails the missing-link
case, and requiring both links fails both single-link cases.

The frozen preview successfully creates a clearly labeled synthetic model after
selecting its existing synthetic project. Its detail page reports zero runs.
No computation is launched. This verifies the real creation path on the prior
candidate, not browser acceptance of the correction. T3 page reads and focused
form interactions work, but snapshot capture still fails, including a fresh tab
showing only the health response. Desktop/390px visual and console acceptance
remain open. The component tests do not prove rendering, live API behavior or
scientific recovery. The preview checkout remains unchanged.

## Live RLS cleanup conflicts with intentional enrollment retention

GitHub run `37818820078` on `85a12549` completes with 1,484 passing tests,
125 skips and one suite teardown failure. The guided model truth suite deletes
its workspace after testing. Migration 18 correctly refuses that cascade through
`model_execution_custody_enrollment_run_id_fkey`. The failure is not a passing
live RLS gate.

The suite now explicitly tests the exact foreign-key refusal and verifies that
all fixture runs and their workspace survive. Teardown signs users out and
retains these uniquely named synthetic fixtures until the isolated test stack
is discarded. It does not disable triggers, delete enrollment, ignore arbitrary
errors or weaken production retention. This live suite must use a disposable
stack; repeated local execution retains synthetic records there.

A native transaction probe on the existing isolated migration-proof database
creates a synthetic workspace, model and run, attempts workspace deletion, checks
the exact refusal and verifies retained rows. Baseline, harmless comment and
restored cases pass. Dropping only the enrollment foreign key makes the probe
fail with `Workspace deletion lost enrolled model run`. Every case rolls back,
including the adverse transaction when its connection closes. Results are in
`prototype/model-retention-cleanup-controls.json`. This checks native retention,
not the updated suite's authenticated HTTP path. Targeted ESLint passes after
correcting an initial invocation from the repository root. The updated complete
live RLS suite remains pending on GitHub.
