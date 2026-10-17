# R2 finite native stages, all unexecuted

R2 governing supplements are SOURCE_COMPATIBILITY.md, MVCC_LIFECYCLE.md and the
explicit current source binding in source-pins.json. Original7c075 and
frozen825 are historical. No native or combined operating identity is claimed.

Admission belongs to root. A stage starts only after its target, source and
receipt fields are concrete. Success or failure ends that stage; neither starts
the next operation. Preserve failures and lost acknowledgements. Do not retry
an uncertain commit, allocation or helper start without reconciling its identity.

## Stage 0: new target and exact predecessor

Root assigns a NEW exclusive fixture DB, not a retained DB made writable. Supply
its exact cluster and database identity, creator, baseline history rows and SQL
digests, expected ordered migration sequence and actual table/function catalogs.
No dump is known to contain SQL19. Do not infer current main from an old proof.
Only an explicitly admitted archive or installation recipe may establish the
predecessor. Do not query retained DBs/dumps, protected eight helpers, demo3000,
root preview, frozen607 or hosted systems. Do not repair global roles or settings.

Record database owner/ACL, effective role memberships, default ACLs and database
role settings by hashes where values could be sensitive. Root supplies existing
cluster roles and NEW synthetic users/workspaces/memberships. The seed generator
takes a prerequisite UUID manifest, not credentials. It creates no auth users,
roles, grants or policies. Its minimal role prerequisites are A owner/admin/member/
viewer, A-only, B-only, dual A/B, outsider and a separate revocable A member.
Keep a second A owner if testing an owner's revocation. The owner-floor trigger
must not be disabled to construct that case.

Bound each later process: proposed runner 512 MiB, no swap, CPU50, Tasks32,
stage wall limit 300 seconds; helper 512 MiB/CPU50/PIDs128 with an owned loopback
port and no mounts. SQL statement timeout 10 seconds, lock timeout 3 seconds,
idle transaction timeout 30 seconds. Concurrency needs an admitted lock timeout
long enough for its observed interleaving, at most 10 seconds. DB server resources
are a separate measured boundary, not covered by runner/helper caps. Root must
confirm capacity before admitting a large stage. These are proposed limits,
not observed allocations. A refusal or capacity failure stays unavailable.

Existing reusable code, read only as source: frozen
`docs/reviews/2026-10-15-project-jurisdiction-native/native_proof.py` has explicit
session authorization, local JWT claims, transaction rollback, error savepoints,
catalog capture and PID/blocker observation; `transport_proof.py` has scoped JWT
and loopback PostgREST patterns. The October 14 aerial `isolated_storage_owned.py`
uses isolated DB/path ownership and finite helper cleanup. These scripts embed
old cluster/database/helper IDs and may allocate, query retained sources or read
global environments. **Do not invoke/import them unchanged.** Reuse individual
patterns after replacing target admission and credential acquisition. Storage
is unnecessary for this JSON-only fixture. `openplan/scripts/ops/full_restore.py`
and the September 9 OWP reconstruction provide separate archive/financial receipt
patterns, not current SQL19 proof. None is dispatched here.

## Stage 1: committed ordinary PostgREST, then actual loader

Apply the admitted migration sequence with exact hashes and a durable journal.
Capture catalog/ACL/source/rows before SQL19 and after its real commit. Its own
BEGIN/COMMIT requires the existing runner's reviewed transaction-body extraction
if history is to join the same transaction. Do not assume wrapping a COMMIT nests
it. Do not fabricate a migration-history row or invent missing grants.

The generator prepares 1,201 deliverables at $1,000 and 50 percent progress,
1,201 $1 spends, and 1,201 eligible invoices alternating sent/paid. Each has a
distinct $2 line. Another 1,201 $3 lines belong to the first invoice and last
deliverable. That parent has 1,202 lines; total eligible lines are 2,402. All
deliverable updated timestamps tie; spend entry dates tie. Add separate draft,
void and foreign-project sentinels with exact excluded IDs. SOURCE_COMPATIBILITY adds
caller-visible foreign delivery/spend rows and draft-first issuance. All names are marked
SYNTHETIC; no client record, actual approval or scientific observation is used.

Literal oracles: deliverable budget 120100000 cents; direct spend and actual
120100 cents; billing 600500 cents; stated budget 999900 cents; remaining 879800
cents. Last-deliverable billing is 360500 cents and direct spend 100 cents.
Equal amounts on different primary keys both count. Billing stays separate from
incurred direct cost. Generator IDs, count and order lists are independent of
the RPC. Expected deliverable order is updated_at DESC then UUID; spend order
is entry_date DESC then UUID; invoice/child order is UUID. Do not use numeric
insertion order as a UUID tie oracle.

Commit the fixture only on the new exclusive DB. Retain transaction identity,
commit acknowledgement and independent connection readback of exact IDs.
Rollback-only seeds cannot prove ordinary HTTP visibility. Start one newly owned
PostgREST helper against that DB with `PGRST_DB_MAX_ROWS=1000`; record effective
version/configuration and new helper identity. One baseline table GET should
show the ordinary row cap, but its count/header is not a completeness oracle.
POST the real scalar RPC as authenticated callers. The function's scalar shape
does not by itself prove API aggregation. Require exact source and nested IDs,
counts, ties, exclusions and literal cents from the actual response.

Retain status, content type, selected credential-free response headers, raw
decompressed JSON bytes, byte length and SHA256 before parsing. Bound one body
to 8 MiB, one request to 15 seconds, each returned source to exactly its expected
row count and each string to the generated fixture's declared lengths. Do not
silently truncate the body or accept an HTTP error as a killed oracle. The
1201/2402 fixture is finite, not unlimited-scale acceptance. Preserve SQLSTATE,
body and unavailable state for cancellation, capacity or malformed responses.

Independently parse raw native numbers with Python Decimal/integer cents, then
parse the SAME bytes with JavaScript JSON.parse and pass through the actual
production loader. A file-backed rpc adapter may hand the captured envelope to
the real loader with asserted RPC name/argument; label it captured-transport
readback. An actual Supabase-client HTTP call is an additional ordinary transport
receipt, not replaced by that adapter. Never stringify Decimal into quoted money
and call it raw native JSON. Then run the actual pinned budget builder/formatter,
retaining input/output types and JSON reconstruction. Do not use production
money helpers to compute their own expected cents.

## Stage 2: numeric storage and separate downstream money

Use separate synthetic projects with 33, 79, 89, 90, 101 and 1,001 per-row maximum
spends/budgets. Literal totals are respectively 3299999999999967,
7899999999999921, 8899999999999911, 8999999999999910, 10099999999999899 and
100099999999998999 cents. The last two exceed MAX_SAFE_INTEGER cents; 79/90
protect binary-number spelling/rounding while still below that integer boundary.
No single stored amount exceeds NUMERIC(14,2). Stated budget stays null for these
projects; do not seed the aggregate into a per-row column. Header amounts also
stay within their own typmods. Production math at historical frozen f520 is not exact-money acceptance. R2 explicitly binds reviewed
current app44e638d6 in source-pins.json; root joined checks are external
receipts, and native money acceptance remains unproved.

Record `format_type(atttypid,atttypmod)`, nullability and constraints. In separate
savepoints attempt required null (23502), negative (23514), 1000000000000.00 and
999999999999.995 overflow (22003), ordinary 0.005 stored as 0.01, 1.004 as 1.00,
1.005 as 1.01, and progress 100.005 overflow/range rejection. PostgreSQL typmods
round before constraints; do not expect sub-cent INSERT rejection generally.
Observe actual error/canonical stored text and rollback. Optional budget/progress
null is legitimate, zero is entered, absent-column is pending, malformed is
unreadable. Nonfinite/400-digit/malformed transport values belong to supplied
loader cases, not native records created by disabling constraints.

## Stage 3: function ACL, SELECT and caller RLS

`catalog.sql` prepares the bounded function/table/column/policy inventory.
Capture `pg_get_functiondef`, owner, language, return type, volatility, security,
config/search path, direct ACL and effective default ACL. Hash returned definition
bytes in the recorder; do not compare pg_get_functiondef bytes directly with the
migration file. Record raw-null proacl and its effective `acldefault` expansion.
Measure PUBLIC grantee OID zero separately from anon/authenticated/service_role,
owner and role inheritance. SQL19 revokes PUBLIC/anon and grants authenticated;
it does not revoke every existing/default service grant or grant table SELECT.

Test ordinary authenticated owner/admin/member/viewer without service credentials,
A-only/B-only/dual/outsider/revoked users, anon and null/nonexistent project UUIDs.
Inaccessible and nonexistent both refuse, not zero totals. Table-level and
column-level SELECT must cover exact SQL19 projections. Revoke only fixture-local
table/column privileges in rolled-back trials to observe actual source failure;
do not grant broad access to make tests pass. Direct service and owner operation
inventory intentional bypasses separately; neither is planner acceptance.

Move a synthetic project A to B while its invoices remain in A, then observe each
caller afresh. A-only cannot see the project; B-only sees project/direct sources
but caller-hidden A invoices stay hidden; a dual caller sees the inconsistency
and requires clientInvoices complete:false/code22000. Revoke a nonowner A member,
commit and repeat ordinary HTTP. Test child SELECT separately: a NEW restrictive
child policy hides one identified line without hiding its visible parent, then
a NEW helper raises an internal error. Completeness is caller-visible completeness,
not a service-role census. Restore policy/catalog/ACL/source/rows after each trial.

## Stage 4: optional attributes and native failure custody

Use one transaction per attribute trial and rollback before the next. Never use
CASCADE. Drop only budget_amount, only percent_complete, only assignee_user_id,
both budgets, and budgets plus assignee in five separate trials. Begin with
nonnull assignee and nonzero budget/progress. Preserve every surviving field;
catalog flags must exclude attisdropped. StatedBudget remains independent. The
generator itself requires the full-schema baseline; do not reuse its admission
against a deliberately partial catalog. Renaming a column is not dropped-attribute
evidence. Any dependency preventing DROP is a recorded refusal, not permission
to weaken schema. Direct SQL can see transaction-local schema; HTTP cannot.

For HTTP error cases, use a separately admitted committed change in the exclusive
DB, and restore it in `finally` with fresh catalog equality before any next case.
Distinguish actual missing RPC/cache reload from installed RPC internally failing
42883, undefined column 42703, source relation 42P01, permission 42501 and query
cancellation 57014. PostgreSQL OTHERS does not catch query_canceled, so cancellation
may be an outer RPC failure. Preserve the actual surface instead of manufacturing
a lane envelope. Do not turn generic42883 into snapshot-pending. Exact named
missing public RPC alone gets that guidance; unsupported wording stays unreadable.

For statedBudget, legitimate pending is an actually absent projects.budget_amount;
for spendEntries, an actually absent project_spend_entries relation; for invoices,
an actually absent client_invoices or client_invoice_line_items relation. The
reviewed current classifier retains an actual p.budget_amount error as unreadable
because its native origin is ambiguous; catalog absence alone does not change
that current protocol. Preserve the original failure rather than invent pending. Establish
absence from the relevant catalog, not just a matching message. Other missing
required columns require source-specific catalog evidence before setup guidance.
Each lane must retain unrelated helper failure as unreadable with original message.
The original packet FINDING remains historical supplied-error evidence. R2
explicitly binds the separately approved conservative classifier; native error
origin remains unproved.
Retain independently readable deliveries, stated budget and unaffected financial
lanes; never discard valid deliveries because stated-budget validation fails.

## Stage 5: controlled same-statement snapshot

Follow MVCC_LIFECYCLE.md for exact old/new identities, draft-only line changes,
status-only voiding and replacement issuance. Use three admitted connections: writer W, reader R, observer O. Record DB/session
identity, backend PIDs, transaction IDs, isolation and statement start times.
W begins and holds ACCESS EXCLUSIVE on project_spend_entries. R starts the actual
production STABLE RPC as an ordinary caller. O records R's waiting relation lock,
pg_blocking_pids(R) containing W, and bounded relevant pg_locks rows. The lock
must be observed, not inferred from elapsed time. W writes one whole new tuple
across project budget, deliverable budget/progress, spend, invoice status and
line IDs/amounts, then really commits. Record W's commit acknowledgement and
O's postcommit readback before treating the release as committed. R completes;
its entire tuple must equal the independently recorded old state. A fresh RPC
must equal the committed new state. Accept no mixed tuple, partial zero or lost
source. Also run two distinct nonzero tuples, then membership/project-move and
invoice/line insert/delete interleavings with caller-specific visibility oracles.

Use the same real function, no sleep wrapper, helper substituted for production,
or source-regex atomicity claim. A deliberate VOLATILE replacement may be a
separately admitted negative control on the NEW DB, preserving exact function
definition/ACL/owner/config and restoring in finally. If it fails to produce the
intended torn result, retain a surviving control and do not call the oracle
mutation-proven. Pure mixed-tuple corruption controls test only tuple comparison.
All held transactions rollback on exceptions; no one kills another session.

## Stage 6: restoration and later journey boundaries

Before/after receipts cover exact catalogs, constraints, triggers, policies,
ACL/default ACL, roles/memberships, function definition/source hash and full
fixture rows sorted by IDs, not counts alone. Capture all builder-trigger side
effects with explicit synthetic identities. The generator creates no cluster
role. Drop no shared role/helper. Committed large fixtures remain on the exclusive
target until root explicitly admits disposal; a successful transaction rollback
cannot claim they disappeared. Capture cleanup and restore status independently.

Representative upgrade means nonempty admitted predecessor rows survive SQL19,
including every field/value, and new callers work. Representative dump/restore
needs its own NEW allocated target, exact archive SHA, history, roles/grants,
catalog/rows/definition reconciliation and continued ordinary readback. Neither
proves full installation/Storage/external-worker/Auth-provider recovery. No
whole-installation restore is required merely to admit this representative case.

Real API editor prefills and untouched-field writes need later ordinary-role
API/database receipts. Desktop and 390px need an identified combined build,
real navigation, console review, displayed cents and usable artifacts. Do not
claim an export path uses this loader when none does. Keep the earlier spend-only
“Billed + spend” label concern separate. Unit/native work does not close M11,
v1, scientific accuracy, agency finance or practicing-planner acceptance.
