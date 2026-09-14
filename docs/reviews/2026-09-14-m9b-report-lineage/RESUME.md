# Resume after the weekly usage reset

Current checkpoint, September 14, 2026. This supersedes earlier resume instructions. Continue the active goal through the full V1 product contract. No draft PRs, paid resources, destructive resets, reminder-constraint changes or human release gates. Verified work lands directly on main. This development checkpoint is backed up on the existing work branch and is not a release.

## Latest pause checkpoint: September 14, after browser failure

This section supersedes the older progress and process descriptions below. The user asked to preserve continuity before the weekly usage reset. Do not restart planning or repeat completed suites without a new reason.

Source checkpoint 24c72d1f4cbdd4f03789e79c558c9949e24c3eca is pushed to work/engagement-decision-traceability. Remote main remains 0ce1fb8b0823ab197616a4323b5c9bc974133586. This follow-up saves the corrected combobox locators and prepared legacy browser runner; both pass node --check. The legacy runner has not run. No new release is claimed.

All four local gates on 24c72d1f completed successfully: full QA 15,360 passed / 533 skipped with production build; shuffled seed 260914, 15,360 passed / 533 skipped; isolated live RLS 562 passed in 61 files; workers 52 suites passed. Logs in the private evidence base are report-history-full-qa-24c72d1f.log, report-history-shuffled-24c72d1f.log, report-history-full-rls-24c72d1f.log and report-history-workers-24c72d1f.log. Installed live CI coverage is now implemented (10 cases); do not add it again. Final release-commit GitHub CI and Upgrade Path remain pending.

Desktop navigation on identified build 24c72d1f4cbd created the source and decision history, recovered lost link and queue responses, and downloaded the original PDF/XLSX/ZIP with matching retained hashes. The corrected report then failed with Unsupported campaign snapshot. Root cause remains unknown. Do not claim full browser acceptance. The 390px journey, withdrawal/public packets and legacy runner still need execution. The first desktop failure was only a scope-combobox locator mismatch; retain that capture separately.

Immediate next action: diagnose failed corrected job e0de5cb6-7773-46a6-9721-7b00996074e2 against successful original job 951b3d6a-d0f3-46f8-ac3d-27255c0eff7b. Campaign 6611198f-3743-4a70-a5c7-295eb727566b; original report e6624a9c-1c58-456e-9be0-0f616dd68d6b. Private browser evidence prefix browser/report-history-1440-1789405349029 includes downloaded original files and failed-job capture. Verify stored snapshot arrays and campaign ID, then run the current parser against the exact retained bytes. Search all Unsupported campaign snapshot emitters. Preserve original files and failed snapshot; never fabricate a replacement.

Worker inventory correction: modern Node processes are named MainThread. Filtering only node missed an older worker. At this checkpoint PID 2148105 and PID 4038996 BOTH have this isolated app as cwd and run document-exports.ts. PID 2541 belongs to the demo /home/nathaniel/apps/openplan/openplan and must remain untouched. A stale worker is a hypothesis, not a diagnosed cause. Recheck startup time, parent/process ownership and code version before stopping anything. Our new worker was exec session 58874, log report-history-browser-worker.log; own identified server on port 3262 was exec session 35026, log report-history-server-24c72d1f.log. No runner is active. Tool handles and processes may expire across reset; do not rely on them surviving.

After diagnosis, finish desktop/390px exact-file/history/privacy/retry acceptance, visually inspect browser-created files, update release metadata for v0.61, land directly on main, inspect final CI, then tag. Continue the complete V1 contract afterward. Do not confuse this saved development branch with a PR or a release. Keep other checkout ownership and reminder constraints intact.

## Checkout and ownership

Use /home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13, package openplan/, branch work/engagement-decision-traceability. Another live Codex PID 3081751 owns /home/nathaniel/code/openplan; leave it read-only until ownership is rechecked. Our session PID is 988312. Recheck all processes, remote main, working changes and browser identity before continuing.

## Saved state

v0.60.0 is published at 29c5f7ab5140a0c71652485189d158c7099ead80. Main at this checkpoint is 0ce1fb8b0823ab197616a4323b5c9bc974133586. Its final CI 34863342444 and RLS 34863342471 succeeded. Full QA and shuffled each passed 15,325 tests with 530 skips; RLS passed 552. See report-page-final-ci.json. The metadata report-page fix already has desktop/390px navigation, interrupted-save recovery and unchanged PDF/XLSX/ZIP evidence. It is complete.

The current unfinished M9b increment adds private decision history to internal PDF/XLSX/ZIP, including exact payload/context validation, original/refresh/withdrawal chains, legacy-format absence labels and public exclusion. Worker and download paths validate authenticated job scope before trusting saved snapshots. The queue migration is openplan/supabase/migrations/20261014000024_engagement_report_decision_history.sql. It derives snapshot_format and grants access only to that metadata column, preserving raw snapshot column restrictions. It is now activated on the isolated application stack; all 42 existing snapshots retain their exact combined checksum. Unknown or non-JSON legacy snapshots yield NULL format without blocking upgrade.

Current checks: the 54-test mutation baseline and harmless control pass, and 22 targeted faults fail, including repeated source-occurrence ambiguity. Final focused renderer tests pass 24 tests; changed-file lint and TypeScript both exited 0. Native rollback upgrade proof now also retains seven unknown/unreadable legacy snapshots, with a harmless control and six targeted failures. Actual queue/link concurrency passed in both ordering directions, including observed database lock waits, exact original retry and two targeted lock failures. All source mutations were restored. See report-history-source-position-mutations.json, report-history-native-upgrade-results.json, report-history-concurrency-results.json and report-history-pagination-results.json.

Artifact inspection found and fixed an orphan PDF subheading and ambiguous workbook continuation IDs for repeated sources. The native fixture's six PDF pages were visually inspected. LibreOffice recalculated the workbook action count to 3; current history/scope/source/exact-context and summary sheets plus sampled continuation rows were visually inspected. ZIP snapshot bytes and all manifest checksums match. See report-history-artifact-inspection.json. Private current output is report-history-artifacts-source-positions/; Calc previews are report-history-workbook-final/. First-party renderer pagination proof passes baseline and harmless comment; removing heading pagination protection reproduces the orphan. This remains a synthetic fixture, not real-navigation browser acceptance.

The first application migration attempt failed safely because 36 existing RLS test snapshots contain non-JSON text. The corrected CASE expression protects the cast and maps only known numeric schema values. It applied successfully: 343 migrations through 20261014000024, 42 snapshots unchanged, 6 format-1 jobs and 36 unknown-format test jobs. See report-history-application-upgrade.json. Do not rerun migration 24 manually on the application database.

No owned browser or document worker is running. Current test handles completed. The disconnected concurrency database openplan_report_history_concurrency_20260914 remains with synthetic fixtures; installed queue/link functions were restored and no proof connections remain. It was cloned from the old rollback proof database. Its original metadata expression is not the application upgrade proof; the concurrency runner exercises queue/link function serialization, and the safe generated column is covered separately by the rollback and populated-application upgrade proofs.

## Next actions

1. Add installed-migration live RLS/activation coverage for the new report-history queue and derived format to the regular CI suite, reusing the native fixture and current test conventions. The existing standalone proof scripts are strong local evidence but are not yet wired into CI.
2. Start a compatible owned Documents worker against the isolated application stack. Migration 24 is already applied. Recheck worker processes and local environment without printing secrets.
3. Build a committed, identified checkout using which-openplan.sh before real browser acceptance. Use the repository Playwright harness, established UI-created fixtures and real navigation.
4. Exercise old/new internal format disclosure, public exclusion, original/refresh/withdrawal files, old retained checksums, private access and interrupted retries from actual navigation at desktop and 390px, with keyboard and console review. Use the repository Playwright harness without asking permission.
5. Run full QA, shuffled tests, isolated live RLS, workers and populated upgrade checks. Prepare a coherent v0.61 release only after these checks, align release metadata, land directly on main, inspect final exact-commit CI, then tag/publish. No v0.61 version or release exists yet.
6. Continue the remaining M9b and full roadmap obligations. The generic /api/reports/[reportId] GET still queries projects with a nullable project ID. The specialized page and metadata PATCH avoid it; do not claim that separate API gap is fixed.

## Local state and evidence

Private evidence base: /home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/. Browser evidence is under browser/. Keep credentials and raw private captures out of Git.

Application isolated container: supabase_db_openplan-restore-target-2026091050, database postgres, API 29821, DB 29822. Stack directory: /home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050. It has 343 migrations through 20261014000024. Disconnected rollback proof database: openplan_decision_link_proof_20260914 in the same container, owned by supabase_admin. Migration 24 remains rollback-only in that old proof database. A separate committed concurrency proof database is openplan_report_history_concurrency_20260914. Do not reset or drop these databases.

Acceptance server 3262 was stopped. No worker or browser lifetime is guaranteed across the reset. Recheck rather than trusting stored PIDs. Disk was about 90 percent used with 350 GiB free. Preserve existing evidence, synthetic fixtures and original snapshots. Follow current contract/roadmap, not old release numbering or stale plans.
