# Accumulated v0.68 candidate, October 9

The live GitHub release list identifies v0.67.0 as the latest published release;
no v0.68 tag exists at this checkpoint. Earlier package metadata and the October 7
candidate record do not establish publication. This update combines the existing
candidate and subsequent Unreleased instructions without discarding their limits.
The inventory advances from 385 to 399 migration files, through
`20261016000027_run_project_workspace_foreign_keys.sql`. This is 26 additions
since v0.67.0. No SQL or application behavior changes in this record update.

All six release-ordering tests pass. A harmless comment passes, changing the
candidate count to 398 fails the high-water and partition assertions, and the
restored source passes again. `release-record-controls.json` retains the source
hash and results. These tests establish record alignment, not upgrade safety or
application acceptance. Product direction checking passes with the existing
review-age and intervening-change reminders; no review date or capability grade
is advanced.

The [populated upgrade](https://github.com/nfredmond/openplan/actions/runs/37998677389)
from v0.67.0 to application candidate `5b4b5e09ec4e18adf1a2c0bfe5259194b2ef22de`
passes. Its representative seeded records do not prove every deployment's data.
[Candidate CI](https://github.com/nfredmond/openplan/actions/runs/37997590145)
passes full QA, shuffled tests and the Python suites. Live isolation 37997590171
and full-archive restore 37997590137 remain running at this checkpoint.

## Award reopening after preview recovery

T3 identifies the unchanged source build `b1b0fc56f8e2` at port 3521, version
0.68.0, process 1508433 and service invocation
`7e08e1a11fca4a9c958f8ce9726b4511`. Its cwd is the isolated short-rail checkout.
The final integration head differs only in evidence files. The journey starts
at 22:21:43 UTC and uses the separate acceptance database, not the demo.

An authenticated product API request creates one clearly synthetic imported
closure against the existing synthetic recovery project. Navigation through
Projects and Grants reaches the award. A written reason without a selected
status is refused. At 390 pixels, keyboard selection chooses Not started, and
the real Confirm re-open button succeeds. The native select focus call reports
a tool error, but subsequent keyboard calls succeed and the settled DOM confirms
the chosen value before submission. An initial role selector fails; the observed
href locator succeeds. Neither tool failure is counted as product acceptance.

API readback confirms award `40e597bb-1148-4e6c-8fb9-886f4ec4de2c` is now
`not_started`, with its recorded reason, actor and reopening timestamp. Current
closure fields are null; the October 1 obligation timestamp is unchanged.
Desktop and 390px post-submit images show the corrected sentence, "Previous
closure basis: recorded as closed on import." The phone form panel is 269px
wide with equal scroll width; the success notice is 243px with equal scroll
width, and document width remains 390px. No new console entry appears during
this journey. Images are inspected and their hashes retained in
`award-acceptance.json`. Raw synthetic readbacks remain private.

This completes the missing post-submit capture and notice review from the
[earlier award report](../2026-10-07-award-reopen-mobile/VERIFICATION.md).
It does not regrade that report's failed capture attempts or establish actual
obligation compliance, reimbursement or observed practitioner outcomes.

## Newly reproduced integration defect

Navigation back to My Work retains the reopened award's deadline but reports
stage-gate decisions unavailable. Migration 27 added a second project foreign
key; native PostgREST reproduces an ambiguous project embed with `PGRST201`.
PR 181 corrects the query in a separate checkout. This defect blocks PR 177
and release publication despite passing tests. Its rebuild, rendered acceptance
and integration checks remain separate required evidence.

No tag is published here. Full v1 remains unfinished, including managed model
continuation, resumable GTFS workers, full geography and authority coverage,
independent nationwide scientific acceptance and observed human outcomes.

## Corrected integration join

PR 181 now includes completed nonempty authenticated reads and production-build
desktop/390px acceptance. Its [verification report](../2026-10-09-my-work-project-relation/VERIFICATION.md)
retains the native ambiguity control, exact source identity and rendered hold.
This release-record branch joins that complete history; the single changelog
conflict preserves both the candidate instructions and the query correction.
The joined application matches tested source `f76b0516` except for test and
evidence records. Final combined GitHub results still govern landing and tagging.
