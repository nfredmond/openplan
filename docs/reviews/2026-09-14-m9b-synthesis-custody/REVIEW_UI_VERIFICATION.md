# Retained review editor verification in progress

September 14, 2026. This is an implementation checkpoint, not browser acceptance or a release. Main remains 09c1cd17 and v0.61.1 remains the latest published release at the last remote inspection.

The editor connects source selection to private retained staff reviews, full notes, reasoned membership/wording changes, earlier versions and browser-local unfinished edits. Exact pending commands survive interrupted acknowledgement and can be retried without changing identity. An unavailable browser store prevents transport; the newest on-screen text can be preserved alongside the older stored copy. Quota-failed text is not guaranteed durable across reload. Source history identifies unfinished local reviews. Exact-output approval, optional generation, response/decision links and reviewed exports remain required by IMPLEMENTATION_BOUNDARY.md.

## Completed evidence

- Focused editor/recovery tests: 23 passed on e01a7781. The 38-case mutation record includes baseline and harmless controls, and targeted faults fail for their stated behavior. The only subsequent editor change replaces the access-loss message's internal word campaign with consultation.
- Full worker run: all 52 suites passed, none skipped. Unchanged worker code was exercised under each worker's own environment.
- New integration proof: 15 tests pass at baseline and with a harmless comment. Removing each of eight SQL-reader classifications, reintroducing the copy regression or removing the migration notice causes exactly the corresponding test to fail. All 12 cases matched and exact source hashes were restored. These classifications document actual read/list/retain RPCs; the identifier scan cannot itself prove SQL behavior. Native custody and the production server/RPC join supply separate evidence.
- The full QA attempt found three failures among 15,490 executed tests: undocumented SQL-only column names, one added internal term in visible copy, and migration 27 absent from Unreleased. All three were corrected without relaxing their guards. The failed log is retained privately as review-full-qa-first-failed.log. QA must finish again before landing.

## Runner errors and remaining checks

The first integration proof result parser looked for an actual column name inside Vitest's JSON failure message, which omits the assertion diff. The correct test failed, but the proof rejected its report. The parser now requires the exact failing assertion, exactly one failure and 14 other passing tests. The original log remains review-integration-parser-failure.log. A focused UI invocation accidentally used repository cwd instead of the application package and discovered no runnable tests; the corrected application-cwd run is separate. Neither is application failure evidence or a pass.

Full installed isolation is running against supabase_db_openplan-restore-target-2026091050 at API 29821/DB 29822, 346 installed migrations. No candidate migration flags, reset, paid provider or other session's database is involved. Full corrected QA, shuffled order, identified desktop/390px browser checks, actual two-browser correction races and applicable upgrade checks remain pending. The browser scripts are prepared but not yet executed against this implementation.

The next browser check must establish serving checkout and commit with which-openplan.sh. Browser scripts use fresh Chrome contexts and synthetic records created by earlier real navigation. Private logs/captures live under /home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/. Public manifests contain checksums, not credentials or private source text.
