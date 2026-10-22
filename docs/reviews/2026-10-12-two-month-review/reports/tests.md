I finished the review and re-checked the earlier analysis against the code and CI. The suite is large and mostly tests real behavior: about 23 of 30 recent files I sampled check outcomes, not wiring. The weak points are hand-kept lists, one live-test detector that misses most of the files it checks, and CI time spent on work that does not need to run on every PR.

Nothing was run except `gh run list` and `gh run view` reads. The reviewed commit is `c735abec3a0ed5bd839988c669ecdc6344c44a8f`; code citations are to that commit.

**Bottom line**
1. **A live security test has never run in CI.** `contract-completed-review-rls.test.ts` was added 2026-09-08. It is gated with `describe.skipIf(!LIVE_RLS)` (line 15) and is missing from the hand-typed file list in `package.json:16`, which is still true on current origin/main. The check meant to catch this, `package-scripts-resolve.test.ts:160`, only recognizes the `LIVE_RLS ? describe : describe.skip` form. That form is used by 45 files; 60 others use `skipIf`, and the check cannot see them.
2. **The map attribution guard misses the map residents see.** `every-map-credits-its-sources.test.ts:20` only matches `new mapboxgl.Map(`. The public engagement map builds its map with `new gl.Map(` (`public-map-stage.tsx:606`). That map does credit its sources today, but nothing would catch a regression.
3. **Most of the RLS job is one feature.** The engagement synthesis suites take 2,058 of 2,506 seconds (82%) of file time in the 43-minute live RLS step. The core cross-tenant proof takes about 32 seconds.
4. **Most of the main test step is page-environment setup.** In the 23-minute vitest step, 1,110 seconds of cumulative time goes to setting up a simulated browser page (jsdom). About 1,570 of 1,676 files get one by default, including the guards and logic tests that never touch a page.

## 1. Inventory by area

| Area | Test files | Test cases (static) | Test lines | Source lines | Test-to-source |
|---|---|---|---|---|---|
| Logic tests (src/lib) | 675 | 7,467 | 141,366 | 212,123 | 0.67 |
| Components | 338 | 2,827 | 72,470 | 110,823 | 0.65 |
| API routes | 267 | 3,159 | 88,320 | 80,667 | 1.09 |
| Pages | 69 | 808 | 29,392 | about 56,400 | 0.52 |
| Guards and source scans | 138 | 852 | 26,916 | n/a | n/a |
| Live RLS | 110 | 610 | 19,149 | 405 migrations | n/a |
| Worker and process | 37 | 531 | 5,904 | n/a | n/a |
| Other | 42 | 247 | 4,625 | n/a | n/a |
| **Total** | **1,676** | **16,501** (23,380 run after expanding `.each`) | **388,142** | **461,955** | **0.84** |

Python adds 154 suites in the AequilibraE worker, 98 in modeling scripts, 17 in ops, 19 in ActivitySim, 6 OCR and 8 ODM, about 48,000 lines in the three largest folders.

Mocking is heavy where it matters: about 3.1 `vi.mock` calls per route test file and about 5.9 per page test file.

**Why local runs need 2 workers and a memory watchdog:**
- `vitest.config.ts` sets no worker cap, so vitest scales workers with this machine's 24 CPU threads.
- Each worker measured about 1.9 GB on 2026-10-02. Even 12 workers exceed the 31 GB of RAM before other agent sessions are counted.
- Each worker is heavy for three reasons:
  - jsdom is the default environment, and only 106 files opt out to plain node.
  - 88 guards each walk and re-read the 462,000-line source tree on their own.
  - Page tests load whole page module trees. In CI the import phase alone took 383 seconds cumulative (`ci-qa-gate-38174058924.log:15448`).

## 2. Convention guards

All 84 tree-walking guards run offline in both "verify (qa gate)" and "order independence" on every PR. The earlier draft marked `package-scripts-resolve`, `every-operator-setting-is-discoverable` and `live-rls-suites-run-serially` as live-only; that was wrong, and the CI log shows all three run in verify. Only the live halves of `policies-are-enforced-guard`, `measure-fund-rls` and `engagement-public-copy-privacy-rls` wait for the RLS job.

Control types, as detected by matching test titles (heuristic):
- **38 have a seeded control:** a test that feeds in a known bad example and proves the guard catches it.
- **23 have only a floor:** they check they scanned "at least N files", which proves they ran but not that their pattern can find anything.
- **23 have neither.**
- **14 state a blind category** in their header.

**Seeded control:**
`a-class-name-is-not-a-style`, `a-route-file-exports-only-route-handlers`, `aerial-artifact-custody`, `body-limit-route-inventory`, `brand-accent-is-not-a-text-surface`, `census-api-key`, `corridor-vocabulary`, `crash-source-token-guard`, `document-library-confinement`, `engagement-notifications-reader-inventory`, `engagement-survey-reader-inventory`, `every-api-route-has-a-caller`, `every-workspace-list-read-is-scoped`, `foundation-audit-ratchet`, `geography-route-reachability-guard`, `gtfs-claim-boundaries`, `invoicing-reimbursement-profiles`, `knowledge-base-retrieval`, `modeling-requirements-cover-the-modeling-imports`, `no-paid-tier-guard`, `numbers-read-the-same-on-every-machine`, `one-claim-tier-labeler`, `one-comment-stripper`, `one-name-for-a-console-filter`, `one-pending-schema-classifier`, `pdf-writer-confinement-guard`, `project-delete-preconditions`, `qa-harness-route-contract-guard`, `refused-crash-person-fields`, `rtp-priority-basis-comes-from-a-jurisdiction-registry`, `safety-claim-boundaries`.
Seeded and blind category stated: `no-hardcoded-place-guard`, `no-personal-brand-guard`, `planner-copy-says-the-plain-thing`, `safety-map-first-popup-legibility`, `ui-primitives-use-token-ink`, `worklist-cards-do-not-nest`, `workspace-write-role-gate-guard`.

**Floor only:**
`a-column-nothing-reads-is-a-question`, `a-gtfs-tier-comes-only-from-the-parser`, `an-agent-may-not-promote-a-tier`, `both-doors-into-the-record-are-geofenced`, `every-api-route-audits`, `every-operator-setting-is-discoverable`, `every-page-titles-its-own-tab`, `every-record-patch-field-is-sent-by-a-caller`, `every-worker-suite-can-actually-run`, `guided-flow-invariants-guard`, `interface-copy-does-not-leak-internal-vocabulary`, `map-layer-caps-are-reachable`, `no-test-asks-for-less-time-than-the-global`, `page-tabs-maps-are-resized`, `success-is-said-once-and-stays-said`, `the-setup-doctor-names-real-things`, `vercel-cron-schedule-matches-the-routes`, `write-zero-row-status-guard`.
Floor only, blind category stated: `create-forms-inline-ratchet`, `every-map-credits-its-sources`, `grants-links-open-the-right-tab`, `planner-pages-carry-no-build-notes`, `portal-one-submission-form`.

**No control found:**
`a-part-finished-survey-can-be-resumed`, `active-roadmap-guard`, `an-anchor-in-a-repeated-card-carries-its-row-id`, `crs-registry-is-generated-and-complete`, `deployment-health`, `live-rls-suites-run-serially`, `map-default-center`, `model-run-kpis-reader-inventory`, `nav-registry`, `one-way-to-confirm-a-destructive-action`, `package-scripts-resolve`, `page-tabs-anchors-have-elements`, `page-tabs-guard-anchor-tables-track-source`, `page-tabs-page-header-and-record-creation`, `product-direction-review-guard`, `public-page-claims-guardrails`, `report-packet-cannot-cite-another-projects-gate`, `risk-and-issue-status-branches-are-reachable`, `work-plan-template-content`, `work-plan-templates`, `workspace-membership-query-guard`.
No control, blind category stated: `crash-vocabulary-is-jurisdiction-neutral`, `safety-copy-names-no-jurisdiction`.

**Guards that do not walk the tree:**
- `migrations/no-destructive-migration`, `migrations/release-ordering` and `migrations/inventory` are seeded.
- `write-policy-coverage-guard` and `viewer-write-denial-guard` are seeded and state a blind category.
- `labels-are-sentence-case` checks only a hand list of 171 files (lines 21 onward), so every new file is unchecked. The file says so.

**Blind categories found in this pass:**
- `package-scripts-resolve.test.ts:160` cannot see any of the 60 files that use the `skipIf` form, and has already let one through (finding 1 above).
- `every-map-credits-its-sources.test.ts:20` misses the public map (finding 2 above).
- `corridor-analysis-follows-light-mode.test.ts:28-31` checks only two CSS selectors. It would not catch the general #193 class: a new dark-only rule.

**Copy guards and the "less text" goal.** The copy guards help with tone but do nothing for volume, and the test suite as a whole works against cutting words.
- **Helps:**
  - `planner-pages-carry-no-build-notes` keeps build notes out.
  - `planner-copy-says-the-plain-thing` and `interface-copy-does-not-leak-internal-vocabulary` keep jargon out.
- **Gaps:**
  - The build-notes guard bans seven phrases, skips `src/lib`, and has only a file-count floor (lines 21-30, 52-54), so nothing proves its patterns can find anything.
  - No guard measures how much text a page carries.
- **Hinders:**
  - 1,062 test assertions in 216 files pin UI sentences of 40 characters or more, so every cut means editing tests.
  - 40 assertions require a phrase to appear two or more times. For example, `model-recovery-status-controls.test.tsx:33` and `:42` require the same notice text to appear twice, and `published-comparable-observation-card.test.tsx:73` requires "SHA-256 unavailable" five times. These tests fail if a duplicate is removed.

## 3. Quality sample (30 files, all added since 2026-09-11, picked across areas)

Result: 23 test behavior, 4 check projections (call shapes or source text instead of outcomes), 2 are guards, 1 partly asserts on its own fixture. None are render-only. One carries an order-dependence risk.

| File (date added) | Class | Note |
|---|---|---|
| public-map-draws-without-a-mapbox-key.test.tsx (10-10) | behavior | Says plainly at :9-11 that MapLibre is faked |
| model-recovery-status-controls.test.tsx (10-08) | behavior | Pins duplicated copy at :33 and :42 |
| land-use-plan-context-editor.test.tsx (10-07) | behavior | Dense one-line style, :57-113 |
| engagement-synthesis-execution-panel.test.tsx (10-06) | behavior | |
| command-palette.test.tsx (10-02) | behavior | States the jsdom focus blind spot at :21-23 |
| engagement-review-history-ui.test.tsx (09-14) | behavior | Long sentences pinned at :12 and :19-21; minified style |
| engagement-translation-write-storage-recovery.test.tsx (09-13) | behavior | |
| map-package-routes.test.ts (10-10) | behavior | Hand-built database fake with no 1,000-row cap (:26-37) |
| land-use-report-provenance-route.test.ts (10-07) | behavior | Single-row reads only |
| engagement-synthesis-continuation-route.test.ts (10-07) | behavior | Mocks the server library (:7); proves only auth order at the HTTP boundary, as its name says |
| engagement-synthesis-thematic-browser.test.ts (10-02) | behavior | |
| engagement-synthesis-review-route.test.ts (09-14) | projection | Asserts database-call shapes (:41, :51, :61); the SQL itself is proven only in the live job |
| engagement-translation-retired-route.test.ts (09-13) | behavior | |
| gtfs-retained-archive-transport.test.ts (10-11) | behavior | Runs against a real local HTTP server |
| gtfs-parsed-artifact.test.ts (10-09) | partly tautological | :27-29 assert on the fixture, not on the decoder's output |
| land-use-plan-descriptor-snapshot.test.ts (10-07) | behavior | Pins sentences at :36-37 |
| engagement-synthesis-preparation-journal.test.ts (10-02) | behavior | Uses a real temporary folder |
| engagement-synthesis-thematic-requests-server.test.ts (10-01) | behavior | Mocks the history loader (:12) |
| engagement-synthesis-generation-plan.test.ts (09-30) | behavior | |
| engagement-synthesis-preparation.test.ts (09-14) | behavior | Covers boundaries at 0, 300, 301 and 1,201 comments |
| invoicing-opens-on-the-current-workspace.test.tsx (10-10) | behavior | Stubs child lanes, and says so |
| model-recovery-page.test.tsx (10-08) | projection | :89-91 and :120-122 check query strings |
| land-use-plan-version-navigation.test.tsx (10-07) | behavior | Pins a full sentence at :16 |
| build-respects-operator-memory.test.ts (10-10) | behavior | Spawns real npm |
| corridor-analysis-follows-light-mode.test.ts (10-10) | projection | CSS text check, :28-31 |
| labels-are-sentence-case.test.ts (10-10) | projection | Checks a hand list at :21 |
| numbers-read-the-same-on-every-machine.test.ts (10-02) | guard, seeded | Control at :55-62 |
| project-map-packages-rls.test.ts (10-10) | behavior, live | |
| gtfs-worker-cli-options.test.ts (10-10) | behavior, order-dependence risk | Varies the setting properly (45 minutes against a 180-second default). But :21 imports a script that registers SIGINT and SIGTERM handlers on the shared worker (`scripts/workers/gtfs-ingestion.ts:13`) and never removes them |
| every-map-credits-its-sources.test.ts (10-10) | guard, floor only | Blind at :20 |

**Hard-coded totals bumped to make tests pass:**
- `rls-isolation.test.ts:1667` `toHaveLength(92)` went through 17 bumps since August 1 (42 to 92). Lines 1668-1762 restate the probe list word for word; the real check is the schema-derived live test at :2073.
- `migration-schema-drift.test.ts:44` `.toBe(286)` went 252, then 264, then 286.

**Exemption lists that grew** (from `list-growth.txt`, counts on 08-11, 09-10, 10-11):
- `a-column-nothing-reads-is-a-question.test.ts:71` UNREAD_COLUMNS: 10, 21, 111.
- `workspace-write-role-gate-guard.test.ts:114` UNGATED_BY_DESIGN: 13, 16, 17.
- `migrations/no-destructive-migration.test.ts:41` ALLOWLIST: 10, 19, 19.
- `every-api-route-has-a-caller.test.ts:69` EXTERNAL_CALLERS 10 to 16, and `:113` PARTIAL_PATH_CALLERS 0 to 10.
- Shrinking, which is the intended direction: UNVERIFIED_CALLER_WRITES 37 to 33; KNOWN_UNWIRED 1 to 0.

**Upkeep cost:** 124 of 1,150 non-merge commits since 09-11 touched one of these hand-kept lists or `package.json` (an upper bound, since `package.json` also changes for dependencies).

**Style:** 77 test files use a dense one-line style, 2,585 test lines run past 200 characters, and there is no formatter or line-length rule.

## 4. Mutation evidence

**It is real.** I found 312 structured result files in `docs/reviews`. They record 1,070 mutations killed and 74 survived, and include 142 negative controls (harmless edits that should change nothing); 92 are recorded as survived, which is the correct result. The results carry real stack traces; one example is `docs/reviews/2026-09-12-m9b-follow-through/mutations.json`.

**It is not repeatable.**
- The results use at least 20 different formats.
- Each review wrote its own harness: 821 Python scripts plus many .mjs and .cjs files sit in `docs/reviews`.
- Nothing re-runs these checks except four ops suites run with `--prove-mutations`, `workers/science_regression_mutations.py`, and `foundation-audit-ratchet`.
- `foundation-audit-ratchet` is a static ledger. Its lines 1044-1057 check the ledger's own arithmetic, and :1034 states that under 5% of test files were audited.

**How much of docs/ it is:**
- docs/ is 137 MB in 6,219 files, of which docs/reviews is 134 MB: 2,505 JSON, 1,083 logs, 821 .py and 413 PNG files.
- 375 files have "mutation" in the name (4.0 MB), and 1,132 files mention it.
- Files that mention mutation at least five times hold 88,796 of 230,521 text lines, about 39%.
- The repo's git pack is 1.18 GiB.

## 5. Live RLS

- **Stack:** Supabase CLI ^2.76 in the GitHub runner, Postgres 17, `supabase db reset` applying 405 migrations, then vitest one file at a time with `OPENPLAN_RLS_LIVE_TEST=1`.
- **Two styles of proof:**
  - Some suites go through the REST API with anonymous and signed-in users (`rls-isolation`).
  - Others run SQL as the postgres superuser through `docker exec psql` inside a rolled-back transaction (the contract-* suites and map packages).
- The job blocks PRs.
- **Last green on main:** run 38180696617, 2026-10-11 22:30 to 23:16 UTC. It ran 104 files: 1,499 tests passed and 125 skipped. The test step took 43.4 minutes.
- **Nightly:** run 38155008315 was green.
- **Coverage:**
  - 105 files are live-gated, 104 are listed, and the one gap is `contract-completed-review-rls`.
  - All 125 skips are the candidate probes in `engagement-synthesis-response-candidate-rls.test.ts:25` and `:1000`. They need `OPENPLAN_SYNTHESIS_CANDIDATE_TEST` or `OPENPLAN_DECISION_SYNTHESIS_CANDIDATE`, and nothing in the repo sets either.

## 6. Python and worker tests

- **CI on main is green:** run 38180696895, each Python job 1.3 to 1.8 minutes.
- **Never run in any workflow (18 suites):**
  - `workers/ocr_worker`: 6 suites.
  - `workers/odm_worker`: 8 suites.
  - `activitysim_worker`: 3 top-level suites (`test_run_launcher.py`, `test_screening_handoff.py`, `test_worker_heartbeat.py`).
  - The map-package skill's `test_checks.py`.
- **Safety floors are loose:**
  - The worker job requires 28 suites but has 154.
  - The modeling job requires 40 but has 97, and its comment still says "44 of 45".
- **Duplicate runs:** `worker-security-regression.yml` lists about 38 suites by name, most of which the glob job already runs.
- **Mostly skipped in CI:** `every-worker-suite-can-actually-run` skips 9 of 16 tests in CI because there are no local virtual environments there.

## 7. Browser and journey tests

- **What exists:** qa-harness (Playwright 1.58) has 12 local smokes and 9 production smokes.
- **Nightly:** the job runs 6 of the local smokes and does not block PRs.
  - 33 of the 35 completed scheduled runs since 09-06 were green.
  - **Failures:**
    - 09-08 (cause not checked).
    - 10-11: `local-rtp-release-review-smoke`, TimeoutError. #202 fixed it, and two runs on that branch were green the same day.
  - The 10-07 run is stuck in "queued".
- **Smokes not in the nightly run:**
  - land-use-plan review reporting, dual-demand report grant, aerial ortho render, governed decision handoff, jurisdiction readiness.
  - workspace URL isolation, which is excluded on purpose with a stated reason.
- **Production smokes** run in no workflow. "Production Health" shows "skipped" on every listed run through 09-08.
- **No accessibility (axe) checks anywhere.**
- The CI step "First-week browser instrument" runs Node unit checks, not a browser.

## 8. Skips, only, retries, flaky markers

- No `.only`, no `.todo`, and no unconditional `.skip`.
- No retries in vitest or Playwright.
- The word "flaky" appears 3 times, all in product prose.
- **Every skip is gated on an environment variable:**
  - 97 live files (1,604 tests) are skipped in the verify job.
  - 125 permanently skipped candidate probes (section 5).
  - 9 skipped tests in the worker-suite probe.
- **Timeout:** the global test timeout is 20 seconds, and a guard stops individual tests from lowering it.
- **The shuffled job finds real order-dependence:** 7 failures in its history appeared only in shuffled order. Example: `engagement-synthesis-thematic-choice-panel.test.tsx` on 10-09, seeds 477439 and 48963.

## 9. Significant source with no direct test

Method: a file counts as tested if any test file names it. That overstates coverage for files only read by guards and understates it for files imported through other modules. Even so, 92.5% of source lines are named by some test.

**Largest untested files:**
- `api/models/[modelId]/runs/[modelRunId]/volumes/route.ts`: 397 lines.
- `api/measures/[measureId]/periods/route.ts`: 341 lines.
- `lib/models/verified-dual-demand-agreement-server.ts`: 377 lines. This is the code behind your standing dual-model comparison directive.
- `components/dashboard/coming-up-rail.tsx`: 199 lines. This is where the #187 P1 lived. Only its logic in `lib/dashboard/coming-up` is tested.
- `components/workspace-gis/workspace-gis-upload-wizard.tsx`: 671 lines.
- `rtp/_packet-state.ts`: 452 lines.
- `reports/.../report-standard-detail.tsx`: 415 lines.
- Map packages: 6 of 7 library files and all 3 components (1,052 lines). The routes are tested.

**User flows with no browser test:** map packages end to end, GIS upload, the measure fund lifecycle, invoicing, and the resident map on a phone (unit-tested with a fake map only).

**Database fakes:** the shared paging fake that models the 1,000-row cap is used by 2 test files. 32 test files hand-build range fakes, and 34 source files page their reads.

## 10. Top 15 improvements, best confidence per hour first

1. **Fix the live-test detector (30 min).** Make `package-scripts-resolve.test.ts:160` recognize `skipIf(!LIVE_RLS)`, and add `contract-completed-review-rls` to `test:rls-live`. Better still, build the live list from a file-name pattern instead of by hand.
2. **Cancel stale PR runs (15 min).** Add `concurrency` with `cancel-in-progress` for pull requests to the CI, RLS Isolation and Worker security workflows. Over 30 days there were 635 CI runs, and no workflow has a concurrency group.
3. **Fix the map credit guard (20 min).** Change `every-map-credits-its-sources.test.ts:20` to match `new <any>.Map(` and add a seeded control.
4. **Delete the restated lists (30 min).** Remove the offline list at `rls-isolation.test.ts:1664-1762` and the exact count at `migration-schema-drift.test.ts:44`. Derived checks already cover both, and this ends a bump on every migration.
5. **Split or shard the RLS job (1-2 h).** Keep the core isolation suites on every PR; run the synthesis family in parallel shards or path-filter it. This should take PR wall time from about 46 minutes to about 15-20.
6. **Change test environments (2-4 h).** Default vitest to node, use jsdom only for `.tsx` files or by opt-in, and cap workers in the config. This targets the 1,110 seconds of setup and should make local full runs safe without a watchdog.
7. **Run the 18 missing Python suites (1-2 h).** Add them to CI, set the floors to the real counts, and remove duplicates from the security workflow.
8. **Remove the dead probes (30 min).** Delete or archive the 125 candidate probes that nothing ever enables.
9. **Make npm audit advisory (15 min).** Move `npm audit --audit-level=low` to a scheduled job, or raise the level to high for production dependencies only.
10. **Take the shuffled job off the PR critical path (15 min, medium confidence).** Run it on main pushes and nightly, keeping seed replay. This saves about 23 runner-minutes per PR, but order-dependence defects would be found up to a day later.
11. **Add a text-volume guard (2 h).** Count renderable words per page and allow the count only to fall. Extend the build-note guard to `src/lib`, give it a seeded control, and stop the jargon ledger from skipping `<details>` blocks.
12. **Stop pinning long sentences (1 h).** Ratchet down the 1,062 long-sentence assertions and use roles or test ids in new tests. At the same time, stop knip from treating tests as entry points so it can see the roughly 1,940 lines only tests use.
13. **Test the riskiest untested files (about 1 h each).** In order: the volumes route, the dual-demand agreement server, the measure periods route, the coming-up rail and the map-package creator.
14. **Strengthen the nightly smokes (2-3 h).** Add axe checks to the six nightly smokes and add the four missing local smokes.
15. **One mutation harness (3-4 h).** Write a single harness in `scripts/ops` with a fixed result format and a required negative control. Stop committing per-review harnesses and logs to `docs/reviews`.

Reproducible outputs are in `/home/nathaniel/.local/state/openplan-review-20261011/tests/work/`:
- `guard-table-draft.txt`
- `ci-runs-30d.txt`
- `rls-main-38180696617.log`