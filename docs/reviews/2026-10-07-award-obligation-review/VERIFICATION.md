# Closed-award obligation review

## Reproduction and change

On the identified production build `10c3bc0c`, an authenticated T3 request to
the actual award creation route saves synthetic award
`d78c405f-3312-4bac-85d6-5ca860b69ca4` with `fully_spent` status,
`recorded_on_import` closure and an October 1 obligation deadline. The response
explicitly states that invoice coverage was not checked. My Work displays its
automatically created obligation milestone but excludes the award record and
its closure context. This disproves the source comment that fully spent proves
the obligation deadline was met. It does not establish a real agency violation
or disappearance of the deadline from every view.

The read-path correction keeps closed awards with recorded obligation deadlines
in My Work and the reminder candidate selection. Each says review is needed and
preserves invoice-covered, imported, legacy or unloaded closure provenance.
A mirrored milestone cannot replace that evidence warning. Active awards keep
the existing deadline behavior. No payment, closure, milestone, obligation date,
permission or scientific record is rewritten. No live reminder sweep or external
email is sent during this reproduction.

## Checks

The restored source passes 106 tests in five files covering My Work, reminders,
conflicting award dates, closeout and award updates. Targeted ESLint and whitespace
checks pass. Four My Work cases retain the review beside an equal-date milestone;
three reminder cases preserve closure basis. Both readers assert the required
query projection.

A harmless source comment passes. Five temporary broken controls fail: reversing
the closed-status review condition, omitting the My Work closure column, omitting
the reminder closure column, collapsing the review against its milestone, and
filtering closed awards out of reminder candidates. All changes are restored.
The tests use simulated database reads; they do not prove live RLS or browser
presentation. Reminder tests remove the email transport credential and use a
fake database/outbox.

The first test-edit script runs from the wrong directory and changes nothing.
The ensuing run exposes nine older expectations that exclude closed awards.
After updates, one digest-count expectation still fails and is corrected to
include the additional review reminder. An initial command names a nonexistent
third test file; only its two actually executed files count. The final command
explicitly executes all five named existing files.

Private logs and the native counterexample are retained under the local
`award-obligation-review-20261007-proof` directory. The initial two logs remain
beside that directory with the same prefix.

## Unfinished boundary

This is an implementation checkpoint, not a released capability. Identified-build
desktop/390px review, broader QA and GitHub integration remain pending. No schema
or write action for responsible-staff obligation evidence is introduced here.
Actual obligation evidence, dates, review disposition, corrections and final
funder closeout remain separate M13/CORE-GRANTPURSUIT-01 and M2c daily-work needs.
The review warning must not be used to claim that those workflows are complete.
The expenditure reminder's existing spending filter is unchanged and needs its
own evidence-boundary assessment. Full V1 remains open.
