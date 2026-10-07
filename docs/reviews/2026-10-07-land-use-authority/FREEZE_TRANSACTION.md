# Atomic freeze persistence checkpoint

This is the database implementation behind the next M1 freeze route. It follows
`1035268d`, which adds working-version revision tracking. The application still
uses its existing separate freeze writes. This checkpoint does not claim that a
planner can use the new transaction through the interface.

## Command and transaction

Candidate migration `20261016000004` adds an append-only, service-only freeze
command journal and a security-invoker transaction. The journal retains exact
request and prepared snapshot text, their generated hashes, the actor, revision,
freeze time and review-event ID. Authenticated and anonymous callers cannot read
the journal or invoke the transaction or its content-projection helper.

The transaction locks the plan and working version with `NOWAIT`, and locks the
current writer's membership. A new command must match the current working
pointer and draft revision. Its prepared plan/version identity, context,
descriptor edition and complete authored projections must agree. Database reads
reconstruct the nodes, relationships, designations with frozen GIS evidence and
policy links, and implementation actions. Missing fields and content omissions
are conflicts, even when the revision number matches.

Readiness is checked while holding the version lock. Applicable and required
sections need non-whitespace content; mapped designations need ready hashed GIS
versions; an implementation action must exist; required review prerequisites and
consultation status must be satisfied. Section whitespace uses the same set as
JavaScript `String.trim`. No consultation notes enter the public snapshot.

Only then does one transaction freeze the version, clear the working pointer,
insert the attributed review event and retain the command receipt. Database time
supplies the freeze timestamp. An exact replay checks current membership before
returning the original outcome. Changed actor, version, revision or request bytes
cannot reuse the command ID. Replay after a later working version exists leaves
that version and its pointer unchanged. It does not resolve the descriptor again
or rebuild the snapshot.

## Native verification

The rollback-only fixture constructs expected authored content independently of
the production projection helper. It checks every returned public field, omitted
content, changed identity/revision/descriptor, stale version preconditions,
readiness refusals, private-note exclusion, role boundaries and exact original
request bytes. Synthetic late failures at both the event and journal inserts
leave the version working, its pointer intact, and no event or receipt. Exact
replay emits no duplicate event; revoked writers cannot replay. Parent-plan
cascade cleanup remains allowed.

The [controls](freeze-transaction/controls.json) retain baseline, a harmless
comment and 33 targeted faults. All produce their expected results, with source
unchanged. The [runner](freeze-transaction/controls.py) verifies the explicit
isolated-stack name and applies each in-memory DDL candidate inside its own
rolled-back transaction. The hash fault initially failed only when replay
compared the receipt; an added independent digest assertion now detects the wrong
hash at the first response. The test was strengthened rather than accepting an
incidental later failure. A SQL variable-qualification error found by the first
native run was corrected before these controls.

The fixtures use a finalized empty synthetic GIS layer and minimal synthetic
rules. Their snapshot text uses PostgreSQL JSON formatting, not the application's
canonical serializer. These are transaction and field-custody checks, not usable
public packets or verified API-to-public hashes. They do not establish legal
applicability, practitioner approval or scientific accuracy.

## Installation and remaining work

Migration `20261016000003` is installed only on the named isolated verification
stack, after commit `1035268d`. The installed draft-revision and context suites
pass. Migration `20261016000004` is still a candidate tested with the explicit
rollback probe flag. Its table and functions do not remain in that database
after collection. The demo, BCA and engagement servers are untouched.

Connect the staff route and workbench to this command before claiming atomic
freezing. Required work includes strict account/workspace and version/revision
scope, the descriptor hash seen by the planner, executable agent refusal,
canonical snapshot text, sorted policy-link arrays, route-local result validation,
durable browser requests and exact recovery after an uncertain reply. The route
must discover replay before loading new content or installed rules. Direct
browser table transitions also need to be closed when the verified route is
connected; this candidate does not yet change the legacy table-write permission.

Collect actual simultaneous edit/freeze, permission-change and duplicate-command
transactions, followed by identified-build HTTP and public hash checks. Desktop,
390px, keyboard, console and artifact inspection remain open while T3 snapshot
inspection fails. M1, the other roadmap requirements and the full v1 contract
remain open.
