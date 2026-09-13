# Exact translation snapshot checkpoint

The command prototype is now staged in application migration
`20261014000010_engagement_translation_commands.sql`. The original candidate SQL
and its earlier evidence remain historical records. Command probes now read the
actual migration and write distinct migration result files. Execute remains
revoked for ordinary callers until every producer and generation publication is
joined. This is development work, not a release or an installed app upgrade.

`20261014000011_engagement_translation_snapshot.sql` adds one scalar snapshot of
campaign/source wording, publication/activity flags, current translations and their
retained revisions. It reads all source records, including unavailable sources
needed to describe retained wording. Publication filters belong to the consumer's
source resolver and later editor inventory. Workspace viewers may read this
current state; private change history and command receipts remain staff-only.
The function uses one stable statement snapshot. No page prefixes are combined.

`openplan/src/lib/engagement/translation-snapshot.ts` validates the complete reply,
campaign and row scope, census, identities, parent relationships, source addresses
and safe positive revisions. It preserves raw source and translated words and a
null source locale. It resolves source availability through published/active
questions and their option parents, and published responses. A failed, malformed
or incomplete response returns an unavailable result, never an absent translation.
The existing campaign state loader, editor and routes have NOT been converted to
this reader yet. It currently has direct consumer tests and installed-data proof.

## Evidence and errors

The disconnected database `openplan_translation_command_proof_20260913` contains
the installed candidate and reader, with deliberately synthetic retained fixtures.
The application and demo databases were not upgraded. The 1,005-category and
1,005-translation fixture is in translation-snapshot-fixture.json, alongside
published/draft questions, options and responses. Sources and saved wording retain
NBSP/BOM boundaries. The actual database snapshot parses through the TypeScript
consumer. Its 2,025 source field versions agree with the transaction's source
resolver; a harmless metadata addition survives and changed source text fails.

A separate owned PostgREST container used that proof database on loopback 38961
with max_rows=1000. The ordinary category rowset returned exactly 1,000 rows;
the scalar RPC returned all 1,005 categories and translations. Owner and viewer
current-state reads agree. Anonymous and outsider reads are refused, and viewer
queries return no private translation history or command receipts. The container
`openplan_translation_snapshot_rest_20260913` is stopped. Its private env file is
mode 600 and is not committed. The first attempt hit a connection reset during
startup; the second hit PGRST002 before the schema cache was ready. The corrected
runner waits through those specific readiness outcomes and only restarts a named,
positively terminal container with the expected database, binding and image.

The concurrency test pauses the actual reader after its access check using an
advisory barrier, confirms its waiter in pg_locks, and commits a source/translation
correction from a different connection. The paused read returns original source,
locale, words and revision; a fresh read returns the correction and next revision.
Baseline and a harmless comment survive. Changing STABLE to VOLATILE breaks the
statement-start snapshot assertion. The function is restored afterward. This
controlled interleaving is not an arbitrary-scheduler or browser test.

Client tests cover raw words, unavailable source states, complete reads and
malformed/incomplete replies. Seventeen tests passed; baseline/comment controls
survive and 21 targeted mutations fail named assertions. Installed SQL controls
catch truncation, missing revision, trimmed source words and removed authority.
The actual migrations also apply together in a BEGIN/ROLLBACK against the named
328-migration source stack. The owner read works, and premature command/anonymous
read grants fail targeted controls. A final census finds no added table, any of
the six new functions, or the new history column in that source database.

The first focused migration run failed because inventory counts and Unreleased
notes had not been updated. The installed catalog confirms one new RLS table,
one permissive staff SELECT policy, eight receipt columns and one history link
column. The inventory now records those changes. A harmless comment survives;
removing the policy, RLS or migration note fails the corresponding check.
The final focused run passed all 56 tests across snapshot and migration suites.
Complete TypeScript checking and changed-file ESLint exited 0. Full QA/shuffled,
standard live-RLS registration, worker and release upgrade/restore checks have
not run for this unfinished integration.

All private logs live under
`/home/nathaniel/.local/state/openplan/response-write-probe-20260913`.
Current file/log hashes and result summaries are in
translation-snapshot-verification.json. Earlier command verification applies to
the earlier checkpoint; use the migration result files for the current source.

## Next implementation

Build the exact write-intent/acknowledgement and saved-request recovery contract
using the new source/version types and the existing response-write patterns.
Then convert loadCampaignTranslationState, campaign-translations-panel and the
translations route together. Keep raw source words separate from display labels,
preserve caller request IDs across uncertain outcomes, show correction reasons
and retain before/after copies. Current legacy loaders and panel still trim words;
do not treat their output as the new exact source snapshot.

Generation needs the existing durable worker/lease conventions, retained results,
attempt accounting before spend and exact publication without another model call.
Convert public cache provenance and every direct producer before granting the
command and retiring direct writes. Do not turn the pending publish_generated
refusal into a claim that generation is finished. Manual authoring stays local
and available without an API key. Then exercise identified desktop/390px keyboard
navigation and console, recovery and artifacts, full applicable gates and final
main CI before release. [NEXT.md](NEXT.md) and the full V1 contract remain binding.
