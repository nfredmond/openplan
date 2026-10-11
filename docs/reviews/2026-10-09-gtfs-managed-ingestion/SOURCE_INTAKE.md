# Exact source intake and immutable upload reconciliation

October 10 development checkpoint in the owned managed-ingestion worktree.
This continues roadmap M3. It does not enable an application import route,
release migration 28, adopt a feed or establish full worker operation.

`managed-worker-intake.ts` connects the existing public-feed downloader to the
owned attempt. It saves a private, synced archive before database preparation
and external upload. Its journal binds installation, target, workspace, feed,
version, submission, original actor and complete source metadata. The source
binding excludes the attempt token so a replacement can recover the original
bytes. Command journals and parser artifacts keep their attempt bindings.

A complete exclusively linked file survives interruption before its hash
receipt. Recovery hashes its actual contents and retains that receipt before
preparation. Missing acknowledged files, altered bytes, unbound files, public
files, symlinks and changed source bindings are refused. An already prepared
archive can be recovered from verified Storage into a new private directory.
An unavailable prepared archive cannot authorize fetching a changed URL.

Upload uses the deterministic private key with `upsert:false`. A dedicated SDK
client carries ownership and deadline cancellation into its actual fetch
transport because the installed upload helper does not forward file-option
signals. A separately bounded acknowledgement handles an uncooperative
transport. Neither an upload path nor an error settles custody. The worker
downloads the actual object and checks exact size and SHA-256 before journaled
confirmation, then reads and validates fresh attempt scope before parsing and
guarded publication. Recurring retired-key reconciliation remains required for
late writes and uncertain cancellation.

## Evidence and limits

[Thirty source controls](intake-controls.json) include baseline, harmless-comment
and restored passes plus 27 intended assertion failures. They cover binding,
private descriptors, byte bounds, source sync, saved hash, missing-file recovery,
mutable refetch, prepared custody, fetch cancellation/refusal, transport signals,
immutable writes, actual remote verification, acknowledgement deadlines, fresh
scope and the parser join. The runner restores tracked source in `finally`.
A real loopback HTTP test observes a pending upload response close after
ownership cancellation. Its missing-signal variant fails that observation.

An early inherited-signal control survived because the SDK swallowed an assertion
inside the mocked transport. The revised test records the observation and asserts
after the SDK call. The final control fails as intended. Removing just one active
predicate also survived because the final complete-snapshot comparison still
refused the changed active flag. The final broken variant bypasses the fresh
scope predicate and fails the inactive-snapshot assertion. Neither interrupted
control run is counted as a completed proof.

[Native recovery](intake-native.json) uses actual local HTTP, PostgreSQL,
PostgREST, Storage and the production BART parser. Four owned process groups stop
after local-byte persistence, database preparation commit, immutable upload
commit and database confirmation commit. Each new process receives a changed
publisher response but makes zero publisher requests. Preparation and local-file
recovery upload once; recovery after upload/confirmation commits uploads zero
times. Each publishes 95 route rows and 717 stop rows, nine batch receipts and
one completion receipt. Terminal replay changes no observed records. Human
adoption remains unperformed. Each native observation check accepts a harmless
copy and refuses seven changed facts.

The initial native run completes the local-file case, then fails because its
second new-feed fixture repeats the unique source URL. Distinct fixture URLs
correct the runner. That run also leaves container-owned temporary object files
after cleanup fails. Those files are made readable for inspection; its proof
database remains retained. The final run explicitly removes its own synthetic
Storage objects before helper teardown and completes without residual containers.

[Regression results](intake-tests.json) record 49 files and 1,207 tests: 1,190
pass, 17 live-database cases remain skipped and none fail. The bounded service
takes 60.7 seconds and peaks at 379.8 MiB. Scoped TypeScript and changed-file lint
are separate checks. The final controls take 72.3 seconds and peak at 198.7 MiB;
native recovery takes 22.9 seconds and peaks at 161.1 MiB, with separate container
bounds.

These checks do not establish public DNS/TLS, power-loss durability, largest-feed
capacity, every concurrent schedule, full archive restore, browser or practitioner
acceptance, full branch CI or release readiness. Controlled SDK tests cannot
establish Storage/RLS operation. Native source transport deliberately maps a
validated public-looking URL and controlled DNS answer to its owned loopback
publisher. Native database state derives from the retained reconciliation clone,
with 399 recorded migrations and candidate DDL applied separately. It is not a
new current-main installation or official-CLI migration proof.

The next work connects bounded polling/CLI, retained and replacement attempts,
then URL/catalog/ZIP enrollment and planner progress/retry/adoption. Route
integration still requires its relevant live role, recovery, upgrade/restore,
capacity and identified T3 desktop/390px journeys before merge or release.

Reproduce with private new output directories and no concurrent source mutation:

```bash
python3 docs/reviews/2026-10-09-gtfs-managed-ingestion/verify_intake_controls.py /private/new-controls
OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER=supabase_db_openplan-restore-target-2026091050 \
python3 docs/reviews/2026-10-09-gtfs-managed-ingestion/verify_intake_native.py \
  /private/reconciliation-database.json /private/bart.zip /private/new-native-proof
```
