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

Identified production-build HTTP checks and concurrent-session proof are next.
The existing PostGIS `spatial_ref_sys` advisor finding remains recorded in the
persistence checkpoint. No complete security-advisor pass, deployment to users,
visible workflow, legal applicability, agency acceptance or v1 release is claimed.
