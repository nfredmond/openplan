# Retained transit archives and installation storage room

The managed worker and submission intake check the installation storage bound
before uploading new archive bytes. They use the existing workspace helper and
the original workspace identity. The configured service credential remains in
memory. No migration or default activation changes here.

Recovery first downloads and checks actual bytes against the retained size and
hash. Exact existing bytes can complete custody even when the installation is
full. For a missing archive, Storage list metadata can establish that an immutable
same-size key already counts toward usage. That avoids charging a retry twice;
it does not establish custody. Upload still uses `upsert: false`, and the worker
must download and check actual bytes before confirming the archive.

A full or unreadable storage total refuses before upload. The private retained
source and prepared version remain available for a later retry. A known storage
refusal keeps its message. An uncertain upload still follows the existing actual
byte reconciliation. Ownership cancellation and the acknowledgement deadline
cover list, usage RPC and upload through the SDK's actual fetch transport.
Racing the SDK promise alone does not cancel an external request.

## Evidence boundary

The source campaign requires baseline, harmless, restored-after-harmless and
final-restored cohorts. Fifteen deliberate source faults challenge both callers,
original workspace RPC scope, metadata versus custody, refusal reporting,
pre-cancelled work and actual stalled HTTP closure. The diagnostic classifier
also has two positive and six negative controls. The final four cohorts each pass 93 tests; all 15 faults fail the intended
assertion. Strict scoped TypeScript and changed-file lint pass. The final
resource-bounded service peaks at 438 MiB with no swap allowance.
[Source controls](controls.json), [oracle controls](oracle-controls.json) and
[bindings](source-bindings.json) preserve those results.

The earlier [intake controls](old-intake-01-controls.json) retain three positive
cohorts and 27 intended failures. The [enrollment controls](old-admission-01-controls.json)
retain four positive cohorts and 33 intended failures, including the prior
uncertain-upload and cancellation boundaries. Every source mutation restores
original bytes in `finally`. Failed earlier diagnostic campaigns remain private
historical records rather than accepted results.

The [related suite](related-summary.json) passes 1,417 tests across all 55 GTFS
files, with 17 live-database cases skipped and no failure. The 1 GiB serial service
peaks at 453.5 MiB. The existing workspace retry helper tests run separately
with the document checks.

The usage check observes current Storage metadata. It does not reserve space
atomically across concurrent writers. This operator-configured installation
bound is not a paid software tier. These tests do not establish native hosted
Storage/RLS behavior, public DNS/TLS, browser or practitioner acceptance. Existing
archive reconciliation and recurring retired-key cleanup remain required.

## Combined CI allowance

The existing aerial worker job exceeds its 60-minute ceiling on PR323 at d13.
GitHub records a time-limit cancellation. Eight other checks succeed; the
cancelled job is incomplete. The candidate changes that job to a bounded
90-minute allowance and preserves every ordered step and command. The
[change record](ci-timeout-change.json) does not substitute for a complete fresh
exact-head run.

The [frozen independent review](INDEPENDENT_REVIEW.md) finds no concrete defect.
It preserves the separate stage deadlines, caller-owned service/target pairing
and native Storage/SQL/RLS limits. The [unchanged helper and document checks](helper-docs-summary.json)
pass 30 tests, with no skip or failure.
