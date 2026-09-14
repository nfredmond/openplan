# v0.59.0 publication

Published September 14, 2026 at 08:54:22 UTC:
https://github.com/nfredmond/openplan/releases/tag/v0.59.0

The annotated tag resolves locally and remotely to
`47bde77d42c017184c0a9ab894c976a0ffb39154`. GitHub reports this as the latest
published release, neither draft nor prerelease. Code landed directly on main.

Every final CI job passed before tagging, including QA, shuffled tests, workers,
modeling scripts and operations. The final RLS workflow passed all 526 tests in
57 files. [Exact records](publication.json) retain commits, run URLs, log hashes
and the publication response. CI QA passed 15,127 tests with 504 skips; the local
suite passed 15,134 with 497 skips. The seven additional CI skips are the named
worker-interpreter probes whose local virtualenvs are absent from the QA job.
Local full QA and all 52 local worker suites cover those installed workers.

The populated upgrade from v0.58.1 and full database/Storage restore also passed.
They use the preceding candidate `32848d3f`; the final four changed files contain
installation documentation and release/next-work notes only. Application, worker,
workflow and migration sources are identical. The generic restore covers 303
tables and one Storage object. Its translation tables were empty; populated
translation preservation is separately proved by the 278-table local upgrade
rehearsal. The restore guard controls include three harmless survivors and 42
intended failures. External worker journals, custom roles and protected deployment
configuration remain outside that database/Storage archive.

[Release verification](RELEASE_VERIFICATION.md) preserves original/corrected
wording, source-bound receipts, generation/output recovery, explicit public
successors, retained cache and private/rotated-link checks at desktop and 390px.
Production cold navigation and console inspection passed. Earlier unexplained
dev-navigation and network-change observations remain historical evidence, not
silently reclassified fixes. No real provider-quality or agency-usefulness claim
is made. Existing caches do not gain completion provenance. No human review was
required to publish the engineering release.

Continue with [response-to-decision traceability](NEXT_DECISION_TRACEABILITY.md)
inside the existing Engagement and Projects workflows. M9b and the full V1
contract remain open. The original checkout, demo and reminder constraint were
not modified by this release lane.
