# Verification boundary

The checker passes eight scoped Vitest tests with zero skips. The command runs
from `openplan/` with `--pool=forks --maxWorkers=2`. The first invocation ran
from the repository root and failed because the test resolved its script path
there. That setup failure remains separate from the corrected passing run.
The local dependency directory links to the existing installation in the main
checkout; no dependency installation or build runs.

The new regression supplies 60,000 synthetic changed paths through a real child
process. The checker accepts output above Node's default buffer. A harmless
comment survives; restoring the 1 MiB buffer fails with `ENOBUFS`. Source bytes
are restored exactly. `npm run product:direction:check` passes, retaining the
existing advisory reminders and review dates. These tests cover Git-output
capacity and existing direction checks, not scientific admission or engine runs.

The full-arm controller passes three synthetic command/ordering/stop tests and
seven synthetic admission tests, with zero skips. Controller mutations contain
one harmless survivor and four intended assertion failures: memory cap, swap
cap, failed-stage stop and prefix/suffix order. Admission mutations contain one
harmless survivor and six intended assertion failures: reduced input hash,
frozen input hash, cache hash, proof status, receipt status and compared tables.
The admission controls compile isolated namespaces without changing the running
controller. Other controls restore source bytes exactly before execution.

This round totals 18 passing tests and 14 accepted mutation controls: three
harmless survivors and 11 intended failures. Mutation runs select the relevant
checks; they are not additional independent engine tests. The seven unselected
Vitest cases in each focused mutation run are intentionally skipped. No live
RLS, browser, hosted, Docker, build or whole-suite test runs in this task.

The native preflight rechecks the existing two 2,000-household exact-parity
comparisons against their retained references and candidate tables. It verifies
input and cache hashes without new subset model execution. Opaque hash checks
also verify all 117 original frozen records, using archive paths where moved,
and 26 unique installed engine, configuration and pandas files. These checks
establish retained-byte custody, not full-population parity or scientific
accuracy. No survey outcome field is read.

The full current prefix then fails at the 16 GiB cap during workplace
`work_high` logsum preparation. The controller's failure path executes natively:
no suffix or SEMCOG start receipt exists. Both final-CSV sets are empty. The
modeled-share report is skipped after the required stop. External cgroup counters
and the systemd journal corroborate one OOM kill and zero swap. The scope's
in-process terminal health receipt remains missing. All 50 private run files
pass a second length/hash check; all original frozen and installed-source hashes
pass after execution. This is a resource failure, not a scientific comparison.
