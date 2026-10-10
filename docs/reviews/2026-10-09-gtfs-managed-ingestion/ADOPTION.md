# Managed GTFS adoption checkpoint

The candidate separates completed imports from the decision to use them. Its
service-only adoption command locks the feed and relevant versions, confirms
ready status and the managed completion receipt, then uses the existing atomic
promotion function. The pointer, status mirror and current-version flags move
together. A retained legacy ready version remains an eligible rollback target.

The existing policy remains unchanged. A reduction greater than 20 percent in
routes or stops is withheld; an exact 20 percent reduction is allowed. This is
an existing product safeguard, not a measured threshold for service accuracy.
An explicit review binds the incoming version and counts to the exact current
predecessor and counts. Changing that predecessor makes the review stale.
Unknown review fields and a false acceptance value fail.

A permanent command receipt binds workspace, actor, version and review. Exact
replay returns its historical outcome without applying an earlier decision again,
even after another version becomes current or the individual feed is deleted.
The actor must still have workspace write access when reading the receipt.
Workspace deletion removes the retained record. Runtime clients cannot access
the private table or execute the adoption command directly.

The future authenticated route must derive the actor from its session. It must
present the returned comparison to a person before sending review acceptance.
No route is connected, and no agent action receives a force-adoption parameter.
SQL verifies exact declared review evidence; it cannot establish who saw a screen
or made a decision. Those remain separate integration and browser requirements.

## Native evidence and controls

[adoption-checks.sql](adoption-checks.sql) creates synthetic imports through the
actual admission, archive, claim, preparation, batch, tract and completion
commands. It exercises first adoption, exact and changed retries, both shrinkage
measures, the boundary value, exact and stale review, revoked and viewer actors,
foreign workspace refusal, client-role denial, unfinished import refusal,
missing completion, inconsistent current evidence, legacy rollback, historical
successful and withheld receipts, deleted-feed receipts and cleared write context.
The legacy rollback fixture declares synthetic ready counts directly; this test
does not validate the legacy parser or its historical derived rows.

[adoption-controls.json](adoption-controls.json) retains 83 combined cases.
Baseline, harmless comment and restored source pass. Eighty deliberate mutations
fail at the recorded boundary. The adoption controls include removed permission,
completion, review and current-evidence guards; changed route/stop thresholds;
inclusive boundary error; skipped promotion; leaked context; client execution;
rewriting an already-current version; and destructive receipt replay.

Three early-refusal controls exercise overlapping protection. Removing complete
identity, workspace selection or ready-version checks reaches another guard and
fails the expected error contract. These controls demonstrate the specific
refusal boundary, not that removing one guard alone permits unauthorized adoption.
Other mutations fail their explicit behavior assertions. The completion-receipt
mutation uses an otherwise eligible 20-percent-smaller version, so stale review
cannot mask that missing guard. Earlier exploratory fixture errors remain in the
private run logs; the final record identifies the corrected assertions and source.

All cases use native PostgreSQL in the owned proof database and roll back.
A separate connection confirms candidate-schema absence after every case.
The completion proof now restores its simulated tract function before the
adoption checks. No persistent migration, demo change or production import occurs.

[adoption-advisor-summary.json](adoption-advisor-summary.json) compares the pinned
Supabase advisor against the retained baseline in a separate rollback transaction.
Its 17 new notices are informational unused-index and private-table/no-policy
findings. There is no new security warning, error or missing foreign-key index.
Existing baseline findings remain outside this bounded comparison.

## Remaining boundaries

This is an unfinished checkpoint outside v0.68. It does not prove concurrent
adoption, committed restart recovery, Storage verification, worker orchestration,
route identity binding, human review or a browser journey. Managed commands lock
the feed before versions. The older promotion function starts with the version;
mixed concurrent legacy and managed calls can deadlock and roll back. Repeat
native contention proofs and establish a consistent migration path before
connecting these commands. No automatic deadlock retry is implemented here.

Failure, cancellation, cleanup, queue/read commands, durable worker journals,
actual lease renewal and the three import routes remain unfinished. Upgrade and
restore evidence, desktop and 390px T3 review, and relevant full CI remain required
before describing managed ingestion as usable or merging its migration.
