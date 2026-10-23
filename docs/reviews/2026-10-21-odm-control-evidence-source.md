# ODM control diagnostics, focused controls observed

October 21, 2026. This change preserves diagnostics for the maintained uncertain
commit control verifier. Root observes the focused seven-method suite and fourteen
fault controls below. Actual worker CI failure remains UNKNOWN. Earlier source-only
statements below describe the preserved R1 through R3 handoffs.

## Two failures remain separate

PR358 fails at `source-timeout-bool-normalized did not fail at its intended
assertion`. The retained CI log exposes the classifier assertion, without a raw
per-control artifact. The actual worker failure remains **UNKNOWN**.

The separate local isolated attempt stops at a 30-second baseline timeout. It
does not reach harmless or targeted controls. Its report does not reproduce or
explain the CI bool classification failure. This change preserves both findings
and makes no timing diagnosis.

The original private records remain at:

- `/home/nathaniel/.local/state/openplan/pr358-odm-ci-readback-20261021-01/failed.log`
- `/home/nathaniel/.local/state/openplan/pr358-odm-control-reproduction-20261021-01/RESULT.md`

## Authored behavior

The verifier retains each child's stdout and stderr separately. Byte streams
remain exact in `<label>-stdout-private.bin` and `<label>-stderr-private.bin`.
String streams use UTF-8 with surrogatepass; `None` produces an empty stream.
`<label>-private.log` identifies the label, timeout or return code, stream types,
and readable output. Invalid UTF-8 bytes use backslash escapes in that log.

A timeout re-raises the same exception. Evidence-write failures appear in its
notes. Each evidence write gets an independent attempt. Ordinary evidence-write
failures raise an exception group, including after a successful child. Existing
five-source restoration remains in the controller's `finally` blocks.

The subprocess argv, cwd, environment, capture settings and 30-second limit
remain unchanged. The classifier and its rules remain unchanged. So do the
21 tests, 21 targeted faults, four positive cohorts, and seven oracle variants
per mutant. No worker module or worker test changes.

CI runs the new focused check after Python setup. A stable
`uncertain_commit_controls` step id scopes an upload immediately after that
control step. The condition requires both job failure and that step's failure.
The upload selects only the synthetic runner temporary control directory, with
14-day retention. The control retains its failing status. Later steps keep their
existing success conditions.

## Admission limits

The focused test file uses a subprocess double and real temporary evidence
writes when admitted. No Path method or evidence helper is replaced. Each
refusal fixture creates a fresh owned directory at a selected artifact filename,
so the actual write must raise IsADirectoryError. Successful artifacts must be
regular files with exact bytes. Blocked artifacts must retain their directories.
Each blocked filename must appear with its IsADirectoryError cause in timeout
notes or the ordinary exception group. Later successful artifacts and individual
refusal errors establish attempts, without inventing a call sequence from paths.
The stream matrix also supplies independent lone-surrogate UTF-8 bytes and
readable backslash escapes. All seven methods remain UNEXECUTED.

Restoration checks copy six worker source files as text, parse the
existing controller bindings when admitted, and never import worker modules.
They dirty five disposable sources to exercise restoration at baseline and the
first mutant. They do not execute the real 21-test cohort.

The workflow guard reads executable step fields at this file's indentation.
It does not validate full YAML semantics, GitHub expression evaluation, artifact
service availability, cancellation, or runner shutdown. Synthetic subprocess
doubles do not establish real pipe draining, child termination, worker behavior,
native recovery, or the cause of either retained failure. Directory obstructions
exercise ordinary filesystem refusals when admitted. They do not establish
partial writes, device exhaustion, fsync durability, or power-loss recovery.

The private handoff contains before/current hashes and modes, the full bounded
delta, protected worker manifests, and concrete survivor/fault/restoration
recipes. All control outcomes remain UNEXECUTED:

`/home/nathaniel/.local/state/openplan/odm-control-evidence-source-20261021-r1/REPORT.md`

R2's HOLD remains valid under its subprocess-only review brief. Its report is
preserved without amendment at:

`/home/nathaniel/.local/state/openplan/odm-control-evidence-independent-20261021-r2/REPORT.md`

The bounded R3 correction changes only this note and the focused test source.
Fresh source pins, the complete candidate patch, and revised unexecuted control
recipes are retained at:

`/home/nathaniel/.local/state/openplan/odm-evidence-real-filesystem-source-20261021-r3/REPORT.md`

Root and a fresh independent source review must assess this correction before
later runtime admission. This source correction does not lift R2's HOLD itself.

## Root focused check, October 21

Independent R4 accepts the exact source correction. Root separately admits a
private nine-input copied-source check. All seven methods pass before mutations.
A harmless comment survives, followed by a restored seven-method pass. Fourteen
faults fail at the expected named assertions, with exact failure counts and
reasons. The full seven-method cohort passes after each restoration. The 31
commands return overall 0 in 4.140895209995506 seconds using CPython 3.11.15.

Faults cover lost timeout artifacts, stderr and readable escapes, premature write
abort, replaced timeout identity, swallowed ordinary write failures, lost output
classification, missing outer restoration, wrong upload path/condition, swallowed
CI failures, omitted wiring, wrong surrogate bytes and removed original causes.
The copied nine-file hashes, sizes and modes restore exactly. Their candidate
pins match; all 122 tracked worker Python files remain byte-identical to HEAD.

This check uses subprocess doubles and actual temporary directory obstructions.
It does not execute workers or hosted CI. The original local timeout and CI
classification failure remain separate, unchanged findings. Their cause remains
UNKNOWN. Private full logs, admission, source pins and post-terminal observations:

`/home/nathaniel/.local/state/openplan/odm-evidence-focused-20261021-01/RESULT.md`

## Root actual worker baseline, October 21

After the focused controls pass, root separately admits one unchanged 21-test
worker baseline in a fresh private 123-source copy. The existing 30-second child
limit remains. The baseline returns TimeoutExpired after 30.019986994004284
seconds. No targeted worker mutation, full campaign, repair or retry runs.

The new helper retains stdout, stderr and the readable log before re-raising the
original timeout. Stdout is None, represented by an empty binary artifact.
Stderr retains eleven completed tests reported ok, followed by the started
`test_original_processing_dispatch_is_required_before_get` case without its
result. This records progress at the deadline. It does not prove that case hangs
or distinguish cumulative suite time from a slow individual operation.

All 123 copied and candidate source hashes, sizes and modes remain exact. The
owned unit terminates with MainPID 0, no matching runner, and no expected cgroup.
Its retained failed-unit readback reports MemoryPeak 47960064 bytes and
MemorySwapPeak 0 under 1 GiB, zero swap, CPU1, affinity0 and Tasks64 bounds. The
private network contains only owned loopback fixtures. Python 3.11.15 differs
from CI 3.11.17.

The original local failure and CI classification failure remain intact. Neither
root cause is established. This failed baseline demonstrates diagnostic
preservation on an actual timed-out child, not passing worker acceptance.
Private raw artifacts, exception, source manifest and terminal receipts:

`/home/nathaniel/.local/state/openplan/odm-worker-baseline-evidence-20261021-02/RESULT.md`

## Dependency lockfile advisory correction

October 21, 2026. A separate read-only npm comparison uses this branch's actual
manifest and exact original/corrected lockfiles. The original returns exit 1
with three advisories, two high and one moderate. The corrected returns exit 0
with zero vulnerabilities. Both calls use package-lock-only mode and audit level
low. Overall comparison returns zero in 2.279 seconds.

Only version, archive URL and integrity change for follow-redirects 1.16.1,
Hono 4.13.11 and Vite 7.3.7. The complete corrected lockfile matches the graph
already checked for PR350 against fresh official npm metadata. All other 1,141
records and root fields remain identical. This branch's package.json and native
test registrations remain byte-identical. No worker, test, verifier, assertion,
timeout, census or classifier bytes change.

An earlier private preparation stops before source mutation or audit on an
incorrect cross-branch manifest-equality assumption. The Population branch's
live-test list differs. Root preserves this branch's own list and performs the
separate comparison above. The failed preparation is not regraded.

No install, lifecycle script, dependency link, compiler lease, worker/application
test, native operation or build runs in this check. The maintained braces suite,
installed runtime, full QA and current-head CI remain separate. The full worker
baseline and original CI classification cause remain unresolved. PR362 stays
draft, without a release, hosted or scientific promotion.

Private audit JSON, graph comparison and retained preparation failure:
`/home/nathaniel/.local/state/openplan/pr362-dependency-lock-transfer-20261021-02/`

## Phase timing and selected-fault diagnostics

October 21, 2026. Separate local diagnostics refine the evidence without changing
worker, verifier, test, fixture, assertion, classifier, durability or timeout
bytes. The full maintained cohort remains FAILED. CI's original boolean-fault
classification cause remains UNKNOWN. Python 3.11.15 differs from CI 3.11.17.

After source review, the phase observer's 69 synthetic commands return overall 0
in 8.628 seconds. Four harmless comments survive, 30 faults fail at their named
assertions and 35 baseline/restoration commands pass. These controls exercise
the observer and its evidence readers, without importing actual worker modules.

A separately admitted instrumented full cohort then reaches the unchanged
30-second child cap. Parent duration is 30.010 seconds; parent and service exit
1. Its accepted 92-event prefix records 11 completed cases and a twelfth setup.
Twelve completed setups total 13.364 seconds, and 11 completed bodies total
15.545 seconds. The last event begins the twelfth body,
`test_original_processing_dispatch_is_required_before_get`. That body's final
duration is unavailable. Nine later cases have no start event. Observer overhead
is included. This locates accumulated setup and body work; it does not establish
a hung test, predict full-cohort duration or explain the CI classification.

One separately admitted profile runs that twelfth test once and passes. Of
2.703 seconds measured self time, 615 `posix.fsync` calls account for 2.060
seconds, or 76.2 percent. The admission-journal synchronization caller accounts
for 421 of those calls and 1.782 seconds. Cumulative caller times overlap and
must not be added. This identifies synchronization cost in that single profiled
run. It does not justify removing durability operations or increasing a cap.

A separate five-command diagnostic checks the exact maintained
`source-timeout-bool-normalized` mutation. Baseline, harmless comment,
restored-before-fault and restored-final each pass the same selected test. The
fault returns 1 at `ValueError not raised` for `value=True`; the unchanged
maintained classifier accepts that intended failure. Overall duration is 12.873
seconds. No operational timeout occurs in this observed fault. The possible
timeout explanation from source assessment remains a hypothesis; no test or
classifier change follows from it. This local diagnostic does not reproduce
CI's rejection and does not pass the full 21-case cohort.

All 123 source hashes, modes and sizes remain exact after each diagnostic. Owned
process and cgroup checks record termination; resource counters for collected
units remain unavailable. The failed instrumented run retains its actual unit
identity and raw prefix. Prior failures are preserved. No source repair, cap
increase, full-campaign acceptance, native database, browser, hosted, scientific
or release claim follows.

Private raw evidence and detailed limits:

- `/home/nathaniel/.local/state/openplan/odm-phase-controls-20261021-01/RESULT.md`
- `/home/nathaniel/.local/state/openplan/odm-phase-actual-timing-20261021-01/RESULT.md`
- `/home/nathaniel/.local/state/openplan/odm-one-case-cprofile-20261021-01/RESULT.md`
- `/home/nathaniel/.local/state/openplan/odm-timeout-bool-mutant-diagnostic-20261021-01/RESULT.md`
