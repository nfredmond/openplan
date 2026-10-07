# Recoverable staff freeze commands

The staff freeze route now submits one exact command to the atomic transaction.
The workbench retains that request before transport and exposes explicit recovery
when the reply is unknown. This follows the database-only
[checkpoint](FREEZE_TRANSACTION.md). It does not close M1 or v1.

## Application behavior

Each command binds the authenticated account, workspace, plan, working version,
draft revision and checklist hash returned to the workbench. The route requires
same-origin staff access, refuses assistant execution/approval headers, bounds
request bytes and preserves the original JSON text. It discovers an earlier
receipt before loading current content or installed rules. Fresh requests must
match the observed version, revision and descriptor. The database rechecks
permission, content and readiness inside its transaction.

The route sends canonical snapshot and descriptor text, including the draft
revision and policy links sorted by identifier. It accepts only a valid receipt
matching the command, version and revision. Fresh preparation also requires the
returned content hash to match the prepared snapshot. An exact replay can return
the original receipt after a later working version exists.

Browser storage uses one immutable key per command, scoped to account, workspace
and plan. Acknowledging one result cannot clear another pending command. Reading,
reloading, importing and restoring requests do not send them. Retry uses the exact
saved bytes and warns that it may freeze the originally requested draft. Changed
saved content remains a conflict. Unknown or malformed replies retain the request.
Account changes abort pending transport and prevent late acknowledgment.

Staff can download or preserve an unreadable request before reviewing the current
plan. Preservation verifies the copy before removing the pending key. It does not
cancel or undo a server operation. Recovery files must match the current account,
workspace and plan. Failed refresh after confirmation or preservation blocks a
new freeze until the current plan loads. Existing unsaved-text controls remain.

Candidate migration `20261016000005` closes authenticated direct inserts of frozen
versions and transitions out of working state. Its security-invoker trigger checks
the database role rather than a caller-controlled JWT role. Ordinary working
writes and the verified service transaction remain usable. Existing frozen
records and later adoption transitions are unchanged.

## Verification and limits

The complete land-use unit selection passes 258 tests, with three live suites
skipped in that unit run. TypeScript and changed-file ESLint pass. A React cleanup
warning was resolved by capturing the effect generation; the subsequent lint and
recovery controls pass. The final [route controls](freeze-route/route-controls.json)
include baseline, a harmless comment and 42 detected faults. All source is restored
byte for byte. An earlier control runner used the wrong blocker variable in its
last mutation target; that harness error was corrected and the complete controls
rerun. It did not produce a product acceptance result.

The native freeze suite passes against the owned isolated database with candidate
migrations 4 and 5 applied inside a rolled-back transaction. The
[server-path controls](freeze-route/server-path-controls.json) include baseline,
a harmless comment and four detected faults. They prove ordinary authenticated
working updates remain allowed, direct frozen insert/update paths are refused,
a forged JWT role cannot bypass the guard, and the service freeze still commits
and replays. The prior transaction fixture continues to exercise exact content,
permission, readiness and late-write rollback boundaries.

Mocked database tests honor selected fields and assert scoped projections. DOM
checks cover local retention, explicit retry, uncertain outcomes, duplicate
clicks, account changes, refresh failure and preservation/restoration. These are
not browser, accessibility or practitioner acceptance. The SQL fixture still uses
synthetic rules, an empty GIS layer and PostgreSQL-formatted snapshot text.

Migrations 4 and 5 remain unapplied outside rollback probes at this checkpoint.
Production build, identified HTTP-to-database canonical hash checks and actual
simultaneous edit/freeze, permission and duplicate-command transactions remain to
be collected. T3 still reports the owned preview attached but fails even a
text-only snapshot. Desktop, 390px, keyboard, console and artifact review remain
open. No fallback-browser authority, legal approval, scientific acceptance,
release or completed plan-context authoring workflow is claimed.

## Identified build, HTTP and simultaneous transactions

The subsequent [production build](freeze-route/native/build-status.json) passes
at `c29d064045b3f511448cbd41f7e8b0a0fca6611c` with its checkout unchanged.
Migrations 4 and 5 are now installed only on the isolated verification target.
All three [installed native suites](freeze-route/native/installed-native.log)
pass without candidate migration flags. Do not reapply candidate DDL to this
installed target. This supersedes the unapplied status above for this stack.

The owned port 3494 server reports that commit, and its actual Next process cwd
matches the isolated worktree. Its [identity and shutdown record](freeze-route/native/server-identity.json)
shows it stopped before later repository edits. The first process-discovery
helper also matched its own inline Python command; narrowing it to process-title
prefixes identified the actual Next process. No server was substituted.

All 33 [production HTTP requests](freeze-route/native/http.json) produce their
expected results. A synthetic plan retains uploaded study context, section and
policy text, two policy links, a finalized empty GIS version, an implementation
action and a private consultation note. A changed draft refuses its stale freeze
request. Wrong account/workspace, cross-origin and assistant-header requests are
refused. Direct authenticated table freezing is refused.

The successful staff freeze returns one receipt and one attributed event. Native
reads confirm original command bytes and their hash. The database snapshot text
matches the application canonical serializer exactly; its hash matches the
receipt, version and anonymous public review packet. Policy links are sorted,
retained context is present, and the private consultation note is excluded. Exact
replay preserves the original outcome after a newer working version exists.
Changed bytes, another writer's reused command and revoked/viewer access are
refused. The public review document states that no actual public process occurred.

The [concurrency record](freeze-route/native/concurrency.json) contains seven
actual two-session cases on the synthetic follow-on version. A pending child edit
causes immediate freeze refusal; after the edit commits, the earlier command is
stale. A pending freeze refuses child writes and duplicate commands. A concurrent
permission change first produces a busy refusal, then a permission refusal after
revocation commits. Committing a freeze once and retrying its exact command returns
one original event and receipt.

Private function copies retain the same behavior under harmless controls. Removing
the working-version lock reproduces the defect: the snapshot retains revision 11
while the row has revision 12 after a child edit commits. That broken freeze rolls
back. The public function stays byte-for-byte unchanged, and the private schema
is removed. The first fixture attempt correctly hit the last-owner protection;
a second synthetic owner was added only for the permission case and then restored
to viewer. A missing statement terminator in the private-copy runner was also
corrected before the complete run. Neither harness failure is a product pass.

The final real duplicate-command case leaves the synthetic follow-on version
frozen. The original public review fixture and private command journals remain
available. Do not rerun these one-shot producer scripts against their completed
journals. Concurrency snapshots use the native content helper for lock testing;
the independent HTTP/public canonical-hash check supplies the separate serializer
boundary. This remains local synthetic verification with an empty map, not a
usable agency packet, browser acceptance, public participation or legal approval.
T3 reopening still reports available but text snapshot inspection fails. Desktop,
390px, keyboard, console and rendered artifact acceptance remain open.
