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


## Final production acceptance

Application and browser build: `6c50861e5c3e9fc72ceff7b06f1defc50adb7d1a`,
version 0.45.0, production server on localhost:3300. `which-openplan.sh`
matched its process cwd and served SHA to this isolated worktree. The database
was the disposable `owp-reporting-verification` stack, API 58321, not the demo.

The journey entered from My Work and Programming Cycles. The owner used the
visible staff-account picker to unlink and relink the synthetic member. That
member entered agency time without a contract, lost the save response after the
server committed it, reloaded, and retried the retained request without duplicate
cost. The owner approved the selected effective cost valuation, reviewed a
period against adopted revision 1, and issued actual downloaded PDF and XLSX.
Previously exercised CSV preview/import, opening balance, split allocation,
non-cost billing/payment records and the later adopted amendment remained in
this source register. The final report deliberately retained baseline 1 after
revision 3 had been adopted.

The owner corrected 2.00 hours to 2.01, recorded the reason, started a corrected
period version, advanced its cutoff, reviewed, returned, reviewed and issued it.
The original snapshot hash and 50.30 labor valuation stayed unchanged; the new
valuation is 50.55. Both artifacts reconcile independently across element,
task, staff and source views, including known hours:

| Measure | Original | Corrected |
| --- | ---: | ---: |
| Period incurred | 130.31 | 130.56 |
| Cumulative incurred | 230.31 | 230.56 |
| Remaining estimate | 75.45 | 75.45 |
| Actual plus remaining | 305.76 | 306.01 |
| Commitments | 10.01 | 10.01 |
| Billed | 20.02 | 20.02 |
| Payments | 15.03 | 15.03 |

The worker probe queued both corrected formats, temporarily removed the
synthetic requester's owner role while retaining another synthetic owner, then
ran the real Documents worker. Final custody failed while rendered and uploaded
bytes remained retained. Restoring the owner and preparing again reused the
same job/document identities. Downloads matched cached SHA-256 and cache file
modification times stayed unchanged. Member downloads were denied. The initial
probe correctly hit the existing last-owner guard; no guard was disabled. Its
first download harness also timed out before observing completed worker state;
the resumed probe awaited actual job completion, then downloaded both formats.
This was a harness timeout, not evidence of a lost report.

The interrupted-save run recorded exactly the injected network failure. The
correction and retry follow-up recorded zero console/page errors. Desktop and
measured 390px screenshots are retained; document width was 390 and checked
inputs/buttons did not overflow. Keyboard navigation and truncated-file refusal
are separately retained in `correction-verification.json`.

Both 11-page PDFs were rendered and every page inspected. The corrected XLSX was
opened by LibreOffice and all 16 printed sheets inspected. Summary sheets are
readable; wide source/history sheets scale small when printed, so the documented
PDF is the print copy and XLSX supports on-screen filtering. Files retained here
contain only labeled synthetic actuals, never EDCTC's actual spending or authority.
Independent workbook aggregation matched every cent and hour; a harmless comment
survived its checker and a one-cent expected-total discrepancy failed.

Local full QA passed at 8d4ef3ef with 13,267 application tests and 170 isolated
live SQL tests, lint, dependency audit with zero reported vulnerabilities, and
webpack build. Later additions passed their focused tests: staff linking,
unknown opening hours, opening-period boundary and staff PATCH roster validation.
The final application webpack build passed at 6c50861e. The 52 worker suites
passed. Final migration code passed GitHub Upgrade Path run 34185268170 at
0f246d28; later commits did not change migrations. Populated local upgrades also
preserved v0.44 source records from 268 to 271 migrations.

These checks do not establish an agency's accounting completeness, human
usefulness, funder acceptance or real spending authority. Mocked projection
checks do not replace live relationship/RLS tests; synthetic SQL fixtures do not
prove all agency data shapes; mutation controls cover stated failure categories,
not every possible defect. M11a and M2d.3 remain partial. Merge, final GitHub
results and local demo promotion are recorded in the release receipt separately.


The installed demo's existing program has no saved preparation revision. Its
empty state correctly requires preparation before actual attribution. The first
read-only probe expected an existing revision and was corrected to inspect that
starting state. A second check found a real setup-link omission: the program's
workspace was absent from the staff URL. A multi-workspace account therefore
reached the workspace chooser instead of its program's staff register. The link
now carries the authorized program workspace explicitly. The earlier isolated
single-workspace journey could not reveal this defect. A rendered-link regression
covers two different workspace identities, and final demo acceptance repeats the
multi-workspace navigation before tagging v0.45.0.

The follow-up staff-register inspection also found agency time labeled as an
unknown contract, with the older inline edit/remove controls. Database guards
already refused changes to mapped time, but those controls led to a rejected
operation. The register now identifies agency work and links mapped entries to
OWP corrections, including billed sources whose invoice restrictions still
apply. Its query explicitly selects the work-program identity. Contract-only
entries retain their existing controls. Component tests and projection/control
mutations cover the corrected behavior; no ledger or migration changed.
