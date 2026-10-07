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
