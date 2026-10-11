# Complete configured worker-root capture

M3 requires the original local bytes, directories, durable records and deployment
configuration to survive a coordinated recovery point. The supported operator
currently snapshots one named model journal. Complete-root capture exists only
in fixed private fixture drivers. Add a supported Python command for one explicitly
selected, private worker root, without changing worker contracts or hosted wiring.

The command requires declared writer quiescence and an exclusive private destination
outside the source. It inventories every regular file and directory, including
empty directories and modes. It refuses symlinks, hard-link aliases, foreign owners,
accessible paths and special files. It preserves ordinary files exactly. It detects
SQLite main files by their native header, uses the backup API to retain committed
WAL records, verifies integrity and normalizes the retained main file. WAL and SHM
are not copied as independent durable files. Known model journals still require
their command schema. Source main/WAL bytes and all durable paths must remain stable
across capture. Only recognized transient SHM bytes and newly reader-created
empty WAL files are excluded from this stability comparison. Original or
nonempty WAL records remain required.

Reuse existing journal privacy, durability and SQLite mechanisms where their
single-directory interface permits it. Support ordinary native SQLite databases
as well as named model journals, because AequilibraE project artifacts can contain
SQLite data. Preserve all records, including BLOBs, through the native backup API.
Reject an orphan SQLite sidecar rather than silently packaging an incomplete main.

Native SQLite backup can normalize physical page metadata even when logical
records remain equal. Independently compare all required schema and table rows
after recovery; require exact ordinary-file bytes and all path/mode records.

Publish a versioned private manifest last. Bind source and retained file hashes,
sizes and modes, the complete directory set, SQLite normalization mappings and the
operator-declared consistency scope. Require fsync of files, affected directories
and the destination parent. An interrupted or refused destination stays private
and cannot be reused. Success requires an exit-zero command and its verified manifest.

This captures one selected root. It does not discover every installation root,
quiesce live workers, fence hostile writers, align PostgreSQL/Storage, encrypt the
package, recover hardware loss, resume computation or validate scientific outputs.
The installation operator must preserve this complete root package in the same
protected coordinated point as database, Storage and configuration. Keep all
remaining M3 and V1 requirements open.

Tests use actual private directories, empty directories, two populated WAL journals
with admission/start records and an ordinary SQLite BLOB database. Independently
compare all logical records and ordinary bytes. Exercise refused reuse, path aliases,
unknown/orphan sidecars, source mutation, deadlines, integrity and fsync/publication
failures. Each new test and guard needs a harmless control and a targeted broken
behavior that fails its intended assertion, with mutation edits restored in finally.
Run bounded services serially, without existing proof or agency resources.

The [SQLite backup documentation](https://www.sqlite.org/backup.html) describes
brief source read locks, not a continuous whole-root lock. Its
[WAL documentation](https://www.sqlite.org/wal.html) describes read-only WAL/SHM
requirements. Native closed and crashed database cases must validate those
boundaries. Required SQLite extensions and complete agency installation remain
unassessed; an unavailable module must produce refusal, not a claimed valid copy.
