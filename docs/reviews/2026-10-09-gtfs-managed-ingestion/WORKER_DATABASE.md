# Committed worker recovery through native database commands

The composed managed worker now has native PostgreSQL recovery evidence for a
lost final reply and a lost batch reply. The application implementation and
candidate migration are unchanged in this checkpoint. No import route or queue
service is enrolled.

[The retained record](worker-database-native.json) identifies the migration,
application sources and both proof runners by SHA-256. The runner creates a fresh
owned clone, installs the candidate there, and starts separate loopback PostgREST
and Storage containers. SDK calls reach actual lifecycle functions as
`service_role`. The worker downloads the retained public BART ZIP, invokes the
production parser child and publishes its derived rows through the journal.

## Completion reply lost after commit

PostgreSQL commits a ready version with 95 route-service rows, 717 stop-service
rows and nine batch receipts. The metadata retains the parser's 14 routes and
287 stops. The feed remains unadopted. The native tract function returns a
successful zero-row result in this fixture; this is not evidence of geographic
coverage or real-world service accuracy.

The proof intercepts the successful HTTP response before the SDK receives it.
The parent then kills only its owned worker process group. A separate SQL
connection confirms the completion receipt and stored rows, while the local
terminal command remains unresolved with no receipt.

A fresh worker process replays that exact terminal command. It does not invoke
processing, download the archive, parse it or publish batches. A third process
uses the checked local receipt without sending completion again. Independent SQL
observations confirm unchanged rows, row fingerprints, receipts and feed pointer
through both recoveries.

Six HTTP requests fail without changing the database:

- Anonymous and ordinary member completion calls receive `42501`.
- Changing the original completion payload receives `22023`.
- A new completion command after closure receives `55000`.
- An additional batch after closure receives `55000`.
- A direct service-role derived-row insert receives `55000`.

These are specific native authorization and closure checks, not a replacement for
the complete live RLS suite or a proof of every privileged route.

## Batch reply lost after commit

A second fixture kills the worker after PostgreSQL commits its first route batch,
before the SDK receives the receipt. Independent SQL observes 95 route rows, no
stop rows, one batch receipt and a still-running execution. The saved batch
command has no local receipt.

The next process reuses the same verified parser artifact and claim. It replays
the original batch, then writes the remaining stop batches and completes. It
makes no Storage download and does not clear the output plan again. The original
route-row fingerprint remains unchanged. The final result again contains 95
route rows, 717 stop rows and nine receipts. A subsequent process reads the
retained terminal receipt without further publication.

This covers recovery while the original lease remains valid. It does not prove
replacement after lease expiry or concurrent old/new owners.

## Verification strength and operating limits

Independent SQL observations pass before and after recovery. Nine additional
observation controls run inside rollback transactions. A harmless timestamp
change passes. Eight actual database corruptions fail the intended assertions:
public status, execution state, silent adoption, missing route, missing stop,
changed parser count, missing completion receipt and missing batch receipt.
The restored database passes and equals the pre-control snapshot. Replication
trigger bypass is limited to these deliberate rollback controls in the newly
created proof clone; it is not part of worker execution.

Scoped TypeScript compilation and Python compilation pass. ESLint checks the
actual TypeScript runner through stdin using an application test filename,
because the application config does not cover sibling review directories by
default. The first direct lint invocation was ignored and is not evidence.
Diff checks pass. The earlier 426-test application checkpoint remains unchanged;
these native proofs add evidence rather than replace that suite.

The final run completes in 16.9 seconds. Its systemd service peaks at 151.4 MB
under a 1.5 GiB cap with swap disabled. The separate Storage and PostgREST
containers have 512 MB and 128 MB caps. The service peak is not the combined
container or database peak, and this small feed does not establish largest-feed
capacity. Fixture Storage objects and owned HTTP containers are removed after
the run. The private clone and worker journals remain available for follow-up.

The source clone records 393 migrations through `20261016000021`, with earlier
GTFS DDL applied outside that ledger. The record lists all seven checkout files
without ledger entries, including the candidate. This is not a clean-install,
current-main upgrade or restore proof. The source clone still has no candidate
`openplan_gtfs` schema after this run. No demo database is a test target.

Reproduce from this checkout with a fresh private output directory:

```bash
OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER=supabase_db_openplan-restore-target-2026091050 \
python3 docs/reviews/2026-10-09-gtfs-managed-ingestion/verify_worker_database.py \
  /private/isolated-proof-config.json /private/public-bart.zip /private/new-proof-directory
```

The initial invocation omitted the required named-container opt-in and stopped
before cloning. Corrected runs complete. Do not substitute a shared database or
remove the helper's isolation checks.

## Remaining work

Native concurrent replacement, lease expiry and mixed legacy/managed promotion
lock ordering remain open. So do URL/catalog intake, uncertain and late Storage
writes, orphan cleanup, adoption/recovery, polling, operational budgets,
current-main populated upgrade/restore, full branch CI and identified T3 desktop
and 390px journeys. This checkpoint does not declare a main merge or managed
import release. The full v1 scope and scientific and human acceptance remain.
