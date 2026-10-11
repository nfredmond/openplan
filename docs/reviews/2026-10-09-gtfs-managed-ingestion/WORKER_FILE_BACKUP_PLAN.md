# Retained worker files in independent recovery, October 11

This prepares the next file boundary in [M3](../../ROADMAP.md#m3-free-private-and-recoverable-agency-operation).
The complete installation recovery point must also cover database rows, Storage
bytes, protected configuration and a verified consistency interval. The existing
[backup guide](../../../openplan/docs/ops/BACKUP_AND_RESTORE.md) and
[model journal proof](../2026-10-08-model-custody-metadata/WORKER_LOCAL_RESTORE.md)
retain those distinct requirements.

## Selected tool and source

Use an isolated Restic probe before building another file archive format.
[The official backup guide](https://restic.readthedocs.io/en/stable/040_backup.html)
documents snapshots and full data rescanning with `--force`.
[The restore guide](https://restic.readthedocs.io/en/stable/050_restore.html)
documents selection of a particular snapshot and a separate restore destination.
These are tool features, not observed OpenPlan recovery.

GitHub's official release inventory identifies v0.19.1, published July 5, 2026.
The 10,107,515-byte Linux asset agrees with its release checksum. The checksum
signature verifies against the primary fingerprint documented in
[the installation guide](https://restic.readthedocs.io/en/stable/020_installation.html).
The first public-key read truncates at 32,768 bytes and import refuses it. The
complete 33,940-byte key then imports and verifies. Both attempts remain private.
The standalone tool lives only under the owned proof directory. It has not yet
executed. No system package, application dependency or required provider changes.

## Native file probe prepared

The stopped ba1 CTA worker root contains 787 regular files totaling 235,591,323
bytes, with no observed symlinks. Capture the entire root, including submissions,
retained source archives, parser output and command journals. Select a local
private encrypted repository without exclusions. Force full file reading, check
all repository data and restore one exact snapshot into a fresh private directory.

Copy that encrypted repository and its protected password to a second fresh
private directory. Disable caches and restore using the copy's explicit path.
Compare every file name, byte hash, size and mode with source inventories before
and after capture. Exercise a wrong password, missing pack, changed restored
archive and incomplete-file observations. Restore mutation changes in finally;
keep the original worker files and all proof artifacts.

The prepared runner uses 1 GiB, no swap, one CPU and one Go execution thread.
It runs after the current full archive and retained HTTP checks. The original
worker service remains inactive. No database, Storage service, cloud worker,
public endpoint or deployment configuration changes.

## Acceptance remains separate

This is a prepared file-only probe, not a completed backup or operator recipe.
Both repository copies remain on the same physical host and disk. It does not
capture coordinated database/Storage/configuration state, prove physical-host
loss recovery, relocate absolute paths or replay a worker. Its root has JSON and
ZIP files, so it cannot establish populated SQLite/WAL recovery. Preserve the
separate SQLite backup requirement and model custody evidence.

Continue through the existing M3 queue with complete installation inventory,
writer quiescence, an independent protected copy, exact logical installation
identity and fresh-process native recovery. Inadequate coverage stays visible.
No agency commissioning or scientific claim follows from checksum agreement.

## Completed file-only probe

[The native result](worker-file-backup-native.json) passes with actual service
exit zero in 12.033 seconds. All 787 files, 235,591,323 bytes, names and modes
match after restoration from the copied encrypted repository with caches disabled.
Source inventories match before and after, and the original worker root remains
unchanged. The service has 1 GiB, no swap and one CPU; its final journal reports
a 720.8M peak. Both repository copies and restored files remain retained privately.

Wrong-password access returns exit 12 with its specific password/key refusal.
Moving one pack out of only the copied repository makes the complete-data check
return exit 1 and identify the missing pack. Restoring that pack makes the full
check pass. Changing one byte of a restored ZIP fails file comparison; its original
byte is restored in finally, and final source/restored comparisons pass.

[Comparison controls](worker-file-backup-comparison-controls.json) exercise the
actual producer function with copied native observations. Ten baseline/harmless
cases behave as expected; omission of census, byte or mode checks fails at the
intended oracle assertions. [The verifier](verify_worker_file_backup_controls.py)
changes no source or snapshot. [Tool source and signature records](worker-file-backup-tool-source.json)
identify the verified release and its BSD 2-Clause license. Earlier preparation
statements above describe the state before this trial.

These results remain file-only. The physical-host, database/Storage/configuration,
SQLite/WAL and fresh worker replay limits above remain open. This adds a measured
component to the existing M3 work, not an independent agency recovery claim.
