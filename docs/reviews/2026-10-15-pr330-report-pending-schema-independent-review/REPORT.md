# PR330 report fallback independent source review

October 15, 2026. **No reproducible P1, P2 or material correctness regression
found within the assigned report fallback correction.** This disposition covers
source and retained synthetic route evidence. It does not accept database,
browser, native artifact or hosted behavior on the changed head.

## Reviewed head and ownership

- Reviewed integration head: `bba8ceb6893243322a0fab06710bde3ec418a776`.
- Implementation: `f956f414ffd1e286163e6c111a3b5314b404cd6f`, based on
  `401c44a0f7bfe4b54740e2c3d07e30f8ed36f169`.
- Assigned checkout: `/home/nathaniel/.t3/worktrees/openplan/t3-e6a4c429`.
- Branch: `t3/pr330-report-pending-schema-review`, initially clean at
  `05dd3e8da4a4572437f06e771b0a2477873e681f`, advanced ff-only to the reviewed
  head. Integration and other checkouts remain outside reviewer writes.
- Reviewer owns only this new directory and
  `~/.local/state/openplan/privatepr330-report-pending-schema-independent-review-20261015`.

Read the assigned AGENTS.md, current checkout instructions and newest external
coordination banners, including the 16:55:06 UTC ownership record. The parent
owns combined focused checks and full TypeScript checks. The workbook reviewer
owns a disjoint review. No source, existing test or existing guard changes occur
in this review. Planner-writing, prove-it and any-place guide the review.

## Assessment of the original objection

The [original P2](https://github.com/nfredmond/openplan/pull/330#discussion_r4285653407)
describes a widened query falling back to core fields, then sending an omitted
`jurisdiction_context` to the strict reader. The correction removes that path
for the recognized error forms. The retained pre-fix route report contains two
intended failures: expected HTTP 200, observed HTTP 500. The corrected retained
report contains the corresponding successful route and generated HTML assertions.

At `openplan/src/app/api/reports/[reportId]/generate/route.ts:1637`, a retry
requires a recognized missing-column message, an exact optional column name and
that column's presence in the current projection. Each retry removes its named
group. Four groups bound recovery to four retries after the initial read.
The project ID predicate remains in every query. Jurisdiction-only failure
preserves place, estimate and site projections. Place-only failure preserves
jurisdiction validation. Unknown columns, unclassified schema-cache errors,
permission/connection errors and failed fallback reads retain refusal paths.

At `openplan/src/lib/reports/project-jurisdiction.ts:9`, unread jurisdiction gets
the report-specific `openplan.report-project-jurisdiction-schema-pending.v1`
object. It records project identity/revision, registry digest, separate read
states and the full disclosure. It invents no null context, human declaration,
recorded time, legacy assessment or support finding. Canonical hashing excludes
the hash itself and the generation clock.

Readable jurisdiction still reaches the unchanged strict export v3 builder at
`openplan/src/app/api/reports/[reportId]/generate/route.ts:1794`. The ordinary
reader still rejects an omitted projection and malformed context. Explicit
database null and a saved human unresolved declaration retain their existing,
different meanings. No place literal, alternate resolver or authority inferred
from study geometry enters this correction.

The same readiness object goes to report HTML and artifact `sourceContext`.
The pending HTML branch at `openplan/src/lib/reports/html.ts:379` prints the
escaped disclosure, schema and digest without entering the human or legacy
branches. Geography receives its own read state at route line 2627; metadata
records it separately at line 2727. The new tests inspect actual uploaded HTML,
stored HTML and metadata, including digest parity and two generation clocks.
They do not stub the route, strict reader, HTML renderer or canonical serializer.

## Evidence inspected and checks run

Read the complete implementation source/test diff, current relevant source,
implementation STATUS, evidence JSON, control driver, private runtime wrapper,
private Vitest configuration and accepted underlying receipts. Read the shared
reader, export payload, canonical serializer and geography projection helpers
as needed. Membership and workbook corrections are excluded from this disposition.

The independent receipt audit runs against retained files, without executing
Vitest, TypeScript, ESLint, a service or a database. It establishes:

- All 11 recorded file hashes match the implementation commit. All four changed
  report source/test files also match the reviewed integration head exactly.
  The shared strict reader and payload remain unchanged. Two disjoint preserved
  file hashes, project page and workbook route, differ at the integration head
  because their separately assigned corrections have joined it.
- All three final process receipt digests and the 101-test Vitest report digest
  match the implementation evidence. The retained report records 87 route and
  14 HTML tests passed, with no failures, skips or todos. These are inspected
  implementation runs, not fresh runs by this reviewer or combined-head checks.
- All 23 accepted mutation executions match their raw reports and process
  outcomes: 21 unique broken behaviors fail their named assertions, and two
  harmless comment executions survive. Both accepted campaigns start with the
  survivor. Restoration digests match the original implementation source.
- The classifier requires the selected test count and intended assertion text,
  rather than any nonzero exit. The rejected config attempt, stale first-upload
  clock assertion and wrong campaign-return mutation remain excluded.

The independent audit's own digest comparison has a harmless metadata survivor,
an intentionally wrong digest rejected with `retained digest mismatch`, and an
unchanged original in-memory sample and retained evidence bytes afterward. These
controls test the receipt comparison; they do not independently replay the
implementation mutations. The private directory retains the script and output.

`npm run product:direction:check` runs from nested `openplan/` and exits zero.
Existing registry/matrix expiry, package-version and intervening-change reminders
remain. A successful direction check does not refresh those records or lift a
release hold. Public evidence references and inspected source hashes are in
[evidence.json](evidence.json).

## Evidence limits and remaining boundaries

No decisive runtime probe is needed after source and retained-receipt review.
No test campaign, compiler run, build, installation, download, database transport,
fixture, browser, application service or provider operation runs in this review.
No push, GitHub review/comment, merge, tag, release, configuration or migration
change occurs. T3 administratively links PR330 to this review thread.

The database double makes projection omission observable, but it generates its
own PostgreSQL/PostgREST messages. This review does not establish actual installed
column sets, alias/quoting/localization variants, schema-cache behavior, RLS,
authentication or transaction consistency. Unknown message forms refuse rather
than produce an accepted partial artifact. Native message coverage remains open.

HTML assertions establish synthetic emitted text and custody, not browser layout,
390px use, accessibility, PDF typesetting, live Storage persistence, real downloads
or recipient acceptance. Receipt digests establish consistency with retained
records, not an independently observed rerun or authenticity beyond that record.
Parent-owned combined checks and whole-application checks remain separate.

Frozen V6 APP49 evidence does not accept this source. Candidate 420/latest17
versus hosted 418/latest15 remains the assigned promotion hold; this review does
not reverify hosted state or lift the hold. Canonical unrelated files, demo,
frozen packets, source database anchor, retained databases and other sessions'
processes remain outside reviewer writes.
