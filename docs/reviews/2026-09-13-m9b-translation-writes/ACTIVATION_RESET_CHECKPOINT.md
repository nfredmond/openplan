# Translation activation usage-reset checkpoint

Saved September 13, 2026. This is an unfinished development checkpoint, not a release or a passing full gate. It supersedes older notes about command execution still being revoked on the application stack.

## Resume here

Owned checkout: `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`, branch `work/translation-command-workflow`. Run npm inside its `openplan/` directory. Preserve the original checkout, the demo and the pending reminder constraint. Another session has been active in the original checkout; recheck ownership before editing there. User authorizes direct verified main merges, no PRs or human-review release gates, local free operation and repository Playwright. Continue toward the full V1 contract after this lane.

The preceding checkpoint is `d51c80dead32c8243d792fc3f06de29218669279`. This checkpoint saves migration 17, its activation fixture and fault controls, installed-grant live tests, fixture adaptations and retained-publication activation checks. The branch remains unreleased.

## Exact unfinished check

The full isolated RLS run terminated with **53 passing files, one failing file; 483 passing tests, one failing test**, duration 362.23 seconds. Private log: `/home/nathaniel/.local/state/openplan/response-write-probe-20260913/translation-activation-full-rls.log`.

The sole failure is `src/test/rls-isolation.test.ts:2161`, the JOIN-scoped coverage census. The missing table is **engagement_translation_write_receipts**. Do not excuse the table merely to obtain green. Add direct receipt SELECT positive and viewer/outsider/anonymous refusal evidence, then register its dedicated live probe and the expected inventory. Prove a harmless control survives and a targeted receipt-policy leak fails. Also prove removing the census registration fails. Rerun the affected checks and applicable release gates.

Correction to earlier commentary: preliminary diagnoses blamed generation tables and then modeling_validation_instrument_v2_custody. Both were wrong. The latter came from a scratch regex that excluded digits. No census edits were made on those diagnoses; the terminal test output above identifies the actual failure.

## Database and processes

The owned application stack is `supabase_db_openplan-restore-target-2026091050`, workdir `/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050`, API 29821, database port 29822. Its postgres database now permanently has **336 migrations through 20261014000017**. Authenticated command EXECUTE is enabled, anonymous EXECUTE disabled, authenticated direct translation DML revoked. Rechecked migration count, command grant and direct UPDATE refusal at checkpoint. No generation worker was started and no paid model calls were made.

A preserved pre-upgrade clone is **openplan_translation_activation_proof_20260913** in that same container, with 331 migrations through 12. The activation probe runner targets this database and rolls back changes. Private full dump: `/home/nathaniel/.local/state/openplan/response-write-probe-20260913/translation-pre-activation.dump`. Do not reset/drop either database. Do not attach workers to proof databases containing queued synthetic jobs.

Owned Next dev was at http://127.0.0.1:3260. On resume, recheck process existence and identify the served checkout with which-openplan.sh before any browser claim. Do not rely on old process/session IDs surviving a usage reset.

**Old browser wrappers are stale:** they expect 331/12 and temporarily grant then revoke command execution. Adapt them to require installed 336/17 and preserve installed grants before running them. Add a wait for the actual Setup tab URL after navigation. Complete actual retained generation/worker/publication journeys at desktop and 390px, with keyboard and console checks.

## Evidence already collected

The four focused translation live suites passed. The activation report records baseline and harmless control surviving, and 14 targeted faults failing. The report is `translation-activation-controls.json`; check hashes against current source before relying on it. Default and activated retained-publication rollback probes passed. TypeScript and focused ESLint passed in the preceding work. These checks do not prove complete browser operation or public generation recovery. The full RLS failure above remains open.

Remaining product work includes generation editor recovery edge cases and actual browser-worker acceptance, public translation producer durability/privacy, then full QA, shuffled tests, isolated RLS, workers and upgrade checks. Inspect CI on the final release commit before tagging. Existing public generation still has non-durable dispatch/metering and must not be described as complete. Read GENERATION_EDITOR_PROGRESS.md and RETIRED_STAFF_ROUTE_PROGRESS.md for preceding implementation boundaries.
