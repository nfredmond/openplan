# v0.64.0 publication

Published September 30, 2026 at 09:52:55 UTC: [v0.64.0](https://github.com/nfredmond/openplan/releases/tag/v0.64.0). GitHub confirms non-draft and non-prerelease status. Annotated tag `50031fcaebe21783c3ca15ecfdd94a1c4078c119` resolves to release commit `62dc74e9b14d48b4a60dee54c52da38357990503`. Main advanced directly, without a PR.

All declared workflows passed on that exact commit before tagging:

- [CI 36697019320](https://github.com/nfredmond/openplan/actions/runs/36697019320): full QA, shuffled Vitest with seed 932774, modeling scripts, operations checks and worker tests.
- [RLS isolation 36697019440](https://github.com/nfredmond/openplan/actions/runs/36697019440): 732 tests in 68 files, with 125 historical candidate skips.
- [Populated upgrade 36697019364](https://github.com/nfredmond/openplan/actions/runs/36697019364): v0.63.0 migrations and seeded operational records upgraded through all four v0.64 migrations.

[Final CI](final-ci.json) retains exact job identities, outcomes and private log hashes. CI QA passes 15,944 tests with 835 explicit skips in 1,344 passing and 61 skipped files. Local QA and shuffle pass 15,951 tests with 828 skips. CI explicitly skips seven interpreter-dependent checks in `every-worker-suite-can-actually-run.test.ts`; local worker verification separately passes all 52 suites. The retrieved shuffled-job log has no numeric summary, so this record retains its successful terminal result and seed without inferring a test count. Skipped checks are not passes.

[Production verification](PRODUCTION_VERIFICATION.md) records desktop and 390px navigation, keyboard, cancellation recovery, private access and actual original/corrected/public PDF, XLSX and ZIP downloads. Original checksums survive correction. Those journeys identify application commit `a7c349d5`; the release commit adds evidence documents only. Application and worker sources are identical between those commits.

## Local handoff

The canonical main checkout now matches the release commit. Its six health-route tests pass. The package lock changes only the root version, so no dependency refresh is needed. The unrelated `.directory` remains untouched.

The retained-build updater completes the move from v0.63.0 at `4364812a` to v0.64.0 at `62dc74e9`. It retains the previous working build, configuration and a checksummed database backup. All four pending migrations apply before application promotion. The identified runtime database has 351 installed migrations and none pending. [Handoff results](handoff-results.json) record read-only sign-in and Engagement navigation at desktop and 390px. Both runs use keyboard activation and have no console or page errors. Screenshots show the heading, campaign counts and navigation within each viewport. A harmless CSS control passes; a wrong expected build and deliberate horizontal overflow fail for their intended reasons. This smoke check does not replace the isolated write journeys. The temporary acceptance server and its export worker are stopped. Historical worktrees remain; no destructive cleanup occurs.

## Next work

Continue M9b with [complete resumable generation](NEXT_GENERATION_BOUNDARY.md) and the remaining response/accountability workflow. This source investigation reuses retained snapshots, exact reviews and durable workers. It does not enable generation or complete M9b.

No human software-release approval is required. Engineering evidence does not establish practitioner usefulness, agency authority, representative public support or nationwide scientific accuracy. AequilibraE and ActivitySim remain separate validation obligations. The full V1 contract remains open. These publication documents do not change release application code.
