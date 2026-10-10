# Parsed artifact validation and guarded row publication

The retained-archive worker now validates the complete parser result and maps it
through the existing route/stop row builders. It prepares an output plan bound
to the saved artifact, delivers ordered batches through the owned journal,
collects checked receipts, requests tract computation and returns an explicit
completion or failure request to the ownership coordinator. No import route or
polling service is enrolled.

The decoder requires the complete parser protocol, including nullable source
facts, warnings and statistics. It checks archive size, receipt outcome, unique
entity and service identities, service-day bases, referenced entities, dates,
departure counts and spans. Worldwide coordinates remain valid. Unknown agency
timezones and route types remain null. The source-text dates in `feed_info.txt`
remain distinct from the parser's ISO service-calendar dates. An initial decoder
check rejected those source-text dates; the corrected decoder preserves the
existing parser output instead of rewriting the feed.

Publication checks the actual descriptor bytes against the retained receipt
before decoding. Typed completion metadata is validated before replacement output
is prepared. Route batches precede stop batches, and their count, ordinal and
returned hash form the complete manifest. The original parser route and stop
counts remain separate from derived row totals. They are returned with the
display name for later adoption work, which is not connected by this checkpoint.

A parser refusal returns its original code and explanation without row writes.
An empty mapped route or stop result returns `no_usable_service`. An unknown
delivery outcome throws without inventing a failure command. Cancellation stops
subsequent writes, including cancellation caused by loss of the artifact lock.
A failed tract join retains null count and timestamp with its error; a successful
zero-row join remains a distinct result.

## Verification

The final combined suite passes 426 tests across the worker service, journal,
dispatcher, coordinator, artifact helper, decoder, publisher, parser supervisor
and retained-archive reader. This includes 108 decoder and 22 publication tests.
Scoped TypeScript, ESLint, product direction and diff checks pass. The direction
check retains its existing review reminders; no review date was changed.

The source controls record 99 runs with source/test hashes. Nine baseline,
harmless-comment and restored runs pass; 90 targeted variants fail assertions:

- [Decoder: 31 runs](parsed-artifact-controls.json).
- [Publication: 17 runs](worker-publication-controls.json).
- [Shared service: 51 runs](publication-service-controls.json).

The publication controls cover incomplete batches, wrong row scope, changed
manifest hashes, metadata checked too late, confused parser/derived counts,
missing preparation, ignored cancellation and lost artifact-lock cancellation.
The decoder controls challenge every strict object schema and its cross-field
checks. These are engineering protocol checks, not scientific validation of GTFS
service or the travel models.

## Composed Storage/parser recovery proof

[The three-process record](worker-publication-native.json) connects the ownership
coordinator, artifact helper, publication function, private command journal and
installed SDK. It uses actual isolated Storage and the production parser child
with the retained public BART archive. Database lifecycle replies and the tract
outcome are controlled fixtures.

The first process maps 95 route-service rows and 717 stop-service rows. Completion
metadata retains 14 routes and 287 stops. The controlled backend accepts the final
command and loses its reply. A new process observes the closed attempt and
recovers that exact unresolved completion command without invoking processing,
downloading, parsing or publishing batches again. A third process validates the
local receipt without resending completion. All three processes see one parsed
output with the same digest. The deliberately unavailable tract result remains
unavailable through both recoveries.

The record identifies every participating application source hash. Storage uses
the existing isolated proof database and a separately bounded service, which is
removed after fixture cleanup. No candidate SQL migration is installed by this
proof. Controlled lifecycle replies do not establish actual PostgreSQL writes,
transaction rollback, lease fencing, RLS, concurrency or adoption. The proof
does not replace browser, planner, scientific or largest-feed acceptance.

## Remaining work

The composed retained-archive path can now be exercised against native lifecycle
RPCs in an isolated database. Verify committed restart and unknown replies,
replacement attempts, concurrent batches and closure before route enrollment.
Connect URL/catalog acquisition, uncertain Storage writes, interrupted-file
cleanup, ordinary adoption and queue polling. Adoption after an observed ready
restart still needs a scoped source of distinct parser counts.

Promotion lock ordering, Storage writes arriving after cancellation, operating
budgets, populated upgrade/restore, full branch CI and T3 desktop/390px journeys
remain open. No main merge or resumable-import release is declared. The full
v1 contract and independent scientific/human acceptance requirements remain.
