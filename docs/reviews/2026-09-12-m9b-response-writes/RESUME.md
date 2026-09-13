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
History has nullable additive reason/request/origin metadata. Direct and parent
source changes withdraw published responses. The source helper refuses stale fixed
snapshots by requiring READ COMMITTED. Existing history/checksums remain intact.

Current evidence: rolled-back baseline, one harmless survivor and thirteen targeted
failures; five actual separate-connection scenarios; one harmless concurrency
survivor and two semantic failures when the lock/isolation guards are removed.
Initial failed probes are retained. No browser acceptance or app route integration
exists yet. Read the precise limits, including public reader defense in depth.

Next complete actor/role/tenant/revoked-access probes, extend the complete history
reader and TypeScript metadata without altering old record/checksum pairs, and
settle durable publication/outbox outcomes. Then join create/PATCH/DELETE and the
browser's preserved pending edits to the transaction. Preserve accepted AI drafts,
exact authorship and executable refusal for unsupported agent writes. Promote to
an additive migration only when the routes and concurrency/recovery checks are
coherent; applying the current permission guard alone would strand old routes.

For separate connections, the additional database response_write_probe_20260913
inside the same disposable container contains the committed prototype. It was
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
