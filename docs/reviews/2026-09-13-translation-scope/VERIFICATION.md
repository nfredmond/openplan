# Translation target isolation, September 13, 2026

This security correction was published as v0.57.1 after exact-release-commit CI passed. See [publication evidence](PUBLICATION.md). The earlier development/runtime paragraphs below retain the sequence and are superseded by the final evidence and publication sections.

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

## Runtime and next steps (superseded by the completed checks below)

Owned checkout remains /home/nathaniel/.local/state/openplan/engagement-response-writes-2026-09-12, package openplan/, branch work/engagement-response-writes. Dev launcher node PID 3963087 serves port 3260, tool session 3208. which-openplan.sh identified its actual checkout; original main and demo are unchanged. Recheck process identity before stopping it for the build. The original npm dev attempt refused missing release files in the disposable workdir; the five exact release migrations were copied there, with byte equality, and normal predev sync then started the app. No migration history was repaired or reset.

Private evidence and browser scripts: /home/nathaniel/.local/state/openplan/response-write-probe-20260913. translation-scope-browser.cjs is the in-progress journey. The first attempt omitted activation, and the app correctly withheld its public link. The second saved/retried successfully but waited for a transient success notice removed by router.refresh; the script now checks persisted wording/status and the actual correction response. Those attempts are not passing journeys. The confirmation uses alertdialog. Complete desktop and 390px navigation, original/corrected/withdrawn public wording, original configuration hash retention, console and screenshot inspection before claiming browser acceptance.

Then run full applicable isolated RLS, upgrade/restore checks, full QA and shuffled tests; stop only the owned dev process before its production build. Prepare package/changelog/release ledger as v0.57.1, land verified work directly on main, inspect exact CI and tag. No human-review gate or PR. Preserve the pending reminder constraint and free/local operation.

After this correction, resume the [translation-history increment](../2026-09-13-m9b-translation-custody/NEXT.md). Its prototype is still uninstalled. Also address the observed machine helper's silent 4000-character source truncation and sequential request-bound generation as part of that workflow; no complete long-text or durable model-job behavior is claimed yet. Full v1 and the roadmap's other early priorities remain open.


## Final browser and restored-stack evidence

Final desktop (1440px) and phone (390px) journeys used source
f4aa6f6d4d0c35f67eea78573d388a02ee8b49a6 and installed migration SHA256
f03a86eaeffaefae342634677ff123c9ae10d41f55021c8bcd4ba90738426fec.
The saved identity log ties the development server to this checkout. The harness
enters through sign-in and keyboard navigation, creates a synthetic campaign in
the UI, activates it and follows its public link. No browser fixtures were seeded
by SQL. It loses the acknowledgement after an actual committed save, retries the
same body, corrects wording and withdraws it. Public wording follows those changes,
and the original configuration hash remains present. Both reports record no
horizontal overflow or page exceptions. Captures were inspected at both sizes.

The only final console error is the deliberately interrupted translation request.
Map reads cancelled during navigation are recorded separately. An earlier desktop
hydration warning was caused by Playwright screenshot caret styling; screenshots
with caret initial removed that instrumentation warning. Earlier failed harness
attempts remain diagnostic artifacts, not passes. The public page visibly reports
its unavailable map and provides a text form. This evidence covers text translation,
not map rendering or language quality. Existing configuration versions do not prove
complete private translation history or source/model/author retention.

The retained restored database advanced from 326 to 327 with all 277 checked tables
preserving their prior row hashes, excluding newly generated reference columns.
The full live RLS run then finished: 51 files and 481 tests passed in 354.05 seconds.
The final log is retained privately as translation-scope-full-rls.log. The new full
backup has not itself been restored in another drill. The previously verified
restore and this additive upgrade are separate evidence.

Release accounting controls pass for the baseline and a harmless comment, and
reject a deliberately incorrect 327-to-326 migration count. This guards recorded
release boundaries; it cannot establish migration behavior or tenant isolation.
Those are exercised by the separate SQL, HTTP and browser evidence above.


## Local release gates

Candidate v0.57.1 passed qa:gate, including lint, deadcode, 14,306 tests
(452 intentionally skipped), the provider connector suite, dependency audit with
zero vulnerabilities and the webpack production build. The same 14,306 tests
passed in shuffled order with seed 571913. All 52 worker suites ran and passed.
Live RLS ran separately on the named disposable restored stack, not implicitly
against a running demo. Log hashes and terminal outcomes are in local-checks.json.
These engineering suites do not establish human language usefulness or scientific
accuracy. Final main CI and publication are recorded separately after landing.
