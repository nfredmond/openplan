# v0.63.0 publication

Published September 27, 2026 at 22:15:28 UTC: [v0.63.0](https://github.com/nfredmond/openplan/releases/tag/v0.63.0). GitHub confirms non-draft and non-prerelease status. Annotated tag `4357a55461770bfcba0c56cabad613ce6dab3577` resolves to release commit `4364812a9e3a180c87b7288bff3d14107d8ccf13`. Main was advanced directly, without a PR.

All declared workflows passed on that exact commit before tagging:

- [CI 36353429929](https://github.com/nfredmond/openplan/actions/runs/36353429929): full QA, shuffled Vitest with seed 131439, modeling scripts, operations checks and worker tests.
- [RLS isolation 36353429992](https://github.com/nfredmond/openplan/actions/runs/36353429992): 657 tests in 66 files.
- [Populated upgrade 36353438727](https://github.com/nfredmond/openplan/actions/runs/36353438727): v0.62.0 migrations and seeded operational records upgraded to this release.

[Final CI](final-ci.json) retains job identities, outcomes and private log hashes. CI QA passes 15,614 tests with 635 explicit skips in 1,330 passing and 59 skipped files. The local QA and shuffle pass 15,621 with 628 skips. The CI worker-environment suite explicitly skips seven interpreter-dependent checks; local worker verification separately passes all 52 suites. Skipped checks are not counted as passes. These checks do not establish nationwide scientific validity or practitioner usefulness.

[Release verification](RELEASE_VERIFICATION.md) retains desktop and 390px navigation, keyboard, mutation controls, original/corrected history checksums, interrupted recovery, private access and actual concurrent writes. Earlier candidate runs on `638cb58c` were superseded after correcting the operating guide. They are not the release evidence.

## Local handoff

[Handoff results](handoff-results.json) record the canonical main checkout at the release commit, refreshed dependencies and six passing health-route tests. SQLite, esbuild and resolver probes run after installation. The unrelated `.directory` remains untouched.

The retained-build updater moves the local demo from `203326b5` to `4364812a`, version 0.63.0, and keeps the predecessor for recovery. Runtime database identity matches the CLI's local stack, with 347 migrations and none pending. Read-only sign-in and Engagement navigation pass without console or page errors. This demo smoke check does not replace the isolated write journeys. No database reset, paid service or worktree cleanup occurs. Historical worktrees remain because ownership and shared dependency paths require separate review before removal.

## Next work

Continue M9b with [complete source-to-response and decision links](NEXT_IMPLEMENTATION.md), reviewed synthesis exports and optional complete resumable generation. Exact staff approval publishes nothing and does not confer adoption or spending authority. M9b and the full V1 contract remain unfinished. The follow-up publication documents do not change release application code.
