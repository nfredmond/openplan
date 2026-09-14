# Resume after the weekly usage reset

Current checkpoint, September 14, 2026. This supersedes earlier resume instructions. Continue the active goal through the full V1 product contract. No draft PRs, paid resources, destructive resets, reminder-constraint changes or human release gates. Verified work lands directly on main. This development checkpoint is backed up on the existing work branch and is not a release.

## Checkout and ownership

Use /home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13, package openplan/, branch work/engagement-decision-traceability. Another live Codex PID 3081751 owns /home/nathaniel/code/openplan; leave it read-only until ownership is rechecked. Our session PID is 988312. Recheck all processes, remote main, working changes and browser identity before continuing.

## Saved state

v0.60.0 is published at 29c5f7ab5140a0c71652485189d158c7099ead80. Main at this checkpoint is 0ce1fb8b0823ab197616a4323b5c9bc974133586. Its final CI 34863342444 and RLS 34863342471 succeeded. Full QA and shuffled each passed 15,325 tests with 530 skips; RLS passed 552. See report-page-final-ci.json. The metadata report-page fix already has desktop/390px navigation, interrupted-save recovery and unchanged PDF/XLSX/ZIP evidence. It is complete.

The current unfinished M9b increment adds private decision history to internal PDF/XLSX/ZIP, including exact payload/context validation, original/refresh/withdrawal chains, legacy-format absence labels and public exclusion. Worker and download paths validate authenticated job scope before trusting saved snapshots. The queue migration is openplan/supabase/migrations/20261014000024_engagement_report_decision_history.sql. It derives snapshot_format and grants access only to that metadata column, preserving raw snapshot column restrictions. It has NOT been activated on the application stack.

Current checks: 57 focused tests across eight files passed. Final TypeScript and changed-file ESLint both exited 0, recovered from sessions 82253 and 42231. Mutation proof has a 53-test baseline, harmless survivor and 21 targeted failures. Native rollback proof has a baseline, harmless survivor and five targeted failures; it preserves old snapshot bytes/retries, three history actions despite empty contribution filters, public exclusion and column permissions. See the copied report-history-* results and proof scripts. These checks do not prove concurrency, UI reachability or artifact layout.

The real renderer produced PDF/XLSX/ZIP from the synthetic native archive. Files and hashes exist under private evidence report-history-artifacts-native/. Actual PDF pages and workbook layout have NOT been inspected. Do not repeat the PDF artifact-start marker unnecessarily; it ran before generation. Renderer script is private render-report-history-native.mts. No checks are known to be running. Former document worker PID 4038996 is no longer present in the process inventory; recheck and restart our worker when needed.

## Next actions

1. Inspect rendered PDF pages and workbook contents/layout, and confirm ZIP exact snapshot bytes. Private render result and script already exist; do not assume a missing tool session means generation failed.
2. Prove actual concurrent queue/link transaction serialization on a named disposable database. Existing native proof uses rollback-only transactions and does not cover overlap. If a separate committed proof database is necessary, create one without dropping/resetting existing databases. Preserve queue FOR UPDATE and link FOR SHARE NOWAIT lock order.
3. Activate migration 24 only on the isolated application stack, with a compatible owned Documents worker. Build a committed, identified checkout using which-openplan.sh before real browser acceptance.
4. Exercise old/new internal format disclosure, public exclusion, original/refresh/withdrawal files, old retained checksums, private access and interrupted retries from actual navigation at desktop and 390px, with keyboard and console review. Use the repository Playwright harness without asking permission.
5. Run full QA, shuffled tests, isolated live RLS, workers and populated upgrade checks. Prepare a coherent v0.61 release only after these checks, align release metadata, land directly on main, inspect final exact-commit CI, then tag/publish. No v0.61 version or release exists yet.
6. Continue the remaining M9b and full roadmap obligations. The generic /api/reports/[reportId] GET still queries projects with a nullable project ID. The specialized page and metadata PATCH avoid it; do not claim that separate API gap is fixed.

## Local state and evidence

Private evidence base: /home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/. Browser evidence is under browser/. Keep credentials and raw private captures out of Git.

Application isolated container: supabase_db_openplan-restore-target-2026091050, database postgres, API 29821, DB 29822. Stack directory: /home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050. It has 342 migrations through 20261014000023. Disconnected proof database: openplan_decision_link_proof_20260914 in the same container, owned by supabase_admin. Migration 24 only ran inside rolled-back proof transactions. Do not reset or drop either database.

Acceptance server 3262 was stopped. No worker or browser lifetime is guaranteed across the reset. Recheck rather than trusting stored PIDs. Disk was about 90 percent used with 350 GiB free. Preserve existing evidence, synthetic fixtures and original snapshots. Follow current contract/roadmap, not old release numbering or stale plans.
