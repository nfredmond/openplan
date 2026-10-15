# Snapshot 01 review and corrections

The independent reviewer reads a frozen copy and runs no service or test. Snapshot 01 source hashes remain in the private proof packet.

| Finding | Trigger and consequence | Correction | Evidence status |
|---|---|---|---|
| P1, signal ownership | A stop signal during directory/journal startup reaches only the observer. The worker can later start with its stop flag false. | Remove observer signal listeners. Pass a notification callback into main, called by the existing worker handlers. | Source 05 passes four 20-case cohorts and 50 faults, including actual-body startup barriers and the fixture NODE_ENV correction. |
| P2, time/state consistency | The reader accepts future running facts and stale stopped facts that contradict SQL classification. Earlier positive fixtures also contradict SQL time rules. | Compare complete facts at PostgreSQL microsecond precision, including the exact two-minute boundary. Correct the fixtures. | Reader 03 passes four 18-case cohorts and 28 faults, including mixed-instance positives and both fresh latest-row count implications. |
| Caller budget | Three serial eight-second probes exceed the earlier checker timeout of 20 seconds. | Raise the checker deadline to 30 seconds and retain separate cancellation transports. | Checker 01 passes four 12-case cohorts and the restored20-second deadline fault fails as intended. |

These findings supersede any earlier implication that the first source/reader controls qualify the corrected source. The first corrected source campaign stopped at an obsolete mutation anchor; it restored target files and does not count as acceptance. Native SQL and HTTP controls qualify separate database/role/race boundaries, not process startup or current parser bytes.

Snapshot 02 independently confirms the startup and caller-budget corrections and identifies the same fresh latest-row count gap found during lead review. Snapshot 03 closes that remaining gap and reports no further concrete defect. These are static code reviews, with no services or tests run by the reviewer. The later child fixture adds NODE_ENV=test to satisfy the application ProcessEnv type; source 05 repeats the complete source campaign against those bytes.

Source 05 also removes an unused fixture binding caught by strict CI lint. No application code or assertion changes. The complete lifecycle campaign and strict local checks pass afterward; see CI_CORRECTION.md.
