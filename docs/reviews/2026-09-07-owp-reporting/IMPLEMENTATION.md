# OWP reporting period, v0.45 candidate

Worktree: `work/owp-reporting`, based on `6c6ca59f`. Implementation uses this isolated checkout. Initial process attribution was wrong:
PID 183847 is this session's own ancestor, not another agent. Main remains untouched.

Implement the authorized period-administration plan in Programs, existing
time/spend records and Documents. Operational records and private cost
valuations remain separate from preparation. Periods bind an adopted revision;
issued snapshots retain their baseline, input versions and source cutoff.
Invoices and cash are separate measures, never additional incurred costs.

Verification uses the disposable `owp-reporting-verification` stack at
58321/58322, configured in
`/home/nathaniel/.local/state/openplan/owp-reporting-db`. No other database is an
authorized fixture target. Test actuals are explicitly synthetic. Retained public
EDCTC material supplies structure only, not actual agency spending or authority.

Required before release: full reporting/correction journey, private-rate and
source relationship enforcement, exact rollups beyond API page limits, worker
retry and real PDF/XLSX inspection, desktop/390px/keyboard/recovery acceptance,
mutation controls, applicable QA and upgrade checks, remote checks and retained
demo rollback. M11a and M2d.3 remain partial. This file is an implementation
record, not release evidence.

## Verified implementation checkpoint

Agency time, private cost rates, append-only valuations/allocations, source mapping,
CSV preview/import, opening coverage, independent progress/remaining estimates and
adopted-baseline period commands are implemented. Existing time/spend POST routes
accept explicit reporting attribution; unmapped legacy records retain their meaning.
The report aggregates its own cost ledger and never calls the older mixed
billing-plus-spending budget helper. Linking billing/cash references adds no cost.

The synthetic August journey entered member time, recovered an interrupted response
with the exact retained request, approved a private effective cost rate, imported
one valid CSV expense while rejecting duplicate/invalid rows, returned a report,
issued it and issued its corrected version. Period incurred cost is 80.01;
cumulative incurred is 180.01 including a 100.00 July opening balance. Commitments
10.01, billed 20.02 and payments 15.03 remain separate. Remaining cost 75.45 yields
255.46 actual-plus-remaining. Original report labor remains 50.30; corrected labor
is 62.88. All figures are synthetic, not EDCTC accounting or authority.

At this checkpoint: 13,265 application tests, 167 full live SQL checks and all 52
worker suites passed. Later focused tests cover source mapping, private storage,
indexing and worker retry. Eleven mutation cases include a harmless survivor and
ten expected failures; SQL tests include additional transactional source/member
mutations. A populated v0.44 predecessor with 268 migrations upgraded to 271;
seven nonempty predecessor tables retained their original fields and no actuals
were backfilled. Final QA, stamped browser acceptance and GitHub release checks
remain necessary after the last changes.

Private reproduction files are under
`/home/nathaniel/.local/state/openplan/owp-reporting-evidence`; credentials and browser
storage states must never be copied into Git. PDF/XLSX files contain only labeled
synthetic data. All ten corrected PDF pages were inspected. LibreOffice opened and
printed the workbook; worksheet visual review is continuing.

## Verification failures retained

The first interruption harness raced its own intercepted request; its synthetic
time was explicitly excluded with retained correction history. A second probe
reached the interrupted-response and retry assertions. A 390px overflowing period
button was found and wrapped. An initial PDF forced every small table onto a new
page; sections now flow. Workbook wrapping was missing and is now exercised by a
long-note continuation and OpenXML-style test. Keyboard automation originally
assumed a date field takes one Tab; Chrome uses four date subfield stops. The
corrected keyboard probe passed. Report denial is 404 (resource concealed), not
the harness's assumed 403. Truncated download refusal uses the actual saved-file
mismatch message. The final follow-up browser run recorded zero console errors.
Initial storage tests assumed a permissive kb-documents read policy; none exists.
A transaction-local permissive control now proves the new restriction can fail.
Unchanged source updates denied by RLS affect zero rows; tests now distinguish
that denial from a successful change. No test failure was removed to obtain green.

## Remaining scope

Internal management only. Funder reimbursement/RFR forms, fund-level claim
eligibility, payroll/accounting replacement, automated scheduling, closeout and
human usefulness remain unfinished. M11a and M2d.3 remain partial; nationwide
scientific claims and historical partial journeys are unchanged.

The first storage-write mutation survived because Supabase's pre-existing
statement-level delete protection denied the operation before the new row trigger.
That test did not prove the new trigger. The corrected probe also updates object
metadata, with a transaction-only permissive storage control, so removing the new
trigger is observable without bypassing the platform's deletion protection.

Final setup review found that existing staff APIs supported an account link but
the staff editor did not expose it. The existing Staff screen now uses the shared
team picker for create/edit, and reporting links directly to it. The actual staff
query selects the saved user identity; component and projection mutations detect
an omitted link or missing field. Opening balances with unspecified historical
hours now explicitly mark hour totals incomplete, rather than implying zero
historical effort. Final build/browser acceptance follows these additions.

The first stamped production staff-link edit failed with HTTP 400. Creation's
roster validation had already been repaired historically, but PATCH still queried
another person's membership through a self-only RLS client. PATCH now uses the
same checked service roster helper as creation. Faithful self-only query mocks
reproduce the original failure; reverting this fix makes the teammate edit test
fail. A separate mutation permits a foreign account and fails the refusal test.
The test account's unsuccessful relink is being completed through the corrected UI
before member time acceptance continues.
