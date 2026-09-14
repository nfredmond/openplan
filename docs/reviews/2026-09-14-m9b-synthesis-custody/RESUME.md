# Resume after the weekly usage reset

September 14, 2026. This note supersedes the unfinished-work section of BACKEND_CHECKPOINT.md and the earlier report-api-project/RESUME.md. The user plans to return to the same thread after usage resets. Resume from these files; do not require the user to reconstruct context or assume old processes survived.

## Saved and released

v0.61.1 is published at 291ce88a600547c1cd2b8b3d85047d5d07c6df44. Do not retag or republish. Main and work/engagement-decision-traceability were both 44dac9e55ea24679eb5f53991f0fbb744edd4db7 before this documentation checkpoint. That later backend checkpoint is not a release.

Use checkout /home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13 and its openplan/ application package. The original /home/nathaniel/code/openplan belongs to another live session. Recheck ownership before editing. Direct main pushes, no PRs, local/free operation, repository Playwright and continued full V1 development remain authorized. Leave the reminder constraint alone.

## Actual checks

GitHub was queried directly at this checkpoint. For 44dac9e5, Upgrade Path 34881839823 and RLS Isolation 34881839833 succeeded. CI 34881839821 failed. Its failed log confirms two QA failures: the new synthesis/sources API has no product caller, and migration inventory expected 266 relations but found 267. Local full QA also failed those two tests, with 15,407 passed and 542 skipped. Do not call full QA green. The source backend's narrower mutation/native/parser checks are documented in BACKEND_CHECKPOINT.md.

## Unfinished edits preserved

Seven application/changelog files remain uncommitted. They add a metadata-only source list RPC in migration 20261014000026, source list schemas/GET handling, actor/workspace request binding, a localStorage pending-request helper, route test adjustments and corrected schema inventory counts. These edits are not fully tested. The actual source selection/history/inspection component has NOT been written. Do not exempt the API from the caller guard.

A byte-verified local recovery copy of all seven files, SHA256 manifest and tracked diff is at /home/nathaniel/.local/state/openplan/weekly-reset-20260914-synthesis-wip/. The working files remain in place. The backup is local, not pushed. Compare current bytes before any restoration; never overwrite later work blindly.

## Next concrete work

1. Inspect current changes and read IMPLEMENTATION_BOUNDARY.md. Finish the reachable Engagement source-selection/history/inspection UI, independently of the old approved-comment count condition. Pass authenticated user/workspace/campaign scope.
2. Preserve the exact request in scoped localStorage before POST. Reload/retry uses the same request. Establish confirmed persistence before follow-up reads; a failed inspection must not recreate the write. Test changed membership/account and unreadable pending state.
3. Test migration 26 pagination/privacy natively, and update route/schema/pending tests and mutation proof. Existing mutation runner assumes 47 tests and needs an honest update. Inventory count is supported by real rolled-back PostgreSQL census: 267 relations, 253 tables with RLS, 14 views.
4. Apply additive migrations only to the named isolated stack when ready. Identify the browser build with which-openplan.sh. Exercise real navigation at desktop and 390px, keyboard, console, source preservation after correction, privacy and interrupted retries. No source UI browser acceptance exists yet.
5. Rerun full QA, shuffled tests, live RLS and applicable worker/upgrade checks. Inspect final code CI before release. Continue complete preparation, resumable generation/review, response/decision links and exports. Source storage alone does not complete M9b or V1.

## Environment

Named isolated database: supabase_db_openplan-restore-target-2026091050, API 29821 / DB 29822, workdir /home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050. Last native evidence showed 343 installed migrations through 20261014000024; candidate 25 tests rolled back. Migrations 25/26 have not been persistently applied by this workstream. Recheck rather than resetting or dropping anything.

Private artifacts: /home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/. Credentials stay in existing private files. No owned app/browser/worker or test job is relied on for recovery. Other sessions have active servers; do not kill them. Repository Playwright successfully launched installed Chrome with a fresh ephemeral profile during this work, but the source UI journey remains pending.
