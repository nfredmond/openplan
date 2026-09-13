# v0.57.0 publication, September 13, 2026

Published at 12:05:35 UTC from main commit `9cfd8aaf146bedb0946d9f56b77d9fb5be36c3bc`. Annotated tag object `00446e7000da1fe18435cac415cb59ada9dd9d71` resolves to that exact commit. [GitHub release](https://github.com/nfredmond/openplan/releases/tag/v0.57.0) was verified published, neither draft nor prerelease.

Before tagging, all jobs on that commit passed in [CI](https://github.com/nfredmond/openplan/actions/runs/34755308697), [RLS Isolation](https://github.com/nfredmond/openplan/actions/runs/34755308687), and [Upgrade Path](https://github.com/nfredmond/openplan/actions/runs/34755308665). Main was updated directly without a PR.

CI full QA and shuffled seed 31494 each passed 14299 tests, with 458 skipped. Seven additional skips relative to the local 14306-pass run are the explicitly conditional worker-interpreter import checks in every-worker-suite-can-actually-run.test.ts; those per-worker virtual environments are absent from the CI QA job. The separate CI worker/modeling/operations jobs passed; the local worker run passed 52 suites. Live RLS passed all 480 tests. The upgrade from v0.56.1 preserved the seeded records and artifact hashes. Full QA completed its provider checks, zero-vulnerability audit and production build.

The browser journeys and their exact source identity, induced failures, background network caveats and retained hashes remain in [CONFLICT_AND_RESTORE.md](CONFLICT_AND_RESTORE.md). The last commits after the browser-tested app source changed QA inventories, release metadata and evidence, not the response UI. This publication does not claim a new production-browser rerun. The [candidate record](RELEASE_CANDIDATE.md) preserves the earlier preparation state; its remaining release steps are now satisfied.

The full v1 goal remains active. The next M9b translation-custody work is recorded [separately](../2026-09-13-m9b-translation-custody/NEXT.md). It is not included in this release. The original checkout and separate demo were left unchanged.
