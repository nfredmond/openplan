# Execution queue release checks

Candidate status, October 7, 2026 Pacific time. No release tag is declared here.
Application implementation is 0270e9cb. Documentation checkpoint b3dc59d1 adds
operator instructions and independent-root recovery evidence without changing
the application build. The full V1 contract and remaining roadmap stay open.

## Completed checks

- Product direction check passes with dated registry/review reminders preserved.
- Full application lint exits 0 at implementation 0270e9cb.
- Dead-code checking exits 0 with unused-export/type and duplicate-export
  findings. This is not a claim that those findings are resolved.
- The identified production build, targeted test and mutation results, native
  queue checks, desktop/390px browser journeys and private artifact custody are
  retained in [the design and acceptance record](DESIGN.md).
- Independent-root recovery refuses another native claim for the interrupted
  allowance. One provider request, one attempt, one dispatch and zero outputs
  remain. See [the measured result](independent-root-acceptance.json).

The earlier integration merge 4d6ef970 has passing CI, worker, populated-upgrade
and live-RLS GitHub checks. Its live-RLS run 37704168902 completes successfully.
Those checks cover that merge, not this subsequent execution queue candidate.

## Running and remaining validation

The full unit suite runs with one worker under the owned service
`openplan-synthesis-queue-full-tests-61833bb3.service`. Its memory ceiling is
8 GiB, swap allowance is zero and CPU quota is 150 percent. The private log is
`/home/nathaniel/.local/state/openplan/synthesis-queue-acceptance-20261007/full-tests-61833bb3.log`.
The service starts against unchanged application code from 0270e9cb. Its result
is pending; a running process is not a passing check.

Shuffled-order, provider-connector, dependency, complete isolated live-RLS,
applicable worker and release checks remain pending. Version, changelog and
migration alignment, candidate GitHub CI, main integration and release tagging
also remain pending. Source changes require reassessing the affected evidence.

The browser does not yet show the detailed worker task-byte refusal. Host-loss,
boot supervision, capacity, provider interpretation quality and observed human
usefulness are not established by these local synthetic checks. These limits
must remain visible in any release claim.

## First candidate CI findings and correction

PR [139](https://github.com/nfredmond/openplan/pull/139) tracks this candidate.
The first QA and shuffled-order GitHub runs each report 1,504 passing files,
94 skipped files and two failing files. They have the same failures: the global
column-name guard treats the queue's `command_text` and `command_sha256` reads
as readers of ten unrelated land-use columns, and the new runbook names
`OPENPLAN_AI_LOCAL_ENDPOINTS` without an example configuration entry.

The correction preserves all ten custody explanations in a separate name-collision
catalog. Its guard checks that each column exists and its name occurs in application
source; it does not establish a table-specific application reader. The unchanged
unread-column guard still checks unexplained columns and stale entries. The example
configuration documents the opt-in local endpoint array and separate worker setup.
No production application code changes in this correction.

The two focused files pass all 12 tests. A harmless comment mutation retains that
result. A nonexistent collision-column mutation fails exactly the new catalog
check, with the missing column named. Both mutations are restored. This proves
catalog-check sensitivity, not database query behavior or complete column usage.
The earlier full local run remains live and already recorded the original column
failure before the correction. Its eventual result is not evidence for the corrected
checkpoint; focused checks and subsequent CI must cover the new test/configuration.

The candidate populated upgrade from v0.67.0 passes in GitHub run 37708748266.
Focused worker and Python checks pass. The first candidate live-RLS and restore
runs remain in progress at this checkpoint. No merge or release tag is declared.

[The staff response and export record](STAFF_RESPONSE_ACCEPTANCE.md) retains the
new queued-proposal handoff and public/private export checks, together with the
unresolved browser errors and mobile findings.
