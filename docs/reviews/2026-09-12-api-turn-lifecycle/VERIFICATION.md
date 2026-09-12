# Retained API turn lifecycle, September 12

Work in progress for roadmap A0b. The adapter at main `c858b89e` passed CI
34722018877 and RLS Isolation 34722018874 before these schema edits began.
This lifecycle is not yet a browser generation workflow or a release.

Migration `20261012000002_assistant_api_turns.sql` extends the existing private
turn table with a retained API connection/revision, canonical configuration,
configuration hash and charge acknowledgement. It adds creation, claim and
minimal worker-status functions. The existing completion validator now accepts
this API kind while preserving its common answer, citation and proposal checks.
Browser read/cancel use the new API lock order only for API turns; native and
Anthropic behavior retain their existing path.

Configuration changes interrupt queued/running requests on the superseded
revision. Revocation interrupts all active work on that connection. Completed
history stays intact. Exact old request/save retries preserve original identity
and do not select a new revision. Process loss expires without requeueing; a
minimal service-only access-lost status lets a worker retire private delivery
state without disclosing an answer after membership loss.

Claiming reserves one usage event in the same transaction as the attempt. The
unique dispatch key is per turn. Reservations count conservatively against the
existing 20-event/300-second staff allowance and exclude public translation.
They are not invoices or proof of a provider charge. Other AI paths retain
best-effort accounting; this does not claim a strict cap across every AI caller.

## Executed evidence and errors

The named disposable stack is
`/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050`,
container `supabase_db_openplan-restore-target-2026091050`, API29821/DB29822.
The first apply failed on an unparenthesized CASE expression inside a PL/pgSQL
IF. Queries confirmed both the added column and migration receipt were absent,
then the corrected file applied successfully. No reset or demo database was used.

The new focused suite has 16 live SQL cases. The final restored run passed all
80 cases across this file and the existing 64 provider-history cases, exit zero.
Changed-test ESLint and diff checks also passed. The shared completion path
therefore has separate legacy regression evidence. Full isolated RLS,
upgrade and full QA remain to be run on the final implementation. The later concurrency checkpoint below supersedes the original concurrency TODO.

Two test errors were corrected. A function call and state read combined in one
SQL expression allowed PostgreSQL to read state before the function changed it;
the test now sequences those operations. Rows inserted in one fixture transaction
share a timestamp, so a queue test could not assume creation-call order instead
of the explicit UUID tiebreaker. It now proves one new claim and durable expiry
of the old attempt regardless of tie order. Assertions use IS DISTINCT FROM so
missing values fail instead of disappearing into SQL's unknown truth value.

The initial mutation run is retained in `initial-mutations.json`. Its expired
requeue fault was blocked by the unique usage key, which caused a queue recovery
error instead of the originally expected assertion. That is a separate accounting
safeguard, not proof that a second generation happened. The final campaign keeps
that fault and additionally changes the reservation key with the attempted retry;
the test must then reject the restarted attempt itself. The final campaign
completed 28 cases with exit zero: one harmless survivor and 27 faults with the
expected failure messages. `mutations.json` retains the named assertions.
All nine committed database function bodies matched the migration source after
the campaign; `restored-function-hashes.json` retains their SHA-256 hashes.
The restored 80-case run also exercised the foreign key, snapshot check and
ordinary-role execution denial after their mutation transactions rolled back.

## Unproved boundaries

The SQL tests run transactions that roll back, using synthetic identities and
SQL-level dummy encrypted envelopes. They do not retest encryption, network
transport, SDK generation, process journals, PostgREST delivery or browser use.
The rollback SQL cases alone do not prove lock behavior between two connections.
The later concurrency campaign below supplies that separate evidence; worker
integration remains pending. No model was called.

## Original concurrency design, implemented below

Extend `openplan/src/test/assistant-provider-concurrency.test.ts` using its real
transaction/background/waitForLock helpers. Keep native tests intact. API fixtures
must clean up their own committed turn rows after all competing transactions end,
because the API claim function chooses globally across active API jobs. Refuse to
start these fixtures if unrelated API jobs are already active in the test stack.

Cover identical creates, one claimed attempt/reservation, concurrent edit/revoke
and completion, removed membership, and two API reservations sharing a workspace
but using different connections. Observe actual PostgreSQL lock waits. A harmless
control and a targeted lock removal are required; do not infer serialization from
two sequential successes.

For the budget race, ordinary simultaneous claimants can pick the same oldest
job and serialize on its connection, masking a missing advisory lock. Isolate
the advisory boundary with two connections in the same workspace and 19 recent
staff events: begin B's creation transaction first but leave it uncommitted;
create A and hold A's claimed attempt/reservation transaction open; then commit
B's older creation and start a second claim. That claim must wait on the advisory
lock, not A's connection. Once A commits, B must be refused at the cap with no
second reservation. The older transaction timestamp makes B visible as the next
candidate while A's running update is still uncommitted. Restore any globally
applied function mutation before running other database suites.

After SQL verification, extend the retained-turn TypeScript validator/projection,
then join `provider-api-generation.ts` to the worker and existing project panel.
Reuse the native connector journal primitives. Settings must continue to disclose
generation unavailability until that path is executable and browser-verified.

## Usage reset checkpoint

Ten API concurrency cases now cover identical creation, competing claims,
membership/project changes, edit/revoke/cancel versus completion, exact completion
replay, explicit connection locking and the separate-connection final-budget race.
The API-only baseline passed ten cases with eight legacy cases skipped. The full
18-case replay remains pending. The final four-case mutation campaign survived
one harmless control and killed missing connection, scope and advisory locks.
Both mutated function bodies were restored and checked against source hashes.

The initial scope mutation failed with a claimed job after membership removal,
rather than only the initially expected missing wait. The final campaign records
that stronger assertion; the original report is retained. The independent lock
that still caused a wait in that initial membership case was not identified.

The retained API TypeScript decoder/projection and nineteen focused cases are
implemented. Together with existing route/API cases, 110 tests passed. Mutation
proof for the new decoder is pending. A fresh TypeScript check at the usage
checkpoint failed with four fixture type errors in provider-api-turn.test.ts,
lines 51, 59, 64 and 107. Changed-file ESLint passed. These are unfinished source
changes, not accepted main or release evidence. RESUME.md has exact next steps.
The explicit package test:rls-live list also still omits the new 16-case API SQL
file; wire it in and inspect serialization before reporting full RLS coverage.

## Decoder proof and resumed checks

The fixture-only typing repair selects the existing legacy schema branch for the
Anthropic test record. TypeScript then passed. The focused decoder, routes,
legacy API and command-environment suites passed 112 cases. The updated decoder
fault campaign exercised 28 cases: one harmless comment survived; 27 named
projection, required-field, credential-mode, native-reference, acknowledgement,
legacy-field, configuration and packet faults failed at assertions. Source was
restored and hashed. See decoder-mutations.json for exact failures.

These are in-process decoding and projection checks, not PostgREST authorization,
credential decryption, worker delivery or browser evidence. Missing API schema
fields are tested directly as well as through downstream decoding, so a later
parse failure cannot mask an accidentally optional type contract. The unchanged
legacy production schema validates the narrowed fixture.

The package live command now explicitly includes the new SQL file. Existing
Vitest configuration serializes live files; explicit concurrency remains within
one file. Before full RLS, both previously mutated database function hashes
matched source and the active API queue was empty. Full RLS and full QA are in
progress, with handles and private log paths in RESUME.md; no outcomes yet.
