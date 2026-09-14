# v0.61.1 publication

Published September 14, 2026 at 18:06:13 UTC: [v0.61.1](https://github.com/nfredmond/openplan/releases/tag/v0.61.1), a non-draft, non-prerelease engineering release. Annotated tag object 4349358cd451d49080a3dcfe0f154ea89143e4ea resolves to release commit 291ce88a600547c1cd2b8b3d85047d5d07c6df44. The remote tag and publication fields were read back after creation.

Before tagging, [CI 34877113299](https://github.com/nfredmond/openplan/actions/runs/34877113299) and [RLS Isolation 34877113339](https://github.com/nfredmond/openplan/actions/runs/34877113339) completed successfully on that exact commit. Full QA and shuffled suites each passed 15,355 tests with 540 skips. RLS passed 562 tests across 61 files. Operations, worker and modeling CI jobs also succeeded. [Machine-readable evidence](final-ci.json) retains job states, timestamps, log hashes and publication identity. Later documentation commits have their own CI; they are not the release tag.

[Engineering verification](RELEASE_VERIFICATION.md) retains the actual desktop/390px report/API and download controls, before failure, local full QA and mutation proofs. Local tests passed 15,362 with 533 skips; those are distinct from CI counts. The API fix changes no migration, worker or artifact bytes. The v0.61 populated upgrade evidence remains applicable to the unchanged 343 migrations.

The release corrects the nullable-project report GET failure. It does not complete M9b, establish agency usefulness, or change scientific claims. The [next synthesis investigation](../2026-09-14-m9b-synthesis-custody/INITIAL_FINDINGS.md) records separate source omission and unconfirmed-save defects and a controlled route reproduction. Those defects are not repaired by v0.61.1.
