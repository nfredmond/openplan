# Publication refuses reader-inconsistent retained packets

October 16, 2026. Source correction after independent review. Native migration,
transaction, browser and release acceptance remain open.

The independent review of `3ce1a92e017e96c8d0c15230b2ab8d1836969f7f`
requests changes for two P2 findings. Its complete report and evidence index are
preserved unchanged in
[`../2026-10-16-land-use-publication-transaction-independent/REPORT.md`](../2026-10-16-land-use-publication-transaction-independent/REPORT.md).
That verdict remains part of the record. This response does not declare itself
independently approved.

## Repeat verification uses one total artifact

The unchanged edition page, provenance endpoint and designation-map endpoint
select the latest artifact without filtering its kind. The earlier function
verified one HTML artifact even when a newer PDF could supply different metadata
to those readers. A timestamp tie also leaves their selection ambiguous.

The corrected function counts every artifact for the retained report and requires
exactly one. It share-locks that artifact, requires HTML, and rejects the
`land_use_plan_implementation_report` metadata marker. The existing scope,
snapshot, content hash, manifest and review-release comparisons still apply.
With one retained artifact, the existing latest-artifact readers select that
same record regardless of timestamp ordering.

This deliberately refuses additional artifact history, including history whose
metadata might otherwise agree. It does not delete artifacts, choose an older
record, reorder history or revise the readers. A later consumer design may support
multiple artifacts, but this bounded verifier makes no such claim. Row locks and
the count do not exclude every concurrent direct child insert or privileged
writer. Native concurrency and global artifact-history integrity remain separate.

## A retained manifest must contain a readable native decision

A correct JSONB-text hash establishes the retained representation, not the
nested decision shape. The existing trigger does not establish that shape.
The function now requires an object with all seven reader-required keys,
explicit string fields, and present string-or-null vote and effective-date fields.
It rejects native body and instrument values that the reader trims to empty.
The whitespace set matches the established ECMAScript trim set already used by
the implementation-report migration.

The manifest must contain all seven decision values from the selected native
record: kind, body, instrument type, instrument identifier, vote, decision date
and effective date. Dates use an explicit `YYYY-MM-DD` representation and must fall
within years 0001 through 9999. Nullable native values must match explicit JSON
null. Additional object keys remain allowed. Missing keys, wrong types or a
different native value refuse before report insertion or existing-packet return.

The earlier snapshot encoding, top-level scope and manifest hash checks remain.
The function does not synthesize a decision or change its stored bytes or hash.
The adoption reader and its existing refusal remain unchanged. The helper, route,
base grants, locks, pointer update, transaction intent and current-adopted gate
also remain unchanged.

PostgreSQL documents that JSON extraction returns SQL NULL for missing or
inapplicable paths and distinguishes JSON null. The correction uses explicit
presence/type checks and an `IS NOT TRUE` containment gate. These documentation
semantics support the source choice; they are not execution of these SQL bytes.
[PostgreSQL 17 JSON functions](https://www.postgresql.org/docs/17/functions-json.html),
[date formatting](https://www.postgresql.org/docs/17/functions-formatting.html).

## One bounded source check window completes

The root owns the combined checkout at parent
`65ec771d3b45a7297fac7f007404ff7730a82a73`. It changes only unapplied migration
425, one existing SQL-composition assertion and one new focused test file.
Migration 425 retains its previously CLI-generated filename. Its prior SHA-256
`15d1904db83f83d7ac93bc7aa7910de042f2e94ac256c4579906d48a036d2272`
and exact source are preserved privately. No database receives either version.

One unit, `openplan-land-use-publication-retained-checks-20261016-01`, finishes
exit zero. The parent records 84.71200391999446 seconds. Entry metadata records
invocation `af42b94683474b90abbe78374be5713a`; the manager announcement does not
print that ID. Actual limits are 1 GiB, zero swap, CPU 50% and Tasks64. The late
memory peak is 387,313,664 bytes, PID peak 43, with zero memory/PID limit events.
Named source/donor mounts are read-only and the private proof root is writable.
The network namespace differs from the host. These observations are not a
host-wide confinement claim.

Harmless, baseline and restored selections each pass 21 cases. Twenty are new:
14 actual adoption-reader cases with supplied records and six SQL-composition
checks. One existing canonical-packet SQL assertion provides continuity. The
other old helper, route and adoption campaigns do not repeat.

The SQL-comment harmless control survives. Twelve named faults fail their exact
baseline-joined oracle with actual AssertionError messages. Eleven faults alter
only the private SQL text fixture: HTML-only counting, missing singleton guard,
wrong kind acceptance, implementation marker acceptance, missing object/key/type
checks, blank native text, date range and native-value mapping. The twelfth uses
an in-memory transform of the actual unchanged adoption reader, replacing its
invalid status with absent. That fault produces 13 intended failed assertions.
The singleton-guard fault produces two; the other SQL faults each produce one.
Exact names, messages, input hashes and applied transforms remain in EVIDENCE.json
and the private receipts.

Scoped types, focused lint and nested direction each exit zero. Existing expired
review, strategy-age and version reminders remain in direction stderr. The final
ten source/config/test pins and eight preservation pins match. The active
transform is empty and the SQL fixture restores to the candidate. A read-only
lock inventory has no matching holder after the parent terminates. No retry or
successor unit runs.

## Evidence limits remain explicit

The reader fixtures distinguish valid explicit nulls, missing decision/nullable
keys, null/string/array/number decisions, wrong field types, blank text, unknown
kind and an invalid calendar date. The valid case asserts the native projection
and exact scope filters. It does not execute SQL or prove that PostgreSQL's
function refuses each fixture. SQL tests inspect source composition. They can
match dead code or comments and do not prove parsing, NULL evaluation, transaction
rollback, trigger effects, ACLs, RLS, locking or installed behavior. Native valid
single-artifact reuse, newer-PDF history, timestamp ties, disqualifying kind and
decision-shape refusals still need a separately reviewed native operation.

All 3,119 original private evidence entries match their hashes, lengths, modes
and ownership. The original checks01 failure remains failed. No old corpus is
copied or regraded. Two nonexistent configuration-path reads and a truncated
report read are retained as metadata-reader notes; the correct files and full
report are subsequently read. A static inspection of installed Vitest each()
dispatch confirms that the mixed fixture table passes the array case as an array;
no test amendment or additional runtime follows that inspection.

The new private manifest binds 2,601 files, including private caches. Later local
commit metadata remains outside that frozen manifest. The evidence index binds
the exact source and results. A fresh independent exact-commit review is required.

No new native SQL, parser, migration application, DB target, Docker, HTTP,
provider, browser, identified build, desktop/390px journey, public artifact,
practitioner or release proof runs. The separate M1 empty-root guard result does
not establish those tiers. KI-025, M1, scientific acceptance and the full V1
contract remain open. The canonical checkout's three unrelated entries remain
untouched.
