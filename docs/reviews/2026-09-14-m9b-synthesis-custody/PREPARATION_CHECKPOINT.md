# Complete source preparation checkpoint

September 14, 2026. Development checkpoint, not a release or completion of M9b.

The saved-source inspector now computes full free local preparation. Every retained comment, reply and survey answer belongs to a historical category group; each survey answer also belongs to a historical question group. Membership uses kind-prefixed IDs. Definition versions, question wording/type and missing context remain distinct. Counts include survey sessions with no selected answers and do not claim distinct people or representative support. Original text and typed values stay in the immutable source. The inspector permits selecting a group, reading its complete membership and searching/paging its full source records.

This is computed preparation, not a retained staff review. Themes, sentiment, typed-answer interpretation and representativeness remain unassessed. The old capped generator remains separate. Continue with durable review creation, exact recovery, optional worker generation, staff corrections and source-linked responses/decisions and exports under IMPLEMENTATION_BOUNDARY.md. Do not replace that complete outcome with grouping alone.

## Verification before browser acceptance

Full local QA passed with 15,441 tests, 549 skipped, 1,318 passing files and 55 skipped files. Lint, dead-code checks, provider connector checks, dependency audit with zero vulnerabilities and the webpack production build passed. QA's opt-in RLS hook did not run; there is no database, API, authorization or worker change in this increment. Source checkpoint 40e54ca8 has separately inspected green GitHub CI and RLS; the current increment still needs its own landing checks.

Fourteen focused tests include existing source-panel integration and ten new preparation/component cases. Baseline and harmless mutation control passed; 25 targeted faults failed the intended cases. See preparation-mutations.json and prove-preparation.py. This establishes counts, historical grouping, missing context, source kinds, survey sessions, complete membership and rendered filter/search behavior. It does not establish layout, database capture, staff judgment, retained reviews or exports.

The current source verifier and preparation consumed the retained native PostgreSQL RPC sample with 301 items and two survey answers. All 303 distinct members reconcile. A harmless control survives and dropping the final item fails the source-count guard. See native-preparation.json and native-preparation-mutations.json. This reuses a checksummed prior native result; it is not a fresh database run.

browser-preparation.cjs extends the existing real navigation/recovery/history journey with a question created/published through the survey builder, a public-form submission and full-text/group membership checks. Its first run and screenshots remain pending at this checkpoint. Do not treat the runner's existence as acceptance.

## Keyboard spacing correction

The first complete desktop and 390px runs on 8ab73ec5 passed their data, group, recovery and privacy assertions. Screenshot inspection then found that the focused membership summary's ring overlapped the first source-ID line. Those automated passes did not establish readable focused membership. Add spacing before that line and require its bounding box to clear the actual focus ring. The browser guard keeps a harmless class change and removes the spacing as a targeted counterexample, restoring both.

The spacing-only correction passed changed-file lint, all fourteen focused tests, the repeated ten-test/25-fault preparation proof and a fresh webpack production build. Full QA and shuffled seed 619143 passed before this CSS-only correction, both with 15,441 tests and 549 skipped. No database, worker, API or grouping logic changed after those broad runs. Corrected-build browser acceptance remains the next check at this paragraph.

Earlier runner failures are retained privately. Chrome exposed the Type select by its combobox role while the exact getByLabel locator matched nothing; two Open portal links required explicit publishing-flow scope; public surveys require their own Survey tab; and repeated identical synthetic answers needed unique per-run search text. These are runner corrections, not demonstrated application defects. The question publish action now follows the returned draft/published state and waits for its visible confirmation. Prior synthetic contributions remain intact.
