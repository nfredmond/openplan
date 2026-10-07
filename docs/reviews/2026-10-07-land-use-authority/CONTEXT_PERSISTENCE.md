# Plan-context save and recovery boundary

This extends the [context foundation](CONTEXT_FOUNDATION.md) on the isolated
`work/land-use-plan-context-20261007` branch. It implements database persistence
for the existing M1 design. The API, interface, complete freeze transaction and
public/exported context are not connected. The workspace-home gate still exists.
This is a verified development checkpoint, not M1 or release acceptance.

## What the database now enforces

The candidate migration provides a service-only, security-invoker save function.
The application server must authenticate the actor, validate the command against
the installed descriptor and re-resolve selected geography before calling it.
The database checks current workspace write permission again. It supplies the
author and time, checks the selected working version, checklist, plan kind and
expected context hash, then saves the context and command outcome atomically.

The journal retains the original command text and hash, expected context hash,
actor, version, checklist, plan kind and saved result. An exact retry returns its
original result after fresh permission checking. It does not overwrite a newer
save or require an old version to remain working. Changed command bytes or
scope under the same command ID are refused. A revoked writer cannot recover a
result through this function. Journal rows refuse direct changes and deletion;
removing the parent plan still permits its existing cascade.

Authenticated table writers cannot insert or alter server-resolved context.
They also cannot change the checklist or plan kind of an assessed plan through
a direct table write. Ordinary title edits remain available. The new journal
has RLS enabled and no authenticated or anonymous table grants. Its service
role has only SELECT and INSERT grants. The save function does not acquire
additional privileges through SECURITY DEFINER. Privileged server/database
operators remain trusted; this is not protection against a compromised service
key or database administrator.

A freeze guard checks that the snapshot retains exactly the current context.
It covers both the normal working-to-review update and direct insertion of an
already-frozen version. Legacy null context remains distinct from retained
context. Existing frozen records are not backfilled. NOWAIT row locks refuse a
busy operation rather than waiting in the opposite order used by historical
freeze callers. Simultaneous sessions have not yet verified those lock paths.

## Verification on October 7

The isolated restore target runs PostgreSQL 17.6. The candidate DDL and new
synthetic users, workspace, plans and commands run inside one rolled-back
transaction for each case. Catalog queries afterward confirm that neither
`plan_context` nor the new journal persists. No migration history is changed.
The SQL fixture includes valid uploaded study geometry and an explicitly
unresolved synthetic authority assessment. It exercises database behavior,
not legal applicability or a boundary-provider response.

The [control report](context-persistence/controls/report.json) records a passing
baseline, a passing harmless comment and 32 targeted faults. The checks detect
permission grants, actor/workspace confusion, direct writes, context/checklist
changes, altered replay scope or bytes, incorrect attribution, journal changes,
and mismatched frozen context. Source files stay unchanged throughout these
controls; each altered SQL copy exists only in its rollback transaction.
Leading/trailing whitespace in the command also exposes destructive trimming.

An early permission mutation hit the viewer case before the intended outsider
case. Reordering those independent cases made each failure identify its own
boundary. The original unsuccessful control output remains in the private
recovery files. An early revocation fixture also hit the existing last-owner
protection; assigning a second owner permits the intended permission test.
Neither application guard was weakened to accommodate a fixture.

All 130 existing land-use unit tests pass. The live persistence test passes
separately with explicit live-stack and candidate-migration opt-ins. Full
TypeScript and changed-file ESLint pass. These tests do not establish an HTTP
write, browser recovery, PostgREST schema refresh or concurrent-session behavior.
The freeze fixture uses a synthetic content hash; this check does not prove the
whole frozen-content hashing, readiness or adoption workflow.

The local security advisor reports one pre-existing error for the PostGIS-owned
`public.spatial_ref_sys` table lacking RLS. Its raw report remains in the private
recovery files. It runs against the existing schema, so it is not an advisor
assessment of the unapplied candidate. Candidate grants, security-invoker status,
RLS flag and actual role restrictions are checked inside the native transaction.
Do not describe the full advisor run as passing.

The implementation follows the current
[Supabase function security guidance](https://supabase.com/docs/guides/database/functions)
and [PostgreSQL function privilege rules](https://www.postgresql.org/docs/current/sql-createfunction.html).
The October 7 changelog review includes explicit Data API grants and the
September 25 PostgreSQL minor-update advisory. This change uses SHA-256 digest,
not legacy PGP encryption, and does not upgrade the local database.
[Supabase Data API grant change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically),
[PostgreSQL minor-update advisory](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).

## Remaining M1 work

The roadmap remains the queue. Continue this same plan-context design through
route-local authentication and agent-write refusal/approval handling, durable
client command recovery, atomic creation and freeze, retained public/exported
context, and version carry-forward. Reconcile descriptor editions without
altering old reviewed snapshots. Prove simultaneous saves, membership changes
and freeze races on an isolated persistent candidate stack before claiming
concurrency acceptance. The create/edit flow must preserve drafts and replace
the workspace-home gate with a complete plan-owned assessment.

California general/specific-plan distinctions, the cross-client and sovereign
cases in the design, identified desktop/390px journeys, console/keyboard review,
usable downloads, and practitioner/counsel acceptance remain open. The T3
preview still reports available but hidden, and screenshot capture fails after
reopening it. No fallback browser or visual acceptance is claimed. The full v1
contract, including separate scientific and operational evidence, remains open.
