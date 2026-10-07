# Authenticated plan-context commands

This continues the [persistence checkpoint](CONTEXT_PERSISTENCE.md) under roadmap
M1. The plan-context API now connects authenticated staff to the saved context
and exact command journal. The authoring interface, complete creation/freeze
transaction, frozen/public/exported context and descriptor reconciliation remain
unfinished. It does not remove the workspace-home creation gate or close M1.

The GET route reads context through the authenticated user's client. It selects
context, hash, checklist, plan kind and working-version pointer together. A
missing projection, invalid context, transformed value or inconsistent hash
state produces an error. Historical null context has an explicit legacy state.
Responses remain private and uncached.

The POST route requires same-origin staff access and the expected account and
workspace. Any assistant execution, hash or approval header is refused. The
request uses a strict, bounded schema; a shared form serializer normalizes values
before the client retains the command. The route refuses unnormalized values
instead of silently changing the retained request. Original transport bytes,
including permitted JSON whitespace, reach the database journal unchanged.

A retained command replays through the permission-checking database function
before loading current rules or fetching geography. Old results therefore remain
recoverable after an installed checklist disappears. New requests resolve and
validate geography and staff-stated applicability before saving. The database
still checks current permission, plan/version/checklist scope and stale context.
Acknowledgment requires a valid response for the exact actor, command and
version. Storage or transport failures remain unconfirmed outcomes, with no
automatic new command or default empty context.

## Checks and installation boundary

All 161 land-use unit tests pass. Full TypeScript and changed-file ESLint pass.
The [route controls](context-route/controls/report.json) include a passing
harmless comment and 34 detected faults, with all source restored byte for byte.
Database doubles return only selected fields and record all scope filters.
These tests cover request/refusal behavior and service arguments, not live HTTP
authentication, network interruption or browser command recovery.

The two reviewed additive migrations, `20261016000001` and `20261016000002`, are
now applied only to the owned isolated restore target on ports 29821/29822.
Their bytes match the committed migration files. Existing plan context remains
null after the upgrade; no historical snapshots change. The native persistence
test passes against the installed schema without its candidate-DDL probe flag.
This supersedes the earlier checkpoint's unapplied status for this test stack
only. The demo and BCA owner's stacks are untouched.

Identified production-build HTTP checks and simultaneous-save proof are now recorded below. Concurrent freeze and permission-change transactions remain open.
The existing PostGIS `spatial_ref_sys` advisor finding remains recorded in the
persistence checkpoint. No complete security-advisor pass, deployment to users,
visible workflow, legal applicability, agency acceptance or v1 release is claimed.

## Production HTTP and simultaneous-save follow-up

The [clean production build](context-route/native/build-status.json) passes at
`522fe33bf06e579e831b1e1b64f7b6ed32410e3a`. The owned server on port 3493 reports
that commit, and its process directory matches the isolated checkout.
[Server identity and shutdown](context-route/native/server-identity.json) record
that boundary. The server stops before subsequent repository edits.

The [HTTP record](context-route/native/http.json) contains 19 authenticated
requests against that build and the installed isolated schema. A new synthetic
workspace and plan start with historical-null context. The staff route saves an
uploaded study area and explicitly unresolved authority assessment. Native reads
confirm exact original command bytes and their hash. Exact replay returns the
original result; altered bytes and stale new commands are refused. A later save
remains current after replaying the older command. Wrong account/workspace
headers, assistant headers, cross-origin requests, viewer writes and replay after
writer revocation are refused. A viewer can still read the private plan context.
A direct authenticated table update is also refused.

These are synthetic fixtures. No agency or person adopts a plan or attests to
legal applicability. The second test user remains a viewer after the temporary
revocation case; the original fixture actor's owner role is restored. The probe
retains its request records before sending them. It does not simulate a lost
browser reply, prove offline draft recovery or collect rendered acceptance.

The [two-session SQL probe](context-route/native/concurrency.json) starts two
writers with the same context hash. The real function refuses the busy second
writer, and refuses its stale retry after the first commits. The first writer's
context remains current. An unchanged copy with a harmless comment does the
same. A private, unexposed function copy with both update locks removed allows
the stale second writer to overwrite the first after an observed row-lock wait.
This is the expected defect, demonstrating that the probe can detect a lost
update. The real function definition remains byte-for-byte equivalent, and the
private probe schema is removed. Each case owns a separate marked synthetic
plan; the fault-case output is not accepted planning evidence.

The [local probe source](context-route/native/concurrency.py) requires the
retained private synthetic-fixture journal and the named isolated stack. It
refuses an existing output journal before creating another schema or fixture;
[the guard check](context-route/native/journal-control.json) confirms the old
record remains unchanged. Do not rerun it over the original case. No credentials
or session cookies are included in these committed records.

This proves sequential HTTP custody and simultaneous database saves. It does not
prove concurrent HTTP calls, a freeze racing with a save, current-rule
reconciliation, the complete authoring/publication journey, browser usability,
practitioner acceptance or full v1 readiness. Continue those M1 requirements
without treating this checkpoint as their substitute.
