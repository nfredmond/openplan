# Original aerial HTTP receipts survive stopped-root restoration

This isolated M3/M5b.2 candidate connects the private admission journal to the
actual HTTP worker through an opt-in mode. Original accepted receipts, payload
identity and pending insertion order survive process interruption and stopped-root
restoration. Started work stays held when the worker lacks a retained reported
engine-terminal observation. The [design](DESIGN.md) defines this boundary.

Default operation and public request/callback schemas remain unchanged. The new
mode requires an explicit installation ID and a private work root. Its immutable
seal records configured identity, with authority unassessed. It refuses a missing
original seal, database or initialized schema rather than creating a replacement
registry. SQLite opens an existing database with `mode=rw`, including when a file
disappears between validation and opening. No deployed configuration, migration
or hosted service changes. Main merges remain held until the coordinator records
a dated lift after the technical handoff, separate Opus review and resolved blockers.

## Controls cover admission, ownership and missing original records

All 30 new tests and [49 source controls](evidence/source-controls.json) pass.
Four baseline/harmless/restored runs survive; 45 targeted variants fail. Forty-four
expose broken behavior. One exposes the exact diagnostic backstop when installation
validation moves after database access. It does not prove unsafe acceptance after
removing the early guard. Every new test appears in the control census. Mutation
edits restore in `finally`, with bytecode disabled. [Source bindings](evidence/source-bindings.json)
identify the current tested files.

Actual local HTTP tests cover both contract shapes, authorization before admission,
validation before journal access, exact replay before capacity, changed-payload
conflicts, unavailable journals, pending counts and opt-in main/worker wiring.
Controlled pipelines cover original insertion order, durable start before execution,
one lifetime root owner, concurrent-call exclusion and terminal publication.
Local failure without a reported engine-terminal observation still holds the queue.
Terminal records retain original request/start context and leave source, engine
and callback custody unassessed.

Private trials remain retained. An early mutation disabled journal initialization
as well as the population guard, causing setup failure before the intended probe.
The harness rejected that diagnostic. Initialization now precedes the population
check, and the final targeted control reaches the intended assertion. No guard
was weakened. The first evidence publication attempted to stop an already unloaded
owned unit; publication now preserves its recorded metrics and verifies zero active
PID before skipping that redundant stop.

These controls do not attest installation identity, original actor authority,
source permission, imagery decoding, engine custody or callback delivery. Cooperative
writers and completed synchronization calls remain assumptions. Small fixtures
do not establish maximum-job capacity or physical power-loss recovery.

## A fresh actual worker preserves queued work and holds interrupted intake

The [native driver](native_recovery.py) starts the actual worker in an owned child.
One HTTP request starts intake at a held synthetic source. A second receives HTTP
202 and remains queued. Exact repeats return HTTP 200 with the original receipt
bytes; changed payloads under the same ID return HTTP 409. The child stops before
any imagery body or NodeODM request.

The actual stopped-root snapshot CLI captures and verifies the root and its SQLite
journal. A fresh copied worker returns both original receipts, preserves one queued
request and holds the original start. The source receives no second GET. Separate
copied roots refuse startup when their original journal or installation seal is
moved aside. Those fixture files restore in `finally`; protected source/package
bytes and full logical SQLite schema/rows remain unchanged.

All [30 observations](evidence/native-observed.json) and [93 controls](evidence/native-controls.json)
pass. Three harmless variants survive; 90 wrong, missing or wrong-type variants
fail. The proof takes 1.228 seconds. [Source bindings](evidence/native-source-bindings.json)
remain unchanged. All four owned child processes and the synthetic listener stop.
Zero imagery body bytes and zero engine requests are consumed. [The summary](evidence/native-summary.json)
marks full worker recovery false. Earlier native evidence predates the missing-record
guards and is retained privately as superseded, rather than reported as current.

## Existing controls and actual CI commands pass

The historical [journal controls](evidence/journal-controls.json), [retained-source controls](evidence/retained-source-controls.json)
and [engine controls](evidence/engine-controls.json) pass against the current code:
52 tests/57 controls, 42 tests/57 controls and 25 tests/44 controls respectively.
The existing ZIP stopped-root proof also passes with [22 observations](evidence/zip-native-observed.json)
and [69 controls](evidence/zip-native-controls.json). Historical evidence files stay
unchanged. All [15 aerial worker test scripts](evidence/odm-suites.json) pass serially.

[Five CI discovery/fail-fast controls](evidence/ci-discovery-controls.json) and
both [new actual YAML commands](evidence/actual-ci-steps.json) pass locally. GitHub
CI remains a separate check of the committed head. All [14 nested application
documentation tests](evidence/documentation-checks.json) and the [direction check](evidence/documentation-results.json)
pass. Existing direction reminders remain visible.

[Resource records](evidence/resources.json) preserve passing and failed invocations.
Combined checks peak at 68,718,592 bytes and actual CI commands at 64,151,552 bytes,
each under 256 MiB, one CPU and no extra swap. Final native recovery peaks at
39,940,096 bytes. Application documentation peaks at 273,162,240 bytes under 1 GiB. Every recorded owned service has zero active PID and is stopped.

Next connect retained exact source intake and original engine stages to the runtime.
Original actor/live authority, URL cancellation, commit/results, usable artifact
links, callback custody and independent full restoration remain open. The legacy
pipeline still lacks these boundaries. No requirement grade, scientific claim,
browser evidence, practitioner acceptance or full-v1 acceptance changes.


## Later native harness readiness correction

The [dated readiness report](../2026-10-11-odm-native-readiness-race/STATUS.md)
records the distinct GitHub partial-listener failure and atomic publication fix.
Deterministically paused native writers pass; direct partial publication fails
at the observed JSON read. Current 30-observation/93-control native bindings
supplement the historical records above. The actual worker implementation does
not change.
