# Browser and delivery concurrency, September 13, 2026

This supersedes RESET_CHECKPOINT.md for completed browser journeys, installed
migrations and runtime state. Published release is still v0.56.1. The full v1
goal remains active; no PR or human-review release gate is required.

## Real navigation

The owned checkout's dev server on localhost:3260 was identified with
which-openplan.sh. Browser reports identify commit 39f2db35 and hash the five
actual app files; those hashes were rechecked against the retained source.
The only change during these journeys was the journey script, between runs.

Both 1440px and 390px journeys entered through sign-in and Engagement navigation,
created synthetic campaigns through the wizard, generated a public link and
activated the campaign. An intercepted create really committed, then its HTTP
acknowledgement was aborted. After reload, keyboard retry sent the identical
request and left one original history record. Publishing queued the update;
the native local worker prepared its known-empty audience through PostgREST.
No external mail was sent or provider acceptance claimed.

The corrected edit locator scopes to the actual editing row and checks both its
starting value and submitted correction. The previous two-label count was a
script error, not an app defect. While the correction was pending, history was
opened and focused. After acknowledgement, it retained focus and displayed all
three revisions. Original record bytes and checksum were unchanged. Refreshing
the publication notice in history retrieved the retained empty audience result.

browser-evidence/ contains both JSON reports and reviewed screenshots of pending
recovery, prepared Activity, corrected history and publication status. Text and
controls were visible at both widths; document width did not exceed the viewport.
The final runs had no page exceptions. Their sole console error was the deliberate
aborted create response. Request logs also retain background GET cancellations.
An earlier desktop run emitted ERR_NETWORK_CHANGED and map-fetch warnings; later
runs did not reproduce them. Their original cause is unresolved. Do not generalize
these journeys into complete cartographic or whole-product acceptance.

## Concurrent delivery defect and fix

A fresh non-serving database response_broadcast_probe_20260913 was restored from
a full source archive inside supabase_db_openplan-restore-target-2026091050.
Restore exit was zero; migration ledger and response/history snapshots matched,
and source snapshots were unchanged. See broadcast-clone-custody.json. Original
owners and ACLs were restored as supabase_admin. This proves the compared records,
not every table or the full application restore procedure.

Independent connections found that claims could read an old subscription while
unsubscribe was pending, or an old active campaign while closure was pending.
They did skip another worker's held message correctly. The initial campaign
fixture used invalid status paused; that failed before testing the intended race.
The corrected fixture uses the supported closed status. Both initial reports
are retained and their distinct failure reasons must not be conflated.

Additive migration 20261014000005 locks the qualifying subscription and response/
campaign rows while deciding a claim. Earlier unsubscribe or closure waits are
resolved before a message is released to the worker. An unsubscribe following
an already-authorized claim waits until that claim transaction finishes. A
committed claim may already be in flight to the provider; this cannot recall it.

The clone's candidate baseline and harmless-comment control passed all four
scenarios. Removing the subscription lock, campaign lock or SKIP LOCKED produced
the specific expected failure. The original clone function was restored and
hash-checked afterward. See broadcast-concurrency-mutations.json and
broadcast-concurrency-restoration.json. Synthetic clone fixtures are retained;
no provider, app server or PostgREST instance points to that clone.

The disposable app database postgres now has 324 migrations through
20261014000005. delivery-authority-upgrade.json confirms the migration succeeded
and all current response/history snapshot bytes and the original 1005-row fixture
were unchanged. Installed transaction, authority and broadcast probes then passed;
the harmless control survived and the stale-version fault failed as intended.
The latest backup itself has not been restored. Never run prototype table
installers against this installed database.

## Runtime and next work

The owned dev launcher PID 1980745 was stopped for QA. Recheck listeners before
restarting; do not touch the separate demo. The ignored .env.local still points
to the disposable API 29821 and disables email. Worker virtualenv symlinks now
reuse the main checkout's installed interpreters after matching their dependency
manifests; the worker source and working directories remain in this worktree.

Still required: full QA, shuffled suite, isolated live RLS, workers, live recipient
and acknowledgement-recovery evidence, remaining changed-workflow privacy and
recovery journeys, applicable upgrade/restore checks and final release-commit CI.
Current checks are not a release declaration. After those pass, prepare the next
minor release, land directly on main and tag only after final CI. Continue the
full current contract and roadmap afterward, keeping scientific claims separate.
