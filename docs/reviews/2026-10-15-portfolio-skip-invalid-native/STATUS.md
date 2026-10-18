# Native import correction passes in a retained rollback target

The full candidate creates the valid selected row and retains the invalid
skipped classification in its audit record. The unchanged-SQL repeat produces
40 expected case notices and an exact 395-record before/after inventory match.
The corrected browser journey remains pending. This is native SQL evidence,
not an installed release or an HTTP import result.

## Reviewed candidate and probe correction

The parent reads the complete [independent source review](../2026-10-15-portfolio-skip-invalid-independent-review-round1/README.md),
commit `41f9b71576510d6e478179e53faa410e5e801217`, for candidate
`aa93a3916e4a1464c774dd30a43ae2f7a4824311`. It reports no additional P1/P2
product finding, but identifies a P2 probe setup hazard. A schema grant needs
the actual temporary namespace rather than the `pg_temp` alias.

The parent applies the review's exact recommended block: select the namespace
by `pg_my_temp_schema()`, then quote its catalog name with `format('%I', ...)`.
The product migration remains byte-identical, SHA-256
`b129f80e37aa9be71069683acd42df3fb6fdb94078ed0458f20b6e9c5155a41b`.
The corrected generator has SHA-256
`4a9c497d90baa58075e90a81a2e2c6778e55eeb9540920e7278871df1ec488c4`.
An assembly baseline and harmless comment pass; restoring the alias, using a
wrong namespace lookup, or dropping identifier quoting each fails its intended
emitted-SQL check. These assembly controls do not execute PostgreSQL.

## Exclusive target and retained source bytes

The parent verifies the owned container's full identity, target-name absence
and available disk before creating
`openplan_portfolio_skip_137003c3b2dc1aa54af843e5`, OID 6134407, owner `postgres`.
It restores the existing frozen 16,232,305-byte dump with one restore worker and
a single transaction. Dump SHA-256 remains
`181caa01d5ebe66b50da9dcba1242b225e75cfdc8bd0fe03e3c4a9ae86e4d398`.
No fresh dump or write targets the source anchor or active preview.

The actual new baseline reports 419 migrations through `20261017000016`.
Every table-data, version and sequence projection matches the retained source
snapshot. The probe independently requires the exact original v2 function body,
the target name and this history before creating fixtures. The parent checks
target OID, owner and zero active connections before the first run.

The installed server is PostgreSQL 17.6. An initial read-only inventory query
uses the obsolete `daticulocale` column and fails before database allocation.
The corrected query uses the installed `datlocale` column. The failed read is
retained as an operating error, not product evidence.

## Actual transaction cases

The generated SQL has SHA-256
`39867a89e7b8bbdf237bedfe8f092790af8e67e95f2bcb1e6a0800dde986f4fe`.
Both runs use this same file with `psql -Xq -v ON_ERROR_STOP=1`, one session and
the shared compiler lock. Each starts one transaction and ends with rollback.
SQL statements use ten-second deadlines, three-second lock deadlines and
16 MiB work memory. The existing database server is not claimed memory-capped.

The observed cases distinguish the two original barriers:

- The exact original function rejects the frozen mixed payload with `22023`.
- Changing only the copied skipped status to a supported value succeeds. The
  original source and frozen payload remain untouched.
- A harmless function comment preserves the original refusal.
- The function-only correction reaches the named audit-status CHECK and raises
  `23514`.
- The full candidate creates one project, records one invalid skipped row and
  retains both audit rows. It preserves `125000 EUR`, null price year, source
  document and actor custody, source hash, preview hash and row fingerprint.
- A separate skipped row preserves its invalid phase and surrounding plan-type
  whitespace exactly as supplied to the RPC.

Thirty-two expected-error calls compare their intended SQLSTATE, message or
named constraint and verify unchanged project, batch and audit counts. They
cover invalid created classifications, blocked creation, missing formula/name
confirmations, duplicate source IDs, replay identity, invalid late text/cost,
and a second-row cost failure after an earlier project insertion. They also
cover viewer/outsider actors, foreign or changed source metadata, malformed
review identity, worksheet/row structure, direct invalid created audit rows
and immutable audit updates.

Actual service-role invocation succeeds. Anonymous and authenticated RPC calls
are denied, alongside explicit function-privilege checks. A workspace member
reads the three expected audit rows and two batches; an outsider reads none.
The positive XLSX case tests SQL metadata custody, not workbook parsing or
Storage bytes. The final notice confirms original function, constraints,
counts, fixture absence and absent migration-17 history after rollback.

## Inventory discrepancy, repeat and warning

The first run exits zero and produces all 40 notices. Its before/after
inventory matches 393 of 394 records. Only the `pg_class` digest differs.
The parent retains the result, catalog maintenance timestamps and the first
inventory. Original full catalog rows were not captured, so the exact changed
row cannot be retrospectively attributed to background maintenance or the
probe. That first run is not reported as a full inventory match.

This unresolved difference justifies one narrow repeat. The parent adds full
`pg_class` rows to the existing repeatable-read inventory function without
changing the SQL under test. The second run again exits zero with 40 notices.
All 395 inventory records now match exactly, including those full catalog rows,
table data, sequence state, function/constraint/policy/trigger catalogs, roles
and settings. Both inventory files have SHA-256
`c94fc2a97d79154b24fbe8065af1567cc6f008bab4d61c55e3e5a7115fc4ce06`.
The first attempt remains intact. No acceptance condition is widened.

Each probe logs one warning that no privileges were granted for its actual
temporary namespace. A separate rollback-only diagnosis finds that
`supabase_admin` owns it, the current role is `postgres`, and `service_role`,
`authenticated` and `anon` already have USAGE. The actual role calls and
function-privilege assertions pass. This establishes the probe's required role
access on this installation; it does not claim that the warned grant changed
an ACL or that the run was warning-free.

The cluster inventory shows exactly one newly allocated database and unchanged
recorded properties for every earlier database. The test database remains
retained at 419/latest-16, with the candidate rolled back. The existing web
invocation `34615ba06b554482b0f79c90fe999a61` remains active. No hosted database,
provider, source anchor, preview binding, release or mainline change occurs.

## Evidence and limits

[Evidence](evidence.json) records sanitized case outcomes and hashes. Private
plans, raw SQL/logs, full inventories, diagnosis and failed-read evidence remain
under `/home/nathaniel/.local/state/openplan/portfolio-skip-invalid-native-root-20261015/`.
The sanitized private summary has SHA-256
`8302ee438980b6f4f786074bf80098a84d22ade04f6bef99516b67bbcb0411d1`.

This tests the real SQL, constraints, roles and rollback behavior on the named
retained target. It does not test Storage bytes, HTTP route recomputation,
simultaneous commits, current approval freshness, whole-installation recovery,
native workbook/GIS rendering, practitioner use or scientific validity. The
original browser failure remains unresolved until an identified corrected
installation completes the actual desktop and 390px journey.

The subsequent [round-two independent readback](../2026-10-15-portfolio-skip-invalid-independent-review-round2/README.md),
commit `98d293e8c7ce5e3742bb1ecdedbf71defe1b2b07`, reads the actual logs, SQL,
inventories and diagnosis. It finds no new P1/P2 issue within this native scope,
confirms the exact repeat inventory and retains the warning and first catalog
difference. The parent reads its complete report and checks 25 current evidence
bindings before joining it. Browser acceptance remains pending.
