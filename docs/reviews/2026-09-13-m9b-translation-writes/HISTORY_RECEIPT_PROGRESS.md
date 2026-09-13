# Reasons and checked source in translation history

This continues `dbf53e5d` in the owned translation-command-workflow checkout.
The increment remains unfinished and unreleased. Start here, then read
EDITOR_RECOVERY_PROGRESS.md and NEXT.md for remaining workflow work.

## Implemented behavior

Private history now joins immutable command receipts in one stable SQL statement.
Each batch receipt is returned once. The schema-2 envelope includes explicit
history links, receipt counts and the exact stored payload/result text with its
checksums. Migration 20261014000012 replaces only the invoker history-read function;
it does not rewrite retained history, backfill reasons or enable command writes.

The server verifies bytes, complete counts, unique receipts, campaign/request/actor
identity, the retained resulting row, history event, source checksum and original
request/version custody. It reuses the existing pending-request validator for
starting-copy checks. Missing or inconsistent linked evidence withholds the whole
read rather than silently presenting a partial audit. Legacy or direct-producer
history with no receipt explicitly retains unknown source/reason evidence.

The history UI shows the reason, checked source, recorded language, source
availability and starting revision. Receipt checksums remain inspectable. Existing
machine-origin records survive acceptance; a source used for withdrawal can differ
from the original translation source or be absent. Shared batches and no-op fields
are covered. A receipt containing only no-op results has no new history row to
attach to; the receipt remains stored, but is not invented as a new change.

## Checks and corrected verification gaps

Four focused suites completed with 60 passing tests. TypeScript and changed-file
ESLint exited 0. TypeScript first found an unsafe union push in a batch fixture;
the test now narrows to a save operation before adding its text entry. An initial
test invocation used the repository root and found no matching package tests;
subsequent package-root invocations are the recorded test evidence.

`prove-translation-history-receipts.py` records 28 expected outcomes: seven
baseline/harmless survivors and 21 targeted failures. Five SQL mutations detected
RLS bypass, missing links, altered source bytes, incomplete history and anonymous
execute permission. Reader/UI mutations detected checksum, count, identity,
original-result, retained-wording, source, event and linked-evidence corruption.
The first run found a surviving starting-version mutation because a new local
comparison duplicated the shared pending validator. The redundant comparison was
removed; mutating the shared validator now fails the intended test. Preserve
translation-history-receipt-redundant-check.json as the initial record. All source
files were restored and their hashes checked afterward. These are selected guards,
not a claim that every new branch has received independent mutation coverage.

SQL candidate definitions and fixtures first ran inside rolled-back transactions
on `supabase_db_openplan-restore-target-2026091050`. The database stayed at 330
migrations with no fixture users and command EXECUTE revoked. The actual additive
migration was then copied to that stack's independent migration directory and
installed using db:sync's application/stack identity check. It is now 331 through
20261014000012. Both registered installed history tests completed, including the
existing >1000/private-original history fixture and the new receipt/role fixture.
Their temporary command grant and synthetic rows were rolled back.

The identified webpack server on 127.0.0.1:3260 served this owned checkout. Updated
1440px and 390px real-navigation journeys completed the original save/lost reply,
exact retry, correction, unsaved draft reload, competing write, conflict review,
archive/reopen, withdrawal/recreation and history-selection flow. They additionally
asserted visible correction reasons and exact source wording in history. Six
linked records, the unchanged retained original and downloaded request checksums
were checked. Screenshots were inspected at both sizes. Console records include
expected failed-request/409 messages and font/style preload warnings; no page
exceptions were recorded. Navigation-aborted reads remain in the private records.

`translation-history-receipt-evidence.json` pins the application, migration,
browser harness, artifacts and cleanup result. The contained browser grant was
revoked with child exit 0. Credentials and raw captures remain private. The demo,
original checkout and pending reminder constraint were not changed.

## Continue

Complete the remaining write-recovery guards and malformed/quota/interruption
browser cases, including unsent-draft archival on storage failure. Private viewer
and outsider behavior has SQL/route evidence here, not a new viewer browser
journey. New machine-acceptance UI behavior still needs that browser path.

Then finish durable generation, retained publication, attempt/spend accounting,
cache provenance and conversion/retirement of legacy direct producers. The ordinary
command grant remains revoked while that integration is unfinished. Full QA and
shuffle, applicable isolated RLS/worker/upgrade/restore checks and exact final main
CI remain before release. v0.58.0 is already published; do not restart the old
v0.47/v0.48 prompt. The complete V1 contract and roadmap remain binding.

The owned webpack server was still running at checkpoint; browser, focused test
and mutation jobs finished. Recheck live ownership, ports, branch and database
state on resume. Another Codex process remained at the original checkout. Keep
working in this owned worktree and do not disturb its session or the demo.
