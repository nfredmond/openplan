# Response transaction and withdrawal prototype evidence

This is still an unfinished prototype, outside the migrations directory. Neither
response-write-transaction.sql nor response-write-guards.sql is applied to the
app's source stack. No app route or UI calls it. These SQL results do not establish
an implemented browser workflow or a released capability.

## Transaction and permission probes

prove-transaction.py composes both SQL files and runs transaction-probe.sql and
guards-probe.sql in rolled-back transactions against only the postgres database
on supabase_db_openplan-restore-target-2026091050. The final catalog check confirms
the receipt table remains absent there. transaction-mutations.json contains the
current composed-source and probe hashes, baseline, harmless survivor and thirteen
intended failures. Earlier evidence is retained in Git and initial probe files.

The baseline covers create/correct/remove, identical replay, changed-payload
refusal, stale-version refusal, increasing response timestamps, immutable receipts,
and retained original words/checksums. Ordinary authenticated INSERT/UPDATE/DELETE
and service-role UPDATE cannot bypass the RPC, including a forged session setting
pointing at a completed receipt. The trusted source helper is not executable by
app roles. Private history retains the supplied correction reason and request;
creation reasons remain unknown when absent.

Direct sources and reply parents both withdraw published responses after a review
change. Automatic receipts retain the actual actor and before/after contribution,
with a separate automatic response-withdrawal reason and the moderator's source
reason. The existing publication guard still refuses a response linked to a reply
whose parent is withheld. An outsider cannot replay the staff request or read its
private receipts. Same-workspace actor swaps, viewer roles, membership revocation,
anonymous and system-actor scenarios still require their full dedicated probes.

One initial helper-ACL mutation survived because the security-invoker helper hit a
second table-write permission barrier, which the old probe also counted as success.
initial-guard-mutations.json retains it. The corrected probe checks the actual
EXECUTE privilege as well as the call. Removing that ACL now fails for the stated
reason. This proves the helper cannot be invoked, not that its invocation alone
would bypass all the other database protections.

## Independent connection evidence

A separate database response_write_probe_20260913 was created inside the named
disposable container from its 321-migration source. It is NOT the app's postgres
database or a PostgREST target. The two prototype files are committed only in this
clone so separate connections can observe the same schema. Synthetic race fixtures
and deliberately broken outcomes remain in the clone as test evidence. Never use
its data as product or public evidence.

The private dump and restore log are under
/home/nathaniel/.local/state/openplan/response-write-probe-20260913, directory mode
700. The initial restore under postgres stopped because that role cannot assign
the auth schema to supabase_admin. The existing clone was continued as
supabase_admin using an explicit remaining archive list, preserving original
owners and ACLs; no reset, DROP, demo mutation or paid service occurred.

prove-concurrency.py uses independent psql connections and pg_stat_activity to
confirm a contender is actually waiting on a live held transaction before its
peer commits. Current baseline scenarios all pass:

- Concurrent identical creates produce one response/history and the exact replay.
- A second editor using the original version is refused after the first commits.
- Publication first, including a newly inserted reply-linked response, is followed
  by withdrawal when its parent is withheld.
- Withdrawal first prevents the contender from publishing its stale source.
- A repeatable-read withdrawal is refused and rolls back the source edit intact.

concurrency-results.json records the observed lock events. mutate-concurrency.py
runs a harmless comment survivor and two intended failures. Without the shared
campaign lock, the publication-first test leaves a new response published after
parent withdrawal. Without the isolation guard, a repeatable-read source review
misses the new response. Both fail for their specific semantic outcome. The
original functions are restored in finally; database-custody.json independently
compares their actual database function-body hashes with the checked-in SQL.

## Demonstrated defects and limits

parent-withdrawal-reproduction.sql/log reproduces the existing schema's missing
reply-parent withdrawal, before installing the prototype in the clone. This is a
stored publication-state defect. The current public portal separately filters
responses against visible source IDs and approved parents in public-portal-data.ts;
these database probes alone do not prove that a withheld parent leaked through the
browser. Approved parent wording changes still require withdrawal and browser
follow-through. Keep that distinction when describing the finding.

repeatable-read-reproduction.json retains the actual unsafe withdrawal snapshot.
The inverse attempt with a stale publisher was refused by the existing campaign
FOR SHARE lock with a serialization failure. That counterexample is evidence too;
not every stale snapshot was unsafe. The source helper now explicitly requires
READ COMMITTED, the app's normal isolation, so other database callers must retry
there. This is an intentional compatibility limit, not silent partial success.

The earlier initial receipt-finalization and timestamp failures remain retained.
The generated digest is excluded from before-update immutable-field comparison
because it is not yet recomputed. The response clock advances at least one
microsecond rather than using transaction-constant now().

The source stack still has 321 migrations and no prototype receipt table. Its
1,005-response baseline and aggregate retained-history checksum match the clone.
No prototype was installed in the source database. No external email was sent.

## Remaining joins and blind categories

Permissions constrain ordinary app/service roles, not the database owner,
referential actions, or every possible security-definer function. The migration
search found only the known public-copy function as a direct SQL response writer;
future definer writers need explicit review and evidence. The prototype's private
receipt metadata cannot itself prove mail delivery, browser recovery, user intent,
or usefulness to a practicing planner.

Still required: full actor/role/revocation and simultaneous membership-change
probes; reader/type/UI reason exposure without rewriting old record/checksum pairs;
route integration and safe handling of transaction errors; durable publication
and outbox outcomes; exact pending-request and unsaved-word recovery in the UI;
real-navigation desktop/390px keyboard and console evidence; applicable full QA,
shuffled, live RLS, worker and populated upgrade checks, final CI and release.
Ordinary response routes would be disabled by applying the permission guard now.
Do not promote this prototype until the routes and UI join are coherent.
