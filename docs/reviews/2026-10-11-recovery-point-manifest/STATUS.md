# Retained recovery-packet manifest, October 11 candidate

The candidate offline command seals an already retained private packet containing
declared database/Storage artifacts, cluster roles, database root key, protected
configuration and a verified worker-root set. It binds every retained file/path/mode
and publishes a receipt last. It does not create a new live database/Storage cut,
discover omitted installation state or complete M3. The relaunch agent retains
hosted coordination and the main merge hold.

## Command and checks

[`recovery_point_manifest.py`](../../../openplan/scripts/ops/recovery_point_manifest.py)
requires exact private `point-inventory.json` bytes. All six artifact categories
are required. Database, roles and key artifacts are nonempty files; Storage can
be a file or object-byte directory. Configuration and worker sets are directories.
Roles/key files can sit inside configuration. Relative paths must be unambiguous,
without aliases, duplicates, parent traversal or reserved receipt/declaration names.
Duplicate JSON keys are refused with a controlled diagnostic.

Sealing requires operator-declared quiescence, checks the complete private packet
and validates the nested worker set. It syncs all retained files and directories,
rechecks the worker set and complete inventory, and publishes `recovery-point.json`
last. Existing completed or interrupted publication state is preserved. Require
exit 0 and later verification. A failed filesystem publication cannot be treated
as successful because a receipt exists. Verification uses only retained files,
checks complete contents and revalidates required artifacts and nested worker
bindings. The manifest hash needs a protected external backup authority.

All 34 new filesystem/native SQLite tests have selected broken controls. The
[41-case run](evidence/mutation-controls.json) includes four full-suite survivors
and 37 broken cases. Baseline, harmless comment, different manifest indentation
and restored source pass. Broken cases expose lost required artifacts, unsafe
scope, aliases/access, stale declaration/content bindings, unsupported artifact
types, invalid nested sets, omitted file/directory/parent sync, false publication,
ignored caller deadlines, private CLI disclosure and promoted installation claims.
Malformed-value cases also test controlled diagnostics instead of an uncaught
exception. Opaque unit database/Storage bytes do not establish native restoration.
Reported sync and nested validation failures exercise refusal branches, not hardware
failure. Exact production source bytes are restored and synced in `finally`.
The complete operations suite passes 242 tests without skips.

The [first deadline control](evidence/failed-deadline-control-selection.json)
does not reach its intended acceptance assertion. The nested set still rejects an
infinite deadline after the outer validator is removed; verification then reaches
a missing receipt. Zero/negative cases produce native timeout. The corrected
variant ignores the caller's deadline and supplies a finite 3,600-second budget,
which exposes invalid-deadline acceptance. The original source is restored and
the failed trial stays retained. Product direction checking passes with existing
registry and version-age reminders preserved.

## Native transport

The [third native producer](evidence/native-encrypted-transport.json) passes. It
copies the accepted full point and five-root set into a fresh private packet,
preserves original mode metadata, seals/verifies it, performs complete encrypted
read checking and restores into a fresh directory. The packet contains 3,092 files
and 1,162,155,249 bytes. Every packet file/path/mode and directory matches after
restore. All eight copied journal schemas/table records match, covering the four
original journals and their four root-set copies. The immutable packet, original
1,557-file point, original directory modes and five-root set remain unchanged.
The [eight dependencies](evidence/native-source-binding.json), including the
previously verified Restic binary, are frozen before execution and unchanged
afterward. The [executed driver](drivers/encrypted_packet.py) retains its exact bytes.

Wrong-password access returns 12. The separate second-trial observer records
zero decrypted stdout bytes. Missing packet receipt
and actual corruption of a restored archive each produce a controlled packet
refusal. Mutation bytes and the held receipt are restored in `finally`, and final
verification passes. Only disposable restored copies change for these controls.
No database, Storage service or worker starts. This checks encrypted transport
of previously retained artifacts, not a new live cut or repeated native database
recovery. The service takes 51.465 seconds and reaches its rounded 512 MiB cap;
spare capacity remains unassessed.

The [first native trial](evidence/failed-source-permission-precondition.json)
refuses the source's retained Storage permissions before copying. Ten object files
are mode 0644 and two directories are mode 0755 behind the accepted private outer
root. The new packet contract requires every child to deny group/other access.
Production privacy guards remain unchanged. A later fresh copy keeps exact
original file/directory metadata privately and hardens only its own copy.

The [second trial](evidence/failed-wrong-password-exit-oracle.json) completes encrypted read checking, restoration and packet
verification but fails its wrong-password exit oracle. The installed pinned
binary returns 12, with the wrong-password diagnostic and zero decrypted stdout,
while the producer expects 1. The corrected expected status matches
[Restic's scripting documentation](https://restic.readthedocs.io/en/stable/075_scripting.html#exit-codes).
The failed producer, sealed packet, encrypted repository and restored copy remain
retained. They are not relabeled as a passing whole producer.

## Remaining boundaries

Private proof remains under
`gtfs-managed-ingestion-proof-20261009/recovery-point-manifest-20261011/`.
[Unit accounting](evidence/unit-accounting.json) preserves invocation identities
and exit results. Declared quiescence does not fence writers or detect every
change followed by exact restoration between reads. Progress deadlines do not
interrupt every blocking kernel operation. Hashes and declarations do not establish
complete roles/configuration, successful native database restore, Storage access
or permission to continue computation.

Installation-wide inventory/alignment, every worker family, useful computation
beyond 45 minutes, separate physical-host/disk recovery, independent agency
commissioning, native Windows/macOS, browser/practitioner acceptance and independent
AequilibraE/ActivitySim validation remain open. Existing native full-point database
and command recovery evidence remains separate. No hosted configuration, worker
protocol, migration, release, tag, main merge or capability grade changes here.
