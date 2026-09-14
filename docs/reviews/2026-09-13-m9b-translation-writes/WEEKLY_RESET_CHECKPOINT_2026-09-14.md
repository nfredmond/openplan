# Weekly usage reset checkpoint — 2026-09-14

Resume in `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`, branch `work/translation-command-workflow`; application package `openplan/`. Preserve the original checkout and other sessions. Read PUBLIC_RETRY_SHARE_SETTINGS_PROGRESS.md for the preceding implementation and evidence. This checkpoint is development work, not a release.

## Saved and checked

The full QA run at fe6d05cc stopped with 15,131 passing tests, 497 skipped and three failing tests. Failures were four SQL-only columns missing from the read ledger, the new private table missing from schema census expectations, and migration 20 missing from the Unreleased changelog. These records are repaired. The focused three suites passed all 40 tests. `public-release-record-controls.json` records ten successful cases: baseline and harmless control survive; eight targeted faults fail for their intended assertions. The mutation runner finished and restored all temporary source edits.

Legacy-cache browser compatibility also passed at desktop 1440px and 390px, alongside explicit retries, source refusal and link revocation. Private results: `/home/nathaniel/.local/state/openplan/response-write-probe-20260913/public-translation-browser-1789372959954/results.json`. The compatibility fixture invokes the actual older SQL cache producer with explicitly synthetic words. Reading it creates no public request; rotating the link refuses its old-token read. Inspect the latest screenshots and console and record the final evidence manifest on resumption.

An accidental `npm exec node` invocation fetched a temporary Node package into npm cache. It did not modify repository dependencies; direct `node --version` remains v24.21.0. Use direct node commands.

## Resume next

1. Recheck branch, clean status, active processes and browser identity. Jobs and dev servers may not survive a reset. No QA or release-record mutation job was running when this checkpoint was written.
2. Advance the clean dedicated QA checkout `/home/nathaniel/.local/state/openplan/translation-resolution-qa-20260913-125bf2a3` from fe6d05cc to this checkpoint and rerun full QA. The previous QA exit was 1, not a pass. Logs remain under `/home/nathaniel/.local/state/openplan/response-write-probe-20260913/`.
3. Run current shuffled tests, workers and complete isolated RLS. The designated stack is `openplan-restore-target-2026091050`, API 29821, database 29822, workdir `/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050`; migration 20 is installed. Never reset it or point workers at retained proof databases. Explicit `OPENPLAN_SUPABASE_WORKDIR` selects it for RLS.
4. Verify populated upgrade from v0.58.1 and production-build cold public navigation. A first navigation after dev restart twice returned the map; warm journeys passed. Dev compilation/HMR is only a hypothesis; cold production acceptance remains unresolved.
5. Prepare the bounded next minor release, merge directly to main, inspect final commit CI and RLS before tagging. No PR or human review gate. Continue toward the complete V1 contract afterward.

Owned synthetic dev server was on port 3260 with local transport interception; inspect process identity before reusing or stopping it. Do not send real provider traffic. Keep the pending reminder constraint untouched and operation local/free.
