# Managed GTFS ingestion implementation checkpoint

This unfinished M3 implementation stays outside v0.68 and has no connected
route or worker. Migration 28 is a candidate in this isolated worktree. Do not
apply it to the demo or enable admission before the complete lifecycle is wired.
The roadmap remains the queue, and the existing worker design remains the scope.

The candidate retains submission identity, original actor and exact source
metadata, one version per request, permanent claim receipts, expiring ownership,
archive preparation/confirmation and guarded stage transitions. It protects
managed versions, derived rows and feed pointers from legacy direct writes,
including service-role writes, unowned failure and age-only reaping. Runtime
roles cannot truncate these tables or access private journals. Source fields
must have the declared JSON types, and archive byte counts must be positive
integers representable exactly by the Node caller. These checks do not establish
that a declared URL is safe or that Storage holds the claimed bytes.

The [native controls](admission-controls.json) record 25 cases. Baseline,
harmless-comment and restored runs pass; 22 targeted changes fail at the stated
assertion. Actual anon/authenticated calls are refused, service-only commands
work, viewer and foreign-feed admission fail, exact retries recover identity,
and changed requests or stale/revoked owners cannot mutate managed work.
Unstored uploads cannot be claimed. Parsing requires confirmed archive metadata;
prepared URL archives cannot be replaced or refetched. Feed deletion preserves
admission identity and workspace deletion removes its custody records.

Each case executes the candidate and synthetic fixtures in one transaction on
the existing isolated proof database, then rolls back. A separate connection
confirms the private schema is absent after every case. No migration history,
production data or demo database changes. The source and assertion hashes match
the retained result. Expiry is simulated by controlled SQL, not a killed worker.
Native concurrency and committed recovery were exercised only in the earlier
prototypes; this production-shaped candidate has not yet repeated those proofs.

The remaining implementation includes derived preparation and batch receipts,
atomic completion, the existing material-shrinkage adoption rules, terminal
failure/cancellation, queue/read commands, durable private worker journals,
archive reconciliation, actual lease renewal, tract aggregation and all three
import doors. The earlier parser PR also needs its environment correction joined
before this work can use it. Test advisors, representative upgrade and full
restore, separate-process recovery, live role/lock contention and desktop/390px
T3 journeys remain required. No resumable-ingestion or planner acceptance claim
is made by these SQL checks.

Reproduce from this owned checkout without applying the migration:

```bash
python3 docs/reviews/2026-10-09-gtfs-managed-ingestion/verify_admission.py /private/isolated-proof-config.json /private/new-proof-directory
```

## Guarded derived preparation and batches

The candidate now adds service-only preparation and route/stop batch commands.
Preparation requires current ownership, confirmed archive custody and parsing
stage. It deletes prior route, stop and tract rows once per attempt, records
removed counts, and returns that saved receipt on retry. Replacement claims clear
the prepared marker. An old worker cannot reset the replacement's rows.

Each batch requires an active prepared attempt, exact workspace/version scope,
recognized fields, a bounded row count and the next ordinal for that row kind.
The command hash binds the version, token, kind, ordinal and payload. Exact replay
returns the original receipt; changed payloads fail. The receipt and actual rows
commit together. The existing private write context permits only that transaction's
inserts, and preparation/batch history survives replacement attempts.

The [combined native record](batch-controls.json) covers 37 cases: baseline,
harmless and restored passes, and 34 targeted failures. The new checks exercise
actual route and stop writes, lost-reply-style same-transaction replay, scope and
field refusals, ordinal gaps and reuse, preparation replay, replacement cleanup
of all three derived tables, preserved history, client-role denial and parent
cascade. The initial baseline exposed an ambiguous PL/pgSQL table alias; renaming
the batch query alias resolves it. No assertion was removed to make that pass.

These tests still roll back, and each separate cleanup connection confirms the
candidate schema is absent. They do not establish committed response recovery,
concurrent replacement, worker journals, final completion or adoption. Before
completion is connected, bind the expected parsed artifact and row/batch counts
before writes so a matching receipt list alone cannot bless a truncated batch
set. Preserve tract-computation failure versus a successful zero-row result.
The current preparation command does not yet retain that output plan. The earlier
25-case admission record remains historical; the 37-case record identifies the
current candidate and combined assertions.

## Expected output identity and checkpoint scope

Preparation now retains the planned parsed-output hash and byte size, expected
route and stop row counts, and expected batch counts. Values are typed, bounded
positive integers; batch counts must be capable of holding their stated rows.
An exact retry returns the original receipt. Changing the plan under that same
attempt fails. New writes cannot exceed the declared row or batch totals.
Completion still needs to require equality with these totals, actual stored rows
and the retained batch manifest before publishing ready. This is an upper bound
and identity checkpoint, not proof that the whole import has completed.

The [current native controls](planned-batch-controls.json) identify the final
candidate hash. All 45 outcomes match expectation: three passing controls and
42 deliberately broken variants detected. The earlier preparation-guard mutant
became protected by the new missing-plan check. Its corrected variant bypasses
both barriers and supplies a forged default plan; the unprepared-write assertion
then fails for the intended reason. Preparation replay is checked before the
changed-plan case, so the destructive-retry mutation still fails its original
receipt assertion. No behavior assertion was removed.

The [advisor comparison](advisor-summary.json) runs the pinned official
[Supabase Splinter SQL](https://github.com/supabase/splinter/blob/fccca4b1c4d8b48b8ccd69bd6b30e84adcb92975/splinter.sql)
before and after installing the candidate within a rollback transaction. The
API schema setting matches this checkout's `public,graphql_public` configuration.
Two new missing foreign-key indexes are corrected. The final comparison has no
new security warning/error or missing foreign-key index. Ten informational
notices remain: unused new indexes and deliberately policy-free private tables
that deny runtime roles direct access. The proof database already has 1,675
advisor findings, including retained experiments; this comparison does not clear
or classify that historical database inventory. Source and output hashes remain
in the report; raw advisor output stays private.

The parser's explicit production-environment fix is joined from `3b0079847`.
This branch remains an unfinished implementation checkpoint, not a release or
merge-ready PR. No route uses the new commands and no persistent database schema
is changed by these tests. Lifecycle completion, tract computation, adoption,
failure/cancellation, worker/journal/Storage connection, native concurrent and
committed recovery, upgrade/restore and rendered journeys remain required.

## Atomic completion checkpoint

The later [completion record](COMPLETION.md) supersedes the open completion and
tract-command items above. Its 67 native control outcomes identify the current
candidate. Adoption, terminal failure/cancellation, worker connection and the
stated independent recovery/acceptance checks remain open. The earlier records
retain the source hashes and limits that applied at their own checkpoint.

## Exact adoption review and retained decisions

[The adoption checkpoint](ADOPTION.md) adds the existing material-shrinkage policy,
exact predecessor review and historical decision receipts. Current membership is
required on every call, including replay. Completed managed imports and retained
legacy ready versions can become current through the existing atomic promotion
function. No route or worker is enrolled. The 83-case combined native record and
advisor comparison identify this checkpoint; earlier records remain historical.
Failure/cancellation/cleanup, queue/read commands, committed concurrency/recovery,
worker integration, upgrade/restore and actual browser review remain unfinished.

## Worker failure and member cancellation

[The termination checkpoint](TERMINATION.md) adds owned worker failure and current
member cancellation, exact terminal receipts, atomic partial-row removal and
prepared-object cleanup scheduling. The current feed is preserved. One hundred
combined native controls and the advisor comparison identify this candidate.
The worker still must settle or reconcile in-flight Storage writes before cleanup
can be considered complete. No route or worker is connected. Queue/read commands,
worker journals, lease renewal, committed recovery/contention, upgrade/restore and
T3 browser evidence remain required before enrollment or merge.

## Worker queue and scoped reads

[The read checkpoint](READS.md) adds a bounded candidate queue, retained-claim
attempt reads and member status reads without worker tokens or private source
arguments. The 120-case combined native record and advisor comparison identify
this candidate. Queue results do not grant ownership, and reads do not renew
leases. Worker response validation, durable journals, actual polling/renewal,
Storage reconciliation, route integration and committed recovery/contention still
remain. No managed import route is enabled.

## Typed worker service and bounded acknowledgements

[The worker service checkpoint](WORKER_SERVICE.md) adds typed queue, claim, read,
renewal and member-status calls. It validates cross-field identity and custody,
bounds acknowledgements independently of transport compliance, and preserves
unknown outcomes for later reconciliation. Sixty-four focused tests, 36 source
controls, three actual PostgreSQL response snapshots, scoped TypeScript and ESLint
pass. Durable journals, mutation calls and worker/route enrollment remain open.

## Typed worker mutations

[The mutation checkpoint](WORKER_MUTATIONS.md) adds scoped calls for archive,
derived batches, tract computation, completion, failure and ordinary adoption.
The private attempt snapshot carries the original submitter identity. One hundred
SDK tests, 51 worker source controls, 121 native SQL controls, three native read
snapshots, the advisor comparison, scoped TypeScript and ESLint pass. Earlier
records retain their original source identities. Durable journals and actual
worker/route enrollment remain unfinished, including live HTTP, restart,
concurrency, Storage cancellation and operation-budget evidence.

## Private attempt and command journal

[The journal checkpoint](WORKER_JOURNAL.md) retains attempt and command identities
before delivery, refuses changed scope or payload, and revalidates retained
receipts without resending. Forty tests and 27 source controls pass. A
native child-process termination check recovers the same identities in a new
process and then reads the retained receipt without dispatch. This uses synthetic
delivery and does not establish database or power-loss recovery. The next step
connects the typed operation dispatcher and live attempt ownership; no import
route is enrolled.
