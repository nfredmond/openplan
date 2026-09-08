# Contract reconciliation engineering acceptance

Scope is the user-approved v0.46 plan in IMPLEMENTATION.md. The release advances
M11a within Projects and Invoicing. It does not complete M11, accounting, funder
reimbursement forms, scheduling, closeout or human usefulness. The entire
assignment and all monetary records below are explicitly synthetic.

## Identified checkout and current status

Work began from main a0aed946, v0.45.0, in the isolated checkout
`/home/nathaniel/.local/state/openplan/contract-reconciliation-2026-09-07`.
Checkpoint 654d95b4 is pushed. Final production acceptance, GitHub checks, tag and
demo refresh are pending and will be recorded here separately. Main and its demo
were not used for fixture writes or mutated by the test suite.

## Exercised workflow

Real browser navigation created the workspace, project, client, contract, staff,
agreement document and deliverable. The contract is reachable from its project
and existing engagement register, and assigned tasks appear in My Work.
The original approved baseline was fee 1000, internal cost 500, hours 10. A
proposal did not change those approved totals. Approving its amendment changed
them to 1200, 600 and 12 while preserving original scope and evidence.

The browser entered split labor, nonbillable rework, CSV expense intake, documented
opening cost, a future commitment, partial payment and gross fee credit. Repeating
the CSV import produced one source. A member accepted a local invitation, linked
to a staff identity, entered and corrected draft time, and then saw its approved
state with editing disabled after owner review. Private valuation and owner notes
were absent from the member response and page. This journey found and fixed an
omitted nullable source field and stale member review status.

Correcting billed time from 2.00 to 2.20 hours retained the original invoice's
200 gross amount and 20 retention. A submitted save was interrupted before the
server; another was interrupted after an observed 200 response. Reload and exact
retry produced one opening source and one commitment. Two simultaneous database
billing commands produced one invoice, two split lines, one source attribution,
101 gross and 90.90 net. The losing command failed as already billed; retrying the
winning request succeeded without creating another invoice.

Final snapshot 10743383-1fb0-42c4-8f85-5530840f8c54 has source cutoff
2026-09-08T07:35:18.909Z and hash
7c7fea8f27a73573e4673a72c90b45fe900504573f23705df8572ed8fffac85e.
Its downloaded workbook and PDF reconcile:

| Measure | Synthetic amount |
|---|---:|
| Incurred cost | 249.50 |
| Future commitments | 100.00 |
| Documented payments | 75.00 |
| Gross-fee credits | 10.00 |
| Historical and current hours | 4.80 |
| Gross issued billing | 200.00 |
| Retention | 20.00 |
| Approved fee remaining after credit | 1010.00 |
| Remaining cost estimate, including future commitments | 400.00 |
| Actual plus remaining cost | 649.50 |

Task, staff, deliverable and contract sums agree in exact cents. The downloaded
XLSX has 18 sheets and 13 retained source-history rows. The 24-page PDF's overview,
financial tables, history and agreement evidence were inspected. Its complete
page contact sheet shows no clipped or blank content pages. LibreOffice rendered
the XLSX to 18 pages, with wrapping and each sheet fitting its print width. Wide
history sheets are intended for on-screen inspection; the PDF provides readable
print detail. The original CSV's bytes retain their original SHA-256.

A deliberately failed PDF preparation requeued the same job/document. The restarted
Documents worker completed it and the workbook. Stale/expired lease and private
indexing refusal are covered by live SQL tests. Earlier issued snapshots and
files remain unchanged after the amendment and corrections. The first workbook
had a real formatting defect, discovered by rendering; it remains historical
and a new immutable snapshot uses the corrected shared formatter.

## Database and regression evidence

The populated v0.45 upgrade applied all eight additive migrations and preserved
original time, spending, invoice, OWP actual and OWP revision JSON byte for byte.
Before/after SHA-256 was
944920f37e2e8652865c3482b56b5611a4b42fa3f14ad55ccd732d53b20da4ec.
19 contract/catalog checks passed on that upgraded stack. Later member-projection
and source-departure trigger refinements require final fresh CI migration proof;
the isolated live stack received the equivalent function/trigger changes.

Full QA passed at the preceding checkpoint, including lint, deadcode, 13,291
unit tests, dependency audit and webpack build. All 52 Python worker suites
passed using their respective installed environments. The latest complete live
run passed 186 checks across 24 suites; a subsequent contract export-recovery
check passed in a focused 17-test run. Final current-source counts are pending.

Independent review found defects rather than treating green tests as acceptance:
issued-line appends, historical cutoff/currency ambiguity, OWP drift, mutable
agreement and parent relationships, incomplete budget reconciliation, duplicate
payroll, deleted/moved legacy sources and timestamp-based estimate selection.
Fixes have targeted database or unit regressions. Private table probes use
populated rows, not empty-policy checks. Aggregation covers more than 1000 records.
Harmless and targeted mutation results will be retained alongside this note.

## Boundaries

Synthetic browser actions establish engineering behavior, not responsible human
approval, external payments, accounting completeness or usefulness to planners.
Remaining estimates depend on the issuer's source coverage and assumptions.
Source keys cannot prove that two differently documented external records describe
the same real event. Overlap review therefore requires explicit evidence. Legacy
net receivables keep their existing whole-invoice semantics; partial cash is
separate contract management evidence. Scientific models and historical partial
whole-product journeys were not regraded or promoted.
