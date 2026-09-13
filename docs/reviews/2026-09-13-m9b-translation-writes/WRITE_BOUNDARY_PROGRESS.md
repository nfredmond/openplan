# Translation route and recovery boundary

This continues the saved `6d499779` checkpoint in
`/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`,
branch `work/translation-command-workflow`. It is unfinished development work,
not a release. The editor still uses the legacy routes. The command remains
revoked for ordinary callers in the staged migration. No database or demo was
changed by this continuation.

## What changed

The command and snapshot route tests now exercise the actual request parser,
body reader, RPC helper and acknowledgement parser. Only authentication, campaign
access and database transport are mocked. Save, accept and withdraw carry exact
source, observed revision, raw words, reason and request identity. An explicit
second request after a lost connection sends the same payload and accepts the
original confirmed replay. The route does not query a newer inventory first.

A 200-entry supplementary-Unicode batch exceeds the old 256 KiB transport cap
and passes the new 8 MiB boundary. A streamed body exceeding that limit is
cancelled before its tail is read, before any database client is created. Malformed
UTF-8 is tested inside otherwise valid JSON so removing fatal decoding can
actually change the outcome. Refusals keep private/no-store responses and do not
return saved receipts or expose raw source words in audit calls.

The recovery checks found a real acknowledgement gap: changed content could
reuse its old history revision. Confirmation now permits that revision only
when wording, source, model, source hash and original actor match the retained
before copy. A changed timestamp alone remains a valid no-op, matching the
installed history trigger. New-revision saves, exact retries and retained model
origin on acceptance/withdrawal remain covered.

The recovery key already binds user, campaign and request. Its exact comparison
now enforces those facts without redundant user/campaign comparisons; workspace
is checked separately. Tests cover inconsistent before copies, duplicate result
addresses and row identities, mismatched scope/version/words/actor, failed local
writes/removals, preserved malformed bytes, archive failure and concurrent changes
to the active record during archiving.

## Evidence and limitations

`prove-translation-write-boundaries.py` reads JSON assertion results from Vitest,
requires the named assertion to fail and restores every changed source in
finally. Baseline plus a harmless comment in each of four source files survived.
All 72 targeted mutations failed their intended assertions. The 77 outcomes and
restored source hashes are in `translation-write-boundary-results.json`.

The first run exposed a weak before-copy length test: removing the length guard
survived because the missing-copy fixture was rejected by another check. The
new extra-copy case isolates that length guard and fails when it is removed.
The initial gap is retained in `translation-write-boundary-initial-gap.json`.
Two early positive tests also compared JSON property order instead of the actual
retained bytes; they now capture and compare the stored bytes before the attempted
operation. Those were test defects, not missing stored words.

The final focused suite covers 106 tests across command routes, write/recovery
and snapshots. The mutation suite runs the 89 route/write tests. An initial type
check caught the test stream's RequestInit/duplex typing, corrected with the
literal `half` type. Final outcomes and file/log hashes are retained in
`translation-write-verification.json`. Private logs are under
`/home/nathaniel/.local/state/openplan/response-write-probe-20260913`, with each
mutation run in its own dated subdirectory.

These tests cannot prove live SQL authority or atomicity, actual PostgREST writes,
browser storage behavior, real navigation, keyboard usability, console cleanliness,
generation or release readiness. Existing installed snapshot and command evidence
remains in SNAPSHOT_PROGRESS.md. Full QA, shuffled, standard isolated RLS, workers,
upgrade/restore and final release-commit CI are still required after integration.

Current remote main was rechecked at `88fb20b619f9108c29c7102ca20fb6423f553e45`;
CI 34765984540 and RLS Isolation 34765984526 both completed successfully. That
evidence applies to main, not this unfinished branch. v0.58.0 remains the latest
published increment identified by the retained publication record.

## Resume with the editor

Continue WRITE_PROGRESS.md's integration plan. Replace the legacy separate reads
in loadCampaignTranslationState with the atomic snapshot, preserve raw words,
pass user/workspace/snapshot into the panel and join manual save/accept/withdraw
to locally retained exact requests. Keep unavailable source translations reachable
for withdrawal without inflating public coverage. Add recovery review, same-request
retry and archive/copy controls, correction reasons and matching UI tests. Identify
the served checkout before browser acceptance. The old loader/panel still trims
words and cannot be treated as an exact observed version.

Then complete durable generation, retained publication and every producer before
retiring direct writes. Do not remove the publish_generated refusal as a shortcut.
Merge verified work directly to main without a PR or human-review release gate,
then inspect final CI before tagging. The full V1 goal, free local operation and
separate scientific validation scope remain unchanged. Keep the pending reminder
constraint, original checkout, demo and retained proof databases untouched.
