# v0.61.0 report context and private decision history

September 14, 2026. Engineering acceptance is complete; final release-commit CI and publication are recorded separately. This document does not itself declare a tag published.

Saved consultation reports show their consultation/project context and permission-scoped metadata editing. Editing metadata preserves saved files and citations. New internal PDF/XLSX/ZIP files include the entire consultation decision history: original links, reviewed corrections and withdrawals, exact retained payload/context bytes, predecessor identities and original source/configuration availability. Participation filters do not restrict that private history, and the UI and files disclose the distinction. Public copies exclude it. Earlier reports retain their original files and disclose absent history; unknown formats remain unknown.

## Runtime and saved files

[Browser results](report-history-browser-results.json) cover the isolated production build `b3dea322fec3`, served from `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13/openplan` at port 3262. The repository identity check reported MATCH. The implementation is unchanged from source checkpoint `24c72d1f`; intervening commits only save browser scripts and documentation.

Desktop 1440px and narrow 390px journeys started at sign-in and used Projects, Engagement, Setup/Record and retained Reports navigation. Decisions, contributions, staff responses and links were created through actual forms. Keyboard activation, original/corrected/withdrawn/public downloads, exact snapshot and ZIP member checksums, private-history exclusion, anonymous report redirects and file denials all passed. Each original was downloaded again after correction and withdrawal with unchanged hashes. Lost successful link/queue responses survived reload and exact retry without creating another command/job. Each journey's only two console errors were its deliberately injected network failures.

Old-format journeys at both widths saved metadata across a lost response, reloaded and restored it, downloaded the original PDF/XLSX/ZIP hashes, verified old-history absence text and denied anonymous access. Supplemental controls captures retain the actual narrow download buttons. The five-page desktop withdrawal PDF was visually inspected. Calc rendered thirteen workbook sheets; history across all columns, scope, source and exact-context sheets were inspected, and its recalculated summary gives three history actions with zero filtered contributions. Long values retain explicit continuation references. This does not claim every possible narrative layout was inspected.

## Failure found and recovered

The first history browser run failed to locate a select using a label locator; the observed combobox locator corrected the test. A later run successfully saved the original files but failed the corrected job with `Unsupported campaign snapshot`.

The agent had missed an older Documents worker because modern Node appeared as `MainThread`, not `node`. Two workers started by this session used the isolated checkout; the older one predated schema 2. Both retained snapshots passed the current parser, while the historical schema-1 predicate rejected them. After stopping only that owned older worker, **Retry saved snapshot** completed the same failed job without changing its snapshot checksum. Its files downloaded correctly and the original files remained unchanged. No application source fix was needed for that failure. The raw failed captures and successful recovery remain local.

Initial narrow captures showed the section heading rather than the download controls. Supplemental capture uses an immediate centered scroll and checks the control's viewport position. One supplemental run also pressed a report link before the Record navigation settled; explicit route waits corrected that runner. These setup/capture failures are preserved and do not count as passing journeys.

## Checks that could fail

[Local gates](report-history-local-gates.json) attribute full QA and seeded shuffled tests to `24c72d1f`: 15,360 passed and 533 skipped in each. QA includes lint, configured deadcode checks, provider connectors, dependency audit and production webpack/TypeScript build. Isolated RLS passed 562 tests in 61 files against the explicitly disposable restore-target stack; all 52 worker suites passed. A production build at `b3dea322` also completed before browser acceptance. Skips establish no coverage.

The [54-test source proof](report-history-source-position-mutations.json) has a surviving harmless control and 22 detected faults. [Installed live coverage](report-history-installed-live-results.json) runs through regular CI with baseline, harmless and eight targeted cases, including partial-NULL exact payload loss, missing metadata grants, raw snapshot exposure and viewer/anonymous boundaries. [Rollback proof](report-history-native-partial-null-results.json) also detects partial-NULL loss. [Native concurrency](report-history-concurrency-results.json) observes queue/link lock waits in both orderings, preserves exact earlier retries and detects either missing explicit lock. [PDF pagination](report-history-pagination-results.json) retains a harmless comment and detects the actual orphan-heading regression. Mocked tests do not replace these database, filesystem, browser or rendering boundaries.

## Upgrade and scope

Stop every Documents export worker for the target installation before upgrading, apply `20261014000024_engagement_report_decision_history.sql`, then start the matching app and workers. Do not leave a pre-upgrade process polling the changed queue. The [populated local upgrade](report-history-application-upgrade.json) preserved all 42 earlier snapshots exactly, including 36 non-JSON test snapshots; six legacy snapshots remain format 1 and unknown formats remain NULL. The first unsafe integer-cast migration failed and rolled back; the guarded CASE migration fixed that demonstrated upgrade defect. The generic final GitHub Upgrade Path remains a separate release check.

This is a local/free engineering increment. It does not establish agency approval, implementation, representative support, translation quality, planner usefulness or comparative engagement superiority. M9b and the full V1 contract remain open. The generic report GET API still assumes a project ID; this specialized page and metadata PATCH avoid that path. The pending reminder constraint remains untouched. Continue the roadmap without a human release gate.
