# Reasoned response writes and interrupted-request recovery

Owner: this thread, no subagents, in the separate worktree
/home/nathaniel/.local/state/openplan/engagement-response-writes-2026-09-12,
branch work/engagement-response-writes, based on 3f70af98. The application package
is openplan/. Dependencies are reused by a node_modules symlink; build output is
separate. The preceding release checkout stays fixed; its final CI and publication completed.

## Preceding release published

v0.56.1 is published at 3f70af98e6fb06b4c0f932769e10f880711d46ec, matching the
peeled tag and remote main at publication. Exact CI 34742035606 and RLS Isolation
34742035586 both completed successfully, including all jobs. Publication occurred
2026-09-13T06:28:37Z. The outbox-recovery review retains the receipt and local
checks. Do not tag it again. The transaction prototype below is NOT in v0.56.1.

## Confirmed existing gap and reuse

The earlier rolled-back stale-editor reproduction is retained in the response
history review. Current PATCH still reads prior publication status separately,
then writes by response/campaign ID without the editor's original version. DELETE
also lacks that version. POST has no durable request identity. The now-shipped
history trigger protects old words but cannot prevent these writes or replay a
request whose response was lost.

Keep the existing Engagement responses, private history, complete snapshot
readers, publication guard and contribution/survey review patterns. Do not create
a module. The only current TypeScript producers are the create/PATCH/DELETE
routes; AI draft assistance feeds the same create flow. RTP and land-use readers
have separate completeness follow-through. No new agent action is exposed here;
existing action registry/approval boundaries remain authoritative.

## Implementation boundary

Move response mutations into one authorized database transaction. A campaign-
scoped request ID binds the actor, operation, exact validated payload and result.
Identical retries return the retained original result; a different payload with
that identity conflicts. Concurrent identical requests must produce one result.
Check the editor's expected updated_at while holding the response row lock.
Make the saved timestamp advance even for multiple writes in one transaction.
Record supplied reasons for corrections, publication/withdrawal and removal in
private history; do not invent reasons for old copies or initial drafts.

A receipt must not claim a successful write until the mutation and its history
commit together. Enforce the transaction path in the database, not solely in HTTP
handlers. Receipt/history tables remain private and immutable after completion.
Server writes must verify current workspace/campaign authority; a replay must not
bypass revoked access or reveal another actor's receipt.

Preserve automatic withdrawal when linked public comments change. That trusted
source event needs distinct source provenance and an honest automatic reason;
it cannot require an invented human correction reason or a fresh browser version.
Check concurrent publication/source withdrawal in both lock orders, including
newly created responses and reply-parent privacy. Do not weaken the existing
publication guard or alter old retained record/checksum pairs.

Publication notifications must have their own durable outcome. A repeated edit
request must never rebroadcast simply because it was retried. Do not claim
exactly-once external delivery from a database receipt. Resolve queued, attempted,
failed and uncertain delivery separately using the existing notification/outbox
implementation; a durable response receipt alone cannot settle a process crash
between a provider accepting mail and recording that outcome. Keep v0.56.1's
persistence-before-transport guard.

The UI must preserve unsaved words and the original pending request on a network
failure, offer a real retry, and show a stale-write conflict without overwriting
the newer response. Any edit after a terminal conflict starts a new request only
after the user reviews the current record. Create, correct, publish, withdraw and
remove must all join the same mechanism, including accepted AI drafts.

## Required evidence before landing

Use the named disposable stack openplan-restore-target-2026091050. It already has
321 migrations through 20261014000002; do not reset/reapply it. Recheck ownership
before any live mutation suite. Preserve the 1,005-response baseline fixture.
Validate new SQL in rolled-back transactions until the implementation is ready.

Exercise create/correct/remove, identical and mismatched retries, stale and
concurrent editors, revoked authority, viewer/outsider/anonymous denial, private
history, source withdrawals, publication interruption and unchanged originals.
Every changed guard needs a harmless survivor and an intended failure. Mocked
reads must assert projections. Browser acceptance must begin at navigation in an
identified build at desktop and 390px, include keyboard recovery, inspect console
and open retained artifacts. Follow with full QA, shuffle, isolated RLS, worker
and populated upgrade checks appropriate to the final implementation.

This is unfinished work, not completed M9b or v1. Translation custody, complete
source-to-decision linkage and the remaining roadmap still apply. Preserve all
50 states/DC, explicit territory/tribal/overlapping support, separate AequilibraE
and ActivitySim validation, free local operation and the pending reminder
constraint. No human review gate is required for engineering releases.

## Guard implementation checkpoint

Use database role permissions for the ordinary write boundary instead of a
caller-controlled session flag. Revoke response INSERT/UPDATE/DELETE from PUBLIC,
anon, authenticated and service_role. The RPC's definer authority and the existing
trusted source trigger still work. A revoked, invoker-only helper creates distinct
source-withdrawal receipts, including reply-parent changes, and joins nullable
private history metadata. The session flag only selects a pending matching private
receipt for metadata; it is not the authorization mechanism.

Campaign advisory locking serializes publication against source withdrawal. The
source helper requires READ COMMITTED after a real repeatable-read race showed
that an old snapshot could omit a new response. Keep this explicit compatibility
limit until another implementation has equally strong evidence. Probes and
restoration hashes are in VERIFICATION.md and database-custody.json. These changes
remain outside installable migrations and do not complete the route/UI/outbox join.
