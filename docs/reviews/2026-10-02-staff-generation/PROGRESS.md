# Staff generation continuation

October 2, 2026. Isolated work from c64d87a8 while PR114 remains under CI.
This checkpoint adds authenticated request read/create/cancel adapters over the
existing native commands. Exact intent bytes and cancellation receipts remain
verified. A saved request does not authorize preparation, provider dispatch,
charges, interpretation, approval or publication.

The restored adapter passes 38 mocked transport tests and strict lint. A harmless
comment control survives; 29 targeted faults fail with assertion evidence in
[the mutation record](request-adapter-mutations.json). The first test run has one
incorrect error-message pattern, corrected without changing the verifier.

Repeated client crashes interrupt the TypeScript observation. Its log is empty
and the earlier process handle is missing, so no completed type-check result is
claimed. The two source files survive and the adapter hash matches the restored
mutation source. Heavy local checks remain stopped at this checkpoint.

Next connect HTTP authentication, origin and stale-account protection, exact
request recovery and explicit refusal of unregistered agent writes. Then connect
durable worker preparation/status and separate plan execution authorization,
followed by the dependent context/thematic stages and existing proposal import.
No new HTTP route, worker pickup, browser control or migration exists here yet.
Native RLS, actual HTTP recovery, browser usability, installed CLI provider choice,
large-history capacity and semantic quality require separate evidence. The full
v1 contract and roadmap remain unchanged.

## Authenticated request HTTP entry point

The new synthesis/generation GET and POST handlers read, create and cancel exact
requests through the authenticated client. Actor and workspace come from current
access checks. Both expected-account headers are required. Writes require same
origin, a streamed 24 KiB body limit and strict commands, and refuse every marked
unregistered Planner Agent execution. Responses remain private and uncached.
Audit records omit intent text, cancellation reasons and native error messages.
No handler prepares a plan or dispatches a provider.

The route and adapter pass 72 tests with one worker. Strict lint passes. The
[route mutation record](request-route-mutations.json) contains a surviving harmless
control and 22 detected faults. Explicit malformed UTF-8 inside an otherwise
valid JSON command exercises fatal decoding; a standalone invalid byte alone
would also fail JSON parsing and would not distinguish that behavior.

The interrupted whole-package TypeScript check is repeated in a user service
with an 8 GiB memory ceiling, zero swap and two-core CPU quota. Its first result
finds a test header union that permits undefined values; the test now declares
a string-record generic. The corrected check exits 0, peaks at 1.7 GiB and uses
no swap. [Check records](request-route-checks.json) retain both logs.

This checkpoint has no browser controls or queue pickup yet. Native access,
request cancellation before creation, lost HTTP acknowledgements and stale
identity recovery still need an installed-stack journey through these handlers.
Continue durable preparation and explicit execution authorization before
claiming a usable staff generation workflow.


## Installed request HTTP recovery

The identified 522fcca7 server passes 18 checks through actual HTTP and the owned
isolated database. [The native record](request-native-http.json) preserves each
result and hashes the local script and logs. Exact creation recovers after a
discarded acknowledgement; altered original bytes fail. Cancellation replays,
precedes creation and prevents a late creation. Foreign account/workspace,
anonymous, cross-origin and unregistered agent requests fail. Neither synthetic
request produces a plan or execution authorization.

The owned server stops successfully after this journey. Its memory peak is 1 GiB,
with no swap use; port 3478 has no remaining listener. This closes the earlier
HTTP-check boundary, not queue preparation, browser usability, provider execution,
role-transition coverage, semantic accuracy or large-consultation capacity.
The full workflow remains unfinished.


## Preparation interruption correction

Investigation before queue pickup finds that segment preparation does not pass a
stop signal to its database calls. It also accepts a late cancelled or sealed
response after a worker stop. Context and thematic preparation already forward
signals and check after responses.

Segment preparation now forwards the worker signal and a fresh ten-second deadline
to each call. It checks the combined signal before accepting an acknowledgement,
including the final seal. Unknown outcomes still stop the invocation. A later
invocation reconstructs the same plan and recovers its retained prefix or seal.
No automatic write retry or new execution authority is added.

Eleven focused tests pass. A harmless control survives and five deliberate faults
fail: omitted transport signal, wrong deadline, omitted worker signal, late
acknowledgement acceptance and omitted stop checks. The installed SQL bridge also
passes its three existing source/batch/recovery cases, including the harmless and
large-packet controls. Sending a task start one position ahead produces the native
out-of-sequence failure. All source mutations are restored. Fifty other native
cases are excluded by this focused filter; no full native gate is claimed here.

Strict lint and whole-package TypeScript pass. The type check uses an 8 GiB memory
ceiling, zero swap and two-core CPU quota, peaks at 4.8 GiB and exits successfully.
The native checks peak at 610.3 MiB and use no swap. The first unit invocation uses
an unsupported minWorkers option and exits before running tests; the corrected
one-worker invocation supplies the actual evidence. The
[check record](preparation-interruption-checks.json) retains controls, fault
results, source and log hashes, resource measurements and blind categories.

These tests establish signal forwarding and refusal of late responses. The SQL
bridge does not exercise an interrupted HTTP socket. Queue ownership/status,
worker pickup, user controls and provider execution remain unfinished.

## Next preparation connection

Existing generation/context/thematic staging helpers retain and verify exact
prefixes. The CLI currently requires an execution authorization and provides no
preparation queue. Reuse those helpers and the execution scheduler. Preserve the
separate plan review and provider authorization step.

The existing contract-calculation queue supplies a lease-token, renewal and
requester-only retry pattern. Its contract-specific source and completion rules
do not fit synthesis directly. Work-program exports run through document jobs;
translation fields couple leases to generation reservations and spending. Neither
is a substitute for synthesis preparation and its distinct stage identities.

The next bounded change should retain an explicit preparation enqueue command,
with authenticated status/retry, service-only leases and stale-token refusal.
Do not discover all historical requests as implicitly queued work. Reconstruct
saved sources, distinguish segment/context/thematic requests, and let existing
native staging commands recheck current requester authority. Keep durable failure
and retry status so one invalid request cannot starve others. Preserve cancellation
and original receipts; a sealed preparation plan still needs separate provider
execution approval. This is implementation guidance under M9b, not a new roadmap.


## Explicit preparation queue and worker leases

Migration 20261015000012 adds private preparation jobs and immutable claim
attempts. Authenticated staff can inspect a scoped request. Only its original
requester can enqueue it or retry its failed attempt. Enqueue binds the retained
intent hash and actual segment, context or thematic stage. Historical requests
remain unqueued until an explicit command arrives.

Service-only claims retain a token and attempt number. The same token recovers
its original claim without reviving an expired or superseded lease. A fresh token
can reclaim an expired job. Renewal and completion require the current unexpired
lease and current requester access. Cancellation blocks fresh preparation.
Completion binds the exact existing native plan seal; preparation creates no
provider authorization. Exact completion replay preserves the original result
after later cancellation. Retry names the observed attempt, so a late old retry
cannot restart a newer failure. Revoked queued requests become visibly failed,
including before their first claim, and restored requesters can retry them.

The CLI creates the migration file. Its filename then advances after the existing
unreleased October 15 sequence, so installation follows its dependencies. The
pending-migration comparison confirms only this migration before applying it to
the owned restore-target stack. No demo, shared checkout or hosted database changes.

Candidate tests pass 29 cases. The installed run passes those 29 plus five schema
drift checks. A further scope audit adds probes that first authorize one campaign
and then request another campaign's queued record, plus retry cancellation,
negative retry bounds, renewal tokens and obsolete completion while queued.
The final installed queue suite passes 34 cases: baseline, harmless control and
32 detected native faults. All fixture writes and faults roll back. This is a
focused native suite, not the full isolation gate.

An actual Supabase HTTP journey passes ten checks. Two simultaneous worker claims
produce exactly one active first attempt. Claim replay preserves its token and
number; renewal retains its identity. The existing TypeScript driver prepares
the full saved synthetic source through native batches. Completion and replay
retain the same seal, staff status omits worker tokens, later cancellation leaves
that completion recoverable, and no provider authorization exists for the request.
The synthetic request remains as cancelled test evidence; original sources and
prior requests remain unchanged.

The first fixture expects PT409 from the existing immutable-history trigger,
which actually returns P0001. The expectation is corrected without changing that
trigger. The schema checks initially flag the two added relations and three SQL
read columns. Native catalog verification and explicit SQL-use explanations bring
them into agreement: 279 application tables have RLS, and 14 application views
remain. All 34 schema/accounting tests pass. Strict lint and whole-package
TypeScript pass. The final native suite peaks at 445.3 MiB; TypeScript peaks at
1.8 GiB. Both use zero swap under the existing resource limits.

The local security advisor reports nine findings in existing objects and none in
new preparation objects. Five existing functions lack fixed search paths;
spatial_ref_sys lacks RLS, and three extensions are in public. Their names and
levels remain in the [check record](preparation-queue-checks.json). They are not
silently marked fixed or dismissed as proof of database security.

Next add typed staff status/enqueue/retry adapters and the preparation worker's
candidate selection, heartbeat and restart recovery. Reuse each stage's original
input reconstruction and staging. Then connect browser controls and explicit
provider execution authority. No unattended worker pickup or usable staff
preparation workflow is claimed by this database checkpoint. Full QA, combined
main integration and identified browser acceptance remain later checks.

## Typed preparation status and commands

The staff adapter reads an existing unqueued request as null. Enqueue binds the
original requester, stage and exact intent hash. A lost acknowledgement can
recover later progress, including preparation followed by cancellation. Retry
names the observed attempt and accepts a newer native state without assuming
that it restarted work. Staff output rejects worker tokens, foreign scope,
contradictory status fields and malformed native values. Every call carries the
caller signal and a ten-second deadline, with a post-response abort check.
No command grants execution or spending authority.

All 50 adapter tests pass; the combined request/preparation suite passes88.
A harmless comment edit survives and28 targeted faults fail assertions. Source
is restored afterward. Changed-file lint and whole-package TypeScript pass.
The first test invocation runs from the repository root and fails alias
resolution before tests run. The corrected invocation uses the app package;
the failed log remains. The final test edit replaces a narrow fixture cast
with the exported state type without changing assertions.

Nine native HTTP checks pass on the owned restore-target stack. They exercise
unqueued state, exact enqueue/replay, native intent/stage and campaign refusals,
failed status without worker tokens, retry and cancellation. After a second
worker attempt fails, retrying attempt1 returns that newer failure without
requeueing it. Cancellation blocks a fresh retry. The synthetic request
938af83d-834f-432c-b54d-ceb225a4567e remains cancelled as evidence, with no
provider authorization. Original source and proposal requests remain unchanged.
See [the check record](preparation-adapter-checks.json).

These adapters still need an authenticated HTTP route and preparation-worker
candidate discovery, heartbeat and restart orchestration. Mocked deadline
checks do not prove in-flight socket cancellation. The native HTTP journey
proves the exercised database path, not browser usability, provider accuracy
or complete M9b/v1 readiness.

## Authenticated preparation HTTP route

The preparation route reads status or accepts an explicit enqueue/retry command.
It requires current staff campaign access and exact expected account/workspace
headers. Native commands retain original-requester authorization. Enqueue binds
stage and intent hash; retry names the observed attempt. An old retry may return
a newer failed state without restarting it. An unqueued request reads as null.

The route bounds streamed bytes, rejects malformed or forged input, requires
same-origin writes and refuses unregistered assistant markers. It uses the
authenticated client and returns private, uncached responses. Audit entries
carry operation, request ID and status without command contents. The handler
does not run a worker, create provider authorization or dispatch a provider.

All 38 route tests pass; the combined request/preparation suite passes160 tests
in four files. A harmless edit survives and22 targeted defects fail assertions.
The malformed-byte fault drops invalid bytes to turn an invalid stage into a
valid one; ordinary replacement decoding also fails the strict stage schema.
Strict lint and whole-package TypeScript pass, with1.8GiB peak memory and zero
swap for TypeScript. See [the check record](preparation-route-checks.json).

The tests execute real Next handlers and adapters over mocked RPC. Native HTTP
acceptance remains pending at this checkpoint. Worker pickup, heartbeat/restart,
browser controls, provider authorization and full integration remain open.

## Preparation route native HTTP acceptance

An identified development server serves9d9e50ae from this staff checkout on3478
against the owned restore-target database. All20 actual HTTP/native checks pass.
They cover unqueued/queued/failed states, lost enqueue and retry acknowledgements,
changed intent/stage refusals, cancellation and later enqueue replay. Replaying
attempt1 after attempt2 fails leaves the newer failure and update time unchanged.
Changed account/workspace headers, anonymous access, assistant markers and
cross-origin writes are refused.

The synthetic request remains cancelled. No generation plan or provider
authorization is created. Original sources and proposal requests remain intact.
See [the native HTTP record](preparation-route-native-http.json) for the request
ID and source identity. The owned server stops after acceptance. These checks
exercise actual HTTP and database boundaries, but do not establish production
build behavior, browser usability, worker pickup or provider quality.

## Preparation worker lease and interruption recovery

The worker runner claims one explicit request and token. It verifies the native
claim and returns without work for an unavailable or superseded claim. While a
stage prepares its original inputs, the runner renews the native lease every
30 seconds. Failed or inconsistent renewal aborts the stage signal. Completion
waits for renewal already in flight, then binds the exact original attempt and
plan seal or explicit failure. An exception or interruption remains unconfirmed;
it does not become a fabricated preparation failure or an execution grant.

All 39 worker tests pass; the combined worker/route/adapter suite passes 127 tests.
Strict lint and whole-package TypeScript pass. The first test-file write uses a
wrong relative path; the next test run exposes a Node timer mock missing its
default export. Neither runs tests. Correcting those setup errors leaves the
product behavior unchanged. Initial mutation testing finds that an active future
claim is rejected by a second guard. Adding an inactive future-claim case makes
the first guard observable. The original survivor remains in the check record.
A harmless control survives and all 30 targeted faults fail after that correction.

The live segment journey passes eight checks against the owned restore-target.
It interrupts after retaining the plan but before acknowledging queue completion.
The same token resumes attempt1, recovers the original seal, renews the actual
lease after 30 seconds, and completes. Exact completion remains recoverable after
later cancellation. A second request is cancelled during preparation; the actual
renewal refusal aborts its stage and prevents restart. Neither request creates
provider authorization. Both requests remain cancelled as synthetic evidence.

A deliberate live fault delays heartbeat to 60 seconds. The 31-second native
observation fails with "Heartbeat did not extend the native lease". The source
is restored by exact hash, that fault request is cancelled, and the restored
39-test suite passes. See [the check record](preparation-worker-checks.json).

The runner still needs automatic candidate discovery, a durable claim-token
journal, stage-specific reconstruction and an installed worker command. Native
segment evidence does not establish context/thematic worker orchestration.
Stage callbacks must cooperate with cancellation; the event loop cannot renew
a lease during blocking synchronous work. Provider execution and staff-facing
controls remain separate unfinished steps. No full-QA, capacity, semantic-quality
or complete M9b/v1 claim follows from these focused checks.


## Explicit preparation queue discovery

The worker now reads bounded pages from the explicit preparation queue. It
selects queued jobs and running jobs whose leases appear expired, orders by
request ID and returns a continuation after every nonempty page. A short page
is not the end of the queue. Discovery grants no authority; native claim still
checks its own clock, current requester access and cancellation. Malformed,
unordered, oversized, failed or late reads remain errors rather than empty work.

All 26 discovery tests and 153 combined preparation tests pass. Strict lint and
whole-package TypeScript pass. Mutation testing first exposes a test-fixture
error: parameterized row arrays are unpacked instead of delivered as complete
pages, so an ordering fault survives. Wrapping each page fixes that test boundary.
The initial failure remains in [the check record](preparation-candidates-checks.json).
After correction, a harmless control survives and 19 targeted faults fail.

Five native checks pass on the owned restore-target. Explicit queued work is
found; unqueued, failed, cancelled and actively leased work stays outside the
scan. Reducing each outgoing HTTP page to one row still reaches the same full
inventory. Advancing the discovery clock does not override a native active
lease. After actual expiry, discovery returns the job and native reclaim starts
attempt2. No execution authorization is created. A deliberate short-page fault
fails the real inventory comparison. Source bytes are restored, all synthetic
requests are cancelled, and the final combined tests pass.

The caller still needs a durable token/outcome journal, stage reconstruction and
an installed worker command. Queue scans are not immutable snapshots; changed
jobs may be visited on the next pass. These checks do not establish campaign
capacity, semantic quality, browser usability, full QA or complete M9b/v1 status.


## Durable preparation attempts

Each private attempt directory now persists its claim token before contacting
the database. It persists the original lease and exact outcome before finishing.
Unknown replies retain those records. Restart reclaims the same token or resends
the saved completion without repeating preparation. An acknowledged directory
records a past receipt; it does not claim current queue status. Terminal records
remain intact, and later work must use another directory. Existing private-file,
atomic fsync/rename and operating-system lock helpers enforce local custody.
Preparation receives a copy of the lease so it cannot change retained identity.

All 36 journal tests and 189 combined preparation tests pass. Strict lint and
whole-package TypeScript pass. A harmless mutation survives and 17 targeted
faults fail. The first outcome-validation fault survives because completion
already rejects the bad value. Adding an acknowledged-journal case tests the
separate offline receipt path. A lease-copy fault initially throws the intended
scope error; the test now asserts successful completion directly so mutation
results distinguish assertion failures. The earlier results remain in
[the check record](preparation-journal-checks.json). Interruption fences are
checked as a group, without claiming each redundant fence is independent.

Five native checks pass in separate child processes on the owned restore-target.
A completion commits while its reply is deliberately lost; a fresh child resends
the original outcome after cancellation without preparing again. Rereading the
acknowledged record uses no network. A second child exits immediately after the
database accepts its claim. Its operating-system lock releases, and a replacement
child completes the same token and attempt1. Neither request creates execution
authorization. Removing outcome persistence makes the actual lost-reply check
fail. Exact source bytes are restored and all synthetic requests are cancelled.

This tests process interruption, not hardware power loss or a host reboot. A
superseded unconfirmed outcome remains retained even when replay is refused.
Queue coordination, original stage drivers, the installed command and staff
controls remain unfinished. Full QA, browser usability, campaign capacity,
semantic quality and complete M9b/v1 acceptance remain separate requirements.
