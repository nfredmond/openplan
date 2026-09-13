# Response recovery and Activity join, September 13, 2026

This supersedes USAGE_PAUSE.md for the installed database state and Activity work.
The full v1 goal remains active. v0.56.1 is still the published release; no new
release claim follows from this checkpoint. Direct main after verification,
no PRs or human-review release gates. Leave the original checkout, demo and
pending reminder constraint alone.

## Installed database state

The named disposable container supabase_db_openplan-restore-target-2026091050,
source database postgres, API 29821 / DB 29822 now has 323 migrations through
20261014000004. The response transaction/guards/queue and complete Activity
summary are installed. Never run the old prototype table installers against
this source. prove-installed.py runs the existing response/guard/queue/authority
probes without reinstalling. prove-activity-sql.py detects whether its summary
function is installed and restores the exact previous definition after every
rolled-back mutation suite.

migration-custody.json and activity-migration-custody.json record both upgrades.
All 3,034 preexisting response rows and 3,051 history rows retained exactly the
same old-column JSON bytes. Every individual record checksum remains valid.
The original 1,005-response campaign remains intact. The older aggregate hash
query could not be recovered; the new custody file retains the exact query for
these complete snapshots instead of guessing its order or claiming equivalence.
Private snapshots and two custom-format backups are under
/home/nathaniel/.local/state/openplan/response-write-probe-20260913/migration-20261014000003/.
The first archive directory was readable; restoring these backups remains untested.

The initial SQL comparison differed only in two separator blank lines; the exact
assembled SQL matches its probed companions. The first CLI connection requested
unsupported TLS and changed no schema; explicit loopback sslmode=disable succeeded.

## Activity behavior

The notifications GET now calls the staff-scoped summary RPC with the session
client and returns private/no-store. SQL aggregates every campaign message once,
using durable attempt state when present and preserving old outbox-only records.
Queued publication intents remain visible before any recipients are prepared.
No provider error text, participant addresses or arbitrary transport strings are
returned. Provider acceptance does not establish inbox delivery.

The browser independently validates schema, count totals and campaign identity.
Activity displays attempting, uncertain and cancelled messages, missing-link and
cancelled preparation, and a refresh button. Uncertain messages are not resent.
The old 500-row TypeScript summary was removed. Its old joined test was replaced
by the real RPC adapter/route/component suite and separate installed SQL probes.
Existing notification writer/subscription tests remain in the focused regression
suite. RPC doubles do not prove the SQL they stand in for; SQL probes do not
prove real navigation, CSS, mail transport or concurrent queue claims.

## Evidence and errors retained

activity-ui-mutations.json records a harmless survivor and targeted failures for
RPC scope, count completeness, negative/missing/private fields, provider error
privacy, both browser boundaries, old-campaign display, honest acceptance labels,
refresh, pending audience, missing/cancelled preparation, route access and cache.
activity-sql-mutations.json covers complete scoped counts over 1,005 recipients,
durable state precedence, withheld private strings, preparation states and role/
actor/anonymous privileges. Synthetic status updates test summary interpretation,
not worker transition correctness. The renamed actor-membership mutation fails
at viewer disclosure, before the later revoked-member case.

The installed response control initially failed because pg_get_functiondef
needed a terminating semicolon when embedded in the probe script. That runner
error is retained in installed-probes-initial.json; corrected controls survived
and the stale-write fault failed for the intended reason. The new summary probe
initially changed every membership for its synthetic auth user, including the
workspace automatically created by the signup trigger. The owner-floor safeguard
refused the change; the whole transaction rolled back. The fixture now scopes
its membership changes to the intended workspace. The first UI mutation batch
stopped before changing the route because its selector also matched PATCH; the
corrected script explicitly changes GET only. Initial evidence remains retained.

The latest focused test run covers 237 tests in 14 files. Final static checks,
browser identity and journey evidence are recorded separately as they complete.

## Resume from here

Owned checkout /home/nathaniel/.local/state/openplan/engagement-response-writes-2026-09-12,
branch work/engagement-response-writes, app package openplan/. Private .env.local
now points directly to API 29821 and http://localhost:3260, with email disabled.
It is ignored and mode 600. Browser account remains in the private
api-provider-research-2026-09-12/api-settings-account.json; never print it.
Recheck live processes and build identity before starting or reusing a server.
The source clone response_write_probe_20260913 remains a separate older-schema
security probe database, not a browser target.

Remaining: real navigation at desktop/390px, keyboard and console, interruption/
review/history/privacy journeys; simultaneous queue claims and unsubscribe races;
live REST-to-worker recovery; full QA, shuffled tests, isolated RLS, workers,
upgrade/restore and exact final release CI. Complete these before the next minor
release, then continue the full roadmap and contract toward v1.
