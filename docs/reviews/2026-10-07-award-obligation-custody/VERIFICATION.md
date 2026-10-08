# Award obligation date custody

This bounded correction belongs to roadmap M2c/M13. It does not close the complete
award administration or human acceptance requirements.

## Confirmed read-path defect

The award creation route copies an obligation date into a linked project milestone.
The award PATCH route can change its date. My Work previously discarded the award
item whenever the milestone shared its award key, without comparing dates. A
controlled reader test changes the award to August 1 while the assigned milestone
remains September 10. The award's overdue item disappears under the original code.
This proves the reader defect with modeled query transport, not a native award
creation/edit journey. The query projection assertions cover both dates and the
milestone's award link.

The reader now collapses those items only when every linked project item has the
same finite parsed deadline. Different or unreadable dates preserve both records
and give the award item a review message. Date-only and midnight UTC timestamp
encodings still collapse. Exact timestamp differences remain visible rather than
assuming that a day-only milestone proves the same cutoff. No record, deadline,
assignment, completion status or historical evidence changes.

## Verification

The first invocation ran from the repository root and failed before tests because
it missed the package alias configuration. Corrected invocation from openplan/
runs three new tests against the original reader: two fail for missing award
items, and the equal-date control passes. After correction the new tests and the
existing My Work reader suite pass all 30 tests. Targeted ESLint and diff checks
pass. A harmless comment passes; restoring unconditional suppression fails the
conflicting-date test; accepting infinite parsed dates fails the unreadable-date
test. Each mutation is restored. Private logs reside in the local state folder
award-obligation-custody-20261007-proof.

## Remaining scope and evidence

Native create/edit/read, current permission, browser desktop/390px presentation,
failed-source display and final build/CI remain unverified for this change. The
existing suites cover source failures and scope-filter fallback through modeled
transport; they do not establish live RLS. This is not legal deadline validation.

The broader award lifecycle still needs one traceable owner for deadline changes,
reviewed completion evidence and reopening. Paid invoice coverage does not prove
that an obligation occurred by its deadline. Imported and legacy closure bases
must remain distinct. Existing obligation milestones can still appear when a
fully-spent award is excluded by the separate award source, so whole-application
absence is not claimed. This correction prevents conflicting dates from being
silently deduplicated; it does not synchronize the records or change reminder
suppression. Those boundaries require their own native and practitioner evidence.
