# Retained aerial source bytes, disconnected candidate

The new [source library](../../../workers/odm_worker/retained_source.py) retains
already-complete private local files and an immutable preparation plan before
engine use. It binds exact bytes and original ordered ZIP/photo metadata to the
saved admission, request, installation, target, workspace, mission, application
job and original actor. It remains disconnected from the HTTP worker. No URL
transport, extraction, processing, deployment or public contract changes.

This advances existing M3/M5b.2. It does not fix the native queued-admission
counterexample, close worker recovery or change any requirement grade.

## Exact local custody

The trusted caller supplies the original private context. This library checks
its required fields and original workspace/mission, but does not verify live
authority. The public worker request has no actor field. Future integration must
read the original application records rather than invent or replace authority.

Private descriptor traversal refuses symlinks, hardlinks, public permissions and
nonordinary source files. Stable identity, aggregate byte limits, declared
size/checksum, available disk and finite deadlines protect preparation. Original
bytes and the complete plan synchronize before copying. Fresh private partial
files synchronize before slot publication; the final manifest follows verified
slots. Supplied filenames never become output paths.

Recovery uses the original plan. Completed slots need no original source access;
missing slots require the exact original planned bytes. Changed request, context,
mapping, budget or actual bytes refuse. Existing different objects and manifests
are preserved. Complete replay and relocation return the original manifest
identity without extra partial files. Partial files remain retained. No URL is
fetched under a prepared identity.

Writers cooperate through a private POSIX lock. This does not protect against an
adversarial same-UID writer. Metadata has a 64 MiB bound; the caller supplies the
aggregate source-byte bound. Largest workloads and unsupported filesystems are
unassessed. Deadline checks run between reads and custody steps; they do not
interrupt a stalled kernel I/O or synchronization call. A matching checksum does not establish valid imagery or measurement
quality. The saved manifest explicitly retains `authorityVerification: unassessed`.

## Tests and controls

All 42 source tests pass in the baseline and restored full runs. [57 source
controls](evidence/controls.json) cover every test, with four full-suite survivors
and 53 intended failures. Mutations restore in finally; [source hashes](evidence/unit-source-bindings.json)
match the accepted implementation and tests.

Tests use real SQLite and private filesystem fixtures. They exercise full
request/context/metadata binding, strict JSON identity, exact bytes, durable plan
ordering, interrupted publication, saved-plan recovery, private paths, unchanged
original files and immutable relocated receipts. Several removed guards reach a
later independent refusal and fail the expected diagnostic. The controls label
these `diagnostic_refusal`; they do not show unsafe acceptance. Removing the
regular-file guard reaches the kernel's FIFO synchronization refusal. Foreign
ownership, disk exhaustion and synchronization failures use controlled adapters.
No real foreign account, full disk or physical power loss runs.

## Native interrupted copy and root recovery

[The driver](native_recovery.py) creates two synthetic ordinary byte files,
67,174,400 bytes in total. They are not decoded images. An owned subprocess runs
the actual library. After observing the first published slot, the parent sends
SIGTERM to that subprocess. The second slot and final manifest remain unpublished;
the complete original plan survives. This is process interruption, not a physical
power-loss test.

The existing worker-root CLI captures and verifies the stopped root. A separate
observer compares all ordinary bytes, modes and directories, plus complete SQLite
schemas and rows. A fresh runtime copy replays the original admission and finishes
the missing slot from its original bytes. The first original file is moved in
that disposable copy to prove its retained slot needs no source access. Complete
replay uses an absent source directory; another relocated pack preserves the
same receipt. Original source and package remain unchanged. SQLite backup
normalizes page layout; equality covers logical records rather than page bytes.

Three separate native copies refuse changed original bytes, a changed completed
slot and a changed original actor. Edits restore in finally; failed partial files
remain retained. [31 observations](evidence/native-observed.json) and [96 controls](evidence/native-controls.json)
require every value with strict types: three positive controls and 93 changed,
missing or equal-value wrong-type failures. These latter controls mutate observed
records, not engine behavior. [Six executed source bindings](evidence/native-source-bindings.json)
remain unchanged. [The result](evidence/native.json) records
`workerRecoveryAccepted: false` and no native imagery or engine execution.

## Integration and remaining limits

The scoped aerial CI workflow discovers the new suite and now runs source fault
controls and interrupted-copy recovery separately. All ten [worker scripts](evidence/odm-suites.json), [five CI discovery controls](evidence/ci-discovery-controls.json)
and [14 documentation/direction checks](evidence/focused-checks.json) pass locally.
The direction command passes with the existing review-age reminders unchanged.
GitHub acceptance remains separate on the pushed head.

[Resource accounting](evidence/local-accounting.json) retains bounded owned
services, no extra swap and one CPU. Source controls peak at 32,849,920 bytes.
The native driver takes 1.926 seconds and reaches its 512 MiB cap, including file
cache; this does not establish spare capacity or long-job capacity. Owned services
stop after their receipts are saved.

[Earlier trials](evidence/earlier-trials.json) remain visible. A nested-directory
fixture initially inherited a private umask and now explicitly creates the
intended public permission. Mutation diagnostics first misclassified a mapping
guard and a FIFO kernel refusal; a direct boolean-limit assertion isolates its
guard. The first native driver expected the wrong actor-refusal wording. These
failed runs are preserved, not reported as passes.

Next retain exact engine identity/options and init/upload/commit intents before
transport, then reconcile uncertain engine effects. Preserve complete outputs,
artifact registration and exact terminal callback before runtime integration.
Download completion, actual engine crash windows, live authority/RLS, processing
quality, long work, installation-wide alignment, physical-host recovery, browser
journeys and independent commissioning stay open. Scientific and practitioner
acceptance remain unestablished. Preserve the main merge hold; the relaunch owner
coordinates its recorded exception.

Private source/admission roots, logs and earlier trials remain under
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-source-custody-20261011/`.
