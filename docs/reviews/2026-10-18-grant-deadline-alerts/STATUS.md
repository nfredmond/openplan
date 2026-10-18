# Grant deadline notices in My Work

October 18, 2026. Source candidate for M13e/B4, based on `cb73e2e61`.
This does not establish native database or browser acceptance.

Application-closing and pursue-or-skip deadline additions, changes and removals
append a journal event and creator notice in the opportunity transaction.
Each event retains its field, exact old/new instants, actor or unknown actor,
creator membership outcome and original opportunity. These are recorded OpenPlan
edits, with no assertion that the official funder changed its notice. Unchanged
instants create no event. A failed notice write aborts the opportunity write.

Migration `20261018000001_grant_deadline_changes.sql` adds the member-readable,
trigger-only journal. Direct journal writes and function execution are revoked.
The trigger refuses opportunity ID/workspace changes. Journal facts cannot be
updated; notice updates preserve facts while permitting existing read-state
changes. Workspace deletion retains its existing cascade semantics. Unknown or
departed creators remain explicit journal outcomes without an invented recipient.

Change notices have a separate event ID and no due date. Reminder keys include
kind so decision and application reminders can coexist. The missing application
sweep filters pursued opportunities before its cap, retains missed closed calls,
and excludes archived/awarded opportunities and completed pursuit states. It uses
workspace calendar windows and instant lateness, existing roster authorization
and reminder preferences. The existing live queue and deadline route are unchanged.
The inbox opens the exact opportunity through its workspace and rejects invalid
event/date shapes as an unavailable read.

## Checks and remaining limits

- Initial pre-restart run: 68 passed, one failed. The inbox copy lost the existing
  `due within 14 days` wording. Its correction was untested at the restart.
- Harmless comments survived: 109 source tests passed. Wrong pursuit filters,
  read-failure handling, event shapes, subject identity and SQL capture/access
  declarations failed nine targeted tests. Wrong badges/navigation failed three.
  Removed idempotency, required reminder dates, RLS and census registration failed
  eight checks. Removing the read policy separately failed the policy inventory.
- All mutation edits restored exactly. The restored run passed 126 tests in
  12.34 seconds; 25 live tests skipped. Focused lint passed. Runs used one worker,
  private cache, a 768 MiB Node heap and the shared nonblocking compiler lock.
- SQL guards inspect declarations and source inventory, not PostgreSQL execution.
  Fake-client tests assert query projections but cannot prove database constraints,
  permissions, transaction rollback or concurrent membership changes. Component
  tests use mocked navigation and cannot establish real browser behavior.
- Four isolated live transaction/access tests are authored and registered for
  later CI. They have not run or received native mutation controls. No SQL parser
  acceptance, migration application, full suite, build, global TypeScript check,
  service, external message or browser operation occurred in this lane. Root owns
  independent migration/access review, CI/RLS and identified desktop/390px checks.
