# v0.65.0 publication

Published September 30, 2026 at 19:37:35 UTC: [v0.65.0](https://github.com/nfredmond/openplan/releases/tag/v0.65.0). GitHub confirms non-draft and non-prerelease status. Annotated tag `856a7bd1204bd1229c531937570d421d7069f58a` resolves to release commit `734052b5b8ad682f868570a2ab1bee260effc658`. Main advanced directly, without a PR.

All declared workflows passed on that exact commit before tagging:

- [CI 36764507889](https://github.com/nfredmond/openplan/actions/runs/36764507889): full QA, shuffled tests with seed 825544, worker, modeling and operations checks.
- [RLS isolation 36764507853](https://github.com/nfredmond/openplan/actions/runs/36764507853): 925 passed and 125 skipped across 73 files.
- [Populated upgrade 36764562365](https://github.com/nfredmond/openplan/actions/runs/36764562365): v0.64.0 upgraded through additive migrations 33, 34 and 35. Seeded record counts remain `2:2:1:1:1:1:1`; content and custody checks also pass.

[Final CI](final-ci.json) retains exact job identities, outcomes and private log hashes. CI QA reports 16,340 passed and 1,028 skipped across 1,362 passing and 66 skipped files. Local QA and shuffled tests report 16,347 passed and 1,021 skipped. The CI worker-environment guard explicitly skips seven checks requiring locally provisioned worker interpreters. Local worker verification separately passes all 52 suites. Skipped checks remain explicit. [Local verification](RELEASE_VERIFICATION.md) retains the worker tests, controls, demonstrated defects and corrected runs. The upgrade exercises representative seeded records, not every agency database.

## Release boundary

The release adds complete selected-source preparation, saved task plans, resource authorization and recoverable local execution. Original provider responses and uncertain dispatches remain distinct. The worker supports one authorized task or its saved task list. No automatic model service or paid infrastructure is enabled.

Complete staff generation, record/context consolidation and machine-draft import remain unfinished. Task completion does not establish useful interpretation, agency approval, provider billing behavior or physical power-loss recovery. Complete M9b and the full V1 contract remain open. Scientific validation of AequilibraE and ActivitySim remains separate.

The follow-up publication records do not change application code or retag the release.

[Next implementation findings](NEXT_IMPLEMENTATION.md) retain the missing native selected-output join, complete contextual stages and explicit staff acceptance boundary. These findings do not establish implemented behavior.

## Local handoff

[Handoff evidence](handoff-results.json) identifies the installed demo at release commit `734052b5`, version 0.65.0, Next.js 16.3.8 and build `dY2HbCg5DS3uF9hGVfK2F`. The retained updater preserves the v0.64.0 runtime and a checksummed database backup before applying migrations 33 through 35. The identified runtime database contains 354 migrations with none pending. No reset occurs.

Desktop and 390px journeys enter through normal sign-in and use keyboard activation to reach Engagement. Both screenshots were inspected. The heading, creation control and navigation remain visible, without page-wide overflow or console/page errors. A harmless CSS control passes; deliberate overflow, wrong commit and wrong version fail for the intended reasons. These read-only demo checks supplement the isolated candidate and worker evidence, not replace it.

Canonical main is synchronized at the release commit, with refreshed dependencies and six passing health-route tests. The unrelated `.directory` and pending reminder constraint remain untouched. Historical worktrees remain in place. No paid service is enabled.
