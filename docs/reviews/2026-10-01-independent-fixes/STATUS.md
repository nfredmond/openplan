# Independent review corrections

The user authorizes implementation, commit, push and PR monitoring on October 1, 2026 after the independent review. The review itself remains preserved in its separate worktree. This correction branch starts from `891a0d89a848133d44b9e4f314a76a922cd71ace`, the documentation successor to v0.66.0 release `bc47c0ce580ee24f1a3808978535f52218e796d4`.

Owned branch: `fix/independent-review-20261001`. Owned checkout: `/home/nathaniel/.local/state/openplan/independent-fixes-20261001`. The engagement and UI agents retain their own files, branches, test stacks and browser sessions. No canonical checkout, active development checkout or demo changes are part of this task. Main was still at the baseline when implementation began.

Implementation addresses SCI-01/02/03, SEC-01/02, PROV-01/02, FIN-01/02/03 and UI-01. It also corrects the adjacent unpaged generated-evidence reads and preparation-history loops described as concerns in the review. Full v1 roadmap work and the unfinished current-staff context-history prototype remain outside this bounded correction.

Root owns financial allocation/parent integrity, complete reads, dashboard query, integration and Git operations. Specialist ownership covers worker/science, provider approval/recovery and Storage authorization. All source mutations have been restored. Independent migration review uses rollback-only synthetic probes.

## Evidence status

Focused regression, native financial/Storage and mutation checks pass. The complete local QA gate passed: lint, dead-code checks, 16,740 application tests (1,190 explicit skips), 387 connector tests (4 explicit skips), dependency audit with zero reported vulnerabilities and the production webpack build. The separate native RLS suite remains in progress. GitHub CI and publication are not yet claimed. Initial QA found an unlisted transitive Storage test import. The test now uses the declared Supabase client and the same installed Storage implementation; its tests and mutations were rerun. No gate was weakened.

The declared full worker matrix cannot run in this new checkout because its five worker environments are absent: 54 suites were explicitly not run, and the command exits nonzero. Relevant ActivitySim/county/scientific suites run in the isolated review Python environment, and a new CI workflow runs those checks independently. This is not a full engine-install or complete worker-matrix claim.

The owned Supabase project `independent-fixes-20261001` uses API29981/DB29982 and applies both additive migrations. Runtime files are outside the repository at `/home/nathaniel/.local/state/openplan/independent-fixes-runtime-20261001`. No other database was a target.

## Browser evidence

T3 tab `tab_2` runs the correction checkout on port3198, identified by the dev launch process in `evidence/browser-identity.txt`. Real navigation follows home, account creation, sign-in, dashboard and Projects with a synthetic account. Desktop1440x900 and390x844 snapshots are retained. The dashboard no longer reports the missing-column submittal read error. The native loader test separately proves authorized nonempty submittals and foreign-workspace exclusion.

The inspected page reports no new console error during the active journey. Historical HMR failures belong to the earlier review server after it was stopped and are not attributed to this build. Font preload warnings remain. The existing narrow navigation overflow and whole-app presentation are outside this query correction and belong to the concurrent UI work. These checks do not establish full keyboard/screen-reader or practitioner acceptance. The owned dev server stopped after captures, before the production build.

Raw local execution logs are retained but excluded from Git; reproducible checks, mutation summaries and synthetic screenshots are included. No real provider call, frozen study rerun or paid resource was used.

The full QA run also caught a reimbursement HTTP mock that returned its same nonempty page forever. It now implements range slicing and asserts the final empty-page projection. A harmless route comment survives and removing the retained snapshot-hash projection fails the intended assertion. Both mutations restore the original source. The stack helper adds only this verified isolated stack name; a bypass mutation fails its denial cases.
