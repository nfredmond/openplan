# A revision boundary for plan freezing

This follows the frozen-context checkpoint at `b5736b7b`. The existing freeze
route reads readiness and content across requests, then separately writes the
frozen version, current-working pointer and review event. A context-only lock
cannot establish that all the authored inputs still agree with those reads.

## Database change

Migration `20261016000003` adds a nonnegative integer `draft_revision` to plan
versions. Existing rows start at zero. No frozen snapshot or content hash is
rewritten. Database triggers advance a working version's revision for writes to
content nodes, relationships, designations, policy links, implementation actions,
process records and private consultation records. Plan identity, study geometry,
saved context, version kind, predecessor and applicable-section changes also
advance it. Child updates conservatively count even if their assigned values are
identical; repeated identical plan-identity updates do not count.

Each child write first locks its version, then existing frozen-content checks
run under that lock. Moves between working versions advance both counters in
UUID order. Moving records out of a frozen version is refused. Legitimate
implementation-status updates after freeze remain available and do not change
the frozen revision. Direct counter edits, invented nonzero starting counters
and version ownership changes are refused. Parent/version cascade deletion still
works. This is a concurrency precondition, not a source, accuracy or readiness
score.

PostgreSQL holds acquired row locks through the transaction, and trigger queries
have defined visibility of changes made within a statement. The implementation
uses those mechanisms and verifies the actual behaviors in the isolated database.
[PostgreSQL 17 locking](https://www.postgresql.org/docs/17/explicit-locking.html),
[trigger visibility](https://www.postgresql.org/docs/17/trigger-datachanges.html).

## Evidence and limits

The native fixture exercises authenticated writers and viewers, every registered
input table, plan and version metadata, both sides of a record move, frozen
content, counter protection and cascade deletion. Its migration and all fixtures
run in a rolled-back transaction. The isolated target has no `draft_revision`
column after collection. Early failures were fixture setup errors: the empty
synthetic GIS version lacked its source count, then needed normal finalization
before a designation could reference it. No guard was weakened to accept that
fixture.

The [control record](draft-revision/controls.json) contains baseline, harmless
comment and 26 targeted faults. All match the expected result; source remains
unchanged. The [runner](draft-revision/controls.py) applies each candidate inside
a separate rollback-only transaction. It verifies the explicit isolated-stack
name before calling PostgreSQL.

These checks are sequential native database checks. They do not prove concurrent
input edits versus freeze, a complete freeze transaction, route authorization,
HTTP recovery, rendered usability or v1 acceptance. The synthetic SQL fixtures
include an empty GIS layer and deliberately minimal frozen/context objects. They
are not application-ready planning records or professional evidence.

## Next transaction and interface

The freeze command must name the exact version and observed draft revision,
account/workspace scope, a unique command ID and the descriptor edition the
planner saw. Before any readiness or snapshot reads, the server must establish
that revision. A database transaction must lock plan/version and current writer
membership, reject intervening changes, recheck readiness, then commit the
frozen version, cleared pointer, review event and command receipt together.

Retain exact request bytes before browser transport. Replay checks current
permission and returns only the original command's outcome, even after a later
working version exists. A command ID cannot be reused for different bytes or a
different actor. An unknown reply cannot start another freeze or silently discard
its request. Installed descriptor changes need reconciliation, not a new inferred
approval. Agent writes require an approved registered action or an executable
refusal. Until those pieces are connected, this revision counter does not repair
the existing multi-request freeze route.
