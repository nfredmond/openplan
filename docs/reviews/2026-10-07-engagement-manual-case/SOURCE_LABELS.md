# Contribution source labels

The synthetic public PDF retained two records whose source_type is internal,
but it did not show their intake type. The import workflow explicitly defines
internal as staff-authored notes, separate from resident comments. The workbook
and portable snapshot retained the raw source_type, so this is a presentation
omission rather than loss of the original record or a proved privacy-gate bypass.

The correction labels each PDF/HTML contribution and workbook row by its recorded
source. A contribution-source table counts records by intake method. Staff notes,
public portal, meeting/workshop and email/letter remain distinct. Missing sources
are not recorded; unrecognized values remain visible and escaped. The summary
now describes retained records and states that counts are not people. Staff notes
are not resident submissions. Intake method does not establish identity or
representative support. Privacy and publication predicates are unchanged.

Two new tests, internal and public, fail against the preceding exporter because
it lacks source labels. All 11 exporter tests pass after correction. A harmless
comment passes; omission of HTML labels, collapsed repeated-source counts and
omission of workbook labels each fail the intended assertions. Source edits are
restored after each control. Changed-file ESLint passes. The adjacent exporter,
decision-history, worker and download suites pass 34 tests in four files.

The tests use mocked PDF rendering. They do not prove actual PDF layout, native
spreadsheet usability, complete disclosure safety or practitioner acceptance.
Newly rendered artifact inspection remains pending. This correction does not
replace the full V1 engagement requirement or broaden publication authority.
