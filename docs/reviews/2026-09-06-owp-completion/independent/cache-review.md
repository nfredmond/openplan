# Supplemental review: export-worker cache metadata

**Final status: the consistency seam below was fixed and independently retested.** `fixed/sha256.json` records the final worker/helper snapshots. `fixed/probe.cjs` executes the actual helper and worker against scratch cache files and a fake service boundary, asserting the exact document/revision query projections and workspace constraint. Nine cases cover valid cache, wrong document, workspace, revision ID, revision hash, format, content type, missing engine and invalid byte checksum. A valid cache is reused; every invalid case rerenders before upload, and destination/type come from the live identity. A harmless comment preserves valid recovery. Bypassing identity comparison lets a wrong-revision cache through and fails the intended guard; removing the revision workspace filter fails the query-scope assertion. Evidence: `fixed/results.json`. The malicious-local-writer limitation below remains explicit.

The following sections preserve the original finding and minimum repair rationale.

## Finding

The byte checksum protects cache consistency but does not bind the cached artifact to the live immutable export record. In `openplan/scripts/workers/document-exports.ts:27–31`, acceptance checks only documentId and bytes SHA-256. It then trusts cached workspaceId, format and contentType for the upload at lines41–42, and never validates cached revisionId/revisionHash. `renderWorkProgramExport` normally queries the live document and its revision in `export-job.ts:14–22`, but cache hits bypass that entire lookup.

A wrong-workspace cache uploads into that workspace's object prefix before the finish RPC rejects its path. The private kb-documents bucket has no authenticated storage.objects policies in the source schema, so this is a misplaced/orphan storage write; cross-workspace disclosure through the current application was not demonstrated.

A wrong-revision cache whose documentId, workspace and format otherwise match can finish successfully under the current document's revision identity. The worker's final RPC supplies no cached revision identity to compare. This is the stronger artifact-integrity concern: the bytes can be a perfectly intact different artifact.

These are local-cache corruption/misassociation or restore-consistency failure cases. I did not identify an ordinary unmodified writer path that generates this mismatch. The default cache is private, so this is not evidence of a remote-user exploit.

## Independent fault probe

`probe.cjs` executes the snapshotted actual worker with real scratch files and a fake service/storage boundary. The fake finish RPC enforces the live expected storage path, reflecting the current SQL path constraint; no database or real storage operation occurred. `results.json` records:

- Consistent cache and harmless comment control: reuse, no render.
- Changed workspace metadata: wrong-prefix upload occurs, then finish is refused.
- Changed revisionId/revisionHash: no live document/revision query, no render, finish accepted.
- A consequential scratch mutation disabling cache reuse: fresh renderer bytes replace the mismatched revision bytes before upload.

These demonstrate control flow and the arguments crossing the storage/RPC boundaries, not an independent live SQL permission test. Snapshot hashes are in `sha256.json`.

## Minimum repair

Before accepting any cache or uploading bytes, load the live Documents identity (document ID, workspace, saved revision ID, format and content type), then the immutable revision ID/hash constrained to that workspace. Compare all these identity fields against validated cache metadata alongside the existing checksum. On mismatch, ignore the cached pair and recover by rendering the live revision. Build upload path and content type from the live identity, even after a valid cache hit.

An extracted read-only identity helper shared with renderWorkProgramExport is the smallest reuse seam. Keep the current atomic cache writes, byte checksum and existing-object verification; do not discard durable recovery merely to avoid validation. Probe mismatched workspace, revision ID/hash, format and content type, proving no upload of rejected cached bytes.

Metadata equality protects accidental stale/mixed caches. It is not cryptographic proof against a malicious local writer able to forge both metadata and byte hash. The private filesystem remains a trust boundary; a stronger local-tampering threat model would need authenticated manifests or rerendering and is beyond the minimum consistency fix.
