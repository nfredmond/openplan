# v0.59.0 translation recovery verification

Prepared September 14, 2026. This record describes the release candidate;
final main CI and publication must be recorded before tagging.

## Result and operating change

Staff can save wording against the exact displayed source and saved revision,
retain reasons and originals, recover interrupted writes, and review retained
machine output before publication. Durable requests, outputs and resolution
receipts preserve the earlier attempt through retries and access changes.
Publication resolves the retained output and keeps acceptance/withdrawal history.
The retired staff HTTP write route returns 410 with recovery instructions.

Public comment translation uses the same local worker with separate anonymous
source authority. Lost acknowledgements recover the same request. A failed
attempt requires an explicit successor; the failed original remains retained.
Checks do not generate replacement work. Source changes and rotated public links
refuse stale reads. Valid legacy cache text remains readable without generation,
but its old metadata does not acquire completion provenance. Participant originals
remain visible. Share settings follow confirmed publication changes while
preserving local drafts and send only edited fields. Empty feedback map frames
no longer leave an empty box above comments.

Install migrations 20261014000010 through 20261014000020 in order before starting
this code. There are 339 migrations at this candidate. Existing installations
must use migration up, not a database reset. Run the local translation worker
with `npm run worker:translation-generation` from `openplan/` and restart the app
and worker on upgrade. Generation needs a configured provider; this release does
not provision one or authorize spending. Manual wording and retained reads remain
usable independently of new model generation.

## Engineering evidence

The clean isolated QA checkout at `5a93ae99c32412ccf6a9620d705a4cc9de63f81c`
passed full QA, including 15,134 tests with 497 intentional skips, connector
tests, zero dependency audit vulnerabilities, and webpack production build.
Shuffled seed 914059 passed the same unit count. All 52 worker suites passed.
The named disposable stack `supabase_db_openplan-restore-target-2026091050`
passed all 526 live tests in 57 files, including the newly installed anonymous
translation queue. [Local records](release-local-checks-5a93ae99.json) retain
exit codes and log checksums. Unit skips are not live isolation evidence.

The [GitHub populated upgrade](https://github.com/nfredmond/openplan/actions/runs/34821797265)
passed from v0.58.1 to that exact commit. It seeds real rows before applying
migrations through the CLI and asserts their survival. The additional
[translation upgrade rehearsal](populated-translation-upgrade.json) applied
all eleven migrations in rolled-back transactions on the retained v0.58.1
schema. It preserved original column contents across 278 tables, including
13,777 rows, corrected translation wording, two retained history revisions and
a legacy cache produced by the old RPC. Baseline and harmless comment passed;
damaging saved wording or cached metadata failed the corresponding table-content
comparison. This rehearsal is not an independent archive restore or committed
installation. The separate GitHub workflow covers committed CLI installation.

[Production browser evidence](public-translation-production-browser-evidence.json)
identifies the built checkout, source hashes, desktop 1440px and mobile 390px.
Fresh contexts navigate from the front door through real campaign setup and
published feedback. Keyboard actions exercise local share-setting drafts,
legacy cache reads, lost acknowledgements, retained worker output, explicit
failed-attempt retry, original preservation, source mismatch and link rotation.
The first production navigation succeeds without warming or a retry. Inspected
screenshots show original and translated comments and the participant caveat,
with no horizontal overflow. Consoles contain only the deliberate lost-response
and 409/404 refusal checks; no page exceptions or unexpected warnings/errors.
Provider calls are intercepted locally with conspicuously synthetic output.

Earlier staff journeys and their mutation evidence are retained in
[resolution lifecycle](RESOLUTION_LIFECYCLE_RESET_CHECKPOINT.md),
[generation lifecycle](GENERATION_LIFECYCLE_PROGRESS.md),
[public integration](PUBLIC_TRANSLATION_INTEGRATION_PROGRESS.md) and
[share settings and public retry](PUBLIC_RETRY_SHARE_SETTINGS_PROGRESS.md).
Each has its own dated source boundary. The latest legacy compatibility run is
retained [separately](public-translation-legacy-browser-evidence.json).
The full-QA accounting corrections have [baseline, harmless and targeted fault
checks](public-release-record-controls.json). [Release metadata checks](v059-release-records.json) pass baseline and harmless
comment controls; wrong migration count, missing migration file and omitted
operator migration reference each fail their intended assertions. The product
direction checker caught stale release headers and a registry version during preparation; they were
updated without altering review dates, evidence or capability grades.

## Limits and next work

These synthetic journeys prove engineering behavior, not translation quality,
agency usefulness or a real provider's language output. Legacy cached text
cannot retroactively be declared complete. Earlier dev first-navigation/map and
mobile network-change anomalies are preserved as unexplained; neither occurred
in production. Source and authority checks, spending reservations and original
custody stay enforced. The reminder constraint remains untouched.

This increment does not complete M9b or V1. Continue the roadmap's remaining
source-to-decision follow-through and early planning obligations. Preserve the
full nationwide planning contract, California depth, territories and tribal or
overlapping authorities, and independent AequilibraE and ActivitySim validation.
No human review gates this engineering release; agency approval inside actual
planning workflows remains distinct from software publication.


## Installation documentation correction before tagging

The first release candidate at `32848d3f` still had an outdated runbook paragraph
calling the routes unfinished and naming migration 13 alone. The corrected
runbook and self-hosting guide require migrations through 20, explain the shared
staff/public worker, retained local directory, manual operation and explicit
public successors. This is a documentation correction; application, worker and
migration sources are unchanged from the tested candidate. Final main CI and RLS
are required on the corrected commit before tagging. A manually triggered
duplicate upgrade run, 34822872731, was cancelled; the original main upgrade
34822840046 passed. The cancelled duplicate is not passing evidence.

[Next decision traceability assessment](NEXT_DECISION_TRACEABILITY.md) records
the next existing M9b software boundary after publication.
