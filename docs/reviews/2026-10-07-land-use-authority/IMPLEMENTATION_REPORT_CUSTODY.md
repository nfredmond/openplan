# Implementation reports keep their saved history

October 7, 2026. Source and production build `d3815893` continue the
[report-map checkpoint](REPORT_MAPS.md). This is an unreleased M1/M2 increment.

## Problem and correction

The implementation-report page previously rendered its artifact without checking
it against the append-only implementation register. It also used current plan
labels. A report could therefore show altered artifact content or later plan
identity while still appearing to represent saved implementation history.

The reader now checks the report kind, workspace, plan, register pointer, saved
hash, summary, reporting dates and complete action snapshot. It then verifies the
original adopted version's identity, context and canonical content hash. Later
superseded and repealed editions remain readable when their retained evidence
agrees. Missing, malformed, mismatched or unreadable evidence produces an explicit
refusal. It never substitutes current action statuses or current plan labels.

The historical producer hashes insertion-order JSON. PostgreSQL jsonb does not
preserve that key order. The reader compares the retained hash and complete native
payload instead of claiming to recompute that historical hash. The adopted plan's
canonical hash remains independently checked. The tests deliberately reorder
keys so a new serialization rule cannot silently reject valid older reports.

The report now shows the responsible party and last action update retained when
it was generated. Missing responsibility says "Not specified." The creation form
says "Implementation report title," since its reporting period need not be a year.

## Tests and controls

[137 tests in five report/copy suites](implementation-report/focused.log) and
[14 workbench/copy tests](implementation-report/workbench-focused.log) pass.
TypeScript, changed-file ESLint and the identified production build pass. An
initial test import names a nonexistent utility and fails before that suite runs;
the corrected test imports Testing Library directly. That attempt remains separate
from the passing checks.

The [control run](implementation-report/controls/report.json) passes its baseline
and harmless-comment case, then fails 34 targeted faults. These include inferred
missing plan identity, altered report scope, invalid statuses/dates, unexpected
private fields, ignored native read failures, wrong native identities and hashes,
lost projections/filters, changed snapshots, key-order-sensitive comparison,
omitted responsibility/update fields and missing disclosures. Restoring the
original unverified rendering path also fails. Source bytes restore after every
case.

These are mounted components with projected database mocks. They do not prove
live cross-workspace isolation, native historical editions, concurrent reads,
print output or practitioner understanding. The shared report page and map tests
remain part of the regression check. No schema or database policy changes here.

## T3 creation and later status change

The [owned server](implementation-report/server-status.json), its process cwd and
`/api/health` identify `d3815893` in the isolated checkout. T3 follows the actual
plan-list card, completes the existing implementation-report form and follows its
new readable-report link. Native reads before submission find no implementation
report for this synthetic plan. The source action is "not started."

T3's type tool fails three times on native date inputs. The same T3 preview sets
those inputs through their native value setter and input/change events, confirms
form validity, and submits the actual button. This is not date-picker or keyboard
date-entry acceptance. The [desktop form](implementation-report/formDesktop.png)
and later [390px form](implementation-report/formMobile.png) remain visible
without measured horizontal overflow.

The exact proposed creation body is retained before the click. Browser performance
evidence shows one creation response, 201. Native reads then find one report,
one artifact and one append-only implementation entry. No uncertain creation is
repeated. The report states that the synthetic fixture claims no agency assessment
or completed work.

T3 returns to the workbench and presses ArrowDown once in the focused action-status
control. The response is 200 and the [current action](implementation-report/currentStatusDesktop.png)
changes to "in progress." Returning through the report link still shows the saved
"not started" status, original update time and responsible party at
[desktop](implementation-report/reportDesktop.png) and
[390px](implementation-report/reportMobile.png). The saved plan context and source
hash also remain visible. Both report widths have no measured horizontal overflow.

A fresh 2,008-byte source download matches the native artifact and implementation
register. The [comparison](implementation-report/implementation-report-download-verification.json)
confirms that the report, artifact, register and both plan versions remain unchanged
after the current action update. Harmless key reordering passes. Changed saved
status, responsibility, timestamp, reporting date, adopted hash, substituted current
status and changed displayed status/time fail their comparisons. Raw native
records and the downloaded file stay outside git.

The [browser summary](implementation-report/browser-summary.json) records the two
requests with native fetch unmodified. No new console error appears during this
journey. It retains the earlier startup, observer and deliberate map-refusal errors
and the tool's omitted diagnostic categories. This is not a complete network audit.

The build runs alone under an 8 GiB limit and completes in about 65 seconds. The
server peaks at 221,773,824 bytes, exits normally after T3 navigates to health, and
leaves port 3498 clear. The earlier active-report shutdown timeout remains open.
Protected BCA, engagement and demo processes remain untouched.

## Integration and unfinished production workflow

PR #127 now passes QA, shuffled tests and four worker/script checks. Its live RLS
and archive restore still run. PR #128 retains its own active CI results. This
branch includes both and requires its own exact-head checks before landing.
This evidence does not declare a release, M1 completion or V1 acceptance.

The producer still reads the adopted version and actions, then separately inserts
the report, artifact and native register entry. An interrupted or failed final
insert can leave an incomplete report. It has no exact-request replay receipt.
The new reader refuses that incomplete state; it does not repair creation
atomicity or recovery. The next producer correction belongs in the existing
implementation-report workflow, with one scoped transaction, explicit request
recovery, concurrency and permission-change checks, and ordinary form navigation.

The raw provenance endpoint is unchanged. Page refusal does not independently
verify a direct source download from a damaged artifact. Export verification,
creation recovery, native historical/foreign-workspace cases, date interaction,
print/PDF and practitioner acceptance remain open. No legal applicability,
completion-of-work or scientific claim changes. [Artifact hashes](implementation-report/sha256.json)
preserve this checkpoint.
