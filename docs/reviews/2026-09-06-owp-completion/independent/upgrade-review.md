# Independent migration upgrade review — round 7

No upgrade compatibility defect found within the focused subsystem replay. Both supported predecessor → current 00001–6 and authentic early-applied 00001–4 → current 00005/6 succeeded. This is not a claim that the entire Supabase stack was installed from empty.

## Method and custody

Only `supabase_db_openplan_owp_preparation` was contacted. Docker port identity was asserted as 56322 before execution. Each replay used newly named private application/storage schemas within one PostgreSQL transaction, ending in ROLLBACK; errors closed the connection and rolled back. No DROP, reset, persistent schema change, canonical-stack access, source edit, or service interruption was performed. `rollback-check.txt` reports zero surviving private schemas and fixture users.

Baseline OWP migrations are actual 20260906000001–3. Their prerequisite Documents/support tables were reconstructed from installed column/default/check/unique/index catalog, excluding fields introduced by the six migrations. Authentic early applied SQL came from the saved `.applied-statements.json` files in the preparation DB scratch directory; these were copied without editing. Current final six migrations were snapshotted and their SHA-256 values compared to the source checkout; all match (`source-snapshot-check.json`). Migration schemas/search paths were redirected to transaction-owned namespaces. Auth users were synthetic transaction-owned rows in the existing auth table. Existing extension/type definitions were reused.

The baseline fixture contains an original retained PDF identity, source attachment, saved revision with explicit historic financial notes, completed legacy job, and callback receipt. Before the repair, each path additionally creates retained extracted pages including a blank page, a source extraction version, and a completed immutable PDF export. Checks compare historical JSON rows, preserving original identities and ignoring only intentionally added columns during the initial schema extension. After 00005/6, all custody rows must remain unchanged. Both repairs run a second time and the same historical assertions pass. The original 00001–4 are create-once migrations; they were not misrepresented as raw idempotent SQL.

## Results

`results.json` records 11 final cases: four baseline/no-op runs pass; seven targeted broken cases fail for the intended assertion. Each passing run exercises the seven actual captured recovery/RLS SQL contracts, plus independent null lease-token, checksum, byte-count and storage-path rejection probes.

- Historical revision mutation: fails `Forward repair rewrote historical custody` on both paths.
- Granting authenticated callers the actor-parameter extraction RPC: fails `Actor spoof allowed` on both paths.
- Removing the NULL byte-count guard: fails `Null export bytes accepted` on both paths.
- Omitting forward repair 00005 from the early-applied path: fails `Null lease token accepted`.

All ten final functions, all scoped constraints, policies and function ACLs compare equal between paths (`catalog-comparison.json`). Historical counts agree: one source, one revision, one pages version, one source extraction version, two Documents, three jobs, two receipts. Actual contracts cover legacy retry recovery, changed request identity, atomic callback/pages/index application, callback deduplication, partial-index conflict recovery, revoked access and foreign chunks, viewer/outsider extraction RLS and direct-write prohibition, service-only RPC access, export leases/artifact immutability, and scoped cancellation.

One verification weakness was found and preserved: the original seven captured contracts also pass when 00005 is omitted from this authentic early snapshot (`original-suite-omission-survivor.*`). Therefore those seven alone do not demonstrate the nullable-input repairs. The added focused probes kill the omitted-repair mutation. Recommendation: retain equivalent NULL-token and NULL-byte export assertions in the repository suite. The implementation guard is present in `20260907000005_work_program_recovery_forward_repair.sql:237` and `:257`; this finding concerns test coverage, not a currently missing guard.

## Limits

This reconstructs the directly involved supported predecessor schema; it does not replay all unrelated historical migrations, external module triggers/FKs/RLS, storage-object HTTP behavior, physical backup restore, PostgREST schema-cache refresh, or concurrent upgrade locks. The actual new migration constraints/RLS/functions are replayed, but prerequisite support-table foreign keys, triggers and unrelated RLS are not cloned. Existing global extensions/types are reused. The historical corpus is synthetic and small. These results supplement, rather than replace, root's full isolated live RLS, worker and browser evidence. No evidence was collected from the canonical database.

Scripts and snapshots are exclusively in this scratch directory. `build-replay.py` builds the scoped scripts; `finish-review.py` executes the guarded cases. SQL stdout/stderr and initial omission survivor are retained. Repository status was recorded before and after shell work; this agent made no repository changes.
