# Managed GTFS ingestion implementation checkpoint

Current candidate authority: [retained planner imports](CLIENT_PANEL.md), [dependent service reads](EQUITY_REFRESH.md) and [the browser-discovered sibling correction](SIBLING_IDENTITY.md). Routes and the installed worker are connected behind an opt-in candidate switch. Migrations 28 through 31 remain unreleased. Earlier paragraphs below are historical checkpoints, including earlier unconnected-route and unfinished-source statements. Browser, complete restore, capacity, CI and release verification remain open.

Latest source-intake preparation, October 10: [interruptible downloads](FETCH_CANCELLATION.md)
now accept the owned worker signal, bound stalled DNS and dispose interrupted
bodies without publishing partial bytes. Durable source intake, exact-byte upload
reconciliation and managed route enrollment remain unfinished.

Latest implementation, October 10: [recurring archive cleanup](ARCHIVE_RECONCILIATION.md)
now retains authorized keys after acknowledgment and parent deletion. The actual
application sweep rediscovers late native uploads while preserving open, ready
and unrelated files. Source intake and managed route enrollment remain unfinished.

Latest investigation, October 10: the [native late-upload counterexample](LATE_STORAGE_UPLOAD.md)
shows an object arriving after cancellation and successful cleanup acknowledgment,
including with an active-state Storage policy. The installed provider checks that
policy before the upload body, not at completion. Recurring bounded object
reconciliation is required before source intake can claim cleanup. This evidence
does not enable managed routes or close the remaining worker/release boundaries.

This unfinished M3 implementation stays outside v0.68 and has no connected
route or worker. Migration 28 is a candidate in this isolated worktree. Do not
apply it to the demo or enable admission before the complete lifecycle is wired.
The roadmap remains the queue, and the existing worker design remains the scope.

The candidate retains submission identity, original actor and exact source
metadata, one version per request, permanent claim receipts, expiring ownership,
archive preparation/confirmation and guarded stage transitions. It protects
managed versions, derived rows and feed pointers from legacy direct writes,
including service-role writes, unowned failure and age-only reaping. Runtime
roles cannot truncate these tables or access private journals. Source fields
must have the declared JSON types, and archive byte counts must be positive
integers representable exactly by the Node caller. These checks do not establish
that a declared URL is safe or that Storage holds the claimed bytes.

The [native controls](admission-controls.json) record 25 cases. Baseline,
harmless-comment and restored runs pass; 22 targeted changes fail at the stated
assertion. Actual anon/authenticated calls are refused, service-only commands
work, viewer and foreign-feed admission fail, exact retries recover identity,
and changed requests or stale/revoked owners cannot mutate managed work.
Unstored uploads cannot be claimed. Parsing requires confirmed archive metadata;
prepared URL archives cannot be replaced or refetched. Feed deletion preserves
admission identity and workspace deletion removes its custody records.

Each case executes the candidate and synthetic fixtures in one transaction on
the existing isolated proof database, then rolls back. A separate connection
confirms the private schema is absent after every case. No migration history,
production data or demo database changes. The source and assertion hashes match
the retained result. Expiry is simulated by controlled SQL, not a killed worker.
Native concurrency and committed recovery were exercised only in the earlier
prototypes; this production-shaped candidate has not yet repeated those proofs.

The remaining implementation includes derived preparation and batch receipts,
atomic completion, the existing material-shrinkage adoption rules, terminal
failure/cancellation, queue/read commands, durable private worker journals,
archive reconciliation, actual lease renewal, tract aggregation and all three
import doors. The earlier parser PR also needs its environment correction joined
before this work can use it. Test advisors, representative upgrade and full
restore, separate-process recovery, live role/lock contention and desktop/390px
T3 journeys remain required. No resumable-ingestion or planner acceptance claim
is made by these SQL checks.

Reproduce from this owned checkout without applying the migration:

```bash
python3 docs/reviews/2026-10-09-gtfs-managed-ingestion/verify_admission.py /private/isolated-proof-config.json /private/new-proof-directory
```

## Guarded derived preparation and batches

The candidate now adds service-only preparation and route/stop batch commands.
Preparation requires current ownership, confirmed archive custody and parsing
stage. It deletes prior route, stop and tract rows once per attempt, records
removed counts, and returns that saved receipt on retry. Replacement claims clear
the prepared marker. An old worker cannot reset the replacement's rows.

Each batch requires an active prepared attempt, exact workspace/version scope,
recognized fields, a bounded row count and the next ordinal for that row kind.
The command hash binds the version, token, kind, ordinal and payload. Exact replay
returns the original receipt; changed payloads fail. The receipt and actual rows
commit together. The existing private write context permits only that transaction's
inserts, and preparation/batch history survives replacement attempts.

The [combined native record](batch-controls.json) covers 37 cases: baseline,
harmless and restored passes, and 34 targeted failures. The new checks exercise
actual route and stop writes, lost-reply-style same-transaction replay, scope and
field refusals, ordinal gaps and reuse, preparation replay, replacement cleanup
of all three derived tables, preserved history, client-role denial and parent
cascade. The initial baseline exposed an ambiguous PL/pgSQL table alias; renaming
the batch query alias resolves it. No assertion was removed to make that pass.

These tests still roll back, and each separate cleanup connection confirms the
candidate schema is absent. They do not establish committed response recovery,
concurrent replacement, worker journals, final completion or adoption. Before
completion is connected, bind the expected parsed artifact and row/batch counts
before writes so a matching receipt list alone cannot bless a truncated batch
set. Preserve tract-computation failure versus a successful zero-row result.
The current preparation command does not yet retain that output plan. The earlier
25-case admission record remains historical; the 37-case record identifies the
current candidate and combined assertions.

## Expected output identity and checkpoint scope

Preparation now retains the planned parsed-output hash and byte size, expected
route and stop row counts, and expected batch counts. Values are typed, bounded
positive integers; batch counts must be capable of holding their stated rows.
An exact retry returns the original receipt. Changing the plan under that same
attempt fails. New writes cannot exceed the declared row or batch totals.
Completion still needs to require equality with these totals, actual stored rows
and the retained batch manifest before publishing ready. This is an upper bound
and identity checkpoint, not proof that the whole import has completed.

The [current native controls](planned-batch-controls.json) identify the final
candidate hash. All 45 outcomes match expectation: three passing controls and
42 deliberately broken variants detected. The earlier preparation-guard mutant
became protected by the new missing-plan check. Its corrected variant bypasses
both barriers and supplies a forged default plan; the unprepared-write assertion
then fails for the intended reason. Preparation replay is checked before the
changed-plan case, so the destructive-retry mutation still fails its original
receipt assertion. No behavior assertion was removed.

The [advisor comparison](advisor-summary.json) runs the pinned official
[Supabase Splinter SQL](https://github.com/supabase/splinter/blob/fccca4b1c4d8b48b8ccd69bd6b30e84adcb92975/splinter.sql)
before and after installing the candidate within a rollback transaction. The
API schema setting matches this checkout's `public,graphql_public` configuration.
Two new missing foreign-key indexes are corrected. The final comparison has no
new security warning/error or missing foreign-key index. Ten informational
notices remain: unused new indexes and deliberately policy-free private tables
that deny runtime roles direct access. The proof database already has 1,675
advisor findings, including retained experiments; this comparison does not clear
or classify that historical database inventory. Source and output hashes remain
in the report; raw advisor output stays private.

The parser's explicit production-environment fix is joined from `3b0079847`.
This branch remains an unfinished implementation checkpoint, not a release or
merge-ready PR. No route uses the new commands and no persistent database schema
is changed by these tests. Lifecycle completion, tract computation, adoption,
failure/cancellation, worker/journal/Storage connection, native concurrent and
committed recovery, upgrade/restore and rendered journeys remain required.

## Atomic completion checkpoint

The later [completion record](COMPLETION.md) supersedes the open completion and
tract-command items above. Its 67 native control outcomes identify the current
candidate. Adoption, terminal failure/cancellation, worker connection and the
stated independent recovery/acceptance checks remain open. The earlier records
retain the source hashes and limits that applied at their own checkpoint.

## Exact adoption review and retained decisions

[The adoption checkpoint](ADOPTION.md) adds the existing material-shrinkage policy,
exact predecessor review and historical decision receipts. Current membership is
required on every call, including replay. Completed managed imports and retained
legacy ready versions can become current through the existing atomic promotion
function. No route or worker is enrolled. The 83-case combined native record and
advisor comparison identify this checkpoint; earlier records remain historical.
Failure/cancellation/cleanup, queue/read commands, committed concurrency/recovery,
worker integration, upgrade/restore and actual browser review remain unfinished.

## Worker failure and member cancellation

[The termination checkpoint](TERMINATION.md) adds owned worker failure and current
member cancellation, exact terminal receipts, atomic partial-row removal and
prepared-object cleanup scheduling. The current feed is preserved. One hundred
combined native controls and the advisor comparison identify this candidate.
The worker still must settle or reconcile in-flight Storage writes before cleanup
can be considered complete. No route or worker is connected. Queue/read commands,
worker journals, lease renewal, committed recovery/contention, upgrade/restore and
T3 browser evidence remain required before enrollment or merge.

## Worker queue and scoped reads

[The read checkpoint](READS.md) adds a bounded candidate queue, retained-claim
attempt reads and member status reads without worker tokens or private source
arguments. The 120-case combined native record and advisor comparison identify
this candidate. Queue results do not grant ownership, and reads do not renew
leases. Worker response validation, durable journals, actual polling/renewal,
Storage reconciliation, route integration and committed recovery/contention still
remain. No managed import route is enabled.

## Typed worker service and bounded acknowledgements

[The worker service checkpoint](WORKER_SERVICE.md) adds typed queue, claim, read,
renewal and member-status calls. It validates cross-field identity and custody,
bounds acknowledgements independently of transport compliance, and preserves
unknown outcomes for later reconciliation. Sixty-four focused tests, 36 source
controls, three actual PostgreSQL response snapshots, scoped TypeScript and ESLint
pass. Durable journals, mutation calls and worker/route enrollment remain open.

## Typed worker mutations

[The mutation checkpoint](WORKER_MUTATIONS.md) adds scoped calls for archive,
derived batches, tract computation, completion, failure and ordinary adoption.
The private attempt snapshot carries the original submitter identity. One hundred
SDK tests, 51 worker source controls, 121 native SQL controls, three native read
snapshots, the advisor comparison, scoped TypeScript and ESLint pass. Earlier
records retain their original source identities. Durable journals and actual
worker/route enrollment remain unfinished, including live HTTP, restart,
concurrency, Storage cancellation and operation-budget evidence.

## Private attempt and command journal

[The journal checkpoint](WORKER_JOURNAL.md) retains attempt and command identities
before delivery, refuses changed scope or payload, and revalidates retained
receipts without resending. Forty tests and 27 source controls pass. A
native child-process termination check recovers the same identities in a new
process and then reads the retained receipt without dispatch. This uses synthetic
delivery and does not establish database or power-loss recovery. The next step
connects the typed operation dispatcher and live attempt ownership; no import
route is enrolled.

## Typed journal dispatch

[The dispatcher checkpoint](WORKER_DISPATCH.md) connects all nine typed mutation
operations to private command records. Fresh and retained responses use the same
prepared verifier, and the exact stored identity reaches the SDK. The existing
100 service tests and 51 source controls pass, along with 33 dispatcher tests,
19 dispatcher controls and three current native read snapshots. The worker still
needs actual polling, live ownership, artifacts, parser and publication flow;
no import route is enrolled.

## Live-ownership attempt coordinator

[The attempt checkpoint](WORKER_ATTEMPT.md) joins saved identity to live claim,
read and renewal calls. It aborts processing on renewal uncertainty, refuses
unfinished work writes and waits for renewal before terminal delivery. Twenty-nine
tests and 19 controls pass. Controlled SDK transport and real private journals
do not establish a native database worker journey. Retained-terminal inspection,
actual archive/parser/output flow, adoption recovery and queue polling remain
open; no import route is enrolled.

## Retained terminal command recovery

[The recovery checkpoint](TERMINAL_RECOVERY.md) inspects saved completion and
failure requests and replays them without invoking processing again. It validates
saved scope and inputs, preserves live ownership checks when renewal applies,
and returns the current snapshot separately from historical acknowledgement.
The 133 focused tests, 78 source-control runs, native journal process proof,
scoped TypeScript and ESLint pass. Transport remains controlled, and the native
process proof covers the journal rather than a database worker. Actual artifacts,
publication, adoption recovery, queue polling and the previously stated native
and browser boundaries remain unfinished. No import route is enrolled.

## Retained archive and parser artifacts

[The artifact checkpoint](WORKER_ARTIFACT.md) connects verified retained Storage
bytes, private attempt/build bindings and the supervised parser. A new process
recovers the same saved BART output after an owned parent-process termination,
without downloading or parsing again, and refuses changed output. The 196-test
combined suite, 34 artifact controls, scoped TypeScript and ESLint pass. Native
Storage and parsing are real; database lifecycle replies remain controlled.
Parsed-domain validation, row publication, source acquisition, Storage-write
reconciliation, adoption, polling and the stated native/browser boundaries remain
unfinished. Interrupted local files need a cleanup policy before unattended
operation. No import route is enrolled.

## Parsed output and guarded publication

[The publication checkpoint](WORKER_PUBLICATION.md) validates the complete parser
protocol and connects existing row mapping to ordered journaled batches, tract
outcomes and explicit terminal requests. Parser route/stop counts remain separate
from stored service rows. The 426-test combined suite, 99 control runs, scoped
TypeScript and ESLint pass. A composed BART proof uses actual Storage and the
parser child, then recovers a lost completion reply across processes without
reprocessing. Its database replies remain controlled. Native lifecycle RPCs,
source acquisition, Storage reconciliation, cleanup, adoption, polling and the
previously stated database/browser boundaries remain unfinished.

## Native committed worker recovery

[The database recovery checkpoint](WORKER_DATABASE.md) replaces controlled
lifecycle replies with actual PostgreSQL commands through an owned PostgREST
and Storage stack. Completion and first-batch reply loss survive process-group
termination and fresh-process recovery. Independent SQL retains 95 route rows,
717 stop rows and nine receipts without duplicate publication. Six native HTTP
refusals and eight intended database-corruption assertions pass, with a harmless
control and restored-state checks. The final bounded worker service peaks at
151.4 MB; separate containers have their own limits.

The clone has 393 recorded migrations plus GTFS DDL outside that ledger. This
adds native recovery evidence, not current-main upgrade, concurrent replacement,
adoption, browser, scientific or release acceptance. No application source or
candidate migration changes, import enrollment or main merge occur here.

## October 10: current-main schema and concurrent replacement

[The current-main checkpoint](CURRENT_MAIN_DATABASE.md) records an exact CLI
upgrade through all 399 main migrations, followed by the populated candidate
upgrade to 400. Six-table GTFS records remain unchanged, repeat migration is
safe in the fixture, and existing imports remain unenrolled. Three altered
migrations fail the data-preservation assertion; baseline, harmless and restored
runs pass. Native completion and batch recovery pass again on that main-derived
schema with their HTTP refusals and observation controls.

Two real PostgreSQL connections prove replacement serialization in both orders.
The observer sees the expected blocking backend, and stale tokens cannot renew
or write after replacement. Synthetic expiry is explicitly advanced; this is not
a complete replacement worker journey or a real-clock expiry test. Mixed
legacy/managed promotion and termination lock ordering remains the next concern.

## October 10: legacy lifecycle lock order

[The lock-order fix](LEGACY_LOCK_ORDER.md) reproduces native deadlocks between
legacy promotion/reaping/closure and managed adoption/cancellation. The candidate
now locks the feed before its version in all three legacy functions and rechecks
the version's feed after waiting. Twenty-seven native interleaving and association
cases include the three original deadlocks, harmless controls and six intended
mutation failures. Privileges and resulting current/closed states are checked.

All 121 lifecycle SQL controls retain their expected outcomes. Populated CLI
upgrade, native worker recovery and the pinned advisor comparison pass against
the revised migration. The advisor's unprotected-table control fails as intended.
The branch remains an unenrolled implementation checkpoint, with intake,
reconciliation, polling, complete worker replacement and release checks open.

## October 10: exact source intake and upload recovery

[Source intake](SOURCE_INTAKE.md) now saves private exact bytes before preparation
and immutable upload, reconciles actual remote size/hash, confirms through owned
commands and refreshes scope before the existing parser/publication path. Thirty
controls include three positive runs and 27 intended assertion failures. Actual
PostgreSQL/Storage/parser recovery survives four process interruption boundaries
without contacting a changed publisher. Each version retains 95 route rows,
717 stop rows, nine batch receipts and one completion receipt without adoption.
The 49-file regression records 1,190 passing tests and 17 skipped live cases.

Earlier open intake paragraphs remain historical. Queue polling/CLI, route
enrollment, complete replacement/adoption/recovery journeys and relevant full
branch, role, restore, capacity and browser checks remain unfinished. No import
route is enabled and migration 28 remains an unreleased candidate.

## October 10: bounded queue and actual-expiry replacement

[Worker polling](WORKER_QUEUE.md) joins retained journals and database candidates,
serializes bounded passes and recovers a live attempt absent from the candidate
list. Actual server-clock expiry permits a replacement using the same saved
source and a new attempt directory. Native stale-token writes fail during that
replacement. Both cases publish 95 route rows, 717 stop rows, nine batches and
one completion without adoption or publisher refetch. Thirty-two controls
include three positive runs and 29 intended failures. Fifty-file regression
records 1,220 passes and 17 skipped live cases. TypeScript and lint pass.

The first candidate page can still hide later eligible work when errors persist.
Paginated discovery, route admission/progress/recovery/adoption and all stated
role, capacity, restore, browser and release boundaries remain open. Submission
helper work starts separately and is not included in this queue checkpoint.

## October 10: retained submissions and paginated queue discovery

[Submission recovery](SUBMISSION_RECOVERY.md) retains exact intent, resolved
source and private ZIP bytes before enrollment, reconciles immutable uploads,
and rechecks original-actor authority on every replay. Six native interruptions
preserve request/version identity; ZIP cases publish without client resupply or
adoption, and URL/catalog cases remain queued. Paginated discovery reaches later
candidates despite persistent first-page refusals. Native scan, actual-expiry
replacement and all 121 lifecycle controls preserve their expected outcomes.
The 52-file regression records 1,275 passes, 17 skipped live cases and no failures.

Older first-page and submission-helper paragraphs remain historical. Routes,
retained-submission polling, planner progress/recovery/adoption, full restore,
capacity, role and browser journeys remain unfinished. Draft route helpers and
migration 29 are outside this verified checkpoint. Nothing is merged or released.

## October 10: retained submission polling and managed API candidates

[Managed enrollment](ENROLLMENT.md) connects opt-in URL/catalog/ZIP/refresh API
paths, request status/recovery and submission polling before worker discovery.
Native polling survives six interruptions without client ZIP resupply or mutable
source resolution. Member status remains separate from unconfirmed/unavailable
results. Final enrollment, submission, queue and native role controls preserve
their intended outcomes; linked regression and scoped TypeScript/lint pass.

The planner panel remains disconnected. Uncommitted requests still need durable
cancellation reservations. Human completion review/adoption and retained browser
request handling are separate drafts. Candidate migrations 28 and 29 are not
released; draft migration 30 is excluded from this checkpoint. Full worker CLI,
upgrade/restore, capacity, live application roles and T3 journeys remain open.

## October 10: exact human review and early cancellation

[Human decisions](HUMAN_DECISIONS.md) connect manual completed-version review,
exact adoption commands and durable cancellation before version admission.
Native SQL, both admission/cancellation transaction orders, interrupted HTTP
commands, current-role refusals and private submission recovery pass. The CLI
upgrades populated predecessor 393 through current main 399 to candidate 403
without changing existing GTFS records or enrolling historical imports.

Browser request, decision and progress helpers preserve identity and separate
unconfirmed, cancelled, ready and current outcomes. The 65-file regression
passes 1,571 tests, skips 17 live cases and has no failures. Scoped TypeScript,
changed-file lint and targeted controls pass. The shared write-role inventory
now checks the human gate and refusal before dispatch.

These helpers are not yet connected to the planner panel. All four migrations
remain candidates. Full restore, installed CLI operation, capacity, application
session roles, T3 desktop/390px journeys, GitHub CI, integration and release
verification remain open. Historical missing-cancellation and missing-human-route
paragraphs above describe earlier checkpoints.

## October 10: retained planner import interface

[Planner progress](CLIENT_PANEL.md) connects the existing URL, catalog, ZIP and
refresh doors to retained requests in opt-in managed mode. Scoped committed
progress remains separate from submission acknowledgement and adoption.
Workspace versions open without original browser history; completed review
uses parser counts, exact predecessors and explicit material acceptance. Lost
replies retain exact requests and decisions for manual replay. Viewers read only.

Missing current and historical counts now display as not recorded; actual zero
counts remain zero. The 70-file regression passes 1,640 tests, skips 17 live
cases and has no failures. Scoped TypeScript and lint pass. Baseline, harmless
and restored controls pass; all 48 broken behaviors fail at intended assertions.
Older disconnected-panel paragraphs describe preceding checkpoints.

This branch is still a candidate. No T3 navigation or visual acceptance, app
cookie roles, installed worker service operation, full restore, largest-feed
capacity, CI, merge or release acceptance is established. Browser preparation
helpers remain separate unverified work. All four migrations remain unreleased.

## October 10: candidate browser database preparation

The [browser preparer](BROWSER_PREPARATION.md) clones the populated official CLI candidate and verifies the 403 migration ledger, Auth schema and unchanged source records. Three positive controls and 20 deliberately broken simulated variants passed their stated expectations. The first native attempt stopped on Auth ledger insert permissions. The corrected attempt uses the configured Auth owner and retains an exact version ledger without changing users or identities.

This preparation does not establish a fresh installation or full restore. The populated predecessor has no Storage buckets and an empty Storage migration ledger. Browser proof infrastructure therefore provisions its private bucket separately. An identified-build browser journey exposed a stale Title VI no-feed result after managed adoption. The response is a bounded refresh fix, not an acceptance claim. The desktop sign-in, real ZIP submission, worker completion, parser-count review and mobile adoption are preliminary evidence at `3aa44ff80155`; the corrected build still needs its own journey.

## October 10: refresh service evidence after adoption

The [refresh checkpoint](EQUITY_REFRESH.md) fixes the reproduced Title VI no-feed message after managed adoption. A fresh server-read identity also covers changes beyond the bounded current-version list. The controller retains its lifetime across equivalent server refreshes, and policy edits survive a service-evidence reread. Fourteen targeted broken variants fail their intended checks; baseline, harmless and restored runs pass. The broader planner controls complete 51 runs, including 48 broken variants. Strict lint and scoped TypeScript pass. The final serial GTFS/transit regression passes 1,647 tests across 71 files, with 17 live cases skipped and no failures.

The application remains stopped until this source is committed and identified. The earlier native journey is precursor evidence, not acceptance of this corrected build. All candidate migrations remain unreleased. Full browser journeys, live application roles, complete database/Storage/private-worker/configuration restore, capacity, GitHub CI, integration and release verification remain open.

## Browser-discovered sibling collision, October 10

At `3132cdddb9f8`, a duplicate React key made server refreshes accumulate 11 managed transit panels. Distinct panel namespaces now preserve workspace and actor scope without sibling collisions. The targeted control detects the collision; restored serial checks pass 1,648 tests with 17 live cases skipped, zero failures, strict lint and scoped TypeScript. [The correction report](SIBLING_IDENTITY.md) preserves the failed browser boundary and isolated REST memory adjustment. A new identified-build journey remains required.

## Current main joined, October 10

The candidate joins `06bdc7af6d40`, including the first merged UI-overhaul increment. Data Hub and Title VI label/style edits merge without replacing retained import bindings or sibling identity. [Integration checks](main-join-tests.json) pass 1836 tests across 76 files, with 17 live cases skipped and zero failures. Strict selected-file lint and scoped TypeScript pass. Both owned control suites rerun after the join, including baseline, harmless, restored and intended broken behaviors. The 1 GiB service peaks at 673.5 MiB. This does not establish browser or GitHub CI acceptance.

## Joined browser flows and malformed-archive presentation, October 10

[The partial identified-build journey](BROWSER_JOURNEY.md) records real URL, ZIP and refresh admissions, installed one-shot worker completion, 390px and desktop adoption, fresh service-equity version identity, retained policy edit and one-panel cardinality. A deliberate malformed ZIP stays failed while valid replacement bytes use a new request/version and complete review. Catalog, cancellation, cookie roles and geography remain open. [The presentation correction](FAILURE_COPY.md) replaces library guidance in both failed-version views without changing diagnostics. Serial checks pass 1,838 tests, with 17 live cases skipped, zero failures, strict lint and scoped TypeScript. Corrected-build browser text, complete restore, capacity, CI and release remain unverified.

## Registry failure and cancellation wording, October 10

[The failure-copy continuation](FAILURE_COPY.md) covers the registry and history after cookie authorization and queued cancellation journeys. The shared formatter keeps malformed archives and other failure reasons distinct. Registry wording preserves the difference between a cancelled managed execution and its legacy stored status. Eight broken copy variants fail at the intended assertions; positive controls pass. Serial checks pass 1,841 tests with 17 live cases skipped, zero failures, strict lint and scoped TypeScript. Browser verification of this source, catalog enrollment, active worker recovery, complete restore, capacity, CI and release remain open.

## Catalog, worker interruption and retained installation, October 10

[The browser continuation](BROWSER_JOURNEY.md) verifies registry/history wording and catalog enrollment on the identified copy-correction build. Historical catalog service dates remain visibly expired. [Installed worker continuation](WORKER_CONTINUATION.md) measures a 43.4 MB TriMet import, same-attempt recovery, actual-expiry replacement with a fresh journal root and terminal recovery of the original journal. No leases are edited. Processing does not adopt either version.

[Installation reconstruction](INSTALLATION_RESTORE.md) compares the complete selected database and private Storage, configuration and both worker roots, then starts fresh local services against the reconstructed database. Native password grants and all ten archive reads pass. A fresh installed CLI completes the restored queued ZIP once without adoption or changes to pre-existing versions/claims. Positive and targeted broken controls pass their stated expectations. The failed first permission comparison remains preserved.

These are same-cluster proofs with existing roles and unchanged logical origin. Browser cookie recovery and project-geography/service-coverage navigation remain unfinished. Active planner cancellation and uncertain admission, current dashboard-main integration, full current checks, GitHub CI and release remain open. An owned Next development child exhausted its 2 GiB heap during model navigation; its evidence is retained and a serial production build is next. All migrations remain candidates. Older remaining-work paragraphs are historical checkpoints.

## Dashboard main joined and operator procedure, October 10

The candidate joins main `f6765e3e0b0e`, including the dashboard overhaul, without conflicts. [The serial integration checks](dashboard-join-tests.json) pass 1,956 tests across 86 files, with 17 live cases skipped and no failures. Scoped TypeScript, strict selected-file lint and both owned control suites pass. [Service-equity controls](dashboard-join-equity-controls.json) and [retained planner controls](dashboard-join-client-controls.json) preserve their positive and intended broken outcomes. The 1 GiB, swap-disabled service peaks at 727.5 MiB. The restored source hashes match the checkout.

The [operator procedure](../../../openplan/docs/ops/GTFS_MANAGED_INGESTION.md) documents the opt-in configuration, shared private root, installed command, exit meanings, cancellation reconciliation and pinned-parser recovery boundary. The command's actual `--help` invocation succeeds from the nested package without database configuration. These documentation edits do not establish commissioning or release acceptance. Production build, remaining T3 journey, current full checks, GitHub CI and release remain open.

## Production restoration journey and public-schema audit, October 10

[The production T3 continuation](BROWSER_JOURNEY.md) identifies source `9e7918dd6cc0` and the exact build. Retained owner cookies reach restored reviews and replay a historical adoption without replacing the current version. Actual project/model navigation carries the saved Oakland geometry into the coverage POST. Browser and native serialized geometry hashes match. Desktop and 390px captures remain readable within their viewport widths. The draft keeps zero model runs and its scientific caveats. These same-cluster observations do not establish cross-host recovery, measured service or practitioner acceptance.

Full lint and deadcode pass. Two full-suite processes reach distinct memory limits before a complete result. The first bounded batch exposes the public-schema grant audit defect. [Its correction](GRANT_SCHEMA.md) passes 39 focused tests, scoped TypeScript, strict lint and baseline, harmless, restored and targeted broken controls. Selected native privileges confirm public reads and private denials independently. Full serial batches are next. Active planner cancellation, uncertain admission, final CI, integration and release remain open. Candidate migrations stay unreleased.

## Full CI failure correction, October 10

[The full GitHub QA result](CI_FOLLOW_ON.md) records eleven failures at `9e7918dd6cc0`. Seven follow the grant inventory schema bug. The remaining failures identify a duplicate comment stripper, copy-baseline increases and missing candidate migration names. Each receives a bounded correction. The shared copy baseline stays unchanged, and Unreleased names migrations 28 through 31 without claiming delivery. Twelve focused files pass all 119 tests, strict lint and scoped TypeScript pass, and both existing planner/equity mutation suites preserve their expected outcomes after the UI wording and helper changes. All source/test hashes match. The resource-bounded unit peaks at 764.3 MiB.

The previous production captures remain evidence for their identified source. The updated labels require a new build/read. Full local batches, current GitHub CI, active planner cancellation, uncertain admission, integration and release remain pending. The remote main migration tree still equals the released checkpoint's tracked migration tree; that does not relabel an older proof database as current main.
