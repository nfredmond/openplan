# Original running progress candidate, October 14

This explicit adapter retains the original dispatch and one running event before
source preparation. It connects to the existing original input, commit and
terminal coordinator. The default worker does not select this adapter.

The event reports preparation and recovery without a fabricated percentage.
The receiver must acknowledge `ok: true` and `status: running`. Ignored terminal
or superseded responses hold work. Missing or different status responses remain
pending. An uncertain reply retries the exact saved callback body and identity.
A saved terminal command takes precedence over running progress.

Historical acknowledgement prevents another event POST. It does not authorize
source or engine work. A cached acknowledgement requires current actor access
before the next pipeline stage. Historical refusal remains held. Local access
or preparation errors preserve validated original observations without another
engine read, terminal callback or queue outcome.

## Current checks

Four 36-case source cohorts pass on each of Python 3.14 and Python 3.11. All
32 intended faults fail at their named diagnostics. Dispatch regression controls
pass four 34-case cohorts and 44 intended faults on each interpreter. Both
campaigns preserve source and test bytes in `finally`.

Earlier trials expose redundant guards, changed method anchors and incorrect
expected diagnostics. Those trials do not count as passes. The current cached
reply tests use a delivery sentinel to distinguish the pipeline gate from the
underlying delivery cache. A command without attempts directly challenges the
historical command validator without a secondary intent hash guard.

Native copied-journal recovery on intended restored schema 415 passes four
four-case cohorts and two SQL faults after the temporary correction. It uses
actual PostgREST and supervised running/terminal callback and artifact sockets.
The callback fixture writes the ledger directly. Fresh input/engine dispatch and
the full application receiver remain unproved. Both 199-case related suites and
19 nested documentation/direction/release tests pass.

Read-only review confirms the three corrections. Earlier 34-case source and
native-01 records predate the temporary fix and stay historical.
Source checks use fixture authority and engine replies with actual loopback
input transfers. They do not establish application receiver-route acceptance.

## Remaining boundaries

Current configuration/adoption, default entry point, complete application
callback/Storage recovery, capacity and planner journeys remain open. Each
component has a finite deadline; this adapter does not establish a hard
whole-pipeline deadline. No hosted, public TLS, photogrammetry quality, map
placement, practitioner, independent-host or V1 acceptance follows.
