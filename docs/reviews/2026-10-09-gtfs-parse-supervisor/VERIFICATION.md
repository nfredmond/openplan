# GTFS parser process supervision

This M3 checkpoint implements the independent CPU-process boundary required by
the [GTFS worker design](../2026-10-09-gtfs-worker-ownership/DESIGN.md). It remains
separate from the frozen v0.68 release candidate. No import route or database
version is enrolled in managed execution by this change.

## Implemented behavior

`superviseGtfsParse` confirms ownership before starting a child, renews serially
while the child runs, and refuses an uncertain or timed-out renewal. Parent
cancellation and the configured process deadline stop the child. SIGTERM is
followed by SIGKILL after the configured grace period, and the parent waits for
the child's close event before returning. The renewal timeout also bounds a
transport that ignores its abort signal; such a request cannot start another
renewal or authorize output after timeout.

The child receives two caller-owned file descriptors and a small request. Its
environment contains no inherited database or provider credentials. It checks
the archive size and SHA-256, requires a separate empty regular output file,
and invokes the existing production parser with the supplied limits. It bounds
the serialized result, writes and synchronizes the output, and returns a small
digest receipt. The parent checks the actual file length and hash, successful
child exit and final ownership confirmation. Parser refusals remain retained
`ok: false` results; they do not become ready feeds. Interrupted or preexisting
output is retained rather than overwritten or removed.

The implementation follows the existing contract-calculation worker's separate
Node process pattern, while adding bounded serial renewals, checked termination
and retained output. Node documents the inherited-descriptor, IPC and `execArgv`
options in its [child-process API](https://nodejs.org/api/child_process.html#child_processforkmodulepath-args-options).
The old-space setting bounds the child's JavaScript heap, not total resident
memory. Operators still need a process-group resource limit and group shutdown
on abrupt parent death. A disconnect listener cannot preempt synchronous parsing.

## Verification

The new suite runs actual child processes. Controlled CPU fixtures block their
event loops and ignore SIGTERM, demonstrating independent renewal and observed
SIGKILL termination. Tests also cover hung renewals, final ownership refusal,
archive corruption, prior output preservation, output size and digest, failed
exit, cancellation and the independent parent deadline. The production parser
fixture compares every retained value with a direct parse except elapsed time,
which naturally differs. The initial comparison failed on that clock field;
the correction preserves every source and derived value in the comparison.

All 55 supervisor and existing parser tests pass. Baseline, harmless-comment and
restored controls pass. Ten targeted changes fail behavior assertions for the
checksum, empty output, output bound, renewal refusal, renewal timeout, final
ownership, output digest, failed child exit, parent deadline and cancellation.
The [control record](controls.json) retains source and log hashes. The runner
restores the original files in a `finally` block and is intended only for an
owned checkout with no concurrent edits or tests. Its systemd service exits
successfully after 57.689 seconds, with a 240.7M journal-reported memory peak
under a 2 GiB cap and no swap.

The [publisher-archive record](archive-result.json) uses the retained 892,312-byte
BART ZIP with SHA-256
`affdc4d70cac01f71e54f049c754ba36824a885edcdef2ef8b024820c9e93080`.
The separate process retains 495,655 output bytes representing 14 routes,
287 stops and 4,417 trips. Twelve renewal callbacks complete, including admission
and final confirmation. All source and derived values match a direct parse.
The bounded service exits successfully after 1.119 seconds, with a 114.1M
journal-reported peak. This fixture is one publisher archive, not capacity
acceptance for the configured maximum input.

Targeted ESLint, scoped TypeScript and the dead-code command pass. The latter
retains nonfatal unused-export/type and duplicate-export warnings. The first TypeScript run found the
test helper inferred a narrower Buffer backing type than JSZip returns; an
explicit Buffer parameter fixes the test signature. Including the archive runner in the scoped check also exposed two redundant
failure branches after narrowing assertions; the assertions remain, and those
unreachable branches are removed. No application type error was suppressed. No dependencies, migrations, parser rules or scientific grades
change.

## Remaining connection work

The renewal callback in these process tests is controlled, not a database lease.
The production caller must bind it to the admitted version and attempt, set an
interval and timeout within that lease's validity, and pass retained descriptors
from a private attempt directory. This module does not establish archive Storage
custody, submission identity, durable worker journals, database write fencing,
replacement-attempt recovery, tract aggregation, final publication or adoption.
Those commands must enforce ownership inside their own transactions even after
this local parse succeeds.

The three existing import doors still run inline. The next implementation work
connects admission, lifecycle commands, supervisor, guarded batches and adoption
under that same version identity, then proves interruption and the desktop/390px
planner journeys. No rendered acceptance or complete worker claim is made here.

Reproduce from the repository root in an owned checkout:

```bash
python3 docs/reviews/2026-10-09-gtfs-parse-supervisor/verify_controls.py /private/proof-directory
cd openplan
node --import tsx ../docs/reviews/2026-10-09-gtfs-parse-supervisor/verify_archive.mts /private/retained.zip /private/new-proof-directory
```

## Production environment correction

GitHub QA at `cf02933e0` passes the tests but fails the production type check
because Next.js augments `ProcessEnv` with a required `NODE_ENV`. The earlier
scoped TypeScript configuration omitted that declaration and therefore missed
this defect. The parent now supplies only `NODE_ENV=production`. It still
passes no inherited database or provider credentials to the parser.

A real child fixture reads its own environment. It confirms the exact explicit
value and refuses a synthetic parent-only variable. All 56 supervisor and parser
tests pass. The [updated controls](environment-controls.json) pass baseline,
harmless and restored runs and detect twelve targeted failures, including
inheriting the parent environment and omitting `NODE_ENV`. The controlled service
exits successfully after 57.756 seconds with a 228.6M journal-reported peak under
its 2 GiB cap, without swap.

The scoped type check now includes Next.js's actual global declaration. The
[TypeScript controls](typescript-environment-controls.json) reproduce the original
missing-`NODE_ENV` error with the old expression and pass after restoration.
Targeted ESLint passes. Full production CI remains required on the corrected
commit; this targeted check does not substitute for it. No import route,
scientific tier, database or release version changes.
