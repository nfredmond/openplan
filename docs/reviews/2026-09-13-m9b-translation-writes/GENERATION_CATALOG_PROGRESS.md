# Saved translation request discovery, September 13, 2026

This continues the unfinished reset checkpoint at 2cec0264. The generation GET
route now lists retained campaign requests when requestId is absent and reads a
single retained request when it is present. Listing uses the authenticated staff
RPC, never service credentials. The editor has not been connected yet.

Migration 20261014000015 adds a campaign/workspace/date/ID index and a staff-only
catalog RPC. It returns at most 20 requests plus a continuation cursor determined
from a 21st row. The cursor preserves all six PostgreSQL timestamp fraction
digits and UUID ordering when timestamps tie. It includes request/actor identity,
locale, date, original field count and all eight persisted state counts. It does
not expose source words, generated words, provider metadata or credentials.

The native page reader checks scope, strict shape, reconciled field counts,
ordering relative to the supplied cursor, and the exact continuation identity.
A separate uniqueness check rejects a repeated request ID even if its timestamp
differs. The route refuses partial cursors and mixed detail
and page selectors. Permission lost at the database returns forbidden; an
unconfirmed read stays unavailable.

## Verification boundaries and corrections

The first test launch mistakenly ran from the repository root instead of the
openplan package. It failed on import aliases before running tests. It is not
verification evidence. The package-root run and later controls are separate. The first native fixture
launch also failed before SQL because top-level await was compiled as CommonJS;
an async main function fixed that probe startup.

The first page-limit mutation survived because a continuation-length check
masked the missing limit. The overfull fixture now has no continuation. Other
schema fixtures similarly isolate the short-page, timestamp-width, extra-state
and empty-field boundaries so another invariant cannot substitute for them.
I initially removed the uniqueness check as redundant with ordering. That was
wrong: a duplicate ID with a different timestamp can still sort correctly. The
check is restored and its fixture now uses different timestamps so ordering
cannot mask its removal. This was caught during review before the checkpoint.
A later ambiguous-selector control selected zero tests because its question mark
was interpreted as a regular-expression operator. The runner now escapes literal
test names and refuses a run with no executed assertions. Both initial failures
remain in private logs. They were instrumentation defects, not passing controls.

The SQL probe uses database openplan_translation_command_proof_20260913 in
container supabase_db_openplan-restore-target-2731143. It installs migration 15
inside BEGIN/ROLLBACK and verifies both function and synthetic user removal.
Twenty-three synthetic requests span equal timestamps and adjacent microseconds.
Their fields directly cover all eight persisted states; this is projection
coverage, not a claim that workers produced those terminal outcomes. A deliberately
inconsistent imported row checks the workspace filter even when its campaign ID
matches. Owner/member access, removed membership, viewers, outsiders, another
campaign, anonymous grants and private-table access have distinct checks.
The actual returned pages pass through the native TypeScript reader and are
compared with all expected request IDs in exact order. No model or worker runs.

Final results are recorded in generation-catalog-controls.json and the follow-up
verification section below. This does not establish browser reachability,
public translation privacy, concurrent snapshot isolation across multiple page
requests, provider usefulness or a complete release. State counts describe
persisted job states; an abandoned active lease may await worker reconciliation.

## Continue

Retained publication is the next implementation join. The existing command in
migration 10 refuses publish_generated. Extend it in a new additive migration
using exact retained field/attempt/digest references. Read words/model only from
completed output accepted as completed, verify original address/source/locale
and the observed saved-translation version, and retain its generation reference
in the immutable write receipt/history. Replays must confirm the original receipt
without a new key or provider call. Keep generation actor and publishing actor
separate. Reject incomplete, interrupted, cancelled or stale results.

Then extend translation-write.ts and pending-translation.ts for machine output,
connect the editor to request discovery and durable generation, and replace the
old staff machine routes. Preserve draft recovery, exact retries and manual
alternatives. Exercise desktop/390px navigation, keyboard, console and interruption
before claiming the workflow works. Full QA, shuffle, isolated RLS, workers,
upgrade/restore and final-release-commit CI remain required before tagging.

Main was rechecked at ef16f166447ab477ea36588a5c01620f61560b19 with completed
successful CI 34779793816 and RLS 34779793752. v0.58.1 is already released; this
translation workflow remains unreleased. No PR or human-review release gate.
Original checkout, demo and pending reminder constraint remain untouched.

## Final checkpoint evidence

Seven focused suites passed 249 tests, including generation, credential, worker,
route, catalog, saved-write and migration release-ordering coverage. TypeScript
and focused ESLint passed. This is not the whole-product QA/shuffle/RLS campaign.
The catalog runner completed 47 controls: six baselines/harmless survivors and
41 targeted failures, all expected. The existing request runner completed all
48 controls with expected outcomes against the current route. The final source
and test SHA-256 values match the catalog evidence after restoration.

generation-catalog-read-restored.json records the final 23-request SQL/native
reader run, page sizes 20 and 3, and confirmed rollback. Migration 15 remains
uninstalled permanently; the app stack stays through migration 12.
Private logs are in /home/nathaniel/.local/state/openplan/response-write-probe-20260913:
- generation-catalog-combined-final.log
- generation-catalog-types-final.log
- generation-catalog-lint-final.log
- generation-catalog-controls-uniqueness-final.log
- generation-request-controls-catalog.log

No background test or proof command remains active at this checkpoint. Existing
app/database services were not restarted or treated as browser acceptance.
