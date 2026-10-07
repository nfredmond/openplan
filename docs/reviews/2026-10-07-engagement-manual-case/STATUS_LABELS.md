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
The production and browser follow-up below addresses those boundaries.
This checkpoint does not claim release or full V1 acceptance.


## Identified build and artifact follow-up

Runtime 492f85e2de11110e83ac8fd8bf63d9d3fbf3c0e4 passed the production build
in 140 seconds with a 6.3 GB peak. PID 3457380 serves port 3503 from the isolated
review-status worktree; its cwd and health commit match. No source changed during
acceptance. The direction check passes with existing review-age reminders.

T3 shows Approved in the export selector at 1440px and 390px. Selecting Public
review copy retains the approved value and disables its review-status selector.
The mobile document width is 390px. The explanatory sentence remains readable.
The first desktop capture showed only the lower controls after resize; the
retained desktop capture scrolls the full review-file section into view.

The Prepare button created public job c7d540d7-a424-4fb3-bc30-3b468c3b4492.
The single-job worker completed with exit zero. Real navigation through Open
retained report reached c6ea4628-cb0b-474b-8e96-db85dee92974. PDF, XLSX and ZIP
downloads match worker bytes, and all seven manifest members verify. The newly
rendered PDF summary page visibly labels two records Approved; text extraction
finds no Published label. The workbook explanation distinguishes approval from
public release. See status-artifacts.json for exact hashes.

The console snapshot contains nine older entries from earlier runtimes and no
new entry from this acceptance session. This is a synthetic review-copy check,
not public publication, native Excel acceptance, or practitioner observation.
Only the changed PDF summary page was visually rechecked in this follow-up.
