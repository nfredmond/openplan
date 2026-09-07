# Round 6 independent review: source parser and required match

The assigned parser and match-calculation cases pass after the fixes identified during this review. This is a bounded implementation review, not whole-product acceptance. An adjacent allocation duplicate-count formula defect remains with the artifact review lane as of this snapshot.

## Correction to earlier spreadsheet verification

My initial LibreOffice `--convert-to` workflow did not force numeric formula recalculation. A diagnostic that set every formula cache to -999 retained -999 in numeric result cells after conversion. Therefore the earlier round5 numeric rate statement and initial round6 numeric match conversion were stronger claims than their evidence supported. I disclosed this to the root and artifact reviewer before issuing this report.

The corrected `recalculate.py` starts a separate LibreOffice process with a random private pipe and scratch user profile, loads each workbook, explicitly invokes UNO `calculateAll()`, saves to a separate output directory, and terminates its own process. It never attaches to an existing user's office session. This repaired poisoned ROUND(5*0.7/100,2) to 0.04 and its dependent reference to 0.04. Evidence: `rounding-diagnostic-results.json` (insufficient conversion), `rounding-forced-results.json` (actual recalculation), and the original/forced diagnostic XLSX files.

All 42 round5 staffing/rate fixtures were then rerun with calculateAll. Baseline/no-op pass all seven cases; all four capacity mutations still fail their corresponding check; the valid numeric rate result 56,000 is now confirmed by explicit recalculation. Evidence is `match-fix/rate-capacity-forced-results.json` and `match-fix/rate-capacity-recheck/`. This supersedes the numerical-method claim in the round5 report without erasing its history.

## Match calculations and workbook formulas

Final snapshotted application reconciliation: `match-fix/current/openplan/src/lib/programs/work-program/reconciliation.ts`, SHA-256 `17428efd2724db62396c55bf8c69eca486bd9e306c56eacad421174f88509215`.
Final snapshotted workbook exporter SHA-256: `f163443e8e0fec7e5e607efbc1edbaa0a1bce342480a4b43d8bcd66fcad82671`. Hashes and sources are retained under `match-fix/`.

Fourteen synthetic cases were independently executed against both the actual application reconciliation and actual XLSX exporter, followed by full LibreOffice recalculation:

- Explicit required amount.
- Percent of funded amount.
- Percent of total cost.
- Missing applicability note.
- Missing supporting source.
- Missing contributing match amount.
- Self-match.
- Match supplied from a reference-basis fund.
- Match supplied from prior-authority fund.
- Missing funded amount for a percentage requirement.
- Explicit evidence-backed match not required.
- Invalid 100% total-cost share.
- 0.7% of 5.00: required match 0.04.
- 12% total-cost share on 0.11 funded amount: required match 0.02.

All final cases agree between expected values, application, and fully recalculated workbook. Evidence: `match-fix/match-recalculated-results.json`, `match-fix/xlsx-input/`, and `match-fix/xlsx-forced/`. Only source-list selection was stubbed to an empty list for workbook generation; the fixtures explicitly label their source facts synthetic. Database permissions and source validity were not tested by these arithmetic fixtures.

The initial percent implementation divided in binary floating point before invoking the rational multiplier. It returned 0.03 and 0.01 for the two exact half-cent cases above. The fixed helper retains the percentage numerator/denominator and divisor until final cent rounding. The original failures remain in `match-results.json`; `match-fix/percent-control-results.json` proves a harmless comment survives and restoring premature binary division makes both half-cent cases fail again.

For the broader guard tests, harmless comments preserve all 14 outcomes. Removing evidence checks makes missing-note and missing-source cases fail in both application and recalculated workbook. Removing self-match protection makes that case fail in both. Mutation evidence is included in `match-fix/match-recalculated-results.json`. These checks do not establish the legal applicability of any real grant match requirement or exercise the live save/export routes.

## Source parser and proposal copying

Retained originals were copied to scratch and hashed before parsing:

- FY2025/26 Amendment 2: 67 PDF pages, SHA-256 `ed7f756c09a5808682957f56845fd19fd847e7f2af409e1098f37b26b8af3bd8`.
- FY2026/27 Final: 65 PDF pages, SHA-256 `8502d3b405257992912d867eeafe97a23b4ae1a8c798a36e7efa872d18ac8a11`.

The parser consumed independently generated `pdftotext -layout` output. Original current PDF page20 and prior PDF page25 were also rendered and visually inspected to verify the wrapped task dates and differing schedule/staff-header placement. Poppler printed `Can't get Fields array` for the retained PDFs, while extracting all 67/65 pages and successfully rendering the inspected pages; form-field integrity is not established by this review.

Initial defects reproduced from the actual PDFs:

1. Prior WE122 PDF25 has Staff Responsible above Completion Schedule. The same-line assumption returned empty role and schedule.
2. Current WE100 PDF20 wrapped dates and multiple leader lines left schedules empty or contaminated with dots.
3. Current WE122 task6 included its page footer and next-page document header in its description, leaving its printed schedule unparsed.
4. Single-dot or no-dot schedules after an explicit role qualifier remained in descriptions, including prior WE200EIR PDF35 task4 and current WE130/WE300 tasks.
5. Prior WE200EIR task4 explicitly identifies Consultant, but proposal copying assigned the overall work-element Executive Director/Transportation Planner role to that task.

Root corrected independent header lookup, column slicing, header/footer removal from parsed body while preserving retained original text, wrapped-line and leader handling, explicit task role selection, and role-qualified single/no-dot schedule handling. Final parser snapshot hashes under `parser-final/` are:

- source-extraction.ts: `faf48c0121e9a8c7cb899e55da2259225b8e589d4cbfa56d294bc8d1b64e7e41`
- source-review.ts: `5568220bca6dbd7736a0ca364b894ca2aa4cfbc2c11f942c6f7624f363101e62`

All 21 final source assertions pass. These cover 16 predecessor and 14 current element counts, numbered task/product splitting, printed work-element dates/roles, wrapped task dates, single/no-dot schedules, explicit Consultant responsibility, and two prior WE263 products whose absent schedules must remain blank. The expanded scan is preserved in `parser-final/all-elements.json`; it is not an exhaustive manual transcription audit of every phrase. WE50 has no printed element schedule/role table in the inspected source and remains blank in those fields.

A harmless comment preserves all outcomes. Disabling schedule-header extraction, disabling numbered splitting, removing fallback schedule handling, and ignoring explicit task role each fail the intended source assertion. Evidence: `parser-final/parser-control-results.json` and its scratch script. Earlier failures remain under `sources/`, `parser-control-results.json` and `parser-fix/`.

The parser recognizes this public EDCTC layout. Other layouts retain the existing explicit manual-review fallback. This review does not establish OCR accuracy, arbitrary PDF-layout support, browser reachability, or a human approval prerequisite for engineering acceptance.

## Adjacent open concern and custody

The artifact reviewer found that Allocations K duplicate counts return zero for rows whose task ID cell is blank, although the application/cached count is one. I independently observed K2=0 after calculateAll in `match-fix/xlsx-forced/baseline-amount.xlsx` for `COUNTIFS(B$2:B$3,B2,C$2:C$3,C2,D$2:D$3,D2)` with a missing C2 cell. This can defeat duplicate detection for unassigned tasks. Root and the artifact reviewer own the fix and final duplicate-specific verification; it is not covered by the closed match-arithmetic result above.

All mutations, fixture writes, conversion profiles and reports were confined to `/home/nathaniel/.local/state/openplan/owp-implementation-review-2026-09-06/round6/`. Originals, source checkout, databases and existing services were not modified. Git status was captured before and after shell work; root edited concurrently, so status differences are not attributed to this reviewer. Fresh source snapshots separate each reviewed implementation. Two initial harness issues were corrected in scratch: absent indexed task rows under a split mutation now produce assertion failures instead of a harness exception, and an initial follow-up script invocation from the parent scratch directory read the baseline snapshot; its old failures remain baseline evidence and are not counted as final-fix results.
