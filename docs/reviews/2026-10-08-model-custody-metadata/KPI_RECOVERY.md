# Legacy KPI recovery candidate

Normal assignment and ActivitySim KPI writes previously used direct inserts.
A lost response could leave a committed row without a recoverable request.
Both callers now use retained delivery, as documented below. The existing
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

## Native committed-response loss

The new native recovery proof calls the retained client through a loopback bridge
to the owned PostgREST gateway. The bridge forwards the first request, waits for
the database's successful response, then closes the TCP connection without
returning it. The client propagates uncertainty and leaves its exact command
pending. A fresh recovery CLI process lists and resends that saved request.
Two identical POSTs leave one KPI and one private receipt. A second CLI recovery
and subsequent client reuse read the cached receipt without another request.
The retained response equals the database receipt.

Baseline, harmless-wrapper and restored controls pass. A client fault that
swallows the lost response is caught at uncertainty propagation. Returning an
incorrect cached response is caught after recovery. The proof restores its
in-process client function and removes candidate database objects and temporary
gateway/bridge processes. Synthetic fixture rows and private journals remain as
evidence. No source mutation is left in the checkout.

Private output is in `legacy-kpi-native-cli/` and
`legacy-kpi-native-controls/` under the proof root. The original baseline run is
`e031d8fa-92f6-4b18-ae6f-38b422b29379`; its request is
`5288a7d8-bef6-5fc0-b4af-df07a2c966b6`. These are synthetic proof identities.
This closes the retained-client lost-response boundary only. Normal worker
helper/caller adoption, installed migration and upgrade evidence, current stage
ownership and complete computation recovery remain required.

## Additive migration and isolated upgrade

Migration `20261016000017_legacy_kpi_command_receipts.sql` now carries the native
candidate. Supabase CLI 2.111.0 generated the file before it was moved above the
repository's existing migration-16 high-water mark. Its SHA-256 is
`d8b5da758d40ec4b8d7b9f94cb12838e825155095517f7b2228a1bd135a06da0`.
The exact migration passes all native rollback cases and eleven faults. A
rollback catalog query against the migration-16 synthetic clone confirms 302
application tables with RLS and 14 views, excluding PostGIS relations. The schema
inventory and SQL-read column ledger now match. All 41 targeted inventory,
column and release-ordering tests pass. Harmless/restored controls pass;
missing-RLS and undocumented-column faults fail their stated checks.

The upgrade proof clones the migration-16 synthetic database and applies the
migration through CLI history, then reapplies without a duplicate history row.
It compares every captured field across ten existing tables, including 111 runs,
52 stages, 243 artifacts, 20 KPIs, both historical assessment formats and parent
receipts. Installed rollback cases pass and leave these records unchanged.
Baseline, harmless-comment and restored upgrades pass. A rewrite of unmanaged
run titles is detected by the snapshot comparison. Earlier adverse attempts hit
artifact-custody and managed-run triggers before comparison; their logs remain
in the first two control directories. The final control narrows the rewrite to
unmanaged fixtures and does not disable either trigger. An initial copied table
list duplicated KPIs and omitted artifacts; review corrected it before the final
baseline and controls. Earlier reduced-coverage results are superseded.

Advisor comparisons for all three final passing variants add no WARN or ERROR
findings. The two new INFO findings name the intentional private RLS table with
no policies and its unused run index. Final evidence lives in
`legacy-kpi-upgrade-controls-v3/`, including `advisor-comparison.json` and
`restored/candidate.json`, under the proof root. The final retained database is
`openplan_kpi_upgrade_48c72fd82c244baf8c2fd7c2dd8c38ea`. Source history stays at
migration 16. No application database is upgraded. Normal helper/caller adoption,
full application QA and complete stage recovery remain open.

Independent dependency installation completed under a 2 GiB cap, and the native
SQLite import/query probe passed. Early inventory reads used repository-relative
paths from the nested app directory and changed no files; corrected reads used
the repository root. The existing parent QA checkout remains frozen.


## Normal worker adoption, October 8

Both normal KPI call sites now use `sb_record_retained_kpi`. The helper adds the
stage binding, preserves explicit nulls, supplies existing defaults only for
absent optional fields, and prepares the complete request before HTTP delivery.
Its stable logical identity combines category and KPI name. An unconfirmed
write raises `WorkerStateWriteUnconfirmed` and stops continuation. Changed
values require reconciliation; they cannot silently replace a retained request.
Migration 17 and the installation identity are required before worker startup.

The native recovery proof now enters through this actual worker helper. After
PostgREST commits, a TCP bridge drops the reply. A fresh CLI process recovers the
saved request, and the helper then reuses that receipt without another POST.
Baseline, harmless and restored cases each leave one KPI and one receipt after
two identical requests. Swallowed-loss and wrong-cached-receipt faults fail.
Evidence is `legacy-kpi-worker-native-controls/controls.json` under the private
proof root. This uses synthetic inputs, not a complete scientific dispatch.

`test_model_kpi_worker_delivery.py` executes both actual call expressions through
the helper and client. Exact retries reuse distinct receipts, changed values
refuse, and null/default/scope checks pass. Baseline, harmless and restored
variants pass; changed null defaults, accepted extra stage fields, a bypassed
caller and swallowed delivery failure each fail. Private evidence is
`kpi-worker-controls.json`. These call-expression tests do not execute the full
stage or establish current restart ownership. The initial control invocation
used an unavailable system `python`; rerunning with `python3` executed all cases.

All 81 worker suites pass with none failed or omitted. Unit
`openplan-kpi-worker-adoption-20261008.service`, invocation
`d3f1da369f8b4eb79b366af97bc7c449`, finished at 08:24:27 Pacific with a 200.6 MiB
peak under a 1 GiB cap. The checkout stayed unchanged during regression.
Whole-stage replay, retained geometry/comparison computation, scientific
acceptance and full application QA for this branch remain open.
