# M2d.3 reporting and reimbursement cycle

Started September 9, 2026 from main e3efcb6e. Engineering in `work/m2d3-reimbursement`, isolated checkout `/home/nathaniel/.local/state/openplan/m2d3-reimbursement-2026-09-09`.

Ownership: work-program reimbursement library/UI/API, additive migration, related report export changes and focused verification. Other running app checkouts remain untouched.

Extend issued internal period reports with separate reimbursement packet versions. Retain approved source identities, eligibility evidence, fund/vintage shares, narrative and deliverable evidence. Database transactions reserve each physical source across packets and programs in a workspace. Return does not release a reservation. Correction replaces the current packet version while retaining all historical packets and event receipts. External submission and acceptance are evidence records entered by authorized humans, never actual transmission.

Use existing private management report storage and Documents workers. Packet report kind must remain separate from management correction numbering and lists. Missing funding authority, prescribed form review and eligibility are blockers, not implied by adoption.

Disposable database: m2d3-reimbursement-verification, explicit workdir `/home/nathaniel/.local/state/openplan/m2d3-verification`, API 58821, database 58822. No demo or M11 fixtures are test targets.

M11 human acceptance and reminder approval remain open and separate. No release, human usefulness, agency eligibility or filing compatibility is established by this starting note.

## Verified checkpoint; final build/artifact review pending

The live SQL cycle now has 11 adverse/positive tests. The full isolated suite passed 250 tests in 39 files. All 52 Python worker suites passed using each worker's existing matching environment from the canonical checkout; the worktree contains only ignored environment symlinks. The first worker invocation correctly failed because those environments were absent. The full unit suite passed 13,420 tests before final contract/export refinements; final QA is running.

A complete synthetic browser cycle saved, reviewed, submitted, returned, corrected, resubmitted and accepted command versions 1–8. Original request 10.00 plus match 2.35 became request 9.00 plus match 2.35 after excluding 1.00 from the unchanged 12.35 source. A blocked network request survived reload and exact retry as one resubmission receipt. Both original and corrected PDF/XLSX files downloaded. Final layout inspection and post-build confirmation are still in progress at this checkpoint.

The shared M11 SQL case retains one 25.00 expense alongside 12.35 staff effort, resulting in cost 37.35, request 30.00 and match 7.35. It retains the matching approved contract valuation and deliverable. Correcting OWP without reconciling M11 is refused without partial reservations. No invoice is created.

The older contract tests assumed a particular M11 workdir name. The test-only target helper now permits the exact named M2d.3 disposable container as well as the previously allowed M11/restore/Actions targets. It rejects the ordinary local/demo database. No M11 acceptance fixture or running app was used for these tests. Initial name-guard refusals were not reported as product failures.

Mutation results are retained in `sql-controls.json` and `typescript-controls.json`; both include a harmless survivor. The initial narrow missing-fund mutation survived because a separate null-date guard caught it. The corrected whole-predicate mutation fails for the intended foreign-fund reason. The first agent-refusal mutation hit an unconfigured mock writer instead of the intended assertion; configuring a valid writer makes that mutation fail on the expected 403 response assertion. No guard was removed to manufacture a passing suite.
