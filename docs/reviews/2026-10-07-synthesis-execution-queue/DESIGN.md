# Staff-requested synthesis execution

Design checkpoint, October 7, 2026. Base 60920f8b, application runtime inspected
at 5646c33c. This is implementation preparation under roadmap M9b and A0, not a
new queue of product priorities or a claim that execution service support exists.

## Observed gap

Staff can save a source, create root/context/thematic requests, queue preparation,
grant exact execution permission, inspect saved results and import a machine
proposal for review. The current generation CLI requires an operator to supply
an authorization UUID and stage. It has no continuous discovery mode.
`scripts/workers/synthesis-preparation.ts` already offers a supervised polling
service; `scripts/workers/synthesis-generation.ts` operates one named grant.
The UI truthfully says that saving an allowance does not start a worker.

The desired outcome is that staff can explicitly request execution of a saved
allowance and observe its disposition with a configured worker running. An
operator should configure the service once, not copy every allowance identifier
into a shell. Existing installations and command-line recovery remain supported.

## Design constraints

1. Keep saving permission separate from requesting execution. Existing allowances
   must never become an automatic backlog when a service starts. Add an explicit
   staff command bound to the original stage, request, authorization and hash.
2. Reuse the existing segment, context and thematic schedulers. Their native
   authorization checks, task ordering, exact journals, selected predecessor
   results and unknown-dispatch refusals remain authoritative. A queue receipt
   grants no extra attempts or permission.
3. Use an additive native queue record and narrow authenticated command. Verify
   the author, current workspace/campaign/source, request stage and original
   permission before a new enqueue. Exact command replay returns the original
   receipt without manufacturing fresh execution rights after expiry.
4. Scope agent writes through the existing action registry or an executable
   staff-only refusal. Do not expose a service-role enqueue endpoint to browsers.
5. Persist a coordinator journal before dispatch and reuse the CLI's canonical
   target/authorization/task directories. Never assign a fresh task directory
   after an uncertain result. Worker restarts preserve the original queue and
   scheduler identity.
6. Bound discovery pages and rotate pending work so an unavailable provider does
   not strand unrelated cases. Native task claims remain the concurrency fence.
   An observation timeout alone does not justify another schedule or process.
7. Cancellation prevents fresh work through existing native request rules. Saved
   output can still recover custody. Expiry and cancellation do not prove that
   a sent call failed or that its cost is zero. Unknown outcomes stay visible.
8. Report queued, claimed, partially retained, retained, unobserved, refused and
   unavailable states without implying semantic correctness or staff approval.
   A worker heartbeat is operational evidence, not proof of output completeness.
9. Preserve all three stages and the complete source. Provider support remains
   accurately disclosed. This queue does not establish installed-provider parity
   for synthesis or finish the broader A0 requirement.

## Implementation and verification sequence

Read the current native authorizations, worker journals and preparation queue
before selecting the queue schema. Specify exact command/reply bytes and replay
behavior first. Add the native command and staff-only route, then browser recovery
and visible controls, then the continuous coordinator using existing schedules.
Update operator configuration and restore custody together.

Use the isolated restore-target stack for synthetic acceptance only after its
identity and outstanding jobs are inspected. Do not automatically run any existing
allowance. Test new explicit queue records against a synthetic local provider
that logs every call and rejects unpinned tasks. No paid provider is required.

Verification must include harmless and targeted mutation controls; wrong actor,
workspace, campaign, stage and permission hash; expired new commands and exact old
receipts; duplicate enqueue; lost enqueue reply; two workers; shutdown/restart;
provider loss before send; unknown dispatch after send; output custody recovery;
context predecessor gaps; thematic source completeness; and cancellation while
queued or running. Count native attempts, dispatches and outputs and compare
original hashes, not only UI success messages. Keep failed cases and blind spots.

Finish identified-build desktop and 390px navigation from retained source through
execution request, observable progress and explicit staff proposal import.
Synthetic semantics do not establish planner usefulness, public comprehension,
provider parity, complete accessibility or independent human acceptance. These
remain full V1 obligations.

## Existing browser evidence

Combined-runtime inspection reaches contribution results with four retained
outputs, both source contributions, context creation and thematic creation.
The thematic request 3620e480 has two retained outputs and an explicitly expired
allowance. Review bf07f2a2 retains revision 2, both unassigned contributions,
uncertainty and no approval events. Proposal inspection shows a replacement
preview and a separate selection control at desktop and 390px. No enqueue,
allowance, provider call, import or approval was performed in this read-only
follow-up. Private local checkpoint and screenshots retain the exact paths;
final workflow evidence must be collected after implementation.

## Record contract checkpoint

The shared command binds schema version, queue ID, actor, workspace, campaign,
source and source hash, request and intent hash, stage, and authorization and
intent hash. The receipt carries the unchanged command text, its SHA-256,
queue ID and original creation time. The portable verifier checks exact bytes
and the checksum without treating the receipt as permission or completion.
Native validation of authority and unique JSON keys remains required.

Twenty focused tests pass. A harmless comment passes; deleting the exact-command,
queue-identity or checksum comparison causes targeted assertion failures.
`record-controls.json` retains those outcomes. Changed-file ESLint passes.
An initial test invocation from the repository root failed to locate Vitest;
the actual tests ran from the application package. No native command, worker,
provider, browser write or new capability is implemented by this checkpoint.
Mock-free record checks do not establish database authorization, browser storage,
concurrency, worker recovery, deployment or full-package compatibility.

## Native enqueue candidate

The additive candidate stores one immutable enqueue command per authorization.
It uses the current requester lock and stage-specific execution checks, compares
source/request/permission identities and hashes, and rejects new scheduling after
expiry or credential changes. Exact receipt replay does not recheck permission
expiry or create another record. Direct table writes are revoked; only the narrow
authenticated enqueue function and service read are granted.

`native-probe.sql` runs inside a rollback-only transaction against the owned
synthetic restore target. It uses existing source/plan records and creates fresh
permissions through the actual stage authorization functions. All three stages
pass exact receipt/replay and adverse hash/stage/actor/duplicate/byte checks.
The baseline and harmless control pass; six targeted native faults fail the
intended probe assertions, recorded in `native-controls.json`. No worker runs,
provider is contacted, or candidate migration remains installed.

This probe sets the synthetic JWT subject while using the local database owner.
It tests function behavior, not authenticated-role grants or live HTTP isolation.
It depends on the retained synthetic fixture and is not a self-contained CI test.
Before landing the migration, add independent role, expiry/replay, cancellation,
credential-change, foreign scope, duplicate/concurrency and immutable-history
checks. Add the migration inventories and release documentation with the complete
increment. The queue has no claim/status API or worker pickup yet; service reads
must never interpret a queue record alone as fresh dispatch authority.

## Role and time-bound follow-up

`native-role-probe.sql` adds actual `authenticated`, `anon` and `service_role`
execution checks in the same rollback-only transaction. Authenticated staff
creates a new queue entry and recovers its original receipt for each stage.
Other actors cannot replay it. Anonymous and service roles cannot invoke the
staff enqueue function; direct authenticated table reads and updates fail.

Fresh permissions expire naturally during the probe. A previously enqueued
command still returns its exact receipt; an untouched expired allowance cannot
create a queue entry. Cancellation likewise preserves exact old receipts and
refuses fresh scheduling. These checks alter only temporary synthetic records.

The baseline and harmless control pass. Six targeted role/current-authority/
expiry mutations fail the intended assertions. The initial UPDATE probe also
read a column, so removing UPDATE restrictions still failed for missing SELECT.
The revised probe assigns a literal and isolates UPDATE permission. This initial
weakness and final results remain in `native-role-controls.json`.

These checks establish SQL role behavior and natural expiry, not browser/HTTP
session isolation, concurrent workers or deployment recovery. Independent fixture
construction, credential-change and concurrency coverage remain unfinished.

## Reproducible native suite

The repository now includes `synthesis-execution-queue-rls.test.ts` and its SQL
fixture in the live-isolation npm command. It creates source, request, plan and
permission records from the existing repository fixture producers. Contribution,
context and thematic cases each use fresh rollback-only records rather than this
machine's saved browser data. The 11 tests pass in 20.84 seconds on the explicitly
selected restore target; changed-test ESLint and whitespace checks also pass.

The initial command ran outside the app package and found no fixture. After
correcting the working directory, the first expanded run passed nine tests and
failed two: the fixture setup supplied the contribution author's ID for context
and thematic requests. Native authorization correctly refused that author.
The setup now reads the original actor from each created request before assuming
the authenticated role. All 11 cases pass, including seven targeted faults and
the harmless control. No production authorization check was weakened.

The suite applies the candidate migration inside its transaction when
`OPENPLAN_SYNTHESIS_EXECUTION_QUEUE_CANDIDATE=1`. Ordinary live CI uses the migrated
schema. It still requires the existing isolated-stack safeguard and explicit
live-test opt-in. These fresh fixtures supersede the earlier machine-specific
probe dependency, but do not establish HTTP/browser recovery or concurrent workers.

## Authenticated server helper checkpoint

The server helper forwards the exact saved queue command through the staff
authenticated client. It checks current route scope before transport and verifies
the native receipt before acknowledgement. It preserves native refusal categories
and refuses acknowledgement after cancellation. It never dispatches provider work.

The 12 helper tests pass. A harmless comment passes; removing scope checks,
receipt verification or post-transport cancellation checks causes assertion
failures. `server-controls.json` records these controls. Changed-file ESLint and
whitespace checks pass. These mocked transport tests do not establish live HTTP
session isolation, timeout recovery, worker execution or a visible staff journey.

The native suite also adds foreign workspace/source checks and immutable-history
checks. It deliberately disables the history trigger to establish that the
UPDATE/DELETE assertions detect missing protection. Queue pickup, the staff route
and UI, credential-change and concurrency evidence remain unfinished.

The expanded native suite passes all 14 cases in 25.82 seconds on October 7.
It ran with the explicit live-test opt-in, candidate migration flag and isolated
restore-target workdir. Every case rolls back its migration and fixtures.

## Staff scheduling endpoint checkpoint

`POST /api/engagement/campaigns/[campaignId]/synthesis/execution/queue` accepts
the original UTF-8 queue command directly. It preserves whitespace and bounds
the body to 4,096 bytes. Current staff access, expected account/workspace and
browser origin checks precede native enqueue. All three agent execution headers
receive an executable refusal, including empty values. Responses are private
and uncached. Audit records contain queue IDs or refusal categories only.

All 15 route tests pass through the real server helper with mocked authenticated
transport. ESLint passes. A harmless change passes; removing agent refusal,
origin checks, the byte limit or either expected-scope check causes the intended
assertion failures. `route-controls.json` preserves the results. The first test
command ran from the repository root and could not locate Vitest; the corrected
command ran from the nested app package.

This is an HTTP-handler test, not a deployed browser/session test. The route does
not discover work, start workers or claim completion. Full package type/build
checks, live HTTP recovery, worker pickup and the visible scheduling journey
remain required before release.

## Bounded worker discovery checkpoint

The queue reader queries only explicit queue records, with a 32-row bound and
an exact custody-field projection. It verifies command hashes, queue identity,
request, permission and stage before returning a page. UUID ordering preserves
the cursor without timestamp precision loss. A short page retains its cursor;
an empty page instructs the future coordinator to wrap and include later inserts
behind that cursor. No worker starts from this reader alone.

All 12 reader tests and changed-file ESLint pass. The harmless control passes.
Removing order, identity, page-bound or cancellation checks, or dropping the hash
from the query projection, causes assertion failures. `reader-controls.json`
records these results. Mocks assert the projection but do not establish live
pagination, fairness, coordinator journals, concurrent workers or dispatch safety.

A full package type check with a 4 GB JavaScript heap limit exhausted that limit
before producing diagnostics. It is not a passing type check. The process was
confirmed absent before considering another run. Full package checking remains
open; focused tests do not substitute for it.

## Queue-to-scheduler binding checkpoint

The worker adapter verifies each queue receipt again, reads the retained request
and permission, and compares their exact hashes and scope before selecting the
contribution, context or thematic scheduler. It uses the existing CLI root plus
target hash and permission ID. Queue IDs never create fresh task directories.
The existing scheduler retains responsibility for current authority, task claims,
unknown dispatch and output recovery. A coordinator still needs to journal the
queue entry before invoking this adapter.

Ten adapter tests cover all three stages, canonical journal paths, query
projections and changed request/permission records. Together with the 15 route
tests, all 25 pass. ESLint passes. The harmless control passes; removing authority
binding, replacing the permission directory with a queue directory or routing
thematic work incorrectly causes assertion failures. `driver-controls.json`
retains the results. Schedulers are mocked here; this does not establish real
provider execution, restart recovery or concurrent worker safety.

The 6 GB heap retry completed and reported one route-test type error: its
Uint8Array annotation allowed SharedArrayBuffer while NextRequest requires an
ArrayBuffer-backed body. The fixture now declares the narrower type. The route
tests pass after correction. Another full type check remains required.

## Durable page coordinator checkpoint

The coordinator saves target, canonical worker root, queue cursor and up to 32
exact receipts before invoking any scheduler. It validates saved receipts on
restart and rejects changed roots, targets, checksums or page ordering. Progress
is saved only after a scheduler returns or refuses. Interruption leaves the
original pending entry on disk. A failed scheduler does not prevent the remaining
page from proceeding; the immutable queue revisits it after cursor wrap using
the same authorization journals. No service or CLI polling loop is installed yet.

Eleven coordinator tests use real private filesystem journals and mocked queue
reads/schedulers. Together with 20 record tests, all 31 pass. They cover interrupted
replay, failed discovery persistence, failed progress persistence, changed saved
identity, pagination wrap and the exclusive local coordinator lock. ESLint passes.
The harmless control passes. Removing pre-dispatch persistence, root binding,
cursor binding or the complete cancellation boundary causes assertion failures.
An intermediate mutation removing only the post-scheduler cancellation checks
survived: the save guard still refuses the aborted signal before changing disk.
Both controls remain in `coordinator-controls.json`. No check was weakened.

The full package type check at 1cd76295 passes with the bounded 6 GB heap run.
The new coordinator still needs full package checking. Real provider interruption,
multiple worker processes, live status reporting and desktop/mobile staff
acceptance remain open. `schedule_returned` is a coordinator observation, not a
claim that all outputs were delivered, analyzed or approved.

## Worker command checkpoint

`npm run worker:synthesis-execution` polls explicit queue pages. `--once` runs
one bounded page, and `--help` works without credentials. The worker shares
`OPENPLAN_SYNTHESIS_GENERATION_WORK_DIR` with the single-grant CLI, defaults to
`~/.local/state/openplan/synthesis-generation-worker`, and keeps its coordinator
under the target hash in `queue-coordinator`. Use the same absolute private root
for service and CLI recovery. Do not delete or rotate task journals after an
unknown dispatch. SIGINT and SIGTERM cancel in-flight work and interrupt waits.

The command requires the candidate queue migration, normal worker database
credentials and the existing provider configuration. It has not been installed
as a running service or pointed at retained allowances. Production operator
configuration, restore inventory and acceptance remain incomplete. Starting it
discovers only explicit queue entries; historical permission is not a backlog.

All 24 options/lifecycle tests pass, as do changed-file ESLint and an actual CLI
help invocation with no environment file. A first test run found an incorrect
coordinator import copied from the preparation pattern; fixing the module path
resolved it. The harmless control passes. Removing absolute-root validation,
target partitioning, unconfirmed-status handling or shutdown acknowledgement
checks causes assertion failures. `service-controls.json` retains the evidence.
Mocks cover loop control and delays, not OS signals, real provider dispatch,
process crash recovery or deployed service health. The full type check through
d3dd40d4 passes; the new command and service still need full checking.

## Credential rotation and combined checks

The native fixture now replaces a valid synthetic API key after granting
permission, then removes the credential record. Existing queue receipts retain
their original bytes, while unused permissions refuse new scheduling. All changes
remain inside rollback-only transactions. Contribution, context and thematic
fixtures use valid key-based configurations; a separate no-key case remains.

The initial rotation mutant survived because the no-key configuration rejected
the inserted key before reaching the credential-hash comparison. That fixture
proved incompatible configuration refusal, not valid key rotation. The revised
fixture creates key-based configuration through the normal native revision
command. Removing the enqueue hash comparison now triggers the intended
'Changed credential queue accepted' assertion. No production guard changed.

All 16 native cases pass in 29.24 seconds, including the harmless control and
targeted faults. All 104 focused tests across seven queue suites pass together
in 3.05 seconds. Changed-test ESLint and whitespace checks pass. The bounded full
package type check at e679bfd9 passes. These checks still do not prove concurrent
worker dispatch, live service interruption, visible scheduling or planner
acceptance. The queue migration remains a rollback-tested candidate.

## Browser queue recovery checkpoint

The browser helper retains exact queue command bytes in a slot scoped to the
requester, workspace, campaign, request, stage and permission. It checks source
and permission hashes when reading. A successful receipt never clears the slot;
retrying a lost response uses the original queue ID and bytes. Storage failure,
changed recovery data, receipt substitution or cancellation prevents a success
acknowledgement. The transport sends expected account/workspace headers.

All 16 recovery tests and changed-file ESLint pass. The harmless control passes;
removing scope checks, overwrite protection, storage readback, post-response
storage comparison or cancellation checks causes assertion failures. Results are
in `recovery-controls.json`. These in-memory storage and mocked transport tests
do not prove browser persistence, cross-device recovery or live HTTP behavior.
The scheduling control, server-side receipt lookup, unreadable-copy preservation
and identified-build desktop/mobile acceptance remain unfinished.

## Server receipt lookup candidate

A native read command recovers the exact receipt by campaign, request and
permission ID. It requires current staff scope and the original requester.
Unknown permissions are refused; a valid permission with no queue entry returns
an explicit null receipt. The read neither schedules work nor renews permission.
Existing receipts remain readable after cancellation under current access.

The candidate remains in the uninstalled additive queue migration. Browser and
HTTP integration will verify both the returned scope and original command bytes
before offering recovery. Native receipt lookup alone does not prove cross-device
recovery or allow a browser to infer that a worker ran.

All 19 native cases pass in 34.14 seconds on the isolated restore target, including
all three stages, the harmless control and targeted lookup faults. Removing the
permission lookup check, changing returned command bytes or granting anonymous
execution fails the intended assertion. Tests also refuse a foreign actor,
recover unchanged receipts after cancellation and distinguish an unused allowance
from a missing permission. Changed-test ESLint and whitespace checks pass.

## HTTP receipt lookup checkpoint

The queue endpoint now reads a saved receipt using request and permission IDs.
It requires current staff access and expected account/workspace headers, rejects
duplicate or extra query fields, and uses only the authenticated native read.
The response verifier checks envelope scope, exact receipt checksum and the
embedded command's requester, campaign, workspace, request and permission.
Malformed or unavailable evidence remains an error, never a null receipt.

All 66 route, server and record tests pass together; changed-file ESLint passes.
The harmless control passes. Removing envelope or embedded-command binding, or
duplicate-query rejection, causes assertion failures. Results remain in
`lookup-http-controls.json`. The HTTP tests mock native transport, so real
session isolation and browser recovery still require acceptance evidence.

## Visible scheduling controls candidate

Each saved permission now offers its original requester a scheduling review.
Opening that review reads server custody without posting. A valid empty lookup
enables an explicit execution request when the allowance is current; retained
commands can retry exact receipt recovery after expiry. A returned server receipt
restores the original browser command. Unknown lookup results never enable fresh
scheduling. The panel distinguishes queue custody from provider-call completion
and directs staff to saved results.

Unreadable or conflicting browser recovery blocks scheduling until staff
preserves its raw copy. Preservation verifies the archive before clearing the
active slot and then reads server custody again. Access loss clears private
command display. Scope changes remount the panel and abort outstanding work.

All 39 scheduling-panel, existing permission-panel and recovery tests pass
together. Changed-file ESLint passes. The harmless control passes. Removing fresh
allowance eligibility, lookup-required gating, private-display clearing or archive
persistence causes intended assertion failures. `panel-controls.json` records
these checks. The React review checked stable component identity, event-driven
reads, aborted requests, native buttons and bounded wrapping. No browser evidence
has been collected for these new controls. Full type/build checks, keyboard and
390px review, live cross-browser recovery and worker acceptance remain open.

## Build preparation and catalog evidence

The full bounded type check at 0af9bd91 passes. A fresh rollback-only catalog
probe with the candidate migration reports 287 application tables, all with RLS,
and 14 application views after excluding extension relations. The migration
inventory now records those counts. All 29 inventory tests pass; a harmless SQL
comment passes and removing queue RLS fails the inventory assertions. Results
remain in `inventory-controls.json`. No new client table policy is introduced.

The existing integration runtime remains on port 3504. The queue worktree will
use its own build and port. The owned restore-target database has no active
application query during preparation and records migrations through 00012.
This catalog check alone does not establish restore behavior or live acceptance.


## Identified-build queue acceptance, October 7

Production build 27835bf6 passes webpack, TypeScript and generation of 137 static
pages. Its owned runtime serves port 3505. Migration 00013 is installed through
the Supabase CLI on the isolated restore-target stack, API port 29821. These
facts supersede the preparation-only state above.

T3 navigation reached the saved source and an expired allowance at desktop and
390px widths. The scheduling review read an empty receipt and disabled fresh
execution for that expired allowance. The mobile document had no horizontal
overflow. This is agent inspection, not practitioner acceptance.

A new synthetic request a9f14a6a-aa21-46d9-ae8f-fba7f612f776 was saved through
T3, queued for preparation and prepared by its targeted journal. Its four-task
plan was sealed. Staff controls saved allowance
04d54d77-5d72-489f-9539-61649e541e03, then explicitly queued it after an empty
custody lookup. A local synthetic provider accepted only exact prepared task
bytes for this request, with no paid provider or participant data.

The first worker process omitted the explicit loopback endpoint exception and
returned one unconfirmed schedule. A direct diagnostic invocation reproduced
`api_endpoint_denied`. Neither invocation reached the provider. Both had already
retained native dispatch custody, leaving tasks 0 and 1 unobserved. The worker
therefore did not resend them after the process configuration was corrected.
Tasks 2 and 3 then reached the provider and retained structurally complete
outputs. A further cursor-wrap and populated pass made no additional requests:
the provider log remains at two calls. Task journals remain unobserved,
unobserved, delivered and delivered. T3 reports two attempts without retained
output and two complete output checks, with an incomplete-analysis warning.

This proves explicit queue transport, two actual local calls, result inspection
and replay without duplicate dispatch for this fixture. It does not prove
all-task completion, recovery of the two missing outputs, semantic validity,
context/thematic queue execution, concurrent coordinators or lost browser-reply
recovery. The pre-transport refusal boundary needs further review. Do not erase
or reinterpret the two unobserved attempts to obtain a complete result.

Private synthetic scripts, exact task bytes, provider logs and journals remain
under ~/.local/state/openplan/synthesis-queue-acceptance-20261007. The provider
process uses tool session 52829 and port 34667. No continuous queue worker is
installed. Empty service startup, SIGTERM and restart previously passed with an
unchanged empty coordinator journal; that narrower evidence does not prove
interruption recovery during a call.

Integration PR #138 separately merged as main commit 4d6ef970 after all eight
PR checks passed, including the full restore drill. Its post-merge CI, RLS,
upgrade-path and worker runs were queued when this checkpoint was written.
This queue candidate is not part of that merge and is not declared released.


## Operator diagnosis after the populated pass

The coordinator now exposes a fixed `endpoint_policy` reason only for typed
transport errors `api_endpoint_denied` and `api_endpoint_policy_invalid`. The
CLI names the queue entry and directs operators to the worker process endpoint
and outbound-host policy. It also warns that dispatch may already be retained
and requires preserving journals and inspecting results before retrying.
Unknown errors remain unconfirmed without arbitrary error text, URLs, secrets
or source material in the report. This diagnostic changes no dispatch authority,
worker journal state or retry rule.

All 40 coordinator and execution-service tests pass together. Changed-file lint
and whitespace checks pass. A harmless comment passes; removing diagnosis fails
two assertions, while classifying unknown or forged errors as policy refusals
fails three assertions. `diagnostic-controls.json` retains those results. These
tests use real private journals with mocked schedulers. They do not establish
live CLI output on a new refusal or solve the pre-dispatch validation boundary.
The production browser build remains 27835bf6 pending a later rebuild.


## Request-save notice correction

The full bounded TypeScript check at 7f9efd05 passes. The direction check also
passes with existing jurisdiction, capability and release-version reminders;
those reminders have not been cleared by changing review dates.

The live journey exposed a stale statement in the request-save notice: it said
no provider execution was authorized even after a permission was saved and calls
ran. The notice now states that saving a request does not grant execution
permission. This describes the action without asserting current grant state.
All 27 request-panel tests and changed-file lint pass. A harmless comment passes;
restoring the old assertion fails three tests. `save-notice-controls.json`
retains the results. Browser verification of the new wording awaits the next
identified build; the prior screenshot remains evidence for the prior build.


## Complete segment queue and lost acknowledgement

Build 87d8a3c3 passes webpack, TypeScript and 137 static pages. Its owned runtime
PID 155763 serves port 3505 from this worktree; health reports that commit. T3
reloaded it, navigated through the saved source and generation history, and
recovered the earlier request's queue receipt. At 390px the document width is
390px. The corrected save notice was then observed when creating a new request.

Fresh request 8ef00aba-f68d-472b-a142-80d16e5f7b84 uses the same retained synthetic
source. T3 saved its four-attempt allowance c843181c-7985-4e35-868a-e86ee003364b
and explicitly queued it. A one-use browser fetch wrapper withheld the successful
POST acknowledgement. The original command remained available, and retrying it
recovered queue df7ba3b6-4cc9-4a80-b9f6-8b1ba2d23c12. The wrapper was removed
before retry. Native inspection confirms exactly one queue record and four
attempts, indices 0 through 3, all under that allowance.

With the exact local endpoint configured, the queue worker made four calls to a
synthetic provider restricted to prepared task bytes. All four private journals
are delivered. T3 reports four complete output checks and offers context
combination, while preserving the meaning and approval caveats. A cursor wrap and
another populated pass produce no more calls. `segment-browser-acceptance.json`
and `segment-native-evidence.json` retain identifiers and measured counts.
This is structural synthetic segment acceptance, not semantic, context, thematic,
practitioner or public-participant acceptance. The earlier two unobserved attempts
remain unchanged.

The lost-reply exercise exposed a stale empty-lookup message after the write.
The panel now displays an unconfirmed scheduling receipt whenever it retains a
command without a confirmed receipt. Fresh empty lookups still display their
original empty state. All nine panel tests and lint pass. A harmless comment
passes, and removing the pending-command distinction causes the regression tests
to fail. `uncertain-receipt-controls.json` records this check. The latest wording
correction requires a new browser build; 87d8a3c3 remains the running build.


## Context acceptance found a first-task resource mismatch

From the completed segment request, T3 selected the long multilingual
contribution and saved context request ec8dbd11-1473-4465-a072-496c4da12fd8.
Preparation sealed four frames totaling 206,380 saved bytes. Staff controls saved
allowance 8fc67324-e4a0-4f00-9fd6-4fa5705d0a5e and explicitly queued it.

The worker refused before claiming the first task. Reconstructing the exact
continuation reports 68,699 required task bytes against the request's 65,536-byte
limit. `context-resource-boundary.json` records this result. The first task
journal remains prepared; T3 reports four tasks with no selected attempt. No
successful synthetic provider call was logged. The queue summary reports one
unconfirmed schedule, so this is not successful context acceptance.

The create panel currently fixes taskByteLimit at 65,536. The preparation frame
budget and the assembled task budget do not account for the same material.
Correct request budgeting and visible refusal/recovery before claiming a complete
context workflow. Preserve this request and its original limit. Do not silently
raise retained authority, clip source text, reduce the test contribution or use
the short contribution as a substitute for this failing case.

The context test provider and pinned originals remain in the private context-run
directory under the queue acceptance root. Its current tool session is 97446 on
port 34667. It checks the pinned frame sequence and preceding output. This fixture
has not yet reached it successfully. The browser still runs build 87d8a3c3;
worker code runs the queue branch checkpoint 4ce39f57.


## Explicit task budget for new requests

The shared segment, context and thematic create form now exposes the existing
request taskByteLimit, from 4,096 to 1,048,576 bytes. Its default remains 65,536.
The explanation includes instructions, complete material and preceding output,
states that source text is not shortened, and distinguishes this bound from
token or price limits. A retained request displays its original budget in a
locked field. Changing the form for a new request does not change old intent,
provider permission or retry scope.

All 32 create-panel tests and changed-file lint pass. The selected 131,072-byte
budget survives a lost reply and remount as exact saved intent. Empty, fractional,
under-minimum and over-maximum budgets disable saving. A harmless comment passes;
ignoring the selected budget and removing invalid-budget gating fail assertions.
`task-budget-controls.json` records those controls. This is a bounded recovery
mechanism, not proof that any declared budget will accommodate every continuation.
The same long context contribution still needs a new identified-build journey
with a separately saved budget. Precise staff-facing resource diagnosis and the
context/thematic queue acceptance remain unfinished.


## Same long contribution with a separately saved budget

Build 0e826600 passes webpack, TypeScript and 137 static pages; the owned port
3505 runtime identifies that build. T3 navigated from saved source history to the
completed segment request and selected the same long multilingual contribution.
The create form explicitly saved 131,072 task bytes in new request
faf4121a-bd8c-46c5-878a-4a3ba550d974. The original 65,536-byte request is unchanged.

Preparation retains four frames and 206,380 saved bytes. T3 saved allowance
022f500a-a319-45ae-92a5-62aaca0a919f and explicitly queued execution. The pinned
local provider accepted all four frames in order and required each preceding
output unchanged. Four task journals are delivered. T3 reports four complete
output checks and combined context ready for theme preparation, with staff-review
and meaning caveats. Another queue traversal leaves accepted provider calls at
four. That traversal still exits 2 because the preserved earlier low-budget
context request remains unconfirmed. This result does not erase its failure.

`context-budget-acceptance.json` records the measured outcome. This establishes
a structural context path for the same source with an explicit new request
budget. It does not close resource diagnosis, context for the second contribution,
thematic execution, semantic validity, staff acceptance or public participation.
The current synthetic provider is context-budget-run/provider.mjs in the private
acceptance root, tool session 3243, port 34667. Source originals remain private.
