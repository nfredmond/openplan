# Legacy KPI recovery candidate

Normal assignment and ActivitySim KPI writes still use direct inserts. A lost
response can leave a committed row with no recoverable request. The existing
managed-attempt command is not a substitute for these unmanaged callers.

The rollback-only SQL candidate retains an explicit KPI identity, workspace,
run, stage and complete payload alongside its original response. A transaction
writes the KPI and private receipt together. Exact retries return the historical
receipt; changed requests refuse reuse. New writes lock the run and stage and
refuse a wrong workspace, missing stage, managed parent or stopped run. Receipt
history does not establish current ownership or authorize a stage restart.

The KPI table has no stage column, and its run/name index is not unique. An old
row therefore cannot establish originating stage. This candidate refuses any
existing identity without its own receipt, even when the row values match.
The first candidate mirrored artifact adoption; review identified this missing
stage evidence and replaced adoption with explicit reconciliation before the
final proof. No application schema was changed by either candidate.

## Numeric and missing-data boundary

All fields are explicit. Value may be a JSON number or null; null is not zero.
Geometry may be a string or null. Breakdown is an object or explicit null. Unit
must be a string, including an intentionally empty unit. The candidate rejects
extra fields, noncanonical identities, blank labels and invalid categories.
It verifies that conversion to the table's double-precision value preserves the
JSON number exactly. The proof rejects `9007199254740993`, which would otherwise
round when stored as a double. This is a representational check, not a test of
scientific meaning, units or measurement uncertainty.

## Native evidence

`prototype/verify_legacy_kpi_command.py` runs the SQL candidate and cases in a
transaction in the existing isolated synthetic attempt-proof database. Baseline,
harmless-comment and restored variants pass. Eleven adverse variants fail at
specified assertions: changed-request comparison, original response replay,
existing-row refusal, stopped-run and workspace checks, private-table privileges,
and field, identity, text, value-shape and numeric-roundtrip guards.

Cases also verify late receipt-failure rollback, explicit null preservation,
wrong-stage and managed-parent refusal, and historical retry after a stopped run.
After every variant, the transaction rolls back. The final probe confirms the
candidate table and function are absent. Private output is
`model-command-client-20261008-proof/legacy-kpi-rollback/legacy-kpi-command.json`.
The fixture is synthetic and no application database is the target.

## Required next work

This is not an installed migration or connected worker path. Native HTTP lost-response recovery, retained client
validation, additive migration/upgrade evidence, schema accounting, and actual
caller adoption remain open. The next implementation must bind stable identities
to destination, run, stage and KPI slot, never to mutable numeric values. Existing
rows need reconciliation instead of silent adoption or deletion. Current stage
ownership, computation recovery and scientific acceptance remain separate gates.


## Independent sessions and HTTP permissions

The contention proof uses independent PostgreSQL service-role sessions and
observes their actual lock waits. Fifteen cases pass: baseline, harmless and
restored exact retries, changed requests, cleanup-first and write-first orderings,
plus three targeted fault controls. Exact retries leave one KPI and one receipt;
cleanup-first leaves neither. Write-first preserves the historical receipt after
the real stale-run reaper marks the run failed. Mutants that bypass request
comparison, return the wrong receipt or allow a write after cleanup are caught.

The temporary PostgREST proof passes baseline, harmless and restored variants.
Membership fixtures first establish that a member sees the run and an outsider
does not. Both receive 403 from the command; anonymous and unsigned calls receive
401. Service execution and exact retry succeed. Direct receipt-table access is
refused even to the service role. An adverse authenticated EXECUTE grant exposes
the synthetic retained receipt, and revocation restores the outsider's 403.
The first invocation omitted the required disposable-container environment
variable and stopped before database work; the corrected invocation supplied the
explicit owned target without weakening the guard.

Each proof removes its candidate function and receipt table; the gateway context
removes its temporary container. Synthetic fixture rows remain in the owned
proof database. Private evidence is in `legacy-kpi-contention/` and
`legacy-kpi-http/{baseline,harmless,restored}/` under the proof root. These results
supersede the concurrency and HTTP-permission gaps above. They do not establish
lost-response recovery through a retained client or normal worker adoption.

## Retained client and recovery dispatch

`model_legacy_kpi_command.py` now prepares complete requests in the existing
SQLite journal. Identity derives from deployment, run, stage and a named KPI
slot, not the value or other mutable payload fields. Changed requests refuse
reuse before and after receipt resolution. The common client and recovery CLI
recognize the candidate RPC. Normal `sb_post_kpi` callers remain unchanged until
migration and native client recovery evidence are complete.

Six focused tests cover slot and deployment separation, exact request recovery
after a lost reply, cached receipt reuse, explicit null versus zero, numeric
receipt equivalence, field completeness and invalid values that never send.
Mismatched receipts stay pending. The maintained mutation suite now includes the
new dependency and test file. Harmless copies pass; four targeted faults fail
at scope, numeric precision, mutable identity and receipt comparison boundaries.
All nine mutation-test methods pass. This uses mocked HTTP and does not replace
the required native lost-response proof.

All 80 worker suites pass. Unit `openplan-kpi-client-workers-20261008.service`,
invocation `349cde41adfb4ed3ad245b2e28320407`, completed at 08:07:39 Pacific on
October 8 with a 189.4 MiB peak under a 1 GiB cap. No checkout edits occurred
during the run. Parent application QA remains active and its checkout unchanged.
