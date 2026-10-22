# Original ZIP members retain exact derived bytes

This M3/M5b.2 candidate derives ordered image slots from the original private
retained ZIP. It preserves the original admission/context, archive size/hash,
member path, archive metadata and actual expanded size/hash. Equal basenames
receive distinct fixed upload filenames. Extensions do not establish decoding,
image quality, permitted use or authority.

The [design](DESIGN.md) reuses [retained local source custody](../2026-10-11-odm-source-custody/STATUS.md).
The raw archive remains in that source set. The original derived plan precedes
slot publication; a complete manifest follows verification of every slot.
Recovery creates missing slots from the exact retained archive and verifies
existing slots. Changed archive, context, mapping or declared limits refuse.
Interrupted plans and partial files remain available for diagnosis and recovery.

This library remains disconnected from the engine journal and HTTP runtime.
No URL fetch, image decoding, engine request, public contract, schema, migration,
engine default or scientific result changes. Complete worker recovery remains
open. Connecting verified derived bytes to original engine intents is next.

## The directory is checked before index allocation

The implementation reads the bounded archive footer and central directory before
the standard ZIP reader allocates its member index. It checks actual record
counts, declared counts, extents and metadata limits. Single-file contiguous ZIP
and bounded ZIP64 footer fixtures pass. Spanning or prefixed layouts remain
unsupported by this candidate. Noncanonical or repeated paths, encrypted entries
and special-file members refuse.

The selected image paths follow the existing intake extension set and sort by
original member path. Actual decompressed bytes must match the saved plan before
publication. File and directory synchronization precede completed custody.
Explicit metadata, member-count, expanded-byte and elapsed limits persist with
the original plan. Kernel I/O/fsync and one decoder read cannot be preempted by
the elapsed guard. Large archive capacity, unfamiliar compression variants,
adversarial same-user writers and filesystem power-loss guarantees remain
unassessed.

## Source controls cover all 32 tests

All 32 tests and [49 source controls](evidence/source-controls.json) pass. Four
baseline/harmless/restored runs survive; 45 targeted variants fail at named
assertions. Seven variants reach explicit diagnostic backstops and do not
establish unsafe acceptance. An AST census requires controls for every new test.
The harness restores the source in `finally` with bytecode disabled. [Two source bindings](evidence/source-bindings.json)
identify the exact implementation and tests.

Failed private trials remain beside the passing run. Two surviving variants
exposed assertions that accepted later saved-record or object-census refusals.
The record test now detects byte reads before plan validation; the census test
requires its exact diagnostic. A controller initially missed the lowercase
`struct.error` exception name. Two expanded-byte trials reached a later size
backstop because the controlled stream did not match its header/limit boundary.
The revised two-byte stream tests the limit alone. A source-type trial reused a
size-mutated fixture; its size now restores before the independent type case.
The seventh complete source run passes. No production guard was weakened.

The directory and object enumeration adapters test declared bounds on actual
small fixtures. Short-read and expanded-byte adapters exercise controlled I/O
behavior. They do not establish native disk failures or largest-job capacity.
The ZIP64 fixture carries actual ZIP64 footer records with small ordinary
members, rather than a multi-gigabyte archive.

## Actual interruption resumes from a captured root

The [native driver](native_recovery.py) uses a real admission journal, retained
archive and derived slots. Its owned child exits abruptly after synchronizing
the first fixed image slot, before the second slot and derived manifest. The
original derived plan already contains both hashes. This interrupts the process
after synchronization returns; it does not simulate physical power loss.

The actual root snapshot CLI captures and verifies the stopped producer. A fresh
copy preserves all ordinary bytes/modes and full logical admission-journal
records. Recovery uses a nonexistent original-download path and the copied
retained archive. It preserves the first slot and original plan, derives the
missing second slot, and replays the exact completed receipt.

Native changed-archive, changed-derived-byte and changed-actor cases refuse.
Byte mutations restore in `finally`. Original producer and captured package
remain unchanged; fresh-copy replay preserves ordinary files and full logical
journal contents. All [26 observations](evidence/native-observed.json) and [81 native controls](evidence/native-controls.json)
pass, with three harmless survivors and 78 wrong/missing/type failures. [Eight source bindings](evidence/native-source-bindings.json)
remain unchanged. The native run takes 0.52 seconds and peaks at 32,751,616 bytes
under a 256 MiB service limit, with no extra swap and one CPU.

## Integration and remaining evidence

All [13 aerial test scripts](evidence/odm-suites.json) pass serially. [Five actual CI discovery/fail-fast controls](evidence/ci-discovery-controls.json)
and both [new YAML commands](evidence/actual-ci-steps.json) pass locally. The
native proof also runs as the second lightweight CI command. GitHub CI remains
separate from these local command results. All [14 nested application documentation tests](evidence/documentation-checks.json)
and the direction check pass. Existing direction reminders remain visible.
[Resource records](evidence/resources.json) preserve measured peaks and limits;
all owned services are stopped.

GPT-6.1-Sol implements the candidate and runs its engineering checks. Claude
Haiku 5.5 at high effort summarizes the already gathered counts. Its output is
checked against the [original typed JSON counts](evidence/model-summary-check.json); it is not an independent engineering or
scientific review. No Opus review runs in this lane.

Live authority, ordered dispatch, engine commit/results, artifacts, callbacks,
complete runtime recovery, clean installation, cross-host restore, browser,
practitioner, capacity and scientific acceptance remain open. No M3/M5b.2,
requirement grade or full-v1 scope changes. Main merges remain held until the
coordinator records an explicit dated lift after the technical handoff, separate
Opus review and resolution of release blockers.

Private proof base:
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-zip-derived-custody-20261011/`.
