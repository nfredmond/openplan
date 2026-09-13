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
current composed-source and probe hashes, baseline, harmless survivor and fifteen
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
probes; UI reason exposure and final reader integration without rewriting old record/checksum pairs;
route integration and safe handling of transaction errors; durable publication
and outbox outcomes; exact pending-request and unsaved-word recovery in the UI;
real-navigation desktop/390px keyboard and console evidence; applicable full QA,
shuffled, live RLS, worker and populated upgrade checks, final CI and release.
Ordinary response routes would be disabled by applying the permission guard now.
Do not promote this prototype until the routes and UI join are coherent.


## Request adapter, reason reader and email worker checkpoint

response-write.ts now validates and forwards the caller's retained request ID,
original microsecond timestamp, reason, explicit nulls and accepted AI provenance.
It checks receipt scope/identity and separates conflicts from unconfirmed saves.
Only the known publication refusal is an invalid-input P0001; other internal
exceptions remain unavailable rather than falsely blaming the user's fields.
The history prototype reader includes reason/request/origin metadata; old absent
metadata remains null in TypeScript, without changing retained response hashes.
These helpers are not called by the current response routes yet.

response-broadcast-queue.sql is another unapplied companion. A real publication
transaction creates one private queued intent and operator inbox record. Replay
creates neither again. Preparation snapshots every confirmed recipient in one SQL
statement, persists each outbox message and opt-out link, and records the count.
An injected outbox failure leaves the saved publication intact and its broadcast
queued with unknown audience, rather than partial delivery or a false zero.

Claims persist an attempt before transport and verify the retained message hash,
current response/version/share link and subscription. Withdrawn or changed work,
altered messages and unsubscribed recipients are cancelled before transport.
Stale in-progress attempts become uncertain and are not reissued. Exact outcome
acknowledgement is idempotent; a wrong attempt or replacement of a completed
outcome is refused. Staff can read complete counts without recipient identifiers;
private tables and worker RPCs remain inaccessible to ordinary app roles.
Preparation and claims require READ COMMITTED. No provider is called by SQL.

prove-broadcast.py retains baseline, harmless survivor and fourteen semantic
failures, including >1,000 recipients, persistence failure, opt-out loss, claim
identity, repeated uncertain delivery, content changes, withdrawal and access
boundaries. Its source-stack transactions all rolled back; the broadcast table
was absent after the probes. The specific isolation guards, empty/no-share-link
branches, multiworker claims and concurrent unsubscribe still need dedicated
adverse scenarios before promotion. The SQL suite is not a live worker-to-PostgREST
integration test.

The local worker is invoked with npm run worker:engagement-email. It needs the
installation's ordinary Supabase configuration and NEXT_PUBLIC_APP_URL as a bare
public origin. OPENPLAN_ENGAGEMENT_EMAIL_WORK_DIR optionally selects its private
journal root; it always uses a database-address-derived child directory so separate
installations cannot consume each other's outcomes. Do not start it against the
app's source stack until the queue migration is ready and applied.

The worker validates claim identity and PostgreSQL's exact message-text checksum
before transport, journals the observed result, then acknowledges it in the
database. Restart retries that acknowledgement only. A provider response or local
journal failure with no durable observed outcome remains uncertain; this does not
prove exactly-once delivery or physical power-loss durability. An accepted result
means provider acceptance, not arrival in a recipient's inbox. Unconfigured email
is skipped honestly and logs neither addresses nor subjects. The existing email
transport now has a twenty-second request deadline.

prove-typescript.py records 65 tests, a harmless survivor and twenty-five targeted
failures. The initial mutation selector matched both an intent and a receipt field
and stopped before editing; initial-typescript-mutations.json preserves that run.
The corrected selector names the intent declaration. All source edits are restored
in finally. The journal tests reopen actual local files in a fresh instance,
retain unacknowledged/malformed files, and archive only an acknowledged result.

prove-worker-process.mjs launches the actual worker entry point in separate Node
processes against two local synthetic HTTP contracts, with the provider key removed
from child environments. Its first acknowledgement fails; a new process recovers
the exact retained skipped result without calling transport again. The second
installation cannot consume the first one's result. Baseline and comment control
survive; removing recovery or installation scoping fails for the named outcome.
The initial process test had a local variable named process that shadowed Node's
global before a worker started; initial-worker-process-results.json retains that
harness failure. The corrected run restored the original worker script and stopped
all worker/HTTP processes it created. No actual email or paid service was used.

The clone still contains the b878d35d response transaction/withdrawal prototype,
not these newer broadcast tables or complete-reader extension. The app database
still has 321 applied migrations and no prototype objects. Do not confuse the
local HTTP contract fixture with an identified OpenPlan browser build.

Still required before a coherent release: route and UI integration, schema
promotion and live REST-to-worker recovery, full actor/role/revocation and remaining
queue concurrency/isolation probes, truthful Activity/broadcast reporting, browser
pending-edit/conflict/reload recovery, desktop/390px keyboard and console journeys,
full QA/shuffle/RLS/worker/upgrade checks and final release CI. The old Activity
outbox projection does not yet expose the new uncertain/attempting states; it must
be joined before the new worker is enabled. Previously skipped/uncertain mail is
not automatically resent, and no retry/resolve UI for those outcomes exists yet.


The final SQL adapter check also refuses clearing already-recorded AI assistance.
An ordinary human correction keeps that provenance; the targeted clearing mutation
fails. This is a recorded-provenance rule, not detection of unrecorded AI use. The
source-stack transaction and broadcast suites were rerun after this guard. The
older separate-connection clone has not been updated with this additional rule.

Final focused compatibility check: 96 tests in nine files, including the existing
notification library, inbox and delivery UI, with zero failures. Full TypeScript
checking and ESLint on every changed TypeScript file completed with exit 0.
adapter-worker-checks.json retains source hashes and the independently checked
source database boundary. This is not the full release QA or browser gate.
