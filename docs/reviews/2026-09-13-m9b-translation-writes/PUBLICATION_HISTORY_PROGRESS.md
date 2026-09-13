# Publication history integration, September 13, 2026

This continues pushed a122969a in the owned translation worktree. Private history
now accepts publish_generated receipts and verifies them against retained
generation output. Pending request recovery, API publication and editor/producer
integration remain unfinished. The workflow is not released or activated.

## Changed behavior

The history reader verifies stored payload/result checksums and original receipt
scope before loading generation evidence with the caller's authenticated RPC.
It uses the existing packet/delivery decoder and publication receipt checker.
No provider call, service client, key lookup or new model selection is involved.
Repeated references reuse one verified generation read within the history load.
A receipt loads at most eight distinct generation requests concurrently.

Publication results must match the immutable viewed words, model, generation
actor, publishing actor, source and saved version. Every result in a publication
receipt must also have its own linked history revision. Ordinary saves may be
content-identical without a new revision; publication decisions always retain a
revision, so the existing allowance for manual no-op fields cannot hide an
incomplete publication batch.

The returned history change includes its generation reference, original actor
and output hash. Those fields are required for publication and refused for an
unrelated manual change. Existing save/accept/withdraw receipt validation still
uses its original pending-baseline checks. Shared publication reference schemas
now live in translation-publication-reference.ts, avoiding an import cycle
between publication and history. No visual component was changed permanently.

## Evidence and corrections

New native tests cover complete batches, repeated generation references, lost
access, missing history rows, receipt/generation corruption, source checksums,
original receipts and the shared evidence schema. A nine-request/eighteen-field
case proves that batching keeps all requests while bounding simultaneous reads.
This is a concurrency mechanism check, not a large-history performance benchmark.
The complete history can require multiple batches; slow or failed evidence reads
return unavailable without exposing a partial verified result.

The existing history/receipt controls are rerun against both manual and
publication branches. Their duplicated scope/original-result expressions are
now mutated together; the historical test assertions remain unchanged. Native
publication controls were adapted to the shared reference schema and rerun.
Their reports retain source/test hashes and timestamped private logs.

The actual SQL/native probe now reads publication history and retained generation
rows as the authenticated publishing owner, then passes those exact SQL values
through the application history reader. It continues publication through a second
identical-word generation decision, acceptance and withdrawal. Retrying the
original publication returns the old receipt without recreating current wording.
The source words and both publication actors remain recoverable in history.

The disposable proof database retained an older history-reader definition without
receipt data. The first native join therefore refused its incomplete snapshot.
The probe now applies migrations 12, 14 and 16 inside BEGIN/ROLLBACK and compares
both original function definitions plus command ACL after rollback. Migration 12
was already installed in the app stack. The probe does not silently upgrade the
old proof database. A first mixed-lifecycle fixture also had an ambiguous JSONB
operator expression; explicit parentheses fixed it before the baseline rerun.
Both failed attempts remain in private logs, not as passing evidence.

The SQL target remains openplan_translation_command_proof_20260913 inside
supabase_db_openplan-restore-target-2731143. Original output is a previously
retained completed fixture. Crafted private clones isolate SQL guards and a
second generation with identical words; they do not claim new worker/provider
execution. All temporary membership/key changes and receipts roll back.
The application database remains through migration 12 with write execution
revoked. Original checkout, demo and pending reminder constraint are untouched.

## Continue

Integrate publication into PendingTranslation and the commands route while
preserving observed output and old baselines through storage loss and exact
retries. The commands route needs the generation route's origin boundary and
an executable refusal for unregistered agent writes before activation. Connect
CampaignTranslationsPanel to the durable queue/catalog and retained output, show
its provenance in history/recovery, and replace the old staff machine producers.
Do not convert an uncertain retry into a new generation request or relabel
machine words as agency-approved wording.

Then activate the protected command after the producer join, exercise desktop
and 390px real navigation, keyboard, console, interrupted retries and artifact
custody in an identified build, and complete QA/shuffle/isolated RLS/worker and
upgrade/restore checks. Inspect CI on the final main release commit before
its tag. No PRs or human-review release gate. The full V1 destination remains
active; no pending integration or independent modeling obligation is closed here.

## Final checkpoint results

Nine focused suites passed 226 tests. TypeScript and focused ESLint passed. The
new history controls completed 14 cases: four baseline/harmless survivors and ten
targeted failures. Existing history controls completed 28, publication receipt
controls 38, and SQL publication controls 31, all with expected outcomes. These
are focused checks, not the complete QA/shuffle/live-RLS release campaign.

retained-publication-restored.json records the final native history sequence
[1, 2, 3, 4], including publication, identical-word publication, acceptance and
withdrawal. One history read and two cached generation reads verified the sequence.
The original publication receipt remained available after withdrawal without
recreating the translation. Function definitions, ACL and fixtures rolled back.

Private logs remain under
/home/nathaniel/.local/state/openplan/response-write-probe-20260913:
- publication-history-combined-final.log
- publication-history-types-final.log
- publication-history-lint-final.log
- publication-history-controls-final.log
- history-receipt-controls-publication.log
- publication-receipt-controls-history.log
- retained-publication-controls-mixed-history-final.log

All checks are terminal, and mutation sources were restored before the final
combined run. Main was rechecked at ef16f166447ab477ea36588a5c01620f61560b19; this
checkpoint does not change the released v0.58.1 claim or activate the workflow.
