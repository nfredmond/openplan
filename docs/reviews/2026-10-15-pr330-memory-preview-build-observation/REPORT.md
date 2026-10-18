# The single PR330 memory preview build succeeds within its build boundary

Observation date: October 15, 2026, Pacific time. Terminal parent record:
October 16, 2026, 02:49:00.195843 UTC.

The requested build exits zero. The original npm process, user-manager unit,
parent execution, working result and durable result agree. Independent streaming
readback matches the emitted artifact inventory and bound inputs. This finding
covers this build. It does not admit archive, application start, attestation,
browser journeys, promotion or release.

## Ownership and authority stay bounded

The observer starts in the assigned clean checkout at
`05dd3e8da4a4572437f06e771b0a2477873e681f`, branch
`t3/pr330-preview-build-observation`. It does not check out the candidate.
It reads the supplied AGENTS instructions, local AGENTS.md, current private
COORDINATION.md, planner-writing and prove-it guidance. The current coordination
record names this observer and root as sole operator. No new product lane opens.

The observer owns this new report directory and the new private directory:
`/home/nathaniel/.local/state/openplan/pr330-memory-preview-build-observation-20261015`.
All operating work remains with root. No build, compiler, test suite, service,
helper, database operation, browser, clone, source/seal mutation, cleanup,
nested delegation, push, pull request, merge or release starts here.

The reviewed preparation commit is
`77da95d6373fcb3cbd83eed728611a96f2322364`. Preparation remains a separate claim.
The actual packet SHA-256 is
`14ee3619801e7d8838b6cb1d89fe71c17f036db997eb945c06c05ac421a6c652`.
Root's retained admission records the user-approved npm cache removal and capacity
admission. This observer performs no cache removal or capacity-changing action.

## Original execution and retained exits agree

- Parent execution: the already-running `82734`, as assigned by root.
- Unit: `openplan-pr330-memory-f0cbeddff-r2-build.service`.
- Actual invocation: `c523bc6168014924ab6d3d41eb391439`.
- Live controller PID: `669660`.
- Source head: `f0cbeddff5ae3fc37e0dd8b91c02601429d977a6`.
- Application tree: `a13c491da3ad3ba5b237ca5fa8802b236c4ef27b`.
- Actual application directory:
  `/dev/shm/openplan-pr330-preview-20261015/candidate/openplan`.
- Parent return code: `0`; elapsed time: `658.954` seconds.
- Actual npm return code: `0`; controller measurement: `510.9353710619034` seconds.
- Original manager output: `code=exited, status=0/SUCCESS`, service runtime
  `10min 58.730s`, CPU time `4min 28.413s`.
- Durable `journal/unit-build/exit.json` and
  `journal/webpack-build/exit.json`: both return `0`.
- Working and durable build-result payloads: both return `0`, with equal content.

The raw streams match their original journal and parent hashes. Original streams
and exact working/durable receipt copies remain private. The manager's terminal
unit properties have already been collected away: blank invocation, unset peak
and default infinity limits. Those defaults do not describe the completed job.
The report uses captured live cgroup metadata and emitted resource receipts.

Webpack reports compilation in 3.5 minutes, TypeScript in 3.4 minutes, page-data
collection with 23 workers, and 145 generated static pages in 11.1 seconds.
Page optimization and trace collection also finish. These observations preserve
the expensive build behavior without changing worker settings or adding controls.

## Live metadata and resource receipts identify the actual process

Live Node processes use the assigned application directory and
`NODE_OPTIONS=--max-old-space-size=6144`. Their mount metadata shows a read-only
controller root, read-only environment file and read-only dependency donor.
Candidate and execution directories remain the intended writable mounts.
The build has a distinct network namespace. The journal records `--unshare-net`
and a hidden `/run` mount. This is a read-only metadata observation, not a new
confinement test or a claim about every host process.

Both retained build resource endpoints record:

- `memory.max=10737418240`, exactly 10 GiB.
- `memory.swap.max=0` and `memory.swap.current=0`.
- `cpu.max=50000 100000`, 50 percent of one CPU.
- Every recorded memory event is zero, including `max`, `oom` and `oom_kill`.
- Before peak: `1071173632` bytes; after peak: `7957655552` bytes.

The after receipt equals the original build-exit resource receipt. Live samples
show the same invocation, caps and zero events. These limits cover this build
cgroup. They do not establish database capacity or resource use by other units.
The earlier checkout's 1 GiB limit and 1,264 sampled `max` events remain a separate
root observation, not an application success or a build resource failure.

Root's pre-build record reports available memory `16156868608`, RAM filesystem
free space `15952822272` and durable free space `6159843328` bytes. The controller's
later actual build intent records `15665434624`, `15952814080` and `5630160896`
bytes respectively. Durable required space stays `4597706396` bytes. Both records
retain their distinct timestamps and values. No threshold changes here.

## Post-terminal input and artifact readback agrees

Readback takes the existing compiler flock nonblocking after the parent and unit
terminate. It streams hashes from the actual retained paths. It does not inspect
whole proof archives, start another compiler or query a database.

- Actual Git head and application tree equal the assigned source. Git reports a
  clean candidate with optional index locking disabled.
- Every one of 17,349 expected tracked entries matches its SHA-256, size and Git
  mode. Symlink targets are read literally. Total tracked bytes: `528310488`.
  Source inventory digest:
  `1a54e6b8f5ae434d19fe7105475621ead3d3c88949c994682d58948270e83dcc`.
- Every one of 420 migration entries matches the expected path and file hash.
  Latest version: `20261017000017`. Migration digest:
  `d2290c518df6cd1e6774c9fa4478a6632dfff012db3f4ddf89fd5e0faecc72fd`.
- Checkout-ready, build-intent and build-result carry equal application bindings.
  The environment file equals its encoded private values and sealed file.
  Its mode is `0600`; SHA-256:
  `4770b4607a163781275595d62be195dcbd850413cabb773d6ae0a4640f3ccbac`.
  The public evidence contains key names and hashes, without raw values.
- Candidate/donor/installed lock hashes agree with the dependency binding.
  All 969 installed package manifest hashes match the expected digest. The
  non-root candidate/donor dependency graph agrees; parser version is `0.8.15`.
  Binding digest:
  `5bff54066d812bfaabb4a864ff8f50e90e616e68aed0c0097bf392d2e832834c`.
  This checks dependency metadata, not every native library or installed byte.
- Actual `.next/BUILD_ID` is `Z9s8u410cuLfXdEF5aeoi`.
  All 2,587 emitted files match the controller inventory, totaling `1860182021`
  bytes, with no symlinks or unmatched entries. Inventory digest:
  `85712f31f8961fb3080ef1aa83e943b4ea8ddf7199f92aeae7a465a8595d4602`.
- Emitted `required-server-files.json` contains exactly the same 420 migration
  versions. App-paths includes the emitted health and deep-health routes.
  This reads build artifacts; it does not call a health endpoint or prove a
  running database has those versions.
- Build intent and result have equal active bindings. Actual target identity,
  service receipt, upgrade receipt, launcher, binding file and executable hashes
  agree with their result fields. The retained upgrade receipt identifies OID
  `6181197`, 420 history entries and latest version `20261017000017`.
  This observer does not independently repeat the native database checks.

## Receipt encoding needs two distinct hash identities

All five working receipts preserve insertion order. The durable journal writes
sorted keys. Their parsed contents agree, and each file exactly matches its
writer's serialization. Their byte hashes differ. The initial byte-equality
observation remains recorded as false, with a separate encoding explanation.
Nothing rewrites or removes that observation.

- Parent build-result SHA-256:
  `fbd5d4fe0a772523d5a46c65d17215806d6eec4202029caad2ae084ff9cd8f0e`.
- Working build-result SHA-256:
  `89d871dca91bcc44fdebf38a26f2dce8652d16e635bf788d386500eecfbd936c`.
- Durable build-result SHA-256:
  `ab3132b2ae8d4ddb57ccd62181a3d8e7ef8352b75a506e247352971b6fe67e06`.
- Working build-files SHA-256, referenced inside build-result:
  `a86e207ca7f14728f830db3b127821aceb55f966c7dac40959736b16b4370c6a`.
- Durable build-files SHA-256:
  `3985b372fa8bb8845de0700b7cbf10958248e6e822041f33f095658e5a8107d2`.

Future custody must use the hash of the named representation. Equal parsed
content does not make the durable bytes a replacement for the working bytes.
Both exact representations are retained privately. No archive stage runs here.

## Failures and unproved boundaries remain visible

The first observer readback stops at Git status with exit 128:
`fatal: unable to create threaded lstat: Resource temporarily unavailable`.
The observer's 512 MiB address-space limit applies to that child. The next
read-only attempt disables Git index threading and completes. The first error
remains private. This is an observer failure, not a repeated build.

The streaming observer uses a 512 MiB address-space limit and cooperative CPU
pacing toward 50 percent. It creates no service or cgroup. It does not claim an
enforced observer swap limit or CPU quota. The exact 10 GiB, zero-swap and
50-percent cgroup limits above belong to the actual build. No new guard or test
is authored, so no mutation campaign runs or duplicates the accepted controls.

One initial journal read prints private environment values into a tool result.
That violates the requested output restriction. Subsequent output filters values.
The private handling note retains this incident; committed files contain no raw
values. No configuration or secret rotation occurs in this observer task.

The original services operation remains failed with ConnectionResetError and
return code 1. Its invocation and original diagnostics remain retained. Later
read-only active-check success and this build do not turn that operation green.
The initial failing endpoint was not captured; startup timing remains an inference.
No helper create/start/restart or mutator retry occurs here.

Root supplies CI separately: 13 successful checks and one neutral result for f0,
with QA and shuffled jobs each reporting 23,014 passed, 1,662 skipped and zero
failed. This observer does not poll CI or use it as build evidence.

No source database anchor, fixed 419 dump, old database, helper, preview, frozen
packet, canonical checkout or demo changes here. Existing controller reacquisition
checks remain their own evidence. This observer does not repeat a broad protected
state census. The unexplained native pg_class difference remains unaccepted.
The 420-candidate versus 418-hosted promotion hold and no-release boundary remain.

This report establishes emitted-build evidence and source/resource custody.
Archive durability, application startup, listener attestation, HTTP behavior,
desktop/390px journeys, native add-ons, artifacts used through the application,
practitioner observation and hosted acceptance remain unassessed here. Root reads
this full report and private final disposition before deciding any later stage.

Machine-readable observations and exact private evidence hashes are in
[evidence.json](evidence.json). The private directory retains original diagnostics,
source/resource summaries, emitted inventory, encoding observations and final
disposition. No copied source tree or build archive is created.
