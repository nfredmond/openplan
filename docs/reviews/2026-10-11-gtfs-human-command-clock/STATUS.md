# GTFS human-command deadline test repair

The acknowledgement test now checks the configured RPC deadline with a controlled
clock. Production code, deadlines, command identity and receipt handling do not
change. This is an isolated test repair on PR 204, not a release or cutover check.

## Failure and change

CI run `38163171762`, job `114540168331`, tested head
`c1c6a22be82a146acae8ea32ac34d09fa29e8a12` with shuffle seed `672435`.
The human-command test failed because elapsed wall time was 198 milliseconds,
above its 150-millisecond assertion. That elapsed value includes real filesystem
work and scheduling. The run remains failed. Earlier passing CI at `ea65534b`
does not establish acceptance of this later head.

The replacement retains the real private journal and lock. A deliberately
uncooperative mocked transport waits for explicit release. The test confirms
dispatch, checks that the transport signal is active at 19 milliseconds and
aborted at the configured 20 milliseconds, then checks that the command rejects
without releasing the transport. Real asynchronous lock cleanup has a separate
two-second diagnostic bound. That bound is not an RPC performance claim.

The saved command remains exact and its receipt remains null before and after
the late mocked response. Finally releases the test transport, awaits cleanup
and restores real timers. Only timeout timers are controlled; filesystem work
and the installed PostgREST client remain real code. The transport itself
is a mock, not an HTTP connection.

## Local evidence

The focused suite passes 36 tests. Changed-file lint and scoped TypeScript pass.
[The controls](evidence/controls.json) retain three successful full-suite runs
(baseline, harmless comment and restored source) and eight intended failures:

| Broken behavior | Intended failure |
| --- | --- |
| Deadline fires at 19 milliseconds | Signal must remain active at 19 |
| Deadline fires at 21 milliseconds | Signal must abort at 20 |
| Configured deadline replaced by 10 seconds | Signal must abort at 20 |
| Await transport instead of racing cancellation | Command still waits for transport |
| Do not pass the abort signal to the client | Transport signal is missing |
| Wrong timeout reason | Acknowledgement-unavailable reason differs |
| String timeout reason | Reason is not an Error |
| Save a receipt while the result is unconfirmed | Saved receipt must remain null |

The control runner restores the exact production source in finally and records
source and test hashes. It runs serially in a 512 MiB service with no extra swap,
one CPU and 128 tasks. Final controls take 17.625 seconds of wall time and peak at
185 MiB according to the Linux journal. The successful focused service peaks at
171.6 MiB; the static service peaks at 339.9 MiB.

The GTFS shuffled regression passes all 56 files: 1,431 tests pass and 17 live-database
tests skip. It uses CI seed `672435`, one Vitest worker, a 1 GiB memory limit
and no extra swap. The service takes 57.760 seconds of wall time and peaks at
488.1 MiB. Skipped live-database checks are not acceptance.

## Retained failures and limits

The first clock trial assumed the whole command settled immediately when its
RPC deadline fired. It failed because lock release is asynchronous. The revised
test checks the signal at the deadline and command settlement independently.
The first mutation runner rejected the correct receipt-diff failure because its
expected text omitted JSON quotation marks. The runner was corrected and all
controls rerun. Both failed producers remain retained. Neither is a passing run.

Private proof is under
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/human-command-clock-20261011/`.
The original CI log is retained separately in that proof base. Public
[limits](evidence/limits.json) identify the failed trials and blind categories.

These checks do not measure real scheduling latency, establish live SQL or HTTP
custody, prove public DNS/TLS, establish browser or planner acceptance, or close
worker deployment and hosted cutover. Current-head GitHub CI remains a separate
check. The relaunch owner retains hosted coordination and the main merge hold.
