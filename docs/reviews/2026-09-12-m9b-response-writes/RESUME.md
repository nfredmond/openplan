# Resume response-write work

The v1 goal remains active. v0.56.1 is published; all final CI/RLS jobs passed
before tagging exact source 3f70af98e6fb06b4c0f932769e10f880711d46ec. Do not repeat
that release. Root checkout and demo are separate older copies; leave them alone.

Active owned worktree:
/home/nathaniel/.local/state/openplan/engagement-response-writes-2026-09-12
Branch work/engagement-response-writes, app package openplan/. node_modules is a
local dependency symlink; build output is separate. No subagent was spawned.
No browser, dev server or local test process from these increments remains live.

Read IMPLEMENTATION.md and VERIFICATION.md here. The transaction and guards are
unapplied prototype companions, outside the migration directory. The ordinary
app/service role write permissions now enforce RPC use in the prototype; trusted
source review uses a private helper and records its actual source provenance.
History has nullable additive reason/request/origin metadata. The current SQL
also refuses clearing already-recorded AI assistance after creation. Direct and parent
source changes withdraw published responses. The source helper refuses stale fixed
snapshots by requiring READ COMMITTED. Existing history/checksums remain intact.

Current evidence: rolled-back baseline, one harmless survivor and fifteen targeted
failures; five actual separate-connection scenarios; one harmless concurrency
survivor and two semantic failures when the lock/isolation guards are removed.
Initial failed probes are retained. No browser acceptance or app route integration
exists yet. Read the precise limits, including public reader defense in depth.

The next join is the actual app: create/PATCH/DELETE must call writeResponse from
openplan/src/lib/engagement/response-write.ts, and CloseLoopBuilder must supply and
retain requestId, expectedUpdatedAt and reason. Those routes still do direct writes;
do not apply the permission guard before replacing them. Keep unsaved words and the
same pending request after an unknown network result. A conflict must display the
current saved copy without discarding the draft before starting a fresh reviewed
intent. Preserve accepted AI source IDs and authorship. Add reason display to
ResponseHistory; the reader/types now retain metadata, but its UI is unchanged.

The new response-broadcast-queue.sql is unapplied. Publication queues a private
intent atomically; the queue prepares every outbox recipient, then claims/checks
messages and records separate outcomes. The new local worker and journal are in
openplan/scripts/workers/engagement-email.ts and src/lib/notifications/. Its npm
script is worker:engagement-email. Do not enable it on the source stack yet.
Use NEXT_PUBLIC_APP_URL without trailing slash and a private per-test journal root.
The worker adds a database-address hash below that root for installation isolation.

SQL broadcast probes: >1000 recipients, rollback after persistence failure,
content/opt-out/current-publication/subscription checks, attempts, uncertainty and
private access; baseline plus harmless control and fourteen intended failures.
TypeScript probes: 65 tests, harmless control and twenty-five failures. An actual
worker process restarted against a local HTTP contract fixture and replayed only
its saved acknowledgement, with separate installation isolation and two intended
mutation failures. No real provider calls occurred. These HTTP fixtures are not
live PostgREST or browser acceptance. The earlier source DB prototype tests and
separate-connection tests remain separately bounded evidence.

Complete remaining role/tenant/revocation probes, simultaneous queue claims,
isolation and unsubscribe races, no-share/empty cases, and live REST-to-worker
recovery. Join the broadcast read RPC and Activity panel to uncertain/attempting
states; the legacy outbox projection alone cannot express them. Skipped/uncertain
outcomes are not automatically resent, and their retry/resolve UI is not built.
Then promote a coherent additive migration and run the required real navigation,
desktop/390px keyboard, console, QA/shuffle/RLS/worker/upgrade/final-CI evidence.
Current package is still v0.56.1; the next user-visible increment generally needs
a minor bump. The release-ordering ledger may need the now-published v0.56.1 tag
recorded with its unchanged 321-migration count when preparing that release.

For separate connections, the additional database response_write_probe_20260913
inside the same disposable container contains the b878d35d transaction/withdrawal
prototype only, not the newer reader extension, AI-provenance clearing guard or broadcast queue. It was
cloned with original ownership/ACLs, is not an app/PostgREST target, and contains
synthetic failed-mutation outcomes. Do not point a browser or app at its data.
prove-concurrency.py and mutate-concurrency.py explicitly select that database;
prove-transaction.py still uses rolled-back probes on the source postgres database.
Both prototype function bodies in the clone were restored and hash-checked after
mutations. No test process remained live at the checkpoint. The private clone dump
and restore log are in /home/nathaniel/.local/state/openplan/response-write-probe-20260913.

The named disposable stack openplan-restore-target-2026091050 has 321 migrations
through 20261014000002, API 29821 / DB 29822. No prototype was committed to it.
Do not reset or reapply the existing migrations. Preserve the 1,005-response
fixture a3c41566-bfd4-40f2-b467-96ee79054ec6. Never print private credentials from
/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12.

Continue the full contract and roadmap after this increment. No human review
release gate; direct main after verification, no PRs, final CI before tagging.
Keep free/local operation, the pending reminder constraint, all-state/DC and
territory/tribal/overlapping scope, and independent AequilibraE/ActivitySim evidence.
