# Implementation report transaction backend

Source commit `3556f5f8b11f210da7907ea444339d4a87e2cc4d`, October 7, 2026.
This is a backend checkpoint within M1. It does not
complete implementation-report recovery, M1 or v1.

## Change and remaining connection

The existing report route writes the report, artifact and implementation
register separately. A failed final write can leave an incomplete report.
Repeating a request after a lost response can create another report.

The new service-only function writes all three records and an exact-request
receipt in one PostgreSQL transaction. Current workspace write permission is
required for creation and replay. The command identifies the adopted version
and its content hash. New reports require that version to remain the plan's
current adopted version, with a matching retained source. Replay returns the
original receipt before consulting a newer adopted version or action status.
Another actor or different request bytes cannot reuse the command ID.

The function holds plan, membership and version locks until transaction end.
The existing implementation-action trigger takes the same version lock on
status edits. Lock contention returns a conflict without partial report writes.
The server helper preserves the exact command bytes, verifies the adopted
source, scopes its reads and refuses incomplete or mismatched receipts.

This checkpoint does not connect the function to the report route or form.
The current user workflow still has its separate writes and no lost-response
recovery. The next connection must include same-origin and current actor/workspace
checks, explicit agent refusal, retained browser command bytes, receipt recovery,
and current permission checks. No agent action is registered by this checkpoint.

## Retained bytes and compatibility

The new transaction retains its exact PostgreSQL JSONB snapshot text in the
private command table. Its SHA-256 covers those bytes. The artifact declares
`contentHashEncoding: postgresql-jsonb-text-sha256`. Existing implementation
reports keep their original JavaScript insertion-order hashes and records.

Before connecting report creation, update the report reader to verify this
explicit encoding against the retained text, artifact and register. Do not
reconstruct PostgreSQL bytes by assuming JavaScript object order. Existing
reports and absent historical fields must retain their present interpretation.

The Supabase CLI generated the migration before its filename was placed after
the repository's existing future-dated migration sequence as
`20261016000012_land_use_plan_implementation_report_commands.sql`.
Local probes create this migration inside a transaction and roll it back.
They do not install it in the retained browser database or repeat prior browser
report, adoption or implementation-status writes.

## Evidence boundaries

The final focused run passes 63 tests: 56 server-helper cases, two native
transaction exercises and five schema-inventory checks. TypeScript, changed-file
ESLint and the product-direction check pass. This checkpoint does not include a
new production build or browser journey. Full GitHub QA, shuffled tests, live
isolation and restore checks remain separate requirements on the pushed head.

The follow-up registers the native transaction suite in `test:rls-live`, whose
file list is explicit. The first pushed checkpoint omitted that registration;
its default unit run skips these two native exercises. The local isolated-stack
evidence above remains valid, but GitHub's live-isolation check must run the
updated command before it can cover this transaction.

Four deliberate no-op controls survive. The final runs catch 71 targeted faults
in permission, source identity, exact replay, receipt comparison, query scope,
field projection, date and text validation, status ordering, locking, stored
hashes, native access grants and schema inventory. Original source bytes are
restored after each control. Logs and a combined index are in
`implementation-report-transaction/` beside this note.

Two intermediate controls need qualification. Removing explicit date-order
validation produces a downstream check-constraint error instead of the intended
invalid-input response. The assertion detects it; the runner's initial expected
diagnostic was wrong and is corrected. Removing a redundant Zod `.strict()`
survives because the extended scope schema already carries strictness. Explicitly
making that result schema loose fails the extra-field case. These initial
results remain in the evidence and are not counted as targeted failures.

The native fixture exercises writer/viewer/outsider scope, exact replay,
source identity, current adoption, invalid input, append-only receipts,
workspace deletion and failures after each of the four inserts. A second
native connection checks plan, membership and version locks in both orders,
including real status updates. It commits only randomly identified synthetic
peer fixtures; its wrapper removes those fixtures and verifies cleanup.

The server-helper tests use projected database doubles. They assert the selected
columns, workspace/plan/version filters, exact RPC arguments and result identity.
These tests do not establish native RLS or real browser behavior. Native fixtures
do not establish authenticated HTTP transport, browser storage, reload recovery,
simultaneous HTTP command execution or practitioner acceptance. A frozen-version
schema constraint prevents an adopted row without a freeze timestamp; an initial
test setup hit that existing constraint and was corrected without weakening it.
The column-inventory guard sees bare column names across application files.
It already sees `snapshot_text` elsewhere, so it cannot establish that this new
table has an application reader. The reader connection remains explicitly open.

The next visible workflow needs an identified build, real navigation, desktop
and 390-pixel T3 evidence, console review and matching downloaded artifacts.
The full product's scientific, geographic, practitioner and operational
acceptance boundaries remain open.
