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

This is not an installed migration or connected worker path. Independent-session
contention, native HTTP permissions and lost-response recovery, retained client
validation, additive migration/upgrade evidence, schema accounting, and actual
caller adoption remain open. The next implementation must bind stable identities
to destination, run, stage and KPI slot, never to mutable numeric values. Existing
rows need reconciliation instead of silent adoption or deletion. Current stage
ownership, computation recovery and scientific acceptance remain separate gates.
