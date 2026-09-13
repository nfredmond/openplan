> Published: v0.57.1 at 6ee8c438da9e5c100bb6c1588e29d5248b46cac7, with all
> exact-commit CI green before tagging. See PUBLICATION.md and publication.json.
> Continue the translation-history increment from ../2026-09-13-m9b-translation-custody/NEXT.md
> and AFTER_SCOPE.md there. Its prototype is still uninstalled. The helper input
> truncation and incomplete-output acceptance now have focused reproductions.
> Full v1 remains active. Older checkpoint paragraphs below are historical setup.

> Superseding checkpoint: v0.57.1 local QA, shuffled tests, all 481 isolation tests,
> 52 worker suites, populated upgrade and browser evidence are complete. Release
> metadata is prepared. Land this verified commit directly on main, inspect exact
> CI (including Upgrade Path), then tag/publish. See VERIFICATION.md and local-checks.json.
> The historical reset checkpoint below retains setup and following-work details.

# Restart checkpoint — September 13, 2026

Saved before the weekly usage reset. Continue the existing full-v1 objective; do not restart planning or declare v1 complete.

## Ownership and saved work

Work in `/home/nathaniel/.local/state/openplan/engagement-response-writes-2026-09-12`, application `openplan/`, branch `work/engagement-response-writes`. Security implementation f4aa6f6d4d0c35f67eea78573d388a02ee8b49a6 is confirmed pushed. Remote main remains 542ffdd0d1e44d5fc9fbe2f1c36ac40e04abf948. v0.57.0 is published; v0.57.1 is NOT released or merged. Package remains 0.57.0. Original `/home/nathaniel/code/openplan` and the demo are intentionally untouched. Check other sessions before editing. No subagents were started.

## Latest verification, superseding the earlier runtime paragraph

- The full live RLS log ends with 51 files / 481 tests passed in 354.05 seconds on the retained restored stack upgraded to migration 327. The new scope fixture has positive and targeted negative controls recorded in VERIFICATION.md and mutation reports.
- Final desktop and 390px browser JSON both report success at source f4aa6f6d, original configuration retained after correction and withdrawal, identical-body retry after a lost acknowledgement, and no horizontal overflow. Both have only the deliberately induced ERR_FAILED console error; map fetches were cancelled during navigation. These are text-translation journeys, not map acceptance. Final 390px screenshots still merit reinspection before release evidence is finalized.
- Port 3260 is no longer listening and no owned dev process or Vitest process appeared in the checkpoint process inspection. Re-identify any new process before stopping it. Do not assume old tool handles survive a reset.
- The second disposable database upgrade retained row hashes for 277 checked tables. See restored-translation-scope-upgrade.json; its backup has not itself undergone another restore drill.

Private logs, browser harness, screenshots, mutation runners and backups: `/home/nathaniel/.local/state/openplan/response-write-probe-20260913`. Never commit credentials or dumps. Final browser files start `translation-scope-1440-` and `translation-scope-390-`; full isolation log is `translation-scope-full-rls.log`.

## Resume here

1. Inspect current ownership/status, final browser captures and evidence. Source disposable stack: `supabase_db_openplan-restore-target-2026091050`, API 29821, DB 29822. Retained restored stack: `supabase_db_openplan-restore-target-2731143`, API 28761, DB 28762, workdir `/home/nathaniel/.local/state/openplan/openplan-restore-drill.enw48S/openplan-restore-target-2731143`. Both are now 327 through 20261014000008. Do not reset them. Candidate pre-install mutation scripts assume schema 326; do not rerun blindly against 327.
2. Prepare v0.57.1 package/lock, changelog, release-ordering ledger (327 migrations), and current-release product metadata. Verify any changed guard with a harmless control and a targeted failure.
3. Run full applicable QA and shuffled tests, remaining worker/upgrade checks as warranted. Do not treat the earlier main CI as patch CI. Complete and preserve evidence, land directly on main, inspect successful CI at the exact final release commit, then tag and publish. No PR or human-review gate.
4. Resume translation history/recovery from `../2026-09-13-m9b-translation-custody/NEXT.md`. Its SQL prototype is still uninstalled. The machine translation helper silently truncates source at 4000 characters and runs sequential model calls inside a request; these remain observed software gaps for that workflow.
5. Continue the full product contract and roadmap. Preserve the pending reminder constraint, local/free operation, all geography obligations and independent model-validation boundaries.

The patch fixes a demonstrated cross-workspace translation write via native relational constraints. See VERIFICATION.md for the reproduction and limits. Run `npm run product:direction:check` and read current authorities before selecting the following substantial lane.
