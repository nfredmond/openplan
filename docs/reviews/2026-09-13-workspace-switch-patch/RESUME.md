# Current state: v0.58.1 published

Read [PUBLICATION.md](PUBLICATION.md). The tag and release are published after exact-commit CI, RLS and populated upgrade success. Continue development in the translation checkout at 5995b05f. Earlier preparation notes below remain historical.

# Latest checkpoint: local acceptance complete

Read [VERIFICATION.md](VERIFICATION.md). All local QA, shuffled, isolated RLS,
worker and browser checks have terminal successful results, with expected
adverse controls. Production browser candidate is 1eef5f49 on localhost:3261.
The owned translation dev server on 3260 was stopped; its source and database
remain retained. Next: land this verified patch directly on main, inspect exact
main CI/RLS and dispatched upgrade results, then publish v0.58.1. No PR.
The older preparation record below is historical, not current job status.

# Workspace selector patch, v0.58.1 candidate

Owned checkout: `/home/nathaniel/.local/state/openplan/workspace-switch-v0581-2026-09-13`, branch `fix/workspace-switch-v0581`, based on remote main `88fb20b6`. Only the independent header commit `05aa194b` was cherry-picked as `6b14e74a`. The unfinished translation branch remains separately committed and pushed through `702e2449`.

This candidate keeps the workspace selector visible below 960px, removes dropdown clipping and wraps long workspace names. The two application files matched main before the fix. No migration, membership policy or workspace API changes are included. The migration inventory remains 328 through `20261014000009_engagement_translation_history.sql`.

Local release evidence belongs in `/home/nathaniel/.local/state/openplan/workspace-switch-v0581-evidence`. The selected retained disposable database is `supabase_db_openplan-restore-target-2731143`, API 28761 and database 28762, with its independently inspected 328-migration inventory. Its CLI workdir is `/home/nathaniel/.local/state/openplan/openplan-restore-drill.enw48S/openplan-restore-target-2731143`. No database reset or downgrade was performed. `.env.local` in the owned application points only at that stack. The translation database with 331 migrations remains untouched.

An initial shuffled run with seed 580113 failed six direction checks because the release-preparation edit missed the capability registry's currentRelease field. That marker is now corrected. The failed log is retained as `shuffled.log`; a new complete run uses `shuffled-corrected.log`. This was release metadata inconsistency, not evidence of shuffled-order dependence despite the generic runner's banner.

All 52 Python worker suites completed successfully. Full QA, corrected shuffle and standard isolated RLS are running or awaiting terminal inspection. Do not infer completion from this note. Mutation of the release-ordering record must wait until concurrent full suites end. The unchanged header browser checks are adapted to port 3261 and a fresh synthetic account pair. `create-browser-fixture.cjs` signs up the owner, creates a manual viewer invitation and explicitly accepts it through the UI; it refuses to replace retained credentials. No external invitation delivery is authorized by that script.

Next: finish local gates, run release-record controls, commit a candidate and start its identified production build on 3261. Exercise fresh fixture setup and desktop/900/390/320px browser journeys with harmless/hidden/clipped controls, inspect screenshots and console, and record source/artifact hashes. Resolve demonstrated defects. Land verified work directly on main, inspect final CI and RLS and applicable upgrade checks, then tag and publish v0.58.1. No PR or human review gate. Preserve other sessions' original checkout, the demo and pending reminder constraint.

After the patch, return to `translation-command-workflow-2026-09-13` and read its `ACCESS_PROGRESS.md`, `WRITE_STORAGE_PROGRESS.md` and `GENERATION_JOIN.md`. Complete durable translation generation, retained publication, dispatch accounting, cache provenance and producer conversion with the remaining recovery/access/browser/QA evidence. The full V1 contract remains incomplete and unchanged.
