# v0.49.3 write outcomes and serving identity

Base main `d87a04d4`; checkout
`~/.local/state/openplan/write-outcome-truth-2026-09-10`.
Own files: shared HTTP write-outcome helper and its existing callers/tests,
serving identity helper and ops tests, dated evidence. No other session edits
observed. Pending reminder constraint, permissions and scientific methods stay
unchanged. This extends A1a integrity work; no new application module.

## Completed identity checks

`which-openplan.sh` accepted an unknown commit from any same-checkout process,
calling a production build live development source. The new local process probe
requires this application's actual `next dev` launch chain before making that
exception. It reads listener PID, working directory, command arguments and start
identity; it does not read process environments or credentials. Missing, changed,
ambiguous or remote process identity cannot acquire the dev exception.

Five Python tests pass. A harmless comment survives; treating start as dev,
accepting remote lookalike URLs, selecting ambiguous listeners or ignoring reused
PID identity fail the intended assertions. Logs were inspected for those failures.
A disposable local HTTP listener in this checkout is refused when unstamped and
accepted with the matching commit. Restoring the old shortcut causes the unsafe
unstamped acceptance again. This is process/claim evidence, not authenticated
attestation against an adversarial process or proof of a built artifact's bytes.

A real Next16.3.4 development server at port3277 was recognized as `nextDev: true`;
health answered commit unknown and the helper accepted its verified source path.
This server belongs to this task. No unrelated listener was stopped or changed.

## Write-outcome repair underway

The preceding [live PostgREST probe](../2026-09-10-assistant-audit-outcomes/postgrest-probe.json)
shows that both zero-row and multi-row singular-response errors can leave no saved
row. INSERT with representation also rejects an unreadable row instead of silently
committing it. The old shared helper nevertheless answered `created:true`/201.

The replacement `unconfirmedInsertResponse` answers500, claims no creation and
asks the caller to inspect saved state before retrying. Existing measure/RTP
callers use it. Zero-row classification now requires explicit zero-row details;
missing details and multiple rows remain errors. Manual VMT determination
persistence had its own copy of the same unsupported fallback; it now uses the
shared response. No numerical computation, framework selection, claim tier or
model validation criterion changed.

The VMT positive mock previously returned no row and passed only because of that
fallback. It now returns the inserted synthetic row with database identity/time;
positive tests check a returned screening ID, while missing-result tests remain
separate. Focused shared/route checks are underway. Broad tests are an exploratory
regression scan, not final evidence while edits continue. Some existing fixtures
omit PostgREST cardinality details and may need correction to the observed shape.

Still required: complete affected route and UI coverage, meaningful failure probes,
full QA/shuffled checks on final source, browser navigation at desktop/390px,
release metadata and final CI/upgrade before publication. v0.49.2 at base main has
its own running CI and must be released when those declared checks pass.

## Regression and mutation checkpoint

The first broad scan failed26 checks (19 files). Twenty-three expected explicit
zero-row outcomes but omitted the cardinality details that distinguish zero from
multiple rows; fixtures now carry the exact observed `The result contains 0 rows`
shape. Their existing refusal/status assertions were retained. Three VMT successes
relied on the old created-without-row fallback; the corrected positive mock and
returned-ID assertion resolve that false confidence. Twenty-one focused files now
pass398 tests. This scan preceded the corrected fixture checkpoint, so it is not
reported as final full-suite acceptance.

A harmless shared-helper comment survives. False201 creation, ignoring cardinality,
misclassifying explicit zero rows, the VMT false-created fallback and removal of
its INSERT projection all fail intended assertions. The initial projection probe
modified the GET occurrence and survived: read-query projection coverage remains
a separate gap. The corrected probe targets `.insert(row).select(...)` and is
caught by an exact projection assertion. The mutation runner now refuses unchanged
mutations before launching tests.

The VMT change only alters persistence-result reporting; its arithmetic, engine
choice, source evidence and jurisdiction/tier gates stay intact. Missing rows and
malformed returned rows cannot acquire a saved determination claim.

## Editor compatibility correction

The horizon editor also accepted the legacy201/no-record payload, closed the
form and asserted creation. It now keeps the form open and asks the planner to
check saved state. Eighteen focused editor/copy tests pass. A harmless comment
survives; disabling the legacy-response refusal fails because the alert disappears.
This client check cannot establish database persistence or network delivery.
The current500 server response still uses the existing error/form-retention path.

v0.49.2 was published after its declared final CI checks passed; its publication
receipt is in the preceding audit-outcome evidence directory.

## Final-source QA checkpoint

At f55226eb, lint/deadcode,13,477 tests in1,232 files, shuffled seed914094
with the same counts, and dependency audit passed. Both test runs explicitly
skip33 files/299 tests; live RLS is a separate isolated job. All92 ops Python
tests pass. The production compiler passed, then TypeScript caught four fixture
errors across three files because their mocked error types omitted `details`.
Those mock types now accept optional details. This is not a completed build;
the corrected production build and browser journey remain required.

## Browser findings and correction

Production ad8aecfe at3277 passed both adverse saves, retained form values,
keyboard submission and normal database-backed save at1440px/390px. The first
harness expected201 from the normal route, which actually returns200. That save
created period25367376-a8e0-45ae-b031-e532ffcc1020; it was preserved. The repeated
desktop case used2036–2046 rather than duplicating its2026–2035 baseline. Mobile
started empty. Failed/suppressed attempts retained no rows; normal attempts each
retained exactly one. Only the expected500 appeared in console/network errors.

Screenshot inspection then exposed a separate narrow-layout defect: the financial
table's intrinsic width expanded the RTP page grid to594px inside a292px content
area. The form fit, but saved text and controls were clipped. A browser CSS probe
using one minmax(0,1fr) track reduced the page scroll width to292px. The RTP detail
page now explicitly uses that one-column track. This is scoped to RTP detail;
it does not claim all module grids are repaired. Final rebuilt layout verification
is pending, so the earlier successful interaction is not complete mobile acceptance.


## Final browser and release evidence

The rebuilt production edc03864 is positively identified at3277. At1440px and
390px, real sign-in and Regional Plan navigation reach the saved periods. The
narrow editor shows its full text and Add/Edit/Remove controls. Keyboard editing
and cancellation preserve rows. Actual trigger-suppressed saves answer500, retain
form inputs and leave the complete baseline unchanged. Control saves from the
preceding ad8aecfe production build each retained one row; the only subsequent
product change is RTP grid sizing. Final baseline is two non-overlapping desktop
periods and one mobile period. Screenshots were opened and inspected.

The layout guard initially measured a hidden panel during navigation and falsely
accepted zero width. It now waits for a visible panel and requires nonzero width.
A harmless CSS comment survives. Restoring the automatic grid track makes the
390px guard fail, then removing that mutation restores the pass. The broader
control probe also sampled before scroll completion; the corrected probe scrolls
each visible enabled financial control into view before measuring. All sampled
controls are reachable. This does not prove contrast, screen-reader behavior or
all financial planning outcomes. The former failed measurements remain in local
scratch logs; they are not reported as successful verification.

Final product build at edc03864 passes. The preceding complete suite/shuffle,
89 focused tests after fixture type corrections,92 ops tests and final browser
records support the declared changes. Live RLS, worker and populated upgrade
checks are required on the final pushed release commit before tagging. Their
GitHub receipt will be retained separately. No human review gates publication.

Blind categories remain: exact VMT GET projection coverage, durable assistant
effect/audit recovery, real agency usefulness, prescribed reimbursement forms,
provider expansion and the full independent scientific/v1 contract. No reminder
constraint or scientific method changed. Browser fixtures are explicitly synthetic
and restricted to the owned disposable restore target at API22301.
