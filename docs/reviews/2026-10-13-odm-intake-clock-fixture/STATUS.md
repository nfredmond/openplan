# Measure the intake's actual shared deadline

Combined PR263 at `7a3bdcd` fails aerial CI38336901415. Its URL-intake positive
control reports `test_shared_deadline_clamps_nested_fetch_deadline`. That test
starts its reference clock before acquiring runtime ownership and starting the
original job. It then compares the nested deadline with that reference plus the
intake timeout and 5 ms. The CI assertion fails by about 2.63 ms. Its trace gives
no per-operation startup timing.

A controlled 20 ms delay before the resume helper reproduces the old assertion
failure while production still clamps the nested deadline. The test now records
the actual first deadline received by the intake's real `_check`. That observation
calls the original check unchanged. The existing delayed source constructor and
0.1-second injected nested extension remain. Fetch deadlines must not exceed the
recorded root deadline, with no tolerance. Production code, deadlines and limits
are unchanged.

Both Python 3.14 and 3.11 pass seven checks: five baseline, harmless, delayed-startup,
restored and complete-suite controls survive. Removing the actual production
clamp fails the exact nested-deadline assertion. Removing the observation fails
its required-measurement assertion. Eight failure-oracle controls pass. All 39
intake cases pass and all source bytes restore. Both owned 256 MiB units stop,
with their measured resource limits and events retained in the evidence folder.

The [complete aerial replay](evidence/workflow-results.json) passes all 31 actual
YAML blocks, including the unchanged inherited URL-intake controller. All 565
cases in 22 unittest suites, seven scenario programs and 20 documentation tests
pass. Product direction passes with its existing reminders. Worker bindings
restore exactly. The owned 1 GiB unit stops after 330.23 seconds with a 927,526,912-byte
peak, zero max/OOM events and no extra swap. Current-head GitHub checks remain
separate before landing. This fixture observes
supplied input preparation, not live actor access, public source transport or
processing. It proves neither operational capacity nor scientific/practitioner
acceptance. The preceding CI failure and controlled old-test failure remain
failed evidence. No production budget is widened, and no hosted write, migration,
worker activation or release is introduced. Full M3/v1 remain open.
