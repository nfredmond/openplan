# Response editor and transaction join

September 13, 2026. Unreleased work in the owned response-write checkout.
This supersedes the unwired-handler status in ROUTE_BOUNDARY.md. No prototype SQL
has been promoted or applied as part of this editor implementation.

The actual POST/PATCH/DELETE exports now call responseWriteRoute. The editor sends
requestId for creation and also the exact original updated_at and a recorded
reason for correction, publication, withdrawal or removal. All writes use the
caller-scoped transaction; the old separate prior-status/category reads, direct
response writes and inline subscriber broadcast have been removed from these
routes. The ordinary source stack still lacks that transaction, so this checkout
is not ready for a deployed editor or an engineering release yet.

The campaign page supplies user identity and keys the editor by user and campaign.
The editor retains a validated intent in sessionStorage before transport and
checks readback. One pending intent blocks new response actions. An unknown result
keeps the same request, including after a reload or when a removed card no longer
exists. Receipt validation is shared by the database adapter and the browser;
HTTP 200 alone does not clear a pending request. Confirmed creates/replays update
one current row rather than appending a duplicate. Tab closure can lose the local
recovery copy and is disclosed. This is not a durable cross-device draft store.

A conflict/rejection requires a complete scoped current-list read before a new
reviewed intent. The panel keeps the starting copy, proposed words and current
copy separate. It uses a fresh request ID and current version only after an
explicit reviewed save. A status-only change does not overwrite another staff
member's intervening response text. Theme tags, contribution links and correction
reasons can be adjusted during review. AI provenance is retained. An absent row
can be dismissed after a successful complete read; that does not claim who
removed it or fabricate a removal receipt.

The publication notice reads strict aggregate reports and can refresh the private
status endpoint. Published history revisions also reopen that report after a reload,
using separate history anchors so the current card and retained revision never
share a DOM id. Queued/unknown counts remain unknown, preparation can establish
zero, and provider acceptance is not inbox delivery. Skipped, attempting,
uncertain and cancelled outcomes stay distinct. Retained history now displays
staff and source-withdrawal reasons without inventing reasons for older entries.
The Activity summary still needs the new attempting/uncertain states before the
worker is enabled. Skipped/uncertain retry/resolve operations remain unbuilt.

Test transition: engagement-response-write-route.test.ts now imports the actual
POST/PATCH/DELETE exports, not the handler factory directly. The removed
engagement-closeloop-route.test.ts asserted the old separate prior-status/category
queries. Those queries no longer exist: transaction refusal/identity/replay tests
and the retained SQL probes cover the replacement boundaries. close-loop-route
retains complete GET and AI-draft route cases. Legacy outbox writing, the real
summary reader, notifications route and Activity component remain tested together
in engagement-email-delivery-is-visible.test.tsx. That suite no longer claims to
exercise current publication delivery. New editor/notice tests exercise the new
contract; live database/browser evidence is still required for the full join.

Verification findings must remain explicit. An initial TypeScript run found
missing userId props in old tests and later found insufficient union narrowing;
these are compiler failures, not behavioral passes. A new regression also reproduced
an invalid unsent edit being put into the unknown-save recovery panel, locking
its form. Preflight validation now leaves such words editable and sends nothing;
that is separate from a valid request whose network outcome is unknown. An initial editor assertion
that Add entry was disabled was weak because its title was empty independently
of the pending-write guard. The corrected assertion uses Generate drafts, whose
enabled state depends on the guard. Mutation artifacts retain any rejected
probe or surviving defect instead of silently counting it as verified.

No new real provider calls, no migration/reset of the disposable source stack,
no main merge, no release tag, and no human-review release gate. Required next
work: complete mutation/type/lint evidence; promote and probe the coherent additive
migration on the named disposable stack; connect Activity outcomes; verify browser
navigation, desktop/390px keyboard/reload/conflicts/history, local REST-to-worker
recovery, QA/shuffle/RLS/worker/upgrade and exact final CI before release.

The final focused checkpoint has 210 tests across 14 files, TypeScript and ESLint
exit 0, and four mutation batches with 79 targeted failures in total. Each batch
retains a passing baseline and harmless control. See editor-checks.json for exact
source hashes and counts. These are not full QA or browser acceptance.

Before browser acceptance, investigate three remaining source-inspection risks:
unknown HTTP errors such as body-limit refusal may need explicit editable recovery;
a permanently unreadable sessionStorage record currently has only a retry control;
AI suggestion cleanup compares raw suggestion text against trimmed retained text.
These have not been reproduced or resolved at this checkpoint. Do not silently
turn them into claims of completed recovery.
