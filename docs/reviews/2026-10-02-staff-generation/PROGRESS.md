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
