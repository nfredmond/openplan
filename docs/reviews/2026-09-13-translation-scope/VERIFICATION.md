# Translation target isolation, September 13, 2026

This security correction is in development for v0.57.1. v0.57.0 remains the published release. Main checkpoint 542ffdd0 passed CI and RLS; new release evidence for this patch is not complete.

## Reproduced defect

Authenticated translation writes were authorized solely by the row's workspace_id. A writer could name their own workspace and a foreign campaign/entity, insert a translation, and alter that foreign campaign's retained public configuration. The API's inventory check did not protect direct PostgREST writes. The existing isolation census had no forged-relationship case for this table. The installed-schema probe reproduced this inside BEGIN/ROLLBACK. No foreign record was changed persistently.

Migration 20261014000008 adds native campaign/workspace and campaign/target foreign keys, with generated references for categories, questions, options and responses. A check binds campaign titles and each allowed source field to the correct entity kind. Source deletion cascades the translation as before; a source move cannot reinterpret a referenced translation. Native constraints enforce concurrent relationships without trusting a route preflight. Existing inconsistent rows refuse the upgrade instead of being silently rewritten. No public URL, role permission, translation wording or machine disclosure is changed.

## Current evidence

- The new live regression fails on schema 326. With the candidate, legitimate translation creation/correction/withdrawal works for all five target types. Foreign target IDs, forged workspace/campaign combinations, unsupported fields and viewer writes are refused. A translated category cannot move campaigns; deleting it removes its current translation.
- Baseline and harmless comment pass. Removing each of five relationship constraints or the field check fails for its stated target. All candidate schema changes were rolled back between probes.
- A valid pre-upgrade translation retains every original field. A forged legacy row makes migration validation fail. The initial category-move fixture reused a slug and hit an unrelated uniqueness constraint; distinct slugs corrected that test, and the intended FK now causes its failure.
- Source stack supabase_db_openplan-restore-target-2026091050 now has 327 migrations through 20261014000008. A private full dump preceded installation. Eight relevant engagement tables matched their before/after row hashes, excluding the new generated references. See installed.json. This backup has not itself been restored in a new drill.
- Installed live regression: one test passed. Focused translation/inventory regression: 55 tests passed. Baseline and harmless checks passed; deleting a generated-column inventory entry failed, and an empty SQL fixture failed its completion marker. The SQL fixture writes its marker only after the assertions finish.
- Actual PostgREST refused the forged write with HTTP 409 / SQLSTATE 23503 in 18 ms. The foreign definition was unchanged, no forged row existed, and anonymous table reads were refused with 42501. The initial HTTP probe used global sign-out for the synthetic account; it was corrected to scope local. Browser acceptance must use a fresh login afterward.

## Runtime and next steps

Owned checkout remains /home/nathaniel/.local/state/openplan/engagement-response-writes-2026-09-12, package openplan/, branch work/engagement-response-writes. Dev launcher node PID 3963087 serves port 3260, tool session 3208. which-openplan.sh identified its actual checkout; original main and demo are unchanged. Recheck process identity before stopping it for the build. The original npm dev attempt refused missing release files in the disposable workdir; the five exact release migrations were copied there, with byte equality, and normal predev sync then started the app. No migration history was repaired or reset.

Private evidence and browser scripts: /home/nathaniel/.local/state/openplan/response-write-probe-20260913. translation-scope-browser.cjs is the in-progress journey. The first attempt omitted activation, and the app correctly withheld its public link. The second saved/retried successfully but waited for a transient success notice removed by router.refresh; the script now checks persisted wording/status and the actual correction response. Those attempts are not passing journeys. The confirmation uses alertdialog. Complete desktop and 390px navigation, original/corrected/withdrawn public wording, original configuration hash retention, console and screenshot inspection before claiming browser acceptance.

Then run full applicable isolated RLS, upgrade/restore checks, full QA and shuffled tests; stop only the owned dev process before its production build. Prepare package/changelog/release ledger as v0.57.1, land verified work directly on main, inspect exact CI and tag. No human-review gate or PR. Preserve the pending reminder constraint and free/local operation.

After this correction, resume the [translation-history increment](../2026-09-13-m9b-translation-custody/NEXT.md). Its prototype is still uninstalled. Also address the observed machine helper's silent 4000-character source truncation and sequential request-bound generation as part of that workflow; no complete long-text or durable model-job behavior is claimed yet. Full v1 and the roadmap's other early priorities remain open.
