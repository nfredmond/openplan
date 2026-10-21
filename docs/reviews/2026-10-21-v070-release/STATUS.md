# v0.70.0 release verification

## Final local graph and release prerequisites, October 21

The corrected graph installs privately with 969 installed package records
matching the lockfile. Vitest and its matching packages use 4.1.12. There are
no donor links. Package and lock versions remain 0.70.0; the dependency audit
reports zero vulnerabilities at this checkpoint.

The maintained QA gate passes at `85fe3a54c88cfe5489d81b7ea2a226cac14fcf5d`:
24,002 application tests pass and 1,689 skip; provider controls record 432
passes and four skips; vendor controls record 19 passes. Lint, dead-code checks,
audit, webpack, configured TypeScript and 145 static pages complete. Local live
RLS is explicitly skipped. These skips do not become native passes.

The first shuffled seed 11465 fails on one 20-second report projection test.
That failed run remains failed. Timed diagnostics find report generation takes
23 milliseconds and the unused full-source scan about 5.6 seconds. Scanning the
already-filtered route takes 34 to 39 milliseconds. Full ordered result parity
holds for all 44 route records, including both project records and the computed
fallback. The test now supplies that route through the helper's existing files
option. Every projection, order and fallback assertion remains unchanged; the
shared scanner and whole-source guards remain unchanged.

A comment-only survivor passes. Removing an actual cost column, making the
computed fallback literal, and changing its table subject each fail the named
projection or fallback assertion. Exact bytes and modes restore. Focused checks
record 126 passes and maintained lint passes. The repaired full seed 11465
records 24,002 passes, 1,689 skips, zero failures in 288.16 seconds. The original
timeout's precise phase remains unknown because its run has no phase telemetry.
No timeout, assertion, skip or scientific criterion is weakened.

The earlier CI-placeholder build has ID `l0EZgpwfUo6X365ms8z9a`. It cannot sign
in to the retained local database. The release lead owns the separate local
acceptance build, affected desktop and 390px views, exact-head CI, integration
and matching publication. Those remain prerequisites for tagging; version
metadata and this note do not declare publication. The tagged
[GitHub release](https://github.com/nfredmond/openplan/releases/tag/v0.70.0)
records the final commit and completed evidence when published.

The release reuses the bounded RTP/HIN and representative v0.69 upgrade evidence
below at their original source identities. Exact-candidate isolated CI protects
its own schema/permission and worker boundaries. A local synthetic browser
view cannot prove authenticated hosted operation, complete predecessor coverage,
scientific accuracy or full v1. All contract and sole-roadmap requirements remain.

## Earlier candidate checkpoints

The following entries preserve their original pending status and dates. The
current verification above supersedes only their current local QA disposition.


October 21, 2026. This candidate packages merged main
`981446636dc28a2ac61cfeb676e0156bdfbf22b9`, which is 20 commits beyond the
published [v0.69.0](https://github.com/nfredmond/openplan/releases/tag/v0.69.0).
The new capability is manual retained-page RTP intake. The same increment
includes exact HIN requested-year membership, sparse-year disclosure and map
focus corrections. Version metadata says 0.70.0; no tag, GitHub release,
current hosted deployment or v1 completion follows from that metadata.

## Metadata checks pass with a sensitivity control

Package and lockfile root versions agree. The contract, roadmap, capability
matrix and registry change only their current-release fields. Their review
dates, statuses, requirements and scientific boundaries remain unchanged.
The release-order record adds 429 files through
`20261019000002_rtp_manual_source_page_proposals.sql`. This is the single
addition since v0.69.0; the old migration history is not rewritten.

The product-direction command exits zero. It retains reminders for expired
jurisdiction/capability reviews, the older v0.66 direction review and intervening
changes. A passing reference check does not refresh those assessments.

The maintained release-ordering test file passes all six cases in the baseline,
harmless-comment, restored-harmless and final-restored cohorts. Changing only the
new 0.70 migration count from 429 to 428 causes exactly two AssertionErrors:
the shipped high-water count and the latest-release partition count. Four other
cases remain passing. Exact source bytes are restored before the final cohort.
This checks the new record's accounting; it does not prove SQL installation,
artifact correctness, recovery, UI behavior or a release publication.

All five bounded units finish. Their post-terminal MainPID values are zero and
current cgroup fields are empty. All 676 owned dependency links are removed;
private Vite caches and full logs remain outside the repository. No dependency
installation occurs. At that metadata window, the 969 installed donor package records match the
then-current lockfile's version, resolved archive and integrity values. That
window does not establish the later corrected graph's installation or runtime.

## Existing feature evidence retains its original scope

The [RTP record](../2026-10-18-rtp-manual-source-intake/STATUS.md) includes the
isolated migration and actual-role fixtures, control failures and restoration,
identified desktop/390px source staging and retained chapter artifacts. Later
wording has its own identified build. Its older pending-CI/merge wording predates
the actual merge. No historical failure is regraded.

The [HIN record](../2026-10-19-hin-requested-years/STATUS.md) includes ordinary
membership/projection/disclosure controls and the map-focus request/focus cases.
The later release audit recovers HIN build LzYWMO4KtJSlgPfNQvDtX at
158641188174c5609642a3580ff8d3f4b837d9b3. Its desktop/390px receipts exercise
painted road movement, map reveal/focus and keyboard continuation to zoom.
The original mobile failure stays failed. Sparse-year browser selection,
provider completeness and scientific accuracy remain unassessed.

## Tagging remains pending

Complete and record the release-readiness audit, exact-candidate QA/build,
shuffled, applicable worker/control and isolated native checks. Use existing
maintained workflows and retained exact-source evidence proportionately. Resolve
real failures in the promised increment; unrelated unfinished v1 work does not
become a new gate for this development release.

Confirm the affected final-candidate view and usable artifacts, reusing the
exact-source RTP and HIN receipts where they cover unchanged behavior.
Bind any upgrade and hosted claim to its actual source, history and deployment.
Then land the verified candidate, inspect final CI and publish the matching tag.
No version-only tag or unchanged-review-date promotion is authorized by this note.

Full RTP and Safety, complete nationwide/territory/tribal workflow coverage,
separate AequilibraE and ActivitySim validation, and all other v1 requirements
stay open. The stale capability ledger needs evidence-based reconciliation;
release numbers are not a completion tally.


## Dependency audit follow-up

The exact-main release audit finds all seven required CI contexts passing and
a representative v0.69-to-main upgrade that applies the single RTP migration.
It identifies a current advisory blocker in main's lockfile. This candidate
selects the reviewed follow-redirects, Hono and Vite corrections from PR362
without importing its unrelated diagnostic changes. Every other node remains
unchanged at that transfer step.

A fresh lock-only audit then exits one with two moderate findings through
Vitest mocker. That failed audit remains preserved. The current
[manual-registration advisory](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)
and [Windows-path advisory](https://github.com/advisories/GHSA-xp26-3454-mjgp)
identify 4.1.12 as the patched version on the4.x line. An explicit
package-lock-only, ignore-scripts update pins Vitest4.1.12 and matching Vitest
packages. Npm also selects Chai6.3.0 and tinyrainbow3.2.0. No dependency code is
installed or lifecycle script executed by that lock-only command.

The following fresh lock-only audit exits zero and reports zero vulnerabilities.
This supersedes only the current advisory disposition, not the failed audit or
previous runtime results. The old metadata test cohorts use the old installed
framework; they do not establish new-framework runtime compatibility. A fresh
install, full QA/build, shuffled and applicable native/worker checks on the
final release commit remain pending. There is no push, tag or hosted claim.
