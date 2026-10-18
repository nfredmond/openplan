# Two isolated CLI calls complete before archive inspection

October 16, 2026. This records tool startup and a separate filesystem metadata
observation. It establishes no archive, restore or native M1 acceptance.

One separately granted empty-root unit runs the copied pg_restore binary through
the pinned explicit loader and library directory. Version and help each return
zero with empty stderr. Version output is exactly `pg_restore (PostgreSQL) 17.6`
plus a newline, 29 bytes. Help is 3,793 bytes. EVIDENCE.json preserves both hashes,
the exact request/grant and the private runtime seal. Root rechecks all 29 saved
runtime descriptors without rerunning the tool.

The parent finishes in 0.9129823968978599 seconds. Manager output reports 869ms,
407ms CPU, rounded peak 17.8M and zero swap. No invocation ID or byte-precise peak
is captured; none is invented or queried. Actual entry limits are 512MiB, zero
swap, CPU50 and Tasks64. Initial and final raw mount tables match, with 25 mount
records. All 1,248 input files receive initial and final readbacks. Nine new
protocol controls pass, including a harmless survivor, intended named failure,
unrelated-error refusal and restoration. The older 12 mount controls do not
repeat. These observations apply to the exact binary, loader and library layout,
not general ABI compatibility or a supported-version registry.

The archive is absent from that unit. It is not mounted, statted, hashed, read or
parsed by either tool call. The earlier artifact01 setup failure remains FAILED1.
Exceptional startup, timeout and cleanup paths are not universally established;
partial or unknown captures require root disposition rather than a success claim.

A later, separately recorded root metadata-only observation checks one selected
archive path with lstat, strict path resolution and stat. It observes a regular
non-symlink file at the same resolved path, mode0600, UID/GID1000 and 16,232,305
bytes. It opens no archive contents and computes no fresh archive hash. The prior
binary content hash remains a retained expectation, not a new content observation.
File metadata can change after this observation. A future admitted consumer must
check the complete metadata and binary hash again before parsing.

Only source preparation of one read-only table-of-contents request proceeds.
No `--list`, extraction, SQL, schema/history interpretation, database connection,
restore, target creation, Auth, browser or native fixture runs. A TOC result would
still require separate assessment before history extraction or a restore proposal.
Migration423-to424 M1 work, publication425, roles/ACLs, receipt/race semantics,
build/navigation, desktop390px, artifacts, practitioner and full V1 acceptance
remain separate and open. No successor operation is granted by this note.
