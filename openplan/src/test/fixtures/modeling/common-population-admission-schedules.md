# Guided admission barrier schedules

SOURCE ONLY. Native SQL and concurrency proof are UNEXECUTED. This is a root-owned
validation recipe, not an operating grant or a reusable historical trial.

Use one newly admitted disposable database, the exact candidate source hashes,
two actual PostgreSQL connections and a separate observing connection. Apply the
new migration only under root's later grant. Retain the installed trigger OIDs,
function owners, complete definitions, search paths and ACLs before and after.
The original invoker and immutability functions remain unchanged. All new helpers
and the full population trigger must reject direct calls by application roles.

The single-session native cases append `common-population-admission.sql` to the
existing complete population fixture inside a rollback transaction. They cannot
prove these schedules. Two-session trials need their own committed synthetic
setup. Root must commit only fresh fixture rows into its disposable target and
retain every returned ID before either contender starts. Never reuse the current
fixture's transaction-local tables or `pg_temp` functions across connections.
Export actual IDs and the exact generated link INSERT from `cp_link` for each
session. Export the exact snapshot INSERT from `cp_snapshot` and
`cp_generic_snapshot`; those statements include actual parent, entry and actor
IDs. No old run, scientific output or retained production snapshot is rebound.

Bind these symbols to those fresh returned IDs, never arbitrary existing rows:

- `G`, `G0`, `G1`: genuinely generic sets with valid baseline/build entries and
  no models, links or fixed-population claim.
- `H`: guided set with the four complete current outputs, exact supported claim
  `C`, track-matched decisions and both managed/ordinary fixture variants.
- `D`: unlinked draft snapshot in H with C; `R`: its fully linked ready form.
- `Q`: generic ready snapshot in G with metadata `{}`.
- `M`: a current guided model in H; `N`: an unattached generic model whose config
  can be changed or whose scope can move. Record exact OLD/NEW scope and config.

Both contenders begin explicitly at READ COMMITTED with bounded statement and
lock timeouts. Assign distinct `application_name` values and record backend PIDs.
A barrier means the observer confirms the expected row lock wait and blocker PID
using actual activity/lock data. Time spent sleeping is not a barrier. Release
the winner only after the observer records the blocked contender. Unexpected
error, timeout or deadlock stops that trial, retains the raw result and rolls
back both contenders. A later retry requires a new root grant and fresh trial.

For each successful winner, capture the final committed snapshot status, scope,
metadata and complete link identities plus all model scopes/configs. The required
unsafe-state query has zero rows: ready snapshots in a set with guided intent
(including explicit null/future marker or recognized worker intent), or with any
guided links, cannot lack exact full fixed-population custody. Do not equate claim
shape or digest equality with the full current validator. Keep genuine generic
ready records as survivors.

## Parent snapshot and claim races

1. **Claim change first.** A updates D's metadata to `{}` and holds its transaction.
   B submits the exact first guided link INSERT for D. Observe B waiting on the
   scenario-set row. Commit A. B rereads the actual snapshot and must raise 23514,
   `Common population comparison custody is invalid`. Assert zero B link rows.
2. **Link first.** A inserts D's first exact link and holds. B updates D metadata
   to `{}`. Commit A after B is blocked. B must fail the original immutable
   semantics guard; no claim change commits. Preserve its original error.
3. **Move first.** A moves an unbound D to another same-workspace set with the
   matching new entry IDs and no fixed claim, then holds. B's link initially names
   D. After A commits, B must either fail the explicit parent-move check or the
   original scope guard. No link can bind the old set to the moved snapshot.
4. **Ready first and late link.** A completes the fourth exact link and updates D
   to ready, then holds. B submits a late link. After A commits, B must refuse the
   ready parent or the existing unique constraint; it cannot add a fifth link.
5. **Last link first and ready waiter.** A inserts the last missing role while D
   has three committed links. B updates D to ready. After A commits, B must see
   exactly four links and run the complete tail. Repeat with a missing companion
   receipt so the wait cannot make an invalid tail acceptable.
6. **Multi-row links.** Submit the four exact link rows in one INSERT statement
   into D, followed by ready UPDATE. Repeat with one wrong consumer digest. The
   complete wrong statement rolls back all its rows. A harmless label/comment
   control must retain four distinct role pairs, without a lower count contract.

## Empty-predicate and model-mutation races

7. **Ready first, guided INSERT second.** A creates Q in empty G and holds its
   transaction. B INSERTs a guided model in G. After A commits, B must refuse at
   the model-side ready/bound check, leaving Q generic and G without guided models.
   Repeat with a null marker, future marker and recognized worker config missing
   its marker. This covers an empty matching-model query.
8. **Guided INSERT first.** A INSERTs that model and holds before commit. B tries
   a direct generic ready INSERT in G. After A commits, B must classify the newly
   committed model and raise 23514 for missing custody. Repeat with draft-to-ready
   and ready-to-ready scope moves from G0 to G. The scope move supplies G entries.
9. **Generic config introduction.** Start with N attached to G using `{}`. A
   changes its config to current guided intent and holds. B's generic ready
   INSERT must refuse after A commits. Reverse the winner: A inserts Q and B
   changes N to guided; B must refuse. Repeat with null/future markers.
10. **Move introduction.** A moves M from H to empty G, retaining exact matching
    project/workspace identity, and holds. B's generic ready write into G must
    refuse after A commits. Reverse the winner and B's model move must refuse.
    Repeat for OLD and NEW sets when one already has ready or bound evidence.
11. **Removal and DELETE.** With D already carrying one committed guided link,
    try removing every model intent marker, moving M out, or DELETEing M while
    another session admits remaining links/ready state. Model mutation refuses
    because OLD scope is bound, regardless of NEW config/scope. With an unlinked
    unfinished draft and no other ready/bound snapshot, removing all intent may
    commit first; a later no-link generic ready write is then a genuine generic
    survivor, not accepted guided evidence. If ready admission wins, removal
    refuses. Never assert both transactions should commit as guided evidence.
12. **Foreign scope.** Repeat introduction/move with wrong workspace and with a
    different project in the same workspace. Model-side scope validation refuses
    even before any ready snapshot. Preexisting corrupted guided models must be
    discovered by set ID and refused by admission, not hidden by project filters.
13. **Multi-row mutations.** In one statement insert a generic row then a guided
    row into G while Q exists; assert the complete statement leaves neither row.
    Repeat multi-row UPDATE removing all intent in a bound set, UPDATE swapping
    OLD/NEW guided scopes, and DELETE of both guided models. Compare every row to
    its pre-statement bytes. A generic-only INSERT/UPDATE/DELETE statement in G
    remains a survivor. Each row locks all its OLD/NEW guided sets before checks;
    the statement's later row can abort its earlier successful rows.
14. **Cross-set lock order.** Have A move two models through G0/G1 in one order
    while B moves them in reverse order. Per-call UUID ordering does not promise
    a global statement order. Either a complete serial outcome or 40P01/timeout
    refusal is safe. Capture aborted rows and no ready orphan, stop the trial,
    and do not report a deadlock as a passing lock-order test.

## Stronger isolation, custody and archival

15. **Stale model-negative snapshot.** B begins REPEATABLE READ, reads G's empty
    model predicate, and retains that snapshot. A introduces a guided model in G
    and commits. B then attempts generic ready admission. Locking the changed
    scenario-set row must raise 40001. Repeat SERIALIZABLE. A lock-only mutation
    that omits the parent UPDATE can wrongly admit a generic ready row at RR;
    this is why the real parent is also written.
16. **Stale snapshot-negative model writer.** B begins RR and reads no ready
    snapshot in G. A creates Q and commits. B introduces guided intent in G. The
    changed parent row must force 40001, rather than let a stale negative
    snapshot query authorize the mutation. Repeat SERIALIZABLE and OLD/NEW moves.
17. **Current-source mutation.** With valid C, race ready admission against
    managed attempt revocation and ordinary receipt tampering/deletion, using
    the actual current producer functions and protected-row fixture mutations.
    Source run/model, artifact, stage/attempt and companion SHARE locks remain
    in the preserved order. A source writer can conflict with that order and
    cause deadlock; do not retry. Ready writes after committed custody damage,
    even with identical claim bytes/status, must fail the complete validator.
18. **Historical archive survivor.** After successful R admission, make its old
    attempt non-current or damage an ordinary companion receipt in the isolated
    fixture. An inert ready-to-archived UPDATE that changes only status and
    updated_at must survive. A metadata, scope or claim edit bundled with archive
    must retain the original bound-snapshot immutability refusal.

## Mutation controls and restoration

Run a harmless comment/label survivor first under every barrier schedule. Record
that it reached the intended post-barrier state. Only then run one fault at a
time, with the same schedule and final unsafe-state assertion:

- Replace the latest trigger prefix with either historical fast path. Missing,
  null, malformed, unknown-policy guided link/direct-ready cases must fail their
  intended-refusal assertion. Use the actual new function definition, not an old
  migration text that no longer owns the installed function.
- Remove the shared parent lock/write from the relevant admission participant
  and schedule 7–10. Remove the model-side ready/bound refusal separately. At
  least one schedule must expose a committed unsafe state, not just timeout.
- Omit only the parent row UPDATE and run 15–16 to expose the RR negative-snapshot
  counterexample. Removing only FOR UPDATE while keeping UPDATE may survive
  because UPDATE itself serializes. Report that survivor honestly.
- Omit OLD scope from the model guard and run 10–11 and 13. Omit NEW scope and
  run 7–10 and 13. Omit snapshot OLD scope and require ready scope-move refusal
  to fail when moving out of a guided set with the unchanged absent claim.
- For each source tail category, bypass one exact predicate in the latest body:
  payload/digest, producer/model scope, source descriptor, Setup active unrevoked
  managed attempt, source origin/scientific limit, exact ordinary request, exact
  ordinary response, restored lineage, each of seven unique retained source
  artifacts, consumer population, and four distinct role count. Use the existing
  corresponding native fault, not a looser count or substitute output. A source
  equality check alone proves bytes, not reachable runtime enforcement.
- Restore exact source and installed definition bytes after every fault. Retain
  failed trials and native catalog readbacks. Confirm restored OIDs/owners/ACLs,
  search paths and hashes. Do not use destructive checkout/reset. No mutation
  anchor error, absent input, prior failure or permanently failing harness counts
  as the intended kill.

These schedules do not prove model accuracy, raw manifest bytes, worker execution,
remote data authenticity, hosted installation, recovery, nationwide coverage or
planner acceptance. They also do not add persistent mutation guards to scenario
set/entry semantics after publication. Entry SHARE locks protect admission-time
assumption reads. Broader historical plan-edit policy remains separate from this
model-intent admission correction. No schedule has run in this source task.
