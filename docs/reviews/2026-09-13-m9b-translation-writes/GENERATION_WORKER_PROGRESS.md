# Translation worker integration, September 13, 2026

This continues baef6b9e in the owned translation checkout. It implements the staff
queue worker, selected-key verification and local CLI, with real process restart
and PostgREST/PostgreSQL evidence. The complete translation workflow, M9b and V1
remain unfinished. Continue verified increments directly to main without PRs or
human-review release gates; keep all work local/free and preserve the full V1
contract, original checkout, demo and pending reminder constraint.

## Implemented behavior

`translation-generation-worker.ts` uses the existing OS lock and fsynced private
journal. It checks scoped request/packet/credential identities before claim,
journals running before authorizing dispatch, watches status during generation,
saves exact output before delivery, and checks the acknowledgement before marking
the journal delivered. It does not put credentials or the whole batch intent in
the journal. A pending running attempt becomes interrupted without invoking the
model; a pending completed attempt redelivers exact encoded bytes without loading
credentials or reclaiming work. Late delivery keeps the database's terminal state.
Orphaned expired claims are reconciled by minimal database status.

The strict workspace key reader now supplies both the encrypted request envelope
and selected ciphertext digest from one read. Worker verification compares the
captured envelope with the current selected key before claim and before dispatch,
including environment-key changes. Read/decryption failures cannot change payer.
The original preparation helper remains as a wrapper for existing callers.

Run `npm run worker:translation-generation`, or append `-- --once`, from the
application package once its migration and intended queue are installed. The
runbook documents the private directory and recovery behavior. This checkpoint
does not start an app worker or switch existing translation producers to it.

## Verification and corrected instrumentation

The first cancellation test was weak: the cleanup abort after a timeout set its
success flag. A mutation removing cancellation detection survived. The repaired
test records whether the provider was still pending when the abort occurred;
removing cancellation detection, ignoring failed status reads and ignoring a
changed lease now each fail their named assertions. This was a test defect found
and reported during implementation, not evidence that the original test proved
cancellation.

Overlapping validation guards were checked explicitly. Removing the claimed-field
identity comparison alone survives because the packet check still rejects the
wrong field. Removing both fails before the test can accept dispatch. A malformed
packet fixture initially changed the error class without admitting a dispatch;
the corrected control uses a valid but changed packet to test the intended
boundary. Redundant guards are recorded as survivors rather than fake kills.

- `translation-worker-controls.json`: 66 worker/credential tests, 35 control cases,
  six intended survivors and 29 targeted failures, all expected.
- `translation-generation-controls.json`: 81 SDK/credential/legacy tests and 50
  control cases, all expected, rerun against the refactored credential reader.
- `translation-worker-live-results.json`: actual worker processes with real
  Supabase query builders, local PostgREST and PostgreSQL. Cases cover normal
  completion, lost dispatch acknowledgement, lost committed-output acknowledgement,
  SIGKILL of this runner's child during provider response, and SIGKILL after a
  completed journal but before delivery. Resume uses a new process and the same
  journal. Each case retains one dispatch reservation event, and only zero or one
  intercepted provider request. There is no second model invocation on recovery.
- The completed-crash case changes the campaign source before resumption. Output
  is retained with interrupted state. Native output JSON, safe receipt and opaque
  provider metadata match database bytes, including NUL and lone-surrogate metadata.
- `translation-worker-live-controls.json`: live baseline and harmless comment
  survive; discarding recovered output fails `Worker recovery must succeed`.
  The baseline evidence is restored to the final unmutated source hash.

TypeScript and focused lint passed. The final five focused suites passed 156 tests. Results are recorded in
`translation-worker-tests-final.log` under the private evidence directory. The
first TypeScript invocation accidentally ran from the repository root, returned
help/exit 1 and was not treated as verification; it was rerun in openplan/.

## Isolation and durable evidence

A new database, `openplan_translation_worker_proof_20260913`, was created in
`supabase_db_openplan-restore-target-2731143`. It is a schema-only copy of the older
translation command proof database, restored as its schema owner in one
transaction. No old proof jobs or application data were copied. Only synthetic
worker fixtures were added. `translation-worker-proof-database.json` records its
schema hash. No database was dropped or reset.

The runner owns `openplan_translation_worker_rest_20260913` on loopback 38962 and
stops it in finally. Its service credentials are in mode-600 private files, never
committed. The app database remains through migration 20261014000012; migration 13
is not applied there. The original proof database and demo were not targeted by
the worker. The final worker proof census found zero queued/reserved/running jobs.

Private evidence root is
`/home/nathaniel/.local/state/openplan/response-write-probe-20260913`.
Important logs: translation-worker-mutations-restored.log,
translation-generation-controls-worker-join.log,
translation-worker-live-controls-final.log, translation-worker-tests-final.log,
translation-worker-type-final.log and translation-worker-lint-final.log.
Earlier failed instruments remain retained in their separately named logs.

## Remaining work and next action

1. Continue from the owned checkout
   `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`,
   branch `work/translation-command-workflow`, package openplan/. No other agent
   edited this checkout. Another Codex process remains active elsewhere. Recheck
   ownership and live processes on resume; do not assume a dev server survived.
2. Replace the sequential staff machine branch in
   `src/app/api/engagement/campaigns/[campaignId]/translations/route.ts` with exact
   request-id queue creation, authoritative actor/field snapshot binding and
   status/output reads. Reuse `prepareWorkspaceTranslationSelection`. Make lost
   creation responses return the retained request before attempting new credential
   preparation or new generation. Keep route-local action approvals/refusals.
3. Connect the editor to durable batch status and retained output publication.
   Finish `publish_generated`, which still deliberately refuses in the existing
   command SQL. Preserve original source, translation version, exact output digest
   and correction/acceptance authority. Generation does not itself publish words.
4. Convert public producers/cache provenance and separate public allowance to the
   durable boundaries. Preserve atomic per-language merge, publication rechecks,
   legacy cache uncertainty and no automatic paid regeneration after lost proof.
5. Main integration is complete for this checkpoint. Last live main
   observed this turn is ef16f166447ab477ea36588a5c01620f61560b19; CI 34779793816 and
   RLS 34779793752 are completed/success. v0.58.1 remains the latest published
   release. Main was then merged into this branch at bc7cd8c2, bringing v0.58.1 metadata. The only conflict was the changelog, resolved by retaining both sections. The translation work remains unreleased.
6. Finish identified desktop/390px keyboard and console journeys, full QA/shuffle,
   isolated RLS, applicable worker/upgrade/restore checks, release metadata and
   final-main CI before tagging. No full-product, full-QA or browser pass is
   claimed by this worker checkpoint.

The real SDK runs against synthetic intercepted provider responses. No provider
quality, actual billing receipt, public workflow, route actor binding or browser
acceptance is established. The CLI loop uses the tested cycle, but its continuous
operator lifecycle and service installation still need operational checks. Legacy
AI producers' shared allowance atomicity remains a separate unfinished join.


After the main merge, the release-ordering check caught two omitted development
migrations in Unreleased: history receipts and generation. The changelog now names
all four development migrations and retains the published v0.58.1 section. This
was an operator-documentation gap; the guard was kept unchanged. Before/after
logs are translation-worker-release-ordering-before.log and
translation-worker-release-ordering-final.log in the private evidence root.
