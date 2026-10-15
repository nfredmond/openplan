# Main after PR328 reaches the web and worker service

The parent verifies main `4ea6a8ca3b43c6712952fc4e527a8538237a9adb`
after PR328 merges at `2026-10-15T07:15:16Z`. This is the next dated delivery
reading, not a rewrite of the earlier PR327 report.

The commit-filtered GitHub reading finds CI, live RLS, aerial custody, Node
process observations, integration-secret rotation and worker cancellation
workflows completed successfully. The scheduled Production Health run also
succeeds. Deployment-status health skips remain recorded as skips. Workflow
success alone does not identify a deployed process.

At `2026-10-15T08:06:48.979Z`, the public health response reports commit
`4ea6a8ca3b43`, version `0.68.0`, and 418 expected migrations through
`20261017000015`. Database health remains `not_checked`. This describes the
build expectations, not a fresh installed-schema census.

Railway reports deployment `d8a4c5d0-a316-43e0-b0f2-425006f6411b` as
`SUCCESS`, naming the exact full main commit. The preceding b259 deployment
is `REMOVED`. An explicit log read for the new deployment finds all seven
declared worker startup messages at `08:05:24.761376977Z` through
`08:05:24.761404546Z`.

The process RPC at `08:06:49.156481Z` reports one running instance for each of
document exports, engagement email, provider API, translation generation,
synthesis preparation, synthesis execution and contract calculations. Their
last observations fall between `08:06:27` and `08:06:33`. GTFS remains
unobserved; this verification does not enable it.

Worker identity uses the provider's exact deployment commit and that
deployment's startup messages, correlated with fresh process observations.
The summary RPC does not attest a commit. The earlier report records null
individual build fields and unavailable direct SSH inspection; those limits
remain open. No stronger independent per-process source-hash claim follows
from this reading. Process observations do not establish job completion,
provider success, throughput or retained output quality.

Sanitized responses, the private deployment response and filtered private
logs remain under the private proof directory
`node-queue-observation-20261014/main328-delivery-20261015/`. Only read
operations run. No hosted secret rotates, no migration or configuration
changes, and no new infrastructure is provisioned.

The parent releases the sequential delivery hold for the next separately
reviewed PR329, subject to its exact-head checks. A further main merge
requires fresh CI and delivery verification. Hosted migration16 remains
unapplied. No release tag, practitioner acceptance, scientific validity or
whole-installation recovery acceptance is declared.
