# Resume retained synthesis work

September 14, 2026. Supersedes the earlier weekly-reset checkpoint. Full V1 remains the objective; v0.61.1 is the published release. No new synthesis release is claimed.

## Where to work

Use /home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13, package openplan/, branch work/engagement-decision-traceability. Another live agent owns /home/nathaniel/code/openplan; inspect ownership before edits. Direct main pushes, no PRs, local/free operation and repository Playwright remain authorized. Leave reminder constraints, other servers and other stacks alone.

Read SOURCE_UI_CHECKPOINT.md, IMPLEMENTATION_BOUNDARY.md and the final verification note when present. Source selection, metadata history, exact-request browser recovery and original-text inspection are now implemented. Survey-only/empty entry is independent of the old synthesis guard. The old capped generator remains separate. The free preparation, generation/review worker, response/decision links and usable reviewed exports are still required; do not shrink M9b to source capture.

## Current verification

68 focused source/API/recovery/client checks passed. source-api-mutations.json records baseline and harmless survivor plus 45 detected targeted faults with byte restoration. The source/list native suite passed 16 tests in candidate mode and again against the installed migrations. Inventory and server-to-panel handoff proofs have their own JSON results. The first connected full QA run failed in campaign-page test setup and copy wording; both were corrected. A new full QA run must finish before claiming success.

The full RLS run is in /tmp/openplan-synthesis-full-rls.log; full QA in /tmp/openplan-synthesis-full-qa.log. Inspect terminal outcomes and live handles rather than restart based on elapsed time. Browser runner: browser-sources.cjs. Its fixed local URL is port3262, currently awaiting an identified build and owned server. Supply PROBE_COMMIT from /api/health's 12-character commit and run PROBE_WIDTH=1440 and 390. Inspect images and consoles; the only expected browser transport error is an intentionally lost save acknowledgement. The runner uses existing synthetic consultations created by earlier real product producers, edits a category through the UI, verifies exact retry and original/corrected hashes, and checks private reads. It is not browser evidence until successfully run and reviewed.

## Database and recovery

The explicitly named isolated stack supabase_db_openplan-restore-target-2026091050, workdir /home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050, API29821/DB29822 now has 345 installed migrations through 20261014000026. Migrations25/26 were applied additively with the explicit workdir. Never reset/drop. Run registered native tests in installed mode here; the older candidate-only runner requires baseline343 and must not be rerun here.

Private browser/account files remain at the paths in browser-sources.cjs. Raw artifacts belong under /home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/. Never print or commit credentials. The seven-file weekly-reset recovery copy remains under /home/nathaniel/.local/state/openplan/weekly-reset-20260914-synthesis-wip/ but is now superseded by subsequent implementation; do not restore it blindly.
