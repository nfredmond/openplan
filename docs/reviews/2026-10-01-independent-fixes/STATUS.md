# Independent review corrections

The user authorizes implementation, commit, push and PR monitoring on October 1, 2026 after the independent review. The review itself remains preserved in its separate worktree. This correction branch starts from `891a0d89a848133d44b9e4f314a76a922cd71ace`, the documentation successor to v0.66.0 release `bc47c0ce580ee24f1a3808978535f52218e796d4`.

Owned branch: `fix/independent-review-20261001`. Owned checkout: `/home/nathaniel/.local/state/openplan/independent-fixes-20261001`. The engagement and UI agents retain their own files, branches, test stacks and browser sessions. No canonical checkout, active development checkout or demo changes are part of this task. Main was still at the baseline when implementation began.

Implementation addresses SCI-01/02/03, SEC-01/02, PROV-01/02, FIN-01/02/03 and UI-01. It also corrects the adjacent unpaged generated-evidence reads and preparation-history loops described as concerns in the review. Full v1 roadmap work remains outside this bounded correction. Concurrent context-history work is integrated and its relevant tests are rerun without taking ownership of that feature.

Root owns financial allocation/parent integrity, complete reads, dashboard query, integration and Git operations. Specialist ownership covers worker/science, provider approval/recovery and Storage authorization. All source mutations have been restored. Independent migration review uses rollback-only synthetic probes.

## Evidence status

Focused regression, native financial/Storage and mutation checks pass. The complete local QA gate passed: lint, dead-code checks, 16,740 application tests (1,190 explicit skips), 387 connector tests (4 explicit skips), dependency audit with zero reported vulnerabilities and the production webpack build. The separate full native RLS run completed with 1,086 passing tests, 125 explicit skips and one 300-second synthesis CLI timeout. That run is not a pass. Its retained database records show 122 of 124 outputs, no claimed attempt without output, and continued progress up to the cutoff. After integration, the unchanged isolated case passes in 275.308 seconds, including retained-history assertions. The full failed run remains recorded; its timing margin is narrow. GitHub CI and publication are not yet claimed. Initial QA found an unlisted transitive Storage test import. The test now uses the declared Supabase client and the same installed Storage implementation; its tests and mutations were rerun. No gate was weakened.

The declared full worker matrix cannot run in this new checkout because its five worker environments are absent: 54 suites were explicitly not run, and the command exits nonzero. Relevant ActivitySim/county/scientific suites run in the isolated review Python environment, and a new CI workflow runs those checks independently. This is not a full engine-install or complete worker-matrix claim.

The owned Supabase project `independent-fixes-20261001` uses API 29981 / database 29982 and applies both additive migrations. Runtime files are outside the repository at `/home/nathaniel/.local/state/openplan/independent-fixes-runtime-20261001`. No other database was a target.

## Browser evidence

T3 tab `tab_2` runs the correction checkout on port 3198, identified by the dev launch process in `evidence/browser-identity.txt`. Real navigation follows home, account creation, sign-in, dashboard and Projects with a synthetic account. Desktop 1440×900 and 390×844 snapshots are retained. The dashboard no longer reports the missing-column submittal read error. The native loader test separately proves authorized nonempty submittals and foreign-workspace exclusion.

The inspected page reports no new console error during the active journey. Historical HMR failures belong to the earlier review server after it was stopped and are not attributed to this build. Font preload warnings remain. The existing narrow navigation overflow and whole-app presentation are outside this query correction and belong to the concurrent UI work. These checks do not establish full keyboard/screen-reader or practitioner acceptance. The owned dev server stopped after captures, before the production build.

Raw local execution logs are retained but excluded from Git; reproducible checks, mutation summaries and synthetic screenshots are included. No real provider call, frozen study rerun or paid resource was used.

The full QA run also caught a reimbursement HTTP mock that returned its same nonempty page forever. It now implements range slicing and asserts the final empty-page projection. A harmless route comment survives and removing the retained snapshot-hash projection fails the intended assertion. Both mutations restore the original source. The stack helper adds only this verified isolated stack name; a bypass mutation fails its denial cases.

## Integration checkpoint

Correction commit `a08f0b000039abdf4b9fcb5289257ba2e1060ff9` contains the fixes. Merge commit `9530d77c860dccea228f57debe4496afc6b3a513` integrates main through `d72c11095e679e897dcf7796fcc6bbcc4ee1ad0c`, including ancestor `a6f0376e6b9742038646ebfe90095b43f122e985`. The merge parents establish that exact boundary; the earlier integration note understated it as a6f0376e alone. The package-script conflict is resolved by retaining all 81 native test files. No application source conflict occurs. Independent source review finds no financial/provider coupling in the successor. The a6f0376e ancestor's application and native CI pass independently. The merged tree passes 121 focused context/history/release-ordering tests.

The timed-out synthesis case uses a different worker execution path from the connector recovery fix. Main does not supply an evidenced timeout correction. The unchanged isolated test retains the 124-frame workload and 300-second deadline. Aggregate evidence and its limits are in `providers-native-timeout.json`; no raw records or credentials are included.

The merged tree also passes all seven native context-history tests, including harmless and targeted SQL mutations, and the direction check. The isolated recovery rerun skips the other 13 tests in that file by name selection; all 13 passed in the preceding full native run. This is an isolated successful rerun, not a claim that the original aggregate invocation passed.


## Follow-up at the integrated boundary

Bounded review of intervening UI commits finds unsupported submission-receipt wording, a reset-only portal retry that retains a failed server response, malformed callback destinations that throw, and numeric Census overlays that lose missing-value provenance before rendering. The branch corrects those behaviors. [Recovery evidence](UI_RECOVERY_FIXES.md) includes an actual desktop and 390px server-fault journey. [Map evidence](MAP_DATA_FIXES.md) executes the actual ACS parser, geometry builder and style expression, with harmless controls and named fault failures. A visible Mapbox render remains unestablished because the isolated environment has no access token. Broader Census aggregate and proxy-classification availability remains outside this bounded overlay correction.

Standalone TypeScript checking initially exhausts the default Node heap. The unchanged check passes with the existing production build's 6 GB heap setting. No type rule is relaxed. The owned browser server and Supabase stack are stopped after evidence collection. Temporary browser routes and the external synthetic fault flag are removed. The Supabase stop preserves its default local data backup.


## Final local gate

After the callback, portal and map corrections, `npm run qa:gate` exits 0. It runs lint, dead-code checks, 16,887 application tests with 1,197 explicit skips, 387 connector tests with four explicit skips, dependency audit with zero reported vulnerabilities, and a successful production webpack build including TypeScript. Native RLS is explicitly outside this aggregate invocation; its separate results above still apply. The log is `evidence/qa-gate-publish.log` locally. A credential scan of 110 publication candidate text files finds no match for the isolated secrets or JWT pattern. The owned ignored environment file is removed after the build; no credential is committed.


## PR verification and concurrent integration

[PR 112](https://github.com/nfredmond/openplan/pull/112) publishes the correction branch. Its first application CI run on merge tree `ce572751e2a5de08af3823dc3d780e38a8f8e03f` passes normal and shuffled suites with 16,891 tests each and 1,197 explicit skips, the production QA gate, and modeling/operations/worker jobs. The native run passes all 81 files with 1,094 tests and 125 explicit skips. The unchanged 124-frame recovery test takes 184.022 seconds. This independent full run passes; the earlier local timeout remains recorded.

The first restore drill fails 14 tests before their SQL probes: the newly added Storage and financial migration tests duplicate a stack-name guard and omit the restore drill's disposable target. This is a test integration defect, not successful fault detection or evidence that restoration passed. The correction reuses the existing shared guard, which already permits explicitly named disposable restore targets. The shared allowlist is unchanged. Focused tests execute the actual probe functions with the Docker transport intercepted; the complete restore check must still pass in CI.

Main's strict status rule requires an up-to-date PR branch. Merge `5846584b` incorporates `49deefd0` and has exactly the same Git tree as the first tested PR merge (`0e80e5b30d0319912a026caf3f811ddb76869529`). Main advances again to `2402241129553ff85cad7df12d63e913a22da7c4` while GitHub's PR response still shows the older base. Direct remote refs establish the update. Merge `3f497f89` preserves the concurrent shell and thematic-input changes. Only the changelog and native-test script conflict; both retain the union of work, now 83 native files. Other package fields match exactly. The direction check passes. The two new thematic migrations follow the financial and Storage migrations without a name collision.

Superseded check runs belonging only to this PR are cancelled after the reproducible restore-harness failure; they are not reported as passes. No other agent's CI run or local process is stopped. Refreshed PR results are recorded in the PR description. GitHub's automated Codex reviewer reports a usage limit, so no automated reviewer approval is claimed.
