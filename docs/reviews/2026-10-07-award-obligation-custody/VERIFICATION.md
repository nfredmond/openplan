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

## Native and identified browser follow-up

Implementation fc195473 passes production webpack, TypeScript and all 137 static
pages. Build ID is `4-2YHnKJvBzyjafaxMibf`. The isolated port 3507 server reports
fc1954731c4e in health and its PID cwd matches this checkout.

A synthetic award is created through the existing three-step UI on the prior
7cf4fe14 build and the same isolated database. T3 cannot type into its native
datetime-local control, so a native value setter with input/change events supplies
December 15 at noon Pacific; the normal Save button persists December 15 at
20:00 UTC and creates the linked December 15 milestone. Native date entry is not
proved. An authenticated browser PATCH to the existing award route changes its
obligation to August 1 UTC. No obligation-date editing UI is claimed.

On the prior build, My Work's Assigned view shows the overdue August award when
the unassigned milestone is absent. Its Unassigned view shows only the December
milestone and says there is no pending award obligation. This confirms the native
record condition behind the controlled reader regression.

On fc195473 the same Unassigned view retains both dates and the review message.
Desktop 1440 by 900 and mobile 390 by 844 screenshots are inspected; the mobile
document width remains 390. Following the award link opens the project's Funding
tab after its anchor-routing effect settles. Returning through My Work and the
Unassigned control retains both dates. All retained console entries are reviewed
through the health page: none is new during the corrected-build journey. Older
network history is truncated; this is not a complete network audit.

Private native baseline, screenshots, build result and console records are in
`award-obligation-custody-20261007-proof` under the local state directory. The
synthetic record does not establish real award compliance or practitioner
acceptance. Role revocation and failed-source behavior for this case remain
covered only by existing independent tests, not this owner-role browser journey.

A separate observed defect remains: Project Delivery formats the date-only
milestone as December 14 at 4 PM Pacific, while My Work correctly displays
December 15. The delivery helper sends a date-only string through toLocaleString.
That display correction is a follow-up, not claimed by this deadline-conflict fix.
