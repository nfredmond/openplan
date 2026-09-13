# Weekly reset checkpoint, September 13, 2026

> Published continuation: v0.57.0 is released. Read [PUBLICATION.md](PUBLICATION.md) and the [next translation-custody checkpoint](../2026-09-13-m9b-translation-custody/NEXT.md) before the historical preparation statements below.

> Later continuation: read [RELEASE_CANDIDATE.md](RELEASE_CANDIDATE.md) and [CONFLICT_AND_RESTORE.md](CONFLICT_AND_RESTORE.md). Version 0.57.0 is prepared, not tagged. Recovery and public source-withdrawal journeys passed at desktop and 390px, the full restored-target RLS suite passed, and shuffled seed 370816 passed. Full QA on 0c1e7d70 has now finished with exit 0. Read the final checkpoint below. Owned dev launcher 3326248 is stopped; port 3260 was empty. No unrelated container was stopped.

This is the current recovery entry point. It supersedes the runtime, migration and next-step statements in USAGE_PAUSE.md; preserve that older record as history. Nathaniel asked whether this thread can resume after the weekly reset. Save work now; do not imply unfinished acceptance passed.

## Final checkpoint before the usage reset

Full QA on pushed candidate 0c1e7d70081ccbf6b63d256903463efbb210067d completed with exit 0, recovered from tool session 56986. Private log: /home/nathaniel/.local/state/openplan/response-write-probe-20260913/full-qa-0c1e7d70.log. Lint, Knip, 14306 tests with 451 skipped, provider checks, zero dependency vulnerabilities and the optimized production build completed, including all 135 static pages. Separate shuffled, restored-target live RLS and worker evidence is recorded in CONFLICT_AND_RESTORE.md. No owned QA/build process remains.

Remote main remains 3f70af98e6fb06b4c0f932769e10f880711d46ec. Candidate code is pushed on work/engagement-response-writes, not yet main or tagged. Next: refresh ownership and remote state, land directly on main without a PR, inspect CI for that exact main commit, then tag/publish v0.57.0 after applicable gates pass. Continue the full v1 goal afterward. Translation correction custody is a possible remaining M9b gap, not yet implemented; recheck the current roadmap before choosing the next lane.

Older failed-test and runtime statements below are historical wherever they conflict with this checkpoint and the linked current evidence. Saved files and commits are the recovery authority; do not assume old tool sessions or processes survive a usage reset. The owned dev server is stopped. Preserve named database stacks and the separate demo.

## Direction and ownership

Continue the existing full v1 goal without recreating or shrinking it. Direct main after verification, no PRs, no human-review release gate. Playwright is authorized. Keep operation free/local and the pending reminder constraint unchanged. No subagents. Read current product direction before choosing the next substantial lane.

Owned checkout: /home/nathaniel/.local/state/openplan/engagement-response-writes-2026-09-12
Branch: work/engagement-response-writes. Package: openplan/.
Parent checkpoint: 1aa4bd840f79ac7903a10601d203951294cb0a5a, already pushed.
Latest release last established at v0.56.1, main 3f70af98. Refresh remote and CI on resume. This checkpoint is unfinished development, not a release or permission to tag.

Original checkout /home/nathaniel/code/openplan is clean at this inspection. Only one Codex process was observed, PID 988312. Leave the separate demo /home/nathaniel/apps/openplan alone. Recheck ownership before edits.

## Most recent defect and fix

The extended desktop browser journey reproduced a real stale-save timeout. Manual SQLSTATE 40001 in write_engagement_response makes installed PostgREST v14.15 retry instead of promptly returning a conflict. Direct SQL refused immediately, while the raw HTTP probe timed out after eight seconds and the editor reached its unconfirmed state. SQL-only tests missed this. The repository already solved the same issue in an older OWP migration; this increment reintroduced it.

Primary sources: https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b and https://docs.postgrest.org/en/v14/references/errors.html .

Migration 20261014000007 changes engagement stale conflicts to PT409 and incomplete receipt results to PT503. It also fixes require_engagement_review_intent. App mappings retain legacy 40001 compatibility. New live RLS test preflights actual function definitions before HTTP, so a regression cannot start the known retry loop. That new live test and extended browser acceptance have NOT passed yet. Two narrowly identified probe retry backends were terminated; never kill generic pooled connections.

Two legacy functions record_access_request_triage and record_access_request_provisioning also contain manual 40001. No current src callers were found. Record this boundary without reactivating legacy machinery or blindly replacing errors elsewhere.

## Current evidence

- Installed database upgrade report confirms 326 migrations through 20261014000007, migration exit 0, existing response/history bytes unchanged. Private pre-upgrade dump retained. installed-probes.json records three SQL baselines, harmless comment control and the intended stale-version failure, all matched. SQL proof does not replace HTTP acceptance.
- Conflict mapping focused report conflict-map-corrected.json has 127 passed, zero failed. It predates this handoff; inspected artifact, not a rerun.
- Earlier desktop and 390px browser journeys passed original creation with lost acknowledgement, exact retry, publication, known-empty recipient preparation, correction, retained original checksum/history and focus. Those committed reports identify older app hashes. Current extended journey adds concurrent correction and failed-review recovery; desktop stopped at the real 40001 defect. Rerun desktop then 390px after the fix and inspect console and screenshots.
- Real native worker through local PostgREST proved acknowledgement committed before simulated transport loss, durable journal replay after restart and only one attempting claim. Baseline and harmless mutation survived; removing recovery failed. Original worker source restored. No external email provider was used.
- Delivery authority concurrency locks are committed in 1aa4bd84. Separate clone proved both unsubscribe orderings, campaign closure and two workers claiming one message. Targeted lock/SKIP LOCKED removals failed; original clone functions restored.
- Worker run completed 52 suites, zero failed or not run. This does not establish scientific model validation.
- Full QA last failed: 8 tests across 7 files; 14287 passed, 450 skipped. Lint and Knip completed, later build stages were not reached. Static fixes subsequently passed 148 focused tests, and seven intended QA join faults failed while the harmless control survived. Full QA and shuffled tests remain outstanding.
- Full isolated RLS last failed the missing receipt census, with 478 passing tests. Focused rerun then found the hardcoded 90 count, changed to 91. The expected sorted table list still lacks engagement_response_write_receipts. Fix that list as well, then rerun; do not remove the census failure.
- Full restore drill has now ended. It restored 296 tables and one file, authenticated the restored account and verified retained hashes/relationships. Its RLS stage failed that same receipt census. It copied 325 migrations through 06, before 07 existed. Do not call it a final-code pass. Retained source and target are openplan-restore-source-2731143 and openplan-restore-target-2731143, private directory /home/nathaniel/.local/state/openplan/openplan-restore-drill.enw48S. Upgrade only the named restored target to 326 and rerun final RLS to finish the additive-upgrade boundary; preserve restored data.

## Local runtime and custody

Owned dev process PID 2704541 was live on port 3260 at inspection. Command runs Next dev with webpack from the owned package. Browser URL http://localhost:3260. Identity log response-final-identity.log identifies this checkout, parent commit plus dirty changes. Re-establish identity with which-openplan.sh after reset; a port alone is not identity.

Named disposable app stack: supabase_db_openplan-restore-target-2026091050, database postgres, API 29821, DB 29822. Workdir /home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050. Current ledger report 326|20261014000007. Never target the demo. Preserve campaign a3c41566-bfd4-40f2-b467-96ee79054ec6 and its 1005 responses. Original pre-03 response/history records are compared individually; newer synthetic fixtures legitimately change whole-table aggregates. Do not reconstruct the older unavailable aggregate query by guessing.

Separate databases response_write_probe_20260913 and response_broadcast_probe_20260913 are retained prototype/concurrency clones, not browser targets. The broadcast clone was restored from full 323 source and candidate functions were restored to its original definitions after probes. Do not run prototype installers on installed postgres.

Private logs, dumps and screenshots: /home/nathaniel/.local/state/openplan/response-write-probe-20260913/ . Main files full-qa.log, live-rls.log, full-restore-final.log, response-dev-final.log, conflict-map-corrected.json. Private account config /home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12/api-settings-account.json. Owned .env.local exists, ignored, mode 600; never print credentials. RESEND_API_KEY is empty.

No restore-drill or prove-installed process remains at inspection. Old tool session IDs may not survive the reset. Read artifacts and process ownership before restarting jobs. The owned Next server may need restarting. Worker .venv311 links point to preinstalled interpreters whose dependency manifests were compared; source execution remains in this checkout.

## Resume sequence

1. Verify ownership, saved branch, current main/CI and browser identity. Read BROWSER_AND_CONCURRENCY.md and this handoff before older pause notes.
2. Correct receipt census expected table list, run isolated rls-isolation.test.ts against the explicit 326 app stack, including new prompt HTTP conflict cases. Keep targeted failures and harmless controls for changed guards. Avoid live 40001 fault loops.
3. Run extended response-browser.cjs desktop and WIDTH=390, inspect recovery/history screenshots and console, verify original checksum after five revisions. Preserve failed prior evidence separately. Do not edit the served checkout during acceptance.
4. Finish error-code mutation evidence and upgrade/RLS checks on the retained restore target. Re-run TypeScript/lint and applicable full QA, shuffled tests and isolation. Do not treat older reports as current-source passes.
5. Update review notes, known limitations and current roadmap truthfully. Prepare next coherent minor release, land directly on main once verified and inspect final release-commit CI before tagging. Then continue toward the whole v1 contract. M9b and v1 remain incomplete.
