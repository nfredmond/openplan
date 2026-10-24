# Memory-fit execution boundary

October 24, 2026 UTC. This packet records modeled run health only. It grants no
permission to request, parse or compare TBI outcomes. The full retained runtime
population remains 1,060,601 households, 2,617,177 persons and 634 zones. Both
coefficient arms retain their frozen values. AequilibraE remains separate.

The 20,000-household diagnostic uses a deterministic SHA-256 membership rule,
49,094 persons and all 634 destination zones. It is an allocation diagnostic,
not a substitute for either full arm. `profile-before-run.json` pins its inputs.
The profiler observes call and return frames through `sys.setprofile`; it does
not replace engine functions. The initial profiler records DataFrame storage.
The successor also records NumPy working-array shapes, dtypes and byte counts.
Both versions remain in this packet.

The successor production target is 268,435,456 bytes, with the inherited 0.05
minimum chunk ratio. Training uses the frozen 2,000-household, 4,971-person
fixture, a 536,870,912-byte target and a 1.0 minimum ratio. The cache must train
through `trip_purpose_and_destination`. The resumed suffix uses chunk size zero
and disabled chunking, including legacy trip scheduling. No engine source,
skim dtype, matrix coverage, coefficient, population or RNG seed changes.

Every engine process runs within `systemd-run --user --scope`, `MemoryMax=9G`
and `MemorySwapMax=0`. Engine stages run sequentially. One-second cgroup samples
retain allocation metadata across failures; they do not replace the exact
scope lifetime peak. Each prefix and suffix has its own scope. No Docker stack,
hosted system, production service, Vercel, Railway or managed database changes.

## Instrument history

The controller initially defines its input and reference guards inline. During
training, those guards move into `admission.py` for shared full-run admission and
mutation testing. `train-and-prove.executed.py` retains the original executed
controller. That running process keeps its already-loaded code. No execution
setting changes during the run.

The diagnostic and training scopes use `monitor.initial.py`. Later scopes use
`monitor.py`, which also samples child RSS and retains named stages across
generic chunk messages. Both monitor versions preserve the same cap, process
command and exit result. Telemetry is run health, not a scientific validator.

Nine admission tests exercise intact evidence, input and final-file custody,
cache custody, failed-proof refusal, changed-choice refusal and changed-candidate
refusal. Nine accepted mutation controls contain two harmless comment survivors
and seven intended assertion failures. Every control restores the source bytes.
The initial failed-proof fixture omits the cache hash, causing a KeyError after
the status guard is removed. That incidental result remains retained and does
not count. The corrected fixture retains the hash and fails through the
intended assertion. Synthetic admission tests do not prove engine parity,
full-population fit or scientific accuracy.

The initial 1 GiB production probe completes its 2,000-household current-arm
prefix in 130.259 seconds, but the unchanged splitting guard refuses admission:
`No actual chooser split appears in the chunk log`. It runs no suffix or full
arm. The successor uses a 256 MiB target for both proof and full execution.
`fit-before-run.json` records that choice before its engine run. The earlier
`parity-before-run.json` and 1 GiB configuration remain historical probe records.

## Allocator probe after the first smaller-target failure

The current full arm exceeds 9 GiB during grade-school chooser preparation,
before inner logsum chunks start. Its last retained sample contains
9,560,240,128 anonymous bytes and 8,404,992 file-cache bytes. Removing skim cache
pages cannot account for the anonymous allocation. The second arm continues
sequentially with the same declared configuration before any successor runs.

The successor probe sets process-local `MALLOC_MMAP_THRESHOLD_=131072`,
`MALLOC_TRIM_THRESHOLD_=0` and `MALLOC_ARENA_MAX=2`. The [GNU C Library manual](https://sourceware.org/glibc/manual/latest/html_node/Malloc-Tunable-Parameters.html)
documents these startup variables. The first fixes the threshold above which
allocations use mappings that can be released on free; the other two control
heap trimming and arena count. These are allocator settings, not skim encoding,
model coefficients or engine patches. They do not change host-wide settings.
No successor full run is admitted until both 2,000-household arms pass the same
choice criterion against their unchanged unchunked references.

`execute.initial.py` and `admission.first-full.py` retain the first full-run
controller dependencies. Later versions add the explicit allocator argument and
select the matching parity receipt. Active processes keep their loaded code.
Each started receipt retains its actual command and configuration hashes.
