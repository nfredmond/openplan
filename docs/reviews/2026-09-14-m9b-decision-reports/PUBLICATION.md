# v0.60.0 publication

Published September 14, 2026 at 14:53:55 UTC:
https://github.com/nfredmond/openplan/releases/tag/v0.60.0

The annotated tag resolves locally and remotely to
`29c5f7ab5140a0c71652485189d158c7099ead80`. GitHub confirms a published release,
neither draft nor prerelease. Code landed directly on main.

Every final CI job passed before tagging, including QA, shuffled tests, workers,
modeling scripts and operations. QA and shuffled suites each passed 15,308 tests
with 530 skips. Final isolated RLS passed 552 tests in 60 files. Local full QA on
the exact release commit passed 15,315 tests with 523 skips, lint, configured
deadcode checks, provider connectors, zero dependency vulnerabilities and the
webpack/TypeScript production build. The separate unchanged local worker sources
have their retained 52-suite result. [Exact records](publication.json) retain
run identities, log hashes and the release response.

The populated upgrade from v0.59.0 passed on 28be4164. Its migrations and upgrade
workflow are byte-identical to the release commit. The retained source/history
activation and concurrent privacy proofs supply their separate populated evidence;
this generic upgrade fixture does not stand in for every agency installation.

The first final CI failed at TypeScript heap exhaustion. The corrected build passes
its memory allowance to actual subprocesses without skipping type errors. Cold,
harmless and restored builds passed; a deliberate invalid assignment failed for
the expected type error. [Build evidence](build-heap-results.json) preserves the
original failure, rejected parent-only setting and observed child heap.

Application, worker and migration sources are unchanged from privacy browser build
dfebc1af; later source changes concern the populated RLS fixture and release ledger.
The [release verification](RELEASE_VERIFICATION.md) retains desktop/390px navigation,
keyboard, original/corrected files, photo, privacy and interrupted-retry evidence
and its limits. These are bounded engineering claims, not planner usefulness,
representative participation, language quality or legal authority.

Continue with [report context and private decision lineage](NEXT_REPORT_WORK.md).
M9b and the full V1 contract remain open. No human review gated this release.
