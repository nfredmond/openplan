# Review approval and public release

The public-review PDF and export filter called approved contribution records
Published. The synthetic campaign remained private without a share token.
Approval therefore did not prove public release.

The filter and PDF summary now say Approved. The workbook explanation and review
file introduction state that approval does not establish public release. Stored
status values, disclosure predicates and saved artifacts remain unchanged.

Two new exporter tests fail against the original label. The corrected exporter
and review-file route pass 16 tests. A harmless comment passes; restoring the
Published summary label or reversing the workbook caveat fails the intended
assertions. The exporter source is restored after each mutation. ESLint passes
for all changed source and test files. Controls are in status-label-controls.json.

Tests mock PDF rendering and do not exercise the component in a real browser.
Production build, desktop and mobile review, and new rendered export acceptance
remain pending. This checkpoint does not claim release or full V1 acceptance.
