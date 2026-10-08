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
