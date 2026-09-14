# v0.62.0 publication

Published September 14, 2026 at 23:23:16 UTC: [v0.62.0](https://github.com/nfredmond/openplan/releases/tag/v0.62.0). GitHub confirms non-draft and non-prerelease status. Annotated tag c9cca46fe0d35a8f71cb0b51848ae0fcb08c41c2 resolves to release commit 018cda5d8a33a45001bbd39c1c6362636101d785. Main was advanced directly, without a PR.

All required workflows completed successfully on that exact commit before tagging:

- [CI 34907096050](https://github.com/nfredmond/openplan/actions/runs/34907096050): QA gate, shuffled Vitest, modeling scripts, operations checks and worker tests.
- [RLS isolation 34907096003](https://github.com/nfredmond/openplan/actions/runs/34907096003): 612 tests in 64 files on the workflow's disposable stack.
- [Populated upgrade 34907095999](https://github.com/nfredmond/openplan/actions/runs/34907095999): previous release migrations and operational rows upgraded to this release.

[v0620-final-ci.json](v0620-final-ci.json) retains job identities, outcomes and private log hashes. [Release verification](RELEASE_VERIFICATION.md) contains the local QA, 15,502-test shuffle, native custody, worker, browser, mutation and compatibility boundaries.

The final read-only browser follow-up reopened the exact reviews created during earlier desktop/390px journeys. Original and corrected content hashes, preparation and source hashes still matched; original revisions remained read-only. Both history screenshots were inspected. [Browser results](retirement-browser-results.json) preserve that follow-up without replacing earlier evidence. The later runner/manifest changes and this publication note do not change release application code.

[Operating guide](../../ops/ENGAGEMENT_SYNTHESIS_REVIEW.md) explains selection, corrections and recovery. The [next approval boundary](NEXT_APPROVAL_BOUNDARY.md) reuses existing revision-bound review patterns. Exact-output approval, optional complete resumable model generation, response/decision connections and reviewed synthesis exports remain unfinished M9b work. No overall capability, scientific claim or V1 completion is promoted.
