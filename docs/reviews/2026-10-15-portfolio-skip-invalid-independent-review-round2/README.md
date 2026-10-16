# Independent review round 2: retained native portfolio evidence

The retained native SQL evidence supports the bounded skipped-invalid-row
correction. This review finds no new P1/P2 product or probe defect. The ROUND1
temporary-schema finding is resolved for the tested installation. The grant
warning and unexplained first inventory difference remain part of the record.
The corrected browser journey remains pending.

## Review target and ownership

This review reads root commit `49e3fa2004c1336ffa36c134a8f21bcc2d72d327`,
candidate `aa93a3916e4a1464c774dd30a43ae2f7a4824311`, and the complete
[ROUND1 report](../2026-10-15-portfolio-skip-invalid-independent-review-round1/README.md)
at `41f9b71576510d6e478179e53faa410e5e801217`. It evaluates the response and
actual saved proof, independently of the implementation author's summary.

The assigned checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-27e657a6`,
branch `t3/portfolio-skip-invalid-review-round2`. It starts clean at `05dd3e8da`
and fast-forwards locally to the exact root commit. Writes stay within this
report directory and the new private directory
`/home/nathaniel/.local/state/openplan/portfolio-skip-invalid-independent-review-20261015-round2`.
Root and candidate checkouts are clean on readback. The canonical checkout
retains its three unrelated untracked entries. No database transport, native
rerun, browser, service, build, full suite, cloud operation, nested delegation,
push, pull request, merge to main or release occurs.

The reviewer reads current AGENTS.md, planner-writing, prove-it, and the
Supabase Postgres privilege and row-level security guidance. This task selects
no new product lane and changes no application source. It therefore stays
within the requested bounded evidence readback without another direction
campaign.

## ROUND1's P2 response uses the actual namespace

The corrected [generator](../2026-10-15-portfolio-skip-invalid-transaction-fix/prepare_native_probe.py)
contains the exact recommended `pg_my_temp_schema()` catalog lookup and
`format('%I', ...)` block. Its diff from the candidate changes that block alone.
The literal `GRANT USAGE ON SCHEMA pg_temp` is gone. Explicit temporary
relation and helper references remain.

Fresh SHA-256 values match the packet:

- Generator: `4a9c497d90baa58075e90a81a2e2c6778e55eeb9540920e7278871df1ec488c4`.
- Migration 17: `b129f80e37aa9be71069683acd42df3fb6fdb94078ed0458f20b6e9c5155a41b`.
- Executed SQL: `39867a89e7b8bbdf237bedfe8f092790af8e67e95f2bcb1e6a0800dde986f4fe`.

The complete saved 2,219-line SQL regenerates byte-for-byte from the corrected
pure assembler and the recorded fixture IDs. The regenerated plan also
matches. Inspection covers the emitted statements and exact embedded original,
harmless-original, function-only and full-candidate bodies. There is one
transaction BEGIN and one final ROLLBACK, followed by restoration assertions.
Preparation controls remain assembly evidence, not PostgreSQL execution.

Both actual logs contain the warning that no privileges were granted for the
actual temporary namespace. The separate rollback-only diagnosis records owner
`supabase_admin`, current role `postgres`, and existing USAGE for `service_role`,
`authenticated` and `anon`. Its namespace belongs to a separate diagnostic
session. It does not retrospectively inspect either probe session's ACL or
prove that the warned GRANT changed any privilege.

The actual service-role success, authenticated reads, role refusals and explicit
RPC privilege checks establish the required tested access boundary. The warning
does not hide an early setup abort. This closes the specific literal-alias
hazard for this installation. It does not establish portability to an
installation with different temporary-schema defaults.

## Raw proof reaches the intended cases

The reviewer reads both raw stdout/stderr files, results, execution intent,
prepared SQL, diagnosis, restore records and inventories under
`/home/nathaniel/.local/state/openplan/portfolio-skip-invalid-native-root-20261015`.
All 12 raw-log/result/inventory hashes listed in root's public packet match
fresh readback. The private sanitized summary hash also matches. Its summary
does not substitute for the underlying records.

Both recorded psql runs exit zero, emit 40 case notices, and emit the final
rollback restoration notice and stdout message. Each has 32 expected-error
notices with unchanged project, batch and audit counts. Neither stderr file
contains an ERROR or FATAL line. Each retains one grant warning.

The stage order distinguishes both original barriers. The original function
rejects the frozen mixed payload with `22023`. Changing the copied skipped
status alone succeeds. A harmless comment preserves the original refusal.
The function-only correction reaches
`project_portfolio_import_rows_resolved_status_check` with `23514`. The full
candidate then creates one project and records one invalid skipped row.

The successful block queries the created project and skipped audit row with
`INTO STRICT`. It checks `125000 EUR`, null price year, source document and
cost actor, active status, programming phase, source hash, skipped fingerprint,
error array, both audit rows and batch preview hash. The frozen input retains
the approved hash
`b8d13529a3267b9b733a3ec80181494615d44c4940e833866bf691da006d0508`
and unknown-price-year warning. A separate positive case checks literal invalid
phase and surrounding plan-type whitespace at the reviewed RPC boundary.
This does not claim fidelity to an untrimmed original workbook cell.

The readback independently extracts all 32 error specifications from the saved
SQL and compares actual SQLSTATE, required message substring or named
constraint, and count assertion. All 28 RPC-error contexts name the actual
`commit_project_portfolio_import_v2` function. The other four expected errors
come from two direct audit inserts and two immutable-audit updates. No expected
case can succeed just because some unrelated command returned nonzero.

Name confirmation lets cost, text and replay cases pass the existing-name
barrier. The late second-row case supplies two distinct valid names and
fingerprints, with invalid cost on the second row. Source order and the error
context show that the cost guard is reached after the first row can insert a
project. The enclosing error subtransaction leaves project, batch and audit
counts unchanged. This is sequential transactional evidence, without a
simultaneous-commit claim.

Created invalid status, phase and plan type still fail. Blocked creation,
formula confirmation, current/batch name confirmation, duplicate source ID,
created identity replay, source scope/hash/status/type/reference, review hash,
worksheet setup, skipped fingerprint and decision still reach their named
refusals. Direct created-audit inserts fail on the intended status and phase
constraints. Both audit-update cases reach the immutable-provenance trigger.

The helper uses invoker rights. The RPC remains service-only and security
definer. The main positive call switches to the real `service_role`. Actual
authenticated and anonymous calls receive `42501`; explicit function privilege
assertions separately exclude accidental EXECUTE grants. Authenticated member
reads see three audit rows and two batches. An outsider sees neither table's
rows. These results cover the fixture and named RPC, not every RLS policy.

## Inventory claims match the actual JSON

The retained dump still has 16,232,305 bytes and SHA-256
`181caa01d5ebe66b50da9dcba1242b225e75cfdc8bd0fe03e3c4a9ae86e4d398`.
Every table-data, version and sequence projection in the first native baseline
matches the original retained source snapshot. Restore records identify the
new exclusive database `openplan_portfolio_skip_137003c3b2dc1aa54af843e5`,
OID `6134407`. The original-function preflight and 419/latest-16 history checks
precede fixtures.

The first before/after pair contains 394 records. Exactly 393 match. The sole
difference is the `pg_class` digest, at record index 376. No original full
catalog rows exist in that pair. Maintenance timestamps do not identify the
changed row or establish the cause. This first attempt remains an incomplete
inventory match.

The repeat adds full `pg_class` rows to the existing snapshot query and changes
the output filenames. It removes no prior inventory field, changes no SQL under
test, and widens no condition. The actual second before/after files match
byte-for-byte and semantically across 395 records. They include 376 table
records, 11 catalog digests, role/membership/settings digests, sequence
projection, metadata, properties, migration versions and 2,702 full `pg_class`
rows. Both file hashes are
`c94fc2a97d79154b24fbe8065af1567cc6f008bab4d61c55e3e5a7115fc4ce06`.
This establishes the repeat's recorded rollback preservation. It does not
explain away the first difference.

The two cluster JSON inventories contain 609 and 610 database-property
records. All 609 earlier records match exactly; the named new target is the
sole addition and has the recorded OID. This is property preservation for
other databases, not a fingerprint of their contents. Both target histories
remain 419/latest-16. Final assertions check the original function and both
constraints, original counts, absent fixtures and absent migration-17 history.
Catalog digests provide a separate comparison of stored functions and guards.
The candidate does not remain installed in this retained database.

The preallocation obsolete-column read failure remains in the packet. The
reviewer reads its `daticulocale` error and the corrected inventory's
`datlocale` query. It is an operating error, not a product test result.

## Preservation and evidence controls

The application tree has no diff from the reviewed candidate. The migration
retains the narrow function diff and two decision-aware audit CHECK changes.
Existing source, actor, cost, duplicate, structural, immutable-audit and
privilege protections remain. All eight original browser failure files match
their pinned hashes on fresh readback. Neither the prior failure nor ROUND1's
historical packet is rewritten.

The reviewer runs bounded checks on fresh in-memory copies of the saved
evidence. A trailing blank line survives. Fifteen faults fail for their stated
reasons: wrong SQLSTATE, wrong constraint, wrong late-error message, missing RPC
context, false unchanged-count result, wrong cost, wrong role refusal, outsider
visibility, lost raw-skip assertion, failed workbook count, persisted migration
notice, missing final notice, changed table count, changed full catalog row,
and omitted full-catalog record. Fresh rereads and hashes confirm original
files remain unchanged. These are evidence-reader controls, not another SQL
execution or product mutation campaign.

The first reviewer parser attempt rejects four-argument calls because it
expects the optional fifth argument. The local reader is corrected to apply
the helper's documented NULL default. That operating failure is retained in
the assigned private directory. No product or original evidence changes.
[Sanitized observations](evidence.json) record independent measurements,
bindings and copied-evidence control outcomes. The private reader and its
observations remain in the assigned private directory.

## Disposition and remaining limits

No P1/P2 objection remains within this native SQL readback. Root may use this
review as evidence for the bounded SQL correction and its retained rollback
test. The original UI failure remains open until the corrected identified
installation completes desktop and 390px navigation and artifact review.

The SQL creates metadata fixtures without Storage objects. This review does
not establish Storage-byte custody, HTTP review recomputation, current approval
freshness, concurrent commits, whole-installation recovery, native Excel/QGIS
rendering, practitioner acceptance or scientific validity. Count checks cannot
detect same-count updates; the independent inventory covers its listed logical
projections. Those projections do not cover all catalogs, physical state,
external effects or every possible sequence property. No live connection is
made to reverify current database or service state. This report authorizes no
claim of browser success, hosted readiness or release acceptance.
