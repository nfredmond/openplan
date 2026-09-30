# Retained synthesis plans

September 30, 2026. This internal M9b increment adds resumable plan staging to
[private request custody](REQUESTS.md). It does not enable a generation interface
or declare a release. The published application remains v0.64.0.

## Plan identity and recovery

The planner rebuilds complete task input from the native request and authoritative
saved source. It binds the request's exact intent checksum to the versioned recipe,
task manifest, contribution count, task count, byte total and ordered task chain.
The version 1 recipe retains its original instructions and output schema as a
checked artifact. Runtime schema conversion no longer changes those saved bytes.
The output validator and task encoding remain version 1. A future recipe or
planning algorithm must preserve this version for existing requests.

Migration `20261014000034_engagement_synthesis_generation_plans.sql` adds immutable
private headers, task rows and completion receipts. Headers are at most 4096 bytes.
Staging packets contain at most 128 task strings and 4194304 UTF-8 bytes. These are
transport bounds, not a new source limit. Each task still obeys the request's
4096 to 1048576-byte limit. The full planner remains memory resident; staging does
not claim streaming source construction or tokenizer/HTTP-envelope fit.

A chain seed binds the request ID, original intent checksum, recipe checksum and
task manifest checksum. Each following hash binds the preceding hash, task index,
exact task checksum and byte count. Native staging accepts a contiguous batch or
an exact retained retry. It refuses changed bytes, a different prefix, gaps,
overlapping old/new batches and work beyond the declared inventory. A completion
receipt requires the expected count, total bytes and final chain. Stored task
strings remain exact, including Unicode and original JSON encoding.

The service-only commands load the retained requester and check current staff
membership and campaign scope. They never set or rely on a staff JWT claim.
Membership and campaign share locks fence concurrent changes. Planning and staff
cancellation use the same request advisory lock. Cancellation blocks new headers,
batches and seals. Exact existing acknowledgements remain recoverable while the
requester retains access. Lost access refuses planning and command recovery;
immutable originals remain stored. Tables have RLS with no client policies,
service SELECT only, and immutable update/delete triggers.

`retainSynthesisGenerationPlan` is the internal staging driver. It verifies every
returned header, cursor and completion receipt against a reconstructed plan. A
failed or unknown acknowledgement stops the invocation. A later invocation
prepares the same header and resumes from the verified saved prefix. A cancelled
or sealed request causes no further writes. An abort signal stops the driver
before its next command. No scheduler, browser handler or provider dispatcher
calls this driver yet.

## Evidence and corrections

[Checksums and results](plan-checks.json) bind the tested files and private logs.
[Mutation evidence](plan-mutations.json) retains the controls, targeted faults and
observed survivors.

The native candidate suite passed 49 checks. The installed run passed 55 checks,
including six existing trusted-search-path checks covering all five new functions.
The 49 native checks include 40 targeted failures, ordinary and harmless controls,
and a retained redundant-guard survivor. A separate connection holds the exact
request fence; unrelated requests proceed, while plan commands and cancellation
return the retryable busy refusal on that request. Removing the plan fence fails
the specific competing-read assertion. All fixtures and injected faults roll back.

The TypeScript/native join uses a real saved 303-contribution source and compares
every retained task byte with the reconstructed plan. A larger fixture inserts an
additional long contribution and captures a new source, producing 304 selected
contributions and tasks above the older translation worker's 200 KB packet limit.
It retains the full task sequence and original checksums. The actual staging
driver receives a simulated lost response after a native batch write, then resumes
at that saved index and reopens the same seal. This join keeps one outer rollback
transaction open; it is not a process-crash or database-power-loss experiment.

The recipe checks survive a harmless comment change and catch three faults:
runtime schema conversion, a shared mutable schema and a changed recipe identity.
A separate comparison against `867e4368` produces identical complete task and
manifest bytes at 4096, 65536 and 1048576-byte limits. The plan protocol catches
16 targeted faults after a harmless control. The driver catches 10 targeted
faults after its control, including ignored cancellation, unverified or stalled
cursors, lost completion receipts, wrong task packets and ignored interruption.

Observed survivors remain part of the evidence. Removing the native sequence
check alone still encounters the independent prefix check. The suite retains
that survivor and catches a combined fault. An oversized-packet fixture initially
also supplied an empty array, so it failed on the wrong condition; it now supplies
an otherwise valid oversized packet. An invalid-index assertion initially accepted
a downstream TypeError after validation was removed. It now requires the explicit
validation error and catches that mutation.

Earlier setup failures are retained in local logs. One invocation ran from the
repository root instead of the app package. The first sequence probe also supplied
a missing prefix. A lock fixture lacked the function definition's final SQL
separator. The first large-source setup tried to update a protected contribution;
it now inserts a separate synthetic contribution and captures a fresh source.
These were fixture/invocation corrections, not removed production protections.

The schema audit found nine new fields to account for. Seven have native SQL
readers. Task checksum and byte-count metadata await a provider worker reader and
are explicitly classified as unbuilt. Three relation counts and the changelog
migration entry also track the additive schema. A harmless control survives;
removing any of the nine field explanations, three counts or migration name
produces the relevant assertion failure. Those 13 faults do not prove runtime
access or user reachability.

## Remaining boundaries

Native sealing establishes custody of the worker-supplied expected inventory.
The database does not independently reproduce semantic extraction, task packing,
model interpretation or the Node manifest serialization. The trusted planner
reconstructs the complete source before staging; any future dispatcher must load
and verify the authorized sealed plan. A self-consistent caller-supplied hash is
not authority. A plan or seal grants no permission to spend or call a provider.
An empty selected contribution set must require no provider attempts, even when
its preparation plan retains campaign context.

The request schema still selects a saved compatible API revision. Future installed
Codex, Claude Code and OpenCode campaign execution needs an explicit additive
request/connector contract. It cannot invent an API revision or silently fall back
to another provider. Preparation does not claim that a selected API revision or
credential remains usable at dispatch time.

Next M9b work remains bounded dispatch authorization, worker lifecycle and exact
raw output retention, recovery from uncertain calls, complete record/context
consolidation, and an explicit machine-draft import into retained staff review.
Provider usefulness, final synthesis coverage, browser generation/retry flows and
practice acceptance are unproved. No new UI or scientific claim follows from this
increment. Manual source preparation and review remain available.

Full QA passed, including 16041 application tests, 382 provider connector tests,
dependency audit with zero vulnerabilities and the production build. The shuffled
run passed the same application tests with seed 552067. Both application runs
skipped 917 tests; the connector skipped four. Separate installed RLS passed 821
tests across 70 files, with 125 skipped. Type checking passed with a 6144 MB heap.
All five installed function bodies match the migration after the fault runs, and
the three new tables contain no leftover fixture rows. Frozen application hashes
still match the files tested. Exact source and log checksums are retained above.

Inspect GitHub CI, RLS and the populated upgrade workflow on the final pushed
commit before proceeding to the next implementation. This local record does not
assert a remote result. This increment does not tag a release or upgrade the demo.
