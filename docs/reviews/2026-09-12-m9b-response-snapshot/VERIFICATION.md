# M9b complete response snapshot, implementation checkpoint

The previous v0.55.1 retry repair is published. This is subsequent unreleased
work on work/engagement-response-snapshots in
/home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10.
The parent review's NEXT_READ_BOUNDARY and capped-read probe record the defect.
Current direction check passed before this lane, with historical reminders;
M9b remains the response/decision follow-through lane in the roadmap.

## Implemented foundation

20261013000001_engagement_response_snapshot.sql adds a read-only SQL function
returning one JSON envelope containing campaign, publication scope, row count
and the explicit response projection. It orders by sort order, created time
and unique ID. SECURITY INVOKER retains caller RLS; execution is granted to
staff-authenticated and service roles, with anonymous/PUBLIC execution revoked.
No table, policy or existing response is changed by this migration.

The choice follows the existing report snapshot aggregation. PostgreSQL's
[stable function documentation](https://www.postgresql.org/docs/17/xfunc-volatility.html)
establishes one calling-query snapshot. Its
[function documentation](https://www.postgresql.org/docs/17/sql-createfunction.html)
defines caller privileges for SECURITY INVOKER. This is a per-read snapshot,
not retained revision history. It holds the result in database/app memory;
large payload failure must remain an error rather than become an empty result.

## Observed database verification

The named disposable container supabase_db_openplan-restore-target-2026091050
was confirmed running at migration 20261012000002 before the probe. Each probe
created the proposed function and 1005 synthetic responses plus a sibling
campaign control inside a transaction. A permitted member read all 1005, the
published-only read returned 502, an identity without membership received zero,
and service-role public scope still returned only 502. Exact projected keys,
unique ordering and anonymous execution privileges were checked. No email or
public publication route was called. Every transaction rolled back, and the
proposed function was confirmed absent afterward. No migration tracking or
persistent fixture was changed.

database-mutations.py/sql/json retain a harmless comment survivor and seven
matched failures: missing campaign filter, missing publication filter, bypassed
caller RLS, missing projected column, missing unique ordering, anonymous execute
grant and volatile declaration. The final case checks declared volatility,
not actual concurrent-update behavior. All source bytes remained unchanged.

## Next implementation and evidence

1. Connect staff and public loaders to the snapshot RPC. Decode the full envelope,
   validate campaign/publication scope, exact count and valid unique rows. Keep
   failed, pending-schema, malformed and empty outcomes distinct. Reuse it for
   the response portion of campaign translation inventory; preserve other readers.
2. Update affected loader, staff page, public page and translation test doubles
   to assert actual RPC identity/arguments and failure propagation. Mutate each
   changed guard with a harmless control and targeted failure.
3. Apply the additive migration through the existing isolated migration workflow.
   Verify real PostgREST retrieval above its configured 1000-row cap, role and
   campaign/public scope, failed reads and concurrent changes. The transactional
   SQL tests do not prove HTTP cap behavior or an in-flight concurrent read.
4. Exercise existing real-navigation staff/public workflows at desktop/390px,
   keyboard and console, including an interrupted RPC retry. The previous
   table-read proxy must target the new RPC; reusing its old matcher would be
   vacuous. Confirm private original responses and scope remain protected.
5. Run applicable full QA, shuffle, isolated RLS and additive upgrade checks;
   retain exact final CI before the next coherent release. Do not call this
   unfinished foundation a shipped UI repair.
6. Continue retained correction/publication history and links to existing
   project decisions/commitments. Existing contribution-history and review-intent
   implementations are reuse candidates. Preserve the wider v1 contract and
   untouched reminder constraint; no agency-usefulness or model claim changes.

No local app, browser, worker or test process remains running from this probe.

## Loader integration and real database evidence

Staff and public response loaders now call read_engagement_response_snapshot,
decode its envelope and rows, and refuse mismatched campaign/publication scope,
count, duplicate identities, draft public rows and malformed content. The
translation response inventory reuses the same published reader. Runtime API
and page response shapes stay compatible with the v0.55.1 retry interface.
Other campaign inventory reads and retained response revision history remain
separate unfinished work.

The 318 existing isolated migration files matched the worktree byte-for-byte.
The additive 20261013000001 migration was copied to the named restore-target
stack and applied with the CLI; its migration ledger now ends at that version.
The initial transactional database-mutations.py probe above expected this
function to be absent and must not be replayed unchanged after application.
The original pre-apply evidence remains historical.

postgrest-probe.mjs/json records real authenticated HTTP calls. An ordinary
table read returned 1000 of 1005 records with no error; the actual new staff
loader returned all 1005 in unique total order. Member and service public
readers returned the same 502 published rows. A real outsider account received
zero rows, anonymous RPC execution was denied with 42501, and a subsequent
correction appeared on the next read without changing the earlier returned
object. That object check is not server-side revision retention.

The first HTTP probe completed those read checks but failed cleanup: retained
configuration history prevented campaign deletion with SQLSTATE 23503. Both
initial synthetic campaigns were archived instead. Auth admin deletion of its
synthetic outsider account returned HTTP 500; its cause is unestablished and
the account remains. The corrected probe journals progress, archives campaigns
and retains its synthetic outsider. Both accepted-run campaigns were separately
confirmed archived with public submissions disabled. No custody guard was
bypassed. initial-http-cleanup-recovery.json records the initial fixture IDs;
postgrest-probe.json records the accepted ones. No synthetic password is stored
in public evidence.

concurrent-read-probe.py uses two real PostgreSQL connections and an observed
advisory-lock wait. An update committed while the calling query was blocked;
that query retained its original response and a subsequent read saw the edit.
concurrent-read-mutations.py shows a harmless comment surviving and VOLATILE
behavior failing the in-flight snapshot assertion. The original database
function was restored exactly. The synthetic response text was restored; its
updated_at records the test edits. This is actual SQL concurrency proof, with
HTTP cap proof recorded separately.

The loader/page/translation group passed 157 tests. A harmless comment survived
and 13 targeted mutations failed for their named reasons, including malformed
translation text escaping into the inventory. Type checking first caught a
nonexistent entityType property in that new translation assertion: it could
not have detected leaked text. The assertion now uses entity and the targeted
leak fails. This correction is part of the retained mutation results.

The first full application run failed 32 tests in five files: four callers'
test clients lacked the new RPC, and Unreleased lacked the migration name.
Those fixtures and the migration note are corrected. Their focused 64 tests
passed; a harmless control survived and a wrong RPC failed all four callers.
The full suite still requires a fresh successful run. Initial command errors
from mixing repository/package-relative paths ran no intended changed checks;
commands now separate edits from package checks and stop edits on error.

Corrected TypeScript and changed-file ESLint checks completed with exit 0.
The database and unit evidence does not establish browser reachability. Next
is an identified-build desktop/390px journey using real navigation, the RPC
fault matcher, full response retrieval and public scope, then final release
gates. No new release version or complete M9b claim is made here.
