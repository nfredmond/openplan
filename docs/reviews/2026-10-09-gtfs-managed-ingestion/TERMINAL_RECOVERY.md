# Retained terminal command recovery

The attempt coordinator now recovers a saved completion or failure request
without invoking feed processing again. This closes the reconstruction gap in
[the previous coordinator checkpoint](WORKER_ATTEMPT.md). The managed worker
remains unconnected to import routes and outside the published v0.68.0 release.

Journal inspection checks the attempt and command scope, directory ownership and
permissions, slot name and record schema. It returns a copied request and its
acknowledgement flag, without exposing a receipt as validated evidence. Missing
commands remain absent. Inspection shares the session lock and rejects a slot
with an outstanding delivery.

The coordinator obtains the current claim and snapshot first. A missing claim
cannot be replaced by a cached success. Saved terminal requests must match the
snapshot's workspace, feed and original submitter. The existing completion and
failure constructors validate input before any renewal or delivery. An unresolved
request with confirmed active flags receives a live renewal before replay. An
inactive or closed attempt can replay its original command for the database to
return an existing receipt or refuse the request. Recovery never creates a new
token or reconstructs a different request.

A locally acknowledged command uses the existing receipt verifier without
resending or renewing. The result carries `snapshotBeforeDelivery` separately
from the command receipt. Historical success does not establish current ownership
or replace current database state.

## Verification

The final focused suite passes 133 tests across the journal, dispatcher and
coordinator. New cases cover read-only inspection, absent commands, immutable
returned input, unresolved and acknowledged records, scope mismatch, busy slots,
private directories, symlinks, closed sessions, saved completion/failure input,
unknown reply recovery after closure, current snapshot separation, unavailable
claims and uncertain renewal. SDK transport is controlled; journal files and
process locks are real.

The source controls record 78 runs: nine passing baseline, harmless-comment and
restored cases, and 69 intended assertion failures. Each record identifies its
source and test hashes. The records are separate from earlier checkpoints:

- [Journal: 29 runs](terminal-recovery-journal-controls.json).
- [Dispatcher: 26 runs](terminal-recovery-dispatch-controls.json).
- [Coordinator: 23 runs](terminal-recovery-attempt-controls.json).

The [native journal proof](terminal-recovery-native.json) kills only its own child
after a prepared synthetic dispatch, observes process-lock release, recovers the
same command and attempt in a new process, and then reads the retained receipt
without dispatch in a third process. It does not exercise a live database or the
coordinator's terminal branch, and does not prove power-loss recovery.

Scoped TypeScript with installed Node/Next declarations and ESLint pass. The
first type check found that Node's user-ID function can be absent. The final
privacy check refuses inspection in that case; the corrected journal controls
and native proof pass. Product direction checking passes with existing review
reminders. No review date was changed. The SQL candidate is unchanged, so its
earlier native SQL controls were not repeated for this checkpoint.

## Remaining integration

Next connect actual retained archives, parser artifacts and ordered output rows
to this coordinator, then ordinary adoption and queue polling. Adoption after a
ready-state restart needs distinct parser route/stop counts, not derived row
totals. Native HTTP/database recovery, committed restart and concurrency,
promotion lock ordering, late Storage writes after cancellation, large-feed
budgets, populated upgrade/restore, full branch CI and T3 desktop/390px journeys
remain open. No resumable-import, scientific, human-acceptance or v1 completion
claim follows from this checkpoint.
