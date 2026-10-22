# Independent review of the portfolio import correction

Bounded source acceptance. I find no new P1 or P2 in candidate `536d4ccbd6e1028a3632e85b41ae7c655fcac21a`, based on `1b2fefe0f0e98f99700fc77e99146fe697b43ee7`. This accepts the duplicate-read pagination and uncertain-result wording for integration review. It does not establish database, browser, build, installation or planner acceptance.

## Review identity and ownership

The assigned review checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-28503658`, branch `t3/review-portfolio-import-correction`. It starts clean at `05dd3e8da` and fast-forwards after fetching to `b259d73e56d22d4935ef2789874cf69901786b33`, the PR 327 merge. The candidate remains a direct child of the specified `1b2fefe0f` base. I read its Git objects and make a private source copy from those objects. I do not read or modify the candidate owner's working files.

I own only this review directory and private probes under `/tmp/portfolio-independent-nbihok5d`. No application changes enter this review branch. I read current AGENTS, the first external coordination entries, the binding contract, roadmap, requirements ledger, capability matrix, current direction review, known issues and architecture. The external record assigns integration, browser evidence and production operations to the parent. This review takes no production slot and changes no coordination entry.

The nested `npm run product:direction:check` exits zero on the fetched review head. It retains the expired registry/matrix reminders, v0.66.0 review versus v0.68.0 package reminder, and intervening-change reminder. This checks direction records, not current product fitness. The planner-writing and prove-it skills guide this report and its controls.

## The two corrections address the reported defects

The runtime diff changes only `openplan/src/app/api/projects/import/route.ts`; the other application change is its focused route test. The importer, review libraries, SQL, source upload/download and export remain unchanged.

Both duplicate collections now request ascending primary-key order and inclusive 500-row ranges. Every project page selects `id, name` and filters the requested workspace. Every receipt page selects the full source hash, worksheet index, physical row, fingerprint and created-project identity, and repeats workspace, source-hash and created-outcome filters. Ordering by `id` does not require returning `id` in that receipt projection. The helper advances by the returned length, continues after a nonempty short page and stops at an empty page. A returned error discards accumulated results; a thrown error reaches the outer refusal. Neither path proceeds to commit with a partial review.

The private probe applies filters, sorting and projections, unlike the candidate's simpler row-cap mock. With a synthetic 137-row response cap, it reaches a normalized name match after row 1,000. Offsets are `0, 137, 274, 411, 548, 685, 822, 959, 1001`; the final request is empty. Foreign-workspace names do not enter the review. Receipt pages retain an exact prior identity beyond 1,000 while excluding other workspaces, hashes and outcomes. Errors after a nonempty page refuse preview for either collection.

The generic returned RPC error now calls the outcome unconfirmed and directs re-review. It makes no rollback claim. The existing component clears its approved hash after a failed commit. It does not automatically repeat the write. On re-review, the library forces an exact prior creation to skip. The recognized `23505`, `22023` and insufficient-privilege responses remain specific database refusals. I inspect their SQL basis but do not execute the transaction.

## Source, approval and provenance trace

Projects navigation leads to the existing importer. It stores the source through the workspace Knowledge Base upload route before inspection. That route hashes the uploaded bytes and scopes byte-identical deduplication. The import route independently checks the current caller, write role, workspace-level spreadsheet record and confined Storage reference. It downloads the stored bytes and compares their computed hash with the recorded checksum.

The planner chooses the sheet, header, mappings and row decisions. The review library computes the preview hash from source content, configurations, reviewed rows, decisions, warnings and duplicate results. The commit route recomputes that review. The private probe obtains an actual preview hash, changes a mapping, and observes `stale_preview` with no RPC call. A write-role downgrade after preview returns 403. Changed stored bytes with the old recorded checksum return `source_hash_mismatch`.

Retry identity consists of the full source hash, worksheet index, physical row and raw-cell fingerprint. The private probe changes the name/description mapping and confirms the same raw source row remains locked to skip. This identity deliberately differs from a mapped source ID. Selected-batch source IDs use case-insensitive NFKC normalization; names also collapse spacing. Existing normalized-name matches require individual confirmation. These checks do not infer semantic equivalence between different files or implement project updates.

The preview hash does not separately encode workspace ID, source-document ID or the optional original-workbook pointer. Route and RPC scope checks protect those references separately. The optional workbook is linked provenance, not a verified equivalence claim about its contents. These unchanged boundaries limit any broader statement about an approval binding every metadata pointer.

The service-role RPC receives reviewed values and writes batch/row provenance. Its created-row unique index includes workspace, full source hash, worksheet, physical row and fingerprint. Import receipts prevent deletion of referenced created projects through the existing foreign key. Recent history exposes source labels and counts; the separate authorized document download route supplies the original bytes. I do not verify delivery, byte parity or user discovery of that download. Source location text remains provenance and supplies no geometry, jurisdiction or adopting authority.

## Independent checks and control quality

Four candidate tests run independently from the exact private candidate copy. They cover uncertain acknowledgement followed by re-review, the project tail, the receipt tail and a later-page error. All four active cases pass. I do not describe this as a fresh run of all 49 cases. The candidate's retained 49-case report records 49 passes.

The separate private probe passes in baseline, harmless-comment and restored trials. Seven mutations fail its single named test at the expected assertion:

| Mutation | Observed assertion |
|---|---|
| Stop on a short page | Normalized tail match is lost |
| Advance by requested page size | Actual-returned-row offsets differ |
| Remove project workspace filter | Foreign-workspace match enters review |
| Remove receipt source-hash filter | Per-page source scope differs |
| Remove receipt created-outcome filter | Per-page outcome scope differs |
| Suppress a later-page error | Partial preview is returned instead of 500 |
| Accept a stale preview hash | Changed mapping reaches commit instead of 409 |

The controller requires the exact active test, exit code 1, one failed test and the named assertion diagnostic containing `AssertionError:`. A harmless comment survives before destructive controls. Every private route mutation restores original bytes in `finally`. The restored SHA-256 is `15a244fb60d281da3d880a14f8c44881576b900539b255a2b8d4d3027079715f`, matching the candidate object.

The first control run refuses a mismatched expected marker: advancing by 500 still reaches the tail, but fails the offset assertion. That refusal is retained privately. A separate final run uses the correct expected offset assertion and completes. It does not count the refused run as a successful kill.

I also inspect the candidate controller and audit its retained reports. All 34 recorded trials match their active test and expected outcome, including 10 intended faults. The recorded startup, wrong-name, wrong-assertion and extra-failure refusals have the stated classifications. Its `finally` restores both affected source files. All 26 tracked source bindings match candidate Git objects. The additional generated private-config binding is absent from Git as documented; I do not claim to verify that removed file. I do not rerun the candidate's full mutation controller or treat its source inspection as fresh execution.

All independent test runs use one worker, private Vite caches and reused dependencies without writing their files. Transient scopes enforce `MemoryMax=1G` and `MemorySwapMax=0`; Node uses a 640 MiB heap limit. The final controller records a 159,236,096-byte scope peak. No application service starts. `evidence.json` records the bounded results and private probe hashes.

## Remaining limits belong in parent acceptance

Ordered offset pages do not form a database snapshot. Concurrent inserts, deletes or newly visible records can shift offsets or appear after a collection has finished. The two collections also have no shared snapshot. Commit-time uniqueness and duplicate checks reduce consequences but do not prove snapshot consistency. SQL name checks use lowercase and whitespace normalization, while the JavaScript review also uses NFKC. Therefore the unchanged SQL recheck does not establish equivalent protection against a newly introduced compatibility-character name during a race. No concurrency or normalization-parity guarantee follows from this review.

The mocks cannot prove native PostgREST cap/order behavior, RLS, role-change timing inside a transaction, atomic rollback, concurrent uniqueness, acknowledgement loss, actual permission changes, source custody or database recovery. The error probe models a returned database error; it does not interrupt a network connection. The controller checks a named assertion diagnostic, not every possible infrastructure failure or test implementation defect. Static source bindings establish identity, not runtime acceptance. Reading the direction check's successful result does not independently mutate that unchanged guard.

The parent still needs an identified integrated build and ordinary Projects navigation at desktop and 390px. Cover upload, sheet/header selection, mappings, default skips, selected creates, source-ID conflicts, individual name confirmation, failed reads, stale approval, interrupted commit and re-review. Check current roles and a large prior import against an isolated actual database. Inspect the console, created-project links, retained history, original-file delivery and byte parity. Preserve unresolved geography and authority. Native file selection, responsive layout, accessibility, constrained networks, capacity, recovery and practicing-planner usefulness remain unverified.

I run no full suite, build, browser, native database, worker/service, hosted, GitHub, PR, push or merge operation. No nested agent runs. The unchanged export/workbook truncation concern remains the separate implementation lane identified by the owner; I neither edit nor duplicate it. This report promotes no capability, scientific, legal or release claim.
