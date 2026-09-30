# Production verification for reviewed synthesis

September 30, 2026. Tested application commit
`a7c349d55c621e5beba9ec462b0e60f16fdd54eb`, version 0.64.0.
The isolated production server reports `a7c349d55c62`; the identity script
matches its serving directory and commit to the clean owned checkout. Source
stays unchanged throughout the four browser journeys. The isolated database
contains 351 migrations through migration 32. The demo database is not the test
target. [Machine-readable results](production-checks.json) retain file checksums
and outcomes without publishing private histories or captures.

## Checks

- Full QA: 15,951 tests pass, 828 explicit skips, lint, configured dead-code
  checks, provider-connector checks, zero dependency vulnerabilities and a
  successful production webpack build.
- Shuffled tests: 15,951 pass, 828 explicit skips, seed 640932.
- Native isolation and recovery: 732 pass across 68 files, with 125 historical
  preactivation cases explicitly skipped. Separate combined-upgrade controls
  cover the retained version-one packet and existing function identity.
- All 52 Python worker suites pass at the display checkpoint. No Python worker
  implementation changes follow that run. The actual Documents export worker
  also completes all six production report jobs in these browser journeys.

## Browser workflows

Fresh Chrome sessions enter from the home page and sign in, then navigate through
Projects and Engagement at 1440px and 390px. Keyboard actions activate the tested
controls and expand retained evidence. Response-link journeys create a private
staff review, approve its exact revision, link a response, correct the review,
refresh the relationship and withdraw it while retaining history. Deliberate
storage refusal survives a real browser focus return; recovery restores the
retained reason. A denied private read clears the previously visible content.

Decision journeys create a project decision through its editor, inspect the
complete retained synthesis chain, save after a deliberately lost acknowledgement,
and replay the same request exactly once. A second correction is interrupted
before it reaches the server. Staff resolve it through the recovery controls and
download the archived receipt. Its late retry returns 409, its original saved
predecessor still replays with 200, and the history stays unchanged.

Each size prepares an original internal report, corrects the source response and
decision capture, and prepares a corrected report. Actual PDF, XLSX and ZIP
browser downloads match retained byte lengths and checksums. Downloading the
original files again after correction preserves every checksum. Public files
exclude private synthesis and decision evidence; anonymous file requests return
401. Global Engagement navigation also works from the public report page.

The browser records no page errors. Console errors are limited to the deliberate
connection resets and the response-link access-denial probes. Baseline and
harmless layout controls fit the viewport; an intentionally widened element is
caught. Inspected narrow screenshots show wrapped recovery buttons, retained
history and reachable downloads.

## Files

Each internal workbook has 16 sheets. Exact event text reconstructs from the
Long text continuations. ZIP manifests and retained snapshot hashes agree.
LibreOffice opens the two original production workbooks, and native rendering shows
readable source text and continuation references. The original XLSX bytes stay
unchanged. The wide audit registers require horizontal scrolling. This check
does not claim print-ready worksheets or interactive Excel keyboard acceptance.

Desktop original/corrected PDFs contain 31/35 pages; mobile-fixture files contain
24/28 pages. Both public files contain four pages. Text extraction produces no
warnings. All internal and named destinations resolve to valid pages. Rendered
first and source-appendix pages have readable headings, source references and
retained approval text. The first inspection script counted only direct PDF
links; these files use named destinations too. The corrected inspection checks
both kinds against the destination map.

## Limits

These synthetic engineering journeys do not establish practitioner usefulness,
screen-reader experience, representative participation, publication authority or
superiority over another platform. No human software-release review is required.
Final GitHub CI, RLS and populated upgrade checks must pass on the release commit
before tagging. Publication and the retained demo upgrade are separate records.
