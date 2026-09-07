# Round 4: existing-main compatibility and staffing arithmetic

Review boundary: read-only source analysis against canonical main commit `86cb4aa0ee0fc9a05118b9b8d7c2e934b502fa13`. Files reviewed are retained under `main-86cb4aa0/` and `current/`; hashes are in `sha256.json`. No database access, process operations or source changes were performed. The parent reported that migrations 20260907000001–00004 had already been applied by predev and that the three new record categories were empty. Those state claims were not independently verified here. The later additive 00005 repair is outside this snapshot.

## Compatibility conclusion

No immediate existing-main route break was identified in the four migrations. This is a bounded source compatibility assessment, not evidence that the installed database has these exact function bodies or that an old-build browser journey passes.

- `20260907000001_document_extraction_recovery.sql:2–7`: additions to existing OCR job/receipt tables are nullable or have compatible defaults. Main's Documents intake, OCR request and OCR callback routes continue writing their existing columns; they do not call the new extraction RPCs or populate the new immutable extraction table.
- `20260907000002_work_program_extraction_versions.sql:2–29`: replacement attachment RPC preserves its signature, return type, membership requirement and known-page-count path. The manual-review alternative broadens the unknown-page-count case. The source version table and its RPC are additive.
- `20260907000003_work_program_preparation_references.sql:6–73`: replacement save RPC preserves its signature, revision locking, request retry behavior and old schemaVersion=1 envelope. Existing main payloads omit preparation; the added staffing/amendment/cost loops become empty arrays. Existing source references still belong to the saved program. Main's work-program route already handles PT409 conflicts (`main-86cb4aa0/.../work-program/route.ts:44`), so that SQLSTATE does not introduce an HTTP-status regression.
- `20260907000004_work_program_export_custody.sql:2–25`: ordinary existing Documents rows have both new export identity columns null. They satisfy the paired-null constraint, lie outside the partial unique index, and bypass the retention trigger's immutable/delete branches. Existing jobs get job_kind=extraction. Main does not invoke the new export RPCs.
- New extraction/version foreign keys can restrict deletes only when dependent rows exist. Given the parent's reported empty new tables, they do not establish an immediate old-data delete failure. Applied earlier foreign-key bodies may differ from the snapshot; 00005 must reconcile actual installed definitions without assuming that changing an already-applied migration reruns it.

## Staffing results

The application now correctly separates period capacity from hours per FTE/person-month. Independent execution of the snapshotted reconciliation code checked eight cases: 12 person-months x 160 hours gives 1,920 hours (not 23,040); missing conversion stays unresolved; two half-cent examples round once to 0.04; scientific notation retains its scale; unsafe totals remain unresolved; same staff with different role labels groups together; differing overlapping periods remain unresolved.

`staffing-probe.cjs` / `staffing-results.json` record the evidence. A harmless comment mutation survived. Replacing conversion with period capacity failed at 23,040 vs 1,920; restoring binary floating-point rounding failed at 0.03 vs 0.04; removing the overlap finding failed its assertion. These are synthetic arithmetic fixtures, not planning records. The probes do not exercise schema parsing, live SQL, UI wiring, or a spreadsheet calculation engine.

## Open finding: workbook capacity checks disagree with the application (P2)

`openplan/src/lib/programs/work-program/export-structured.ts`, staffing W formula and cached value near line 96, versus `reconciliation.ts:86–101`:

1. App groups a known staff member by staffId regardless of role label. Workbook SUMIFS additionally groups by role E. Two 1,120-hour rows for the same employee with different role text and a 1,920-hour capacity are Overallocated in the app and cached workbook, but the written formula evaluates each role separately and yields Within stated capacity after recalculation.
2. A differing overlapping period produces `staff_overlap_unresolved` in the app, while the actual generated W cells say Within stated capacity.
3. Conflicting capacity assumptions similarly produce `capacity_conflict` in the app but Within stated capacity in generated W cells.

`workbook-capacity-probe.cjs` / `workbook-capacity-results.json` reproduce the actual exported cells using the real exporter and XLSX library; only source selection is stubbed to an empty source set. Formula execution was not performed. The unresolved-items sheet retains the app findings, but the staffing table itself makes an inconsistent positive capacity claim.

Smallest repair: use staffId as the grouping identity when present, otherwise role; represent overlap and conflicting assumptions as Unresolved in both cached and recalculated W cells. Keep numeric sums separate from capacity assessment, and add a recalculation parity fixture.
