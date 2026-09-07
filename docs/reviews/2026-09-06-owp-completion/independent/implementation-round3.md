# Independent worker and retained-export review, round 3

2026-09-06, isolated OWP preparation checkout. Source copies and per-file SHA-256 values are in `snapshot/` and `sha256.json`. The export worker is `openplan/scripts/workers/document-exports.mts`, not a root scripts path. No repository source or database was changed. All generated files are explicitly synthetic test artifacts in this review directory.

## Remaining findings in this snapshot

1. **P1: HTML export cannot enter the configured private bucket.** `20260907000004_work_program_export_custody.sql:40` sets HTML content_type to text/html; document-exports.mts uploads that type to kb-documents. Its last MIME allowlist is `20260811000005_document_library_stored_kinds.sql:95-124`, which excludes text/html. No later bucket alteration was present when reviewed. Add a narrow MIME allowance and test the real storage refusal/success. This is source-derived, not a claim about the owner's currently running test database.

2. **P2: Export completion accepts null artifact identity.** In migration 00004, finish_work_program_export uses `p_checksum !~ regex` and `p_bytes <= 0` without explicit null checks. With checksum, byte count and storage reference all null, the guard can evaluate SQL NULL rather than TRUE and skip the refusal. The following updates mark document stored/job succeeded without a retained file. claim_work_program_export likewise accepts a null token. Add explicit null/token/positive-byte checks and live transaction tests that verify no completion or artifact mutation follows invalid input. These functions are service-only; this is an integrity boundary hole, not an anonymous access claim.

3. **P2: OCR callback application does not constrain shared job kind.** Migration 00001's apply_kb_extraction_callback looks up only request_id, although 00004 adds export jobs to the same table. An authenticated misrouted OCR callback naming an export request can mutate its document/index and mark its job succeeded without export checksum/storage custody. Restrict this function to job_kind='extraction', as the export claim/finish functions already restrict their kind. Add a wrong-kind live RPC test.

4. **P2: Export polling grows with every saved revision and never stops.** editor.tsx mounts WorkProgramExports for every historical revision. exports.tsx starts three status fetches every four seconds even when all formats are not_prepared or succeeded. One hundred revisions produce 300 repeated requests per cycle, each with several database/auth reads. Poll only active jobs, load history status once or on expansion, and stop after immutable artifacts complete. This is source-derived; no browser/performance run was performed.

5. **Carried P2: first export of an old revision still depends on unrelated later sources.** export-job.ts invokes loadWorkProgramPreparation for the entire program before filtering the saved source_ids. This reads the latest revision, all sources, every extraction version and full revision history. An unrelated later read failure blocks rendering the requested historical revision. Read the exact frozen revision sources and selected extraction versions directly. Once an artifact is retained, download is independent of rendering, which is an improvement.

## Prior recovery findings addressed

- Terminal result creation now commits under the shared lock, and deliver_result requires a successful pre-delivery checkpoint. Per-job locks prevent concurrent terminal sends. Independent tests cover a failed checkpoint and two simultaneous delivery callers. The harmless mutation survives; removing the pre-delivery persist fails at the no-POST assertion, and removing delivery serialization fails at the single-send assertion. See `delivery-guard-results.json`.
- A dispatch batch now checkpoints and catches errors per job. Replaying the prior bad-middle-job probe returns requests for good jobs 1 and 3 while recording an error for job 2. See `dispatch-probe.json`.
- Static SQL review shows explicit retry can supersede legacy active extraction jobs lacking dispatch/checksum custody, and mismatching old partial chunks now leave the complete new page extraction available while search stays unresolved. These were not run against a live database by this reviewer.
- Cancellation IDs now travel in poll responses and the worker marks the matching accepted job canceled at its next processing checkpoint. Cancellation is cooperative between stages; it does not interrupt an in-flight OCR subprocess immediately.
- New unreferenced page extractions use cascading document/job deletion, while work-program extraction references still restrict deletion of retained cited sources. The owner said the test database constraints had not yet been reapplied, so no applied-schema claim is made.

## Export recovery evidence

`export-recovery-probe.cjs` executes the actual transpiled export worker script with real scratch-file reads/writes, a synthetic renderer and mocked storage/RPC boundaries. On the first run, storage succeeds and final database custody fails. The retry reuses cached bytes without calling the renderer, detects the existing storage object, checks its checksum and commits the same checksum/path. Only one render runs across the two attempts.

A separate case replaces the retained mock-storage bytes with a corrupt synthetic object. The worker refuses completion. The harmless comment control survives. Disabling cache recovery fails because the retry rerenders; disabling existing-object checksum verification fails because the corrupt object is committed. Evidence is in `export-recovery-results.json`. An initial scratch-harness syntax error and a mutation-stop issue were corrected before these final controls; neither is counted as product evidence.

## Permissions and retained identity

The export enqueue route authenticates program read access and refuses unregistered agent writes. SQL rechecks membership, locks the selected revision and creates one document per revision/format. Viewer membership can prepare derived review files; this is the current policy in both route and SQL, not an accidental mismatch between them. If viewers must never create derived artifacts, that policy needs a different positive role check.

Claim uses an expiring token and row locking with SKIP LOCKED. Finish checks current token, expiry, cancellation, membership and document workspace; once a checksum exists, the document trigger protects file checksum, size, content type and storage location against replacement and prevents deletion. Storage paths include workspace, document and checksum; uploads use upsert false, and an existing object is verified rather than overwritten. The download route confines bucket/prefix and uses authenticated, private no-store delivery. Its hash header is the saved checksum, not a freshly computed hash of streamed bytes.

## Not established here

No live migration/RLS/storage operation, actual renderer output, lease-expiry competition in PostgreSQL, worker process supervision, computer-crash durability, backup restore or browser journey was run. The renderer and storage fakes do not prove PDF/XLSX layout or bucket MIME acceptance. Local render files use atomic rename but no file/directory fsync, so the scratch recovery test establishes process-level file reuse, not power-loss persistence. The final committed remote artifact remains the intended durable handoff.
