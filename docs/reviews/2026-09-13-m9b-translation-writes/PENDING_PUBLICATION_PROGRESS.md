# Pending publication recovery, September 13, 2026

This continues ce127cec in the owned translation checkout. PendingTranslation
now retains publish_generated requests with the exact viewed generation DTOs,
original source and saved baseline. The staff generation/catalog/editor producer
join remains unfinished. This is not a release or activation checkpoint.

## Implementation

The existing version-1 manual shape remains readable and serializes unchanged.
A strict publication alternative requires retained generation evidence. The
shared publication selection reader checks distinct request and field identities,
requested campaign/workspace/language, attempt, delivery digest, original source
and saved baseline, and completed output state. It rejects unrelated requests.
The same reader now supplies publication acknowledgement verification, avoiding
separate definitions of which retained output a reference identifies.

Storage identity already includes the complete frozen request except its mutable
phase. It now includes all viewed generation evidence as well. Changed words,
model, actor, output hash or earlier wording cannot replace or clear an existing
publication request with the same ID. Damaged records remain unreadable recovery
records; archiving preserves their original bytes.

The existing write hook sends only the publication intent through commands and
confirms the result against its retained viewed evidence before clearing storage.
A lost response or in-flight storage deletion retains the page request and uses
the same exact intent on retry. Recovery and earlier archives display generated
words, separately from the prior saved translation. Display lookup uses the
request and field identities without revalidating the entire batch for each row.
The operation label reads publication instead of an internal operation name.

Reopening a refused publication archives it through existing recovery and leaves
manual drafts unchanged. It does not assign machine output to an operator or
rebase it onto refreshed source. The editor's next generation selection must
preserve this boundary when the real producer is connected.

## Evidence and limits

The new schema/storage/component suite uses synthetic viewed DTOs and mocked
HTTP in jsdom. It checks exact retained bytes and baselines, original actors,
reordered fields, changed references and states, unrelated requests, ambiguous
fields, corrupted-record archival, frozen-identity replacement refusal, failed
acknowledgement, exact retry after deletion/response loss, and conflict archival
without overwriting an unrelated manual draft. The shared publication receipt
controls and existing manual-write boundary controls are rerun after extraction.
Final results are recorded below when all checks finish.

Two first-run component assertions selected the strong label instead of its
paragraph, and one used a single-element query for a two-field batch. Those test
selectors were corrected to inspect the paragraph containing each first label.
The subsequent focused run passed all 127 tests across the three selected suites.
This does not establish browser geometry or new workflow reachability.

Browser identity was checked at http://127.0.0.1:3260 using which-openplan.sh.
It identified the owned checkout's live next dev process, version 0.58.1, with
no falsely stamped build SHA. Source hashes cover the added publication modules.
The existing manual editor browser journey is the regression target. Publication
creation through actual staff navigation remains unverified until the producer
join. Synthetic recovery component fixtures do not claim a completed generation
or live publication browser journey.

No database schema or standing execution permission is changed by this increment.
The existing browser wrapper may temporarily grant the manual command on the
named disposable application stack and restores the prior revocation in finally.
That regression uses migrations through 12, not the unpublished generation and
publication migrations. Original checkout, demo and reminder constraint remain
untouched. No paid service or provider call is required.

## Continue

First fix the outline-button hover contrast found in the 390px conflict-review
screenshot. The hovered Download retained request button has pale text on a pale
background. The shared Button outline variant mixes its hover background with
literal white, while dark-theme pine-deep is light. Verify actual hover colors
and keyboard focus in both themes and widths before claiming this fixed. This
finding was reported to the user and remains open at this checkpoint.

Connect the staff editor to durable generation POST/GET, request discovery and
retained publication. Preserve exact source/saved versions and stable identities
when a request is interrupted or browser storage is lost. Retain viewed output
with PendingTranslation before publication. Do not resend generation to resolve
uncertain publication or select a replacement model/key on a retry. Render
original generation actor separately from the current publisher.

Replace the old staff suggestion/publication producers before enabling the
protected command. Account separately for public comment producer privacy and
allowance. Then exercise actual generation and publication navigation, desktop
and 390px, keyboard, console, interrupted retries and source/version conflicts
against identified isolated builds. Complete applicable QA, shuffle, database,
worker, upgrade and restore gates before final main CI and release tagging.
The user authorizes direct main merges and does not require PRs or human review.

## Final checkpoint evidence

All 366 tests passed across 16 selected suites. TypeScript no-emit, focused ESLint
and git diff --check completed successfully. Fault reports contain 15 pending
cases with five survivors and ten targeted failures, 38 publication receipt
cases with two survivors and 36 targeted failures, and 77 manual boundary cases
with five survivors and 72 targeted failures. Sources were restored before the
combined checks and browser journey; no source changed during browser capture.

The existing manual editor journey passed at 1440px and 390px from sign-in and
Engagement navigation. It exercised keyboard controls, quota/archival failures,
in-flight storage deletion, exact replay, competing correction, withdrawal and
recreation, downloads and original history. Inspected screenshots show the
retained and current copies and wrapped controls. Neither width had horizontal
document overflow or a page exception. The narrow hover contrast issue described
above remains open. Do not summarize these captures as full visual acceptance.

Console review found the two deliberately interrupted request errors and the
expected 409 conflict in each journey, plus Next dev preload warnings. Navigation
also cancelled map/history requests; no unrelated page exception was recorded.
The browser wrapper exited zero and revoked the temporary command grant. A fresh
read-only SQL check confirmed authenticated execution false and max migration
20261014000012. The browser result hashes, screenshot paths and source hashes are
in pending-publication-browser-regression.json.

Private logs under response-write-probe-20260913 include
pending-publication-combined-final.log, pending-publication-types-final.log,
pending-publication-lint-final.log, pending-publication-controls-final.log,
publication-receipt-controls-pending.log, write-boundaries-pending-publication.log
and pending-publication-manual-browser.log. All verification processes are
terminal. Full QA, shuffled tests, whole-stack RLS, worker, upgrade and restore
checks were not rerun for this unreleased checkpoint.
