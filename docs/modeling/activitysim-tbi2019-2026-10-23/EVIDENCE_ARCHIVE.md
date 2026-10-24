# Private evidence archive

The October 24 cleanup moves 551 files totaling 35,339,551 bytes out of the
working tree. It preserves each file at the same repository-relative path under
`/home/nathaniel/.local/state/openplan/tbi2019-evidence-archive-20261024/`.
The selection includes raw logs, compressed logs, JSONL telemetry and every
other evidence file over 2,000 lines. No evidence bytes change.

[EVIDENCE_MANIFEST.json](EVIDENCE_MANIFEST.json) records each path, byte length,
line count and SHA-256. Its SHA-256 is
`c16b4c53aeec124c211966e615cff99b87944cced92bfcfb72a683a39bb14099`.
Every destination passes byte-length and hash verification before and after
removal of its working-tree copy. Historical commits also retain the originals;
this cleanup does not rewrite Git history or shrink existing Git object storage.

Historical relative links to moved files resolve through this manifest and
archive root. Historical reports and failed-attempt summaries remain committed,
including INTEGRATION_READINESS.md, convergence-evidence/VERIFICATION.md,
chunk-cause-evidence/ROOT_CAUSE.md, memory-fit-evidence/JOIN_BOUNDARY.md and
prechunk-evidence/ALLOCATION.md. The archive is local, not a public download.
No TBI outcome data is parsed during copying or verification.
